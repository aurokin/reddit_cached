/**
 * Hono entry — boots the API on :3001. In production, serves Vite's dist/ SPA
 * as a fallback for any non-/api/* request.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "./app";
import { getAppContext } from "./context";
import { createDiskAssetSource } from "./static";

const PORT = Number(process.env.PORT ?? 3001);
const DIST_DIR = resolve(process.cwd(), "dist");
const IS_PROD = process.env.NODE_ENV === "production";

if (IS_PROD && !existsSync(DIST_DIR)) {
  console.warn(
    `[server] NODE_ENV=production but no dist/ found at ${DIST_DIR}. Run 'bun run build' first.`,
  );
}

const server = startServer({
  port: PORT,
  staticAssets: IS_PROD ? createDiskAssetSource(DIST_DIR) : null,
});

const ctx = getAppContext();
console.log(
  `[server] listening on http://${server.hostname}:${server.port} (testMode=${ctx.testMode}, prod=${IS_PROD})`,
);

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  server.stop(false);
  process.exit(0);
});
