/**
 * Serve command — boots the web dashboard (API + SPA) via the web package's
 * app factory. The compiled binary serves the SPA from assets embedded at
 * build time (scripts/embed-web-assets.ts); in a source checkout it falls
 * back to packages/web/dist from a prior `vite build`.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AssetSource,
  createDiskAssetSource,
  createEmbeddedAssetSource,
  startServer,
} from "@reddit-cached/web/app";
import { flagInt, flagStr } from "../args";
import { printError } from "../output";
import { getEmbeddedAssets } from "../web-assets";

const DEFAULT_PORT = 3001;

export async function serveCmd(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const port = flagInt(flags, "port") ?? DEFAULT_PORT;

  // The web app resolves its database via REDDIT_CACHED_DB (api/context.ts),
  // so map --db onto it to match the other commands.
  const dbPath = flagStr(flags, "db");
  if (dbPath) {
    process.env.REDDIT_CACHED_DB = resolve(dbPath);
  }

  // serve hosts the built SPA, so run the production profile (strict CSP, no
  // per-request stdout logging). Compiled Bun binaries default NODE_ENV to
  // "development", so an unset env is indistinguishable from an explicit one —
  // force production except under TEST_MODE, which refuses to combine with it.
  const testMode = process.env.TEST_MODE === "1" || process.env.TEST_MODE === "true";
  if (!testMode) {
    process.env.NODE_ENV = "production";
  }

  let staticAssets: AssetSource;
  const embedded = getEmbeddedAssets();
  if (Object.keys(embedded).length > 0) {
    staticAssets = createEmbeddedAssetSource(embedded);
  } else {
    // Source checkout without embedded assets — serve a vite build from disk.
    const distDir = resolve(import.meta.dir, "../../../web/dist");
    if (!existsSync(join(distDir, "index.html"))) {
      printError(
        `No web build found at ${distDir}. Run 'bun run --filter @reddit-cached/web build' first (release binaries built with 'bun run build:binary' embed these assets).`,
        "NO_WEB_BUILD",
      );
      process.exit(1);
    }
    staticAssets = createDiskAssetSource(distDir);
  }

  const server = startServer({ port, staticAssets });
  console.error(`listening on http://${server.hostname}:${server.port}`);
}
