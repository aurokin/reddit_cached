#!/usr/bin/env bun
/**
 * Release-binary build: runs the embed codegen (scripts/embed-web-assets.ts),
 * then compiles the generated entry with NODE_ENV=production — Bun inlines
 * process.env.NODE_ENV into compiled binaries, and serve's CSP/logging
 * profile keys off it.
 *
 * Requires a web build in packages/web/dist (repo-root `bun run build:binary`
 * does that first). Usage:
 *
 *   bun run build:binary                             # host target -> dist/reddit-cached
 *   bun run build:binary -- --target=bun-linux-x64   # -> dist/reddit-cached-linux-x64
 *   bun run build:binary -- --target=bun-linux-x64 --outfile=dist/custom
 *
 * Cross targets get distinct default outfiles so a release matrix's builds
 * don't clobber each other. Asset embedding is target-independent, so the
 * same codegen output serves every target.
 */
import { resolve } from "node:path";

let target: string | undefined;
let outfile: string | undefined;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--target=")) {
    target = arg.slice("--target=".length);
  } else if (arg.startsWith("--outfile=")) {
    outfile = arg.slice("--outfile=".length);
  } else {
    console.error(
      `[build-binary] unknown argument: ${arg} (expected --target=... or --outfile=...)`,
    );
    process.exit(1);
  }
}
outfile ??= target ? `dist/reddit-cached-${target.replace(/^bun-/, "")}` : "dist/reddit-cached";

const cliDir = resolve(import.meta.dir, "..");

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, {
    cwd: cliDir,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}

run(["bun", "run", "scripts/embed-web-assets.ts"]);
run([
  "bun",
  "build",
  "./src/index.binary.generated.ts",
  "--compile",
  ...(target ? [`--target=${target}`] : []),
  "--outfile",
  outfile,
]);
console.error(`[build-binary] built ${outfile}${target ? ` for ${target}` : ""}`);
