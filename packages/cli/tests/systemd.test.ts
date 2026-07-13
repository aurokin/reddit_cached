import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveJobsProgramArguments } from "../src/launchd";
import {
  DEFAULT_JOBS_INTERVAL_SECONDS,
  DEFAULT_JOBS_UNIT_NAME,
  buildJobsServiceUnit,
  buildJobsTimerUnit,
} from "../src/systemd";

const CLI_PATH = join(import.meta.dir, "../src/index.ts");

describe("resolveJobsProgramArguments with a systemd trigger", () => {
  test("passes --trigger systemd", () => {
    expect(
      resolveJobsProgramArguments({
        execPath: "/usr/bin/bun",
        mainPath: "/repo/packages/cli/src/index.ts",
        trigger: "systemd",
      }),
    ).toEqual([
      "/usr/bin/bun",
      "/repo/packages/cli/src/index.ts",
      "jobs",
      "run",
      "--trigger",
      "systemd",
    ]);
  });

  test("defaults to launchd when no trigger is given", () => {
    expect(
      resolveJobsProgramArguments({ execPath: "/usr/bin/bun", mainPath: "/repo/index.ts" }),
    ).toContain("launchd");
  });
});

describe("buildJobsServiceUnit", () => {
  const base = {
    description: "Reddit Cached jobs pipeline",
    execStartArguments: ["/usr/bin/bun", "/repo/index.ts", "jobs", "run", "--trigger", "systemd"],
  };

  test("contains the section headers and oneshot service keys", () => {
    const unit = buildJobsServiceUnit(base);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=Reddit Cached jobs pipeline");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain("ExecStart=/usr/bin/bun /repo/index.ts jobs run --trigger systemd");
  });

  test("omits WorkingDirectory unless provided", () => {
    expect(buildJobsServiceUnit(base)).not.toContain("WorkingDirectory");
    expect(buildJobsServiceUnit({ ...base, workingDirectory: "/repo" })).toContain(
      "WorkingDirectory=/repo",
    );
  });

  const quotingCases: Array<{ name: string; arg: string; expected: string }> = [
    { name: "plain args stay unquoted", arg: "--steps", expected: "--steps" },
    {
      name: "args containing spaces are double-quoted",
      arg: "/path with spaces/index.ts",
      expected: '"/path with spaces/index.ts"',
    },
    {
      name: "double quotes are backslash-escaped inside quotes",
      arg: 'say "hi"',
      expected: '"say \\"hi\\""',
    },
    {
      name: "backslashes are escaped inside quotes",
      arg: 'back\\slash "x"',
      expected: '"back\\\\slash \\"x\\""',
    },
    {
      name: "single quotes trigger double-quoting",
      arg: "it's",
      expected: '"it\'s"',
    },
  ];

  for (const c of quotingCases) {
    test(c.name, () => {
      const unit = buildJobsServiceUnit({ ...base, execStartArguments: ["/bin/x", c.arg] });
      expect(unit).toContain(`ExecStart=/bin/x ${c.expected}`);
    });
  }
});

describe("buildJobsTimerUnit", () => {
  const base = {
    description: "Run the Reddit Cached jobs pipeline periodically",
    intervalSeconds: DEFAULT_JOBS_INTERVAL_SECONDS,
    unitName: DEFAULT_JOBS_UNIT_NAME,
  };

  test("contains the timer keys with the right values", () => {
    const unit = buildJobsTimerUnit(base);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=Run the Reddit Cached jobs pipeline periodically");
    expect(unit).toContain("[Timer]");
    expect(unit).toContain("OnBootSec=120");
    expect(unit).toContain("OnUnitActiveSec=3600");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=timers.target");
  });

  test("cross-references the service unit by name", () => {
    expect(buildJobsTimerUnit(base)).toContain(`Unit=${DEFAULT_JOBS_UNIT_NAME}.service`);
    expect(buildJobsTimerUnit({ ...base, unitName: "custom-jobs" })).toContain(
      "Unit=custom-jobs.service",
    );
  });

  test("clamps the interval to at least 60 seconds", () => {
    expect(buildJobsTimerUnit({ ...base, intervalSeconds: 5 })).toContain("OnUnitActiveSec=60");
    expect(buildJobsTimerUnit({ ...base, intervalSeconds: 90.9 })).toContain("OnUnitActiveSec=90");
  });
});

describe("systemd platform guard", () => {
  // Mirrors the launchd darwin guard: on non-Linux hosts the command must
  // refuse to run. Skipped on Linux, where the guard passes by design.
  test.if(process.platform !== "linux")(
    "install-systemd exits 1 with UNSUPPORTED_PLATFORM on non-Linux",
    async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "jobs", "install-systemd"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      expect(proc.exitCode).toBe(1);
      expect(stderr).toContain("UNSUPPORTED_PLATFORM");
      expect(stderr).toContain("systemd scheduling is only available on Linux.");
    },
  );

  test.if(process.platform !== "linux")(
    "uninstall-systemd exits 1 with UNSUPPORTED_PLATFORM on non-Linux",
    async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "jobs", "uninstall-systemd"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      expect(proc.exitCode).toBe(1);
      expect(stderr).toContain("UNSUPPORTED_PLATFORM");
    },
  );
});
