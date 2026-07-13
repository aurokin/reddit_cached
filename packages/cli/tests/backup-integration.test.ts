/**
 * End-to-end integration tests for the JSONL/git backup subsystem: a real
 * SQLite database, real git repositories (a bare "remote" plus a working
 * clone), and the real runBackupSync helper the CLI and jobs pipeline use.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type InboxItemRow, SqliteAdapter, isGitRepo, runGit } from "@reddit-cached/core";
import { runBackupSync } from "../src/commands/backup";
import { type CliContext, createContext } from "../src/context";
import { setOutputMode } from "../src/output";
import { makeItem, makeTempDb } from "./helpers";

const originalEnv = { ...process.env };

const UTC_2021 = 1_620_000_000; // 2021-05-03
const UTC_2023 = 1_690_000_000; // 2023-07-22

function makeInboxRow(id: string, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  return {
    id,
    name: `t1_${id}`,
    kind: "t1",
    type: "comment_reply",
    author: "replier",
    subject: "comment reply",
    body: `body ${id}`,
    dest: "me",
    subreddit: "testsub",
    context: `/r/testsub/comments/p/t/${id}/?context=3`,
    link_title: "My post",
    parent_id: "t1_mine",
    first_message_name: null,
    created_utc: 1_700_000_000,
    is_new: 1,
    fetched_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    raw_json: "{}",
    ...overrides,
  };
}

async function gitOk(repoPath: string, args: string[]): Promise<string> {
  const result = await runGit(repoPath, args);
  expect(result.code).toBe(0);
  return result.stdout;
}

function jsonlIds(path: string, key = "id"): string[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)[key]);
}

describe("backup end-to-end against real git", () => {
  let dbPath: string;
  let tempDir: string;
  let remotePath: string;
  let clonePath: string;
  let ctx: CliContext;

  beforeEach(async () => {
    dbPath = makeTempDb();
    tempDir = mkdtempSync(join(tmpdir(), "backup-e2e-"));
    remotePath = join(tempDir, "remote.git");
    clonePath = join(tempDir, "clone");
    setOutputMode(false, false, false);

    const configDir = join(tempDir, "config");
    mkdirSync(configDir, { recursive: true });
    process.env.REDDIT_CACHED_CONFIG_DIR = configDir;
    process.env.XDG_DATA_HOME = tempDir;

    // Bare "remote" plus a working clone, hermetic identity/branch config.
    mkdirSync(remotePath, { recursive: true });
    await gitOk(remotePath, ["init", "--bare", "--initial-branch=main"]);
    await gitOk(tempDir, ["clone", remotePath, clonePath]);
    await gitOk(clonePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await gitOk(clonePath, ["config", "user.email", "backup-test@example.com"]);
    await gitOk(clonePath, ["config", "user.name", "Backup Test"]);

    // Seed: posts across multiple origins and years, tags, inbox items.
    const seed = new SqliteAdapter(dbPath);
    seed.upsertPosts(
      [
        makeItem({ id: "sv1", subreddit: "alpha", created_utc: UTC_2021 }),
        makeItem({ id: "sv2", subreddit: "alpha", created_utc: UTC_2023 }),
      ],
      "saved",
    );
    seed.upsertPosts(
      [makeItem({ id: "up1", subreddit: "beta", created_utc: UTC_2023 })],
      "upvoted",
    );
    seed.upsertInboxItems([
      makeInboxRow("ib1"),
      makeInboxRow("ib2", { name: "t4_ib2", kind: "t4", type: "message", subreddit: null }),
    ]);
    seed.close();

    ctx = await createContext({ dbPath });
    const tag = ctx.tags.createTag("ml");
    ctx.tags.addTagToPost(tag.name, "sv1");
  });

  afterEach(() => {
    ctx.close();
    setOutputMode(false, false, false);
    for (const key of ["REDDIT_CACHED_CONFIG_DIR", "XDG_DATA_HOME"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("sync writes round-trippable JSONL, commits once, and re-commits only on change", async () => {
    const first = await runBackupSync(ctx, { repoPath: clonePath }, { push: false });
    expect(first.committed).toBe(true);
    expect(first.pushed).toBe(false);

    // Expected file layout (posts sharded by UTC year of created_utc)
    for (const rel of [
      "data/posts/2021.jsonl",
      "data/posts/2023.jsonl",
      "data/tags.jsonl",
      "data/post_tags.jsonl",
      "data/sync_state.jsonl",
      "data/inbox_items.jsonl",
      "manifest.json",
    ]) {
      expect(existsSync(join(clonePath, rel))).toBe(true);
    }

    // JSONL content round-trips: parse every line, find seeded rows
    expect(jsonlIds(join(clonePath, "data/posts/2021.jsonl"))).toEqual(["sv1"]);
    expect(jsonlIds(join(clonePath, "data/posts/2023.jsonl")).sort()).toEqual(["sv2", "up1"]);
    expect(jsonlIds(join(clonePath, "data/inbox_items.jsonl"))).toEqual(["ib1", "ib2"]);
    expect(jsonlIds(join(clonePath, "data/tags.jsonl"), "name")).toEqual(["ml"]);

    // Manifest agrees with the sync output and lists every data file
    const manifest = JSON.parse(readFileSync(join(clonePath, "manifest.json"), "utf8"));
    expect(manifest.backupHash).toBe(first.backupHash);
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain("data/inbox_items.jsonl");

    // Exactly one commit was created in the clone
    const log = await gitOk(clonePath, ["log", "--format=%s"]);
    expect(log.split("\n")).toHaveLength(1);
    expect(log).toMatch(/^backup: /);
    expect((await gitOk(clonePath, ["status", "--porcelain"])).trim()).toBe("");

    // Idempotence: same database state → nothing written, no second commit
    const second = await runBackupSync(ctx, { repoPath: clonePath }, { push: false });
    expect(second.committed).toBe(false);
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.backupHash).toBe(first.backupHash);
    expect((await gitOk(clonePath, ["log", "--format=%s"])).split("\n")).toHaveLength(1);

    // Change one row (tag another post) → new commit touching the changed file
    ctx.tags.addTagToPost("ml", "sv2");
    const third = await runBackupSync(ctx, { repoPath: clonePath }, { push: false });
    expect(third.committed).toBe(true);
    expect(third.written).toContain("data/post_tags.jsonl");
    expect(third.backupHash).not.toBe(first.backupHash);

    const commits = (await gitOk(clonePath, ["log", "--format=%s"])).split("\n");
    expect(commits).toHaveLength(2);
    const changed = await gitOk(clonePath, ["show", "--name-only", "--format=", "HEAD"]);
    expect(changed.split("\n")).toContain("data/post_tags.jsonl");
  });

  test("push advances the bare remote's ref, including the first push to an empty remote", async () => {
    const config = { repoPath: clonePath, remote: "origin", push: true };

    // First sync: the remote is empty, so pull --ff-only has nothing to
    // fetch — the sync must tolerate that and still commit + push.
    const first = await runBackupSync(ctx, config, { push: true });
    expect(first.committed).toBe(true);
    expect(first.pushed).toBe(true);

    const remoteSha = await gitOk(remotePath, ["rev-parse", "refs/heads/main"]);
    expect(remoteSha).toBe(await gitOk(clonePath, ["rev-parse", "HEAD"]));

    // Change a row and sync again: the remote ref must advance
    ctx.storage.upsertInboxItems([makeInboxRow("ib3")]);
    const second = await runBackupSync(ctx, config, { push: true });
    expect(second.pulled).toBe(true);
    expect(second.committed).toBe(true);
    expect(second.pushed).toBe(true);

    const advancedSha = await gitOk(remotePath, ["rev-parse", "refs/heads/main"]);
    expect(advancedSha).not.toBe(remoteSha);
    expect(advancedSha).toBe(await gitOk(clonePath, ["rev-parse", "HEAD"]));
  });

  test("no-change sync with push enabled does not push and the remote stays put", async () => {
    const config = { repoPath: clonePath, remote: "origin", push: true };
    await runBackupSync(ctx, config, { push: true });
    const remoteSha = await gitOk(remotePath, ["rev-parse", "refs/heads/main"]);

    const repeat = await runBackupSync(ctx, config, { push: true });
    expect(repeat.committed).toBe(false);
    expect(repeat.pushed).toBe(false);
    expect(await gitOk(remotePath, ["rev-parse", "refs/heads/main"])).toBe(remoteSha);
  });

  test("fails with a clear git error when the target directory is not a repository", async () => {
    const plainDir = join(tempDir, "not-a-repo");
    mkdirSync(plainDir, { recursive: true });
    expect(await isGitRepo(plainDir)).toBe(false);

    await expect(runBackupSync(ctx, { repoPath: plainDir }, { push: false })).rejects.toThrow(
      /not a git repository/i,
    );
  });

  test("fails when the configured remote does not exist in the repo", async () => {
    await expect(
      runBackupSync(ctx, { repoPath: clonePath, remote: "missing" }, { push: true }),
    ).rejects.toThrow(/remote "missing" does not exist/);
  });
});
