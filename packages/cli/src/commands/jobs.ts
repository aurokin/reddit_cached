import {
  INBOX_SYNC_DEFAULT_LIMIT,
  JOB_LOCK_STALE_MS,
  type JobStepResult,
  acquireJobLock,
  getJobLockPathForDatabase,
  loadConfig,
  paths,
  readJobLock,
  syncContext,
  syncInbox,
} from "@reddit-saved/core";
import { flagInt, flagStr } from "../args";
import { type CliContext, createContext } from "../context";
import {
  clearProgress,
  isHumanMode,
  printJson,
  printProgress,
  printSection,
  printTable,
} from "../output";
import { runBackupSync } from "./backup";
import { type OriginFetchResult, VALID_TYPES, runFetchForOrigin } from "./fetch";

/**
 * `jobs run` — the scheduled sync pipeline: fetch all origins → capture
 * thread context → sync the inbox → back up. Steps run sequentially; a
 * failing step is recorded but does not abort the rest. Guarded by a
 * cross-process file lock so overlapping launchd/manual runs skip cleanly.
 */

export const JOB_STEPS = ["fetch", "context", "inbox", "backup"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export function parseJobSteps(value: string | undefined): JobStep[] {
  if (!value) return [...JOB_STEPS];
  const requested = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (requested.length === 0) return [...JOB_STEPS];
  for (const step of requested) {
    if (!JOB_STEPS.includes(step as JobStep)) {
      throw new Error(`Unknown job step "${step}". Valid steps: ${JOB_STEPS.join(", ")}`);
    }
  }
  // Preserve canonical pipeline order regardless of how they were listed.
  return JOB_STEPS.filter((s) => requested.includes(s));
}

export async function jobsRunCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const steps = parseJobSteps(flagStr(flags, "steps"));
  const limit = flagInt(flags, "limit");
  const trigger = flagStr(flags, "trigger") ?? "manual";
  const dbPath = flagStr(flags, "db");

  const lockPath = getJobLockPathForDatabase(dbPath ?? paths.database);
  const release = await acquireJobLock(lockPath);
  if (!release) {
    // Another run is in flight — skipping is the expected outcome for an
    // overlapping scheduled run, so it exits 0 and writes no provenance
    // (opening a second writer on the same DB mid-run invites SQLITE_BUSY).
    printJson({ skipped: true, reason: "already-running" });
    return;
  }

  try {
    const ctx = await createContext({ needsApi: true, dbPath });
    try {
      const runId = ctx.storage.startJobRun(trigger);
      const results: JobStepResult[] = [];

      for (const step of steps) {
        const startedAt = Date.now();
        try {
          const result = await runJobStep(step, ctx, { limit, dbPath });
          results.push({ ...result, step, durationMs: Date.now() - startedAt });
        } catch (err) {
          results.push({
            step,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        clearProgress();
      }

      const allOk = results.every((r) => r.ok);
      ctx.storage.finishJobRun(runId, { status: allOk ? "complete" : "errored", steps: results });

      if (!allOk) process.exitCode = 1;

      if (isHumanMode()) {
        for (const r of results) {
          printSection(`Step: ${r.step}`, [
            ["Status", r.ok ? (r.skipped ? `skipped (${r.skipped})` : "ok") : "FAILED"],
            ["Duration", `${Math.round(r.durationMs / 1000)}s`],
            ...(r.error ? [["Error", r.error] as [string, unknown]] : []),
          ]);
        }
        console.log();
      } else {
        printJson({ status: allOk ? "complete" : "errored", trigger, steps: results });
      }
    } finally {
      ctx.close();
    }
  } finally {
    await release();
  }
}

/** Execute one pipeline step. Returns everything except step/durationMs. */
async function runJobStep(
  step: JobStep,
  ctx: CliContext,
  opts: { limit?: number; dbPath?: string },
): Promise<Omit<JobStepResult, "step" | "durationMs">> {
  const api = ctx.apiClient as NonNullable<typeof ctx.apiClient>;

  switch (step) {
    case "fetch": {
      const results: OriginFetchResult[] = [];
      for (const typeStr of VALID_TYPES) {
        printProgress(`jobs: fetching ${typeStr}...`);
        try {
          results.push(
            await runFetchForOrigin(ctx, typeStr, {
              isFull: false,
              limit: opts.limit,
              dbPath: opts.dbPath,
            }),
          );
        } catch (err) {
          results.push({
            type: typeStr,
            status: "errored",
            fetched: 0,
            stored: 0,
            hasMore: false,
            duration: "0s",
            errored: true,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ok: results.every((r) => !r.errored), detail: results };
    }

    case "context": {
      printProgress("jobs: capturing thread context...");
      const result = await syncContext(ctx.storage, api, { limit: opts.limit });
      // Individual item failures retry next run by design — only a cancelled
      // run marks the step as failed.
      return { ok: !result.wasCancelled, detail: result };
    }

    case "inbox": {
      printProgress("jobs: syncing inbox...");
      const syncRunId = ctx.storage.startSyncRun("inbox", "incremental");
      try {
        const result = await syncInbox(ctx.storage, api, {
          limit: opts.limit ?? INBOX_SYNC_DEFAULT_LIMIT,
        });
        ctx.storage.finishSyncRun(syncRunId, {
          status: result.wasCancelled ? "cancelled" : "complete",
          fetched: result.fetched,
        });
        return { ok: !result.wasCancelled, detail: result };
      } catch (err) {
        ctx.storage.finishSyncRun(syncRunId, { status: "errored", fetched: 0 });
        throw err;
      }
    }

    case "backup": {
      const config = await loadConfig();
      if (!config.backup?.repoPath) {
        return { ok: true, skipped: "not-configured" };
      }
      printProgress("jobs: backing up...");
      const result = await runBackupSync(ctx, config.backup, {
        push: config.backup.push === true,
      });
      return { ok: true, detail: result };
    }
  }
}

export async function jobsStatusCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const dbPath = flagStr(flags, "db");
  const limit = flagInt(flags, "limit") ?? 10;

  const ctx = await createContext({ dbPath });
  try {
    const runs = ctx.storage.getJobRunSummaries(limit);
    const lockPath = getJobLockPathForDatabase(dbPath ?? paths.database);
    const lock = await readJobLock(lockPath);

    const now = Date.now();
    const annotated = runs.map((run) => ({
      ...run,
      // Display-only: a run that never finished and is older than the lock's
      // stale window almost certainly crashed.
      crashed: run.finishedAt === null && now - run.startedAt > JOB_LOCK_STALE_MS,
    }));

    if (isHumanMode()) {
      printTable(
        annotated.map((run) => ({
          started: new Date(run.startedAt).toLocaleString(),
          status: run.crashed ? "crashed?" : run.status,
          trigger: run.trigger,
          steps: run.steps
            .map((s) => `${s.step}${s.ok ? "" : "!"}${s.skipped ? "~" : ""}`)
            .join(" "),
        })),
        [
          { key: "started", header: "Started" },
          { key: "status", header: "Status" },
          { key: "trigger", header: "Trigger" },
          { key: "steps", header: "Steps (! failed, ~ skipped)" },
        ],
      );
      console.log(`\nRunning now: ${lock ? `yes (pid ${lock.pid} on ${lock.host})` : "no"}`);
    } else {
      printJson({ runningNow: lock !== null, lock, runs: annotated });
    }
  } finally {
    ctx.close();
  }
}
