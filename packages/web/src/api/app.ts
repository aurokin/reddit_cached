/**
 * App factory — builds the Hono app (API routes plus optional static/SPA
 * fallback) and starts Bun.serve. Consumed by the server entry (server.ts)
 * and by the CLI's `serve` command in the compiled single-file binary.
 */
import { extname } from "node:path";
import { Hono } from "hono";
import { getAppContext } from "./context";
import { cspMiddleware, errorHandler, loggerMiddleware } from "./middleware";
import authRoute from "./routes/auth";
import exportRoute from "./routes/export";
import inboxRoute from "./routes/inbox";
import jobsRoute from "./routes/jobs";
import linksRoute from "./routes/links";
import postsRoute from "./routes/posts";
import syncRoute, { unsaveHandler } from "./routes/sync";
import tagsRoute from "./routes/tags";
import todayRoute from "./routes/today";
import { type AssetSource, shouldServeSpaFallback } from "./static";

export { createDiskAssetSource, createEmbeddedAssetSource } from "./static";
export type { AssetSource } from "./static";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface CreateAppOptions {
  /** When set, non-/api/* requests are served from this source with an
   *  index.html SPA fallback (production behavior). */
  staticAssets?: AssetSource | null;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  app.use("*", loggerMiddleware());
  app.use("*", cspMiddleware());

  // Boot the singleton now so schema/migrations run before the first request
  getAppContext();

  app.route("/api/auth", authRoute);
  app.route("/api/posts", postsRoute);
  app.route("/api/tags", tagsRoute);
  app.route("/api/links", linksRoute);
  app.route("/api/today", todayRoute);
  app.route("/api/inbox", inboxRoute);
  app.route("/api/jobs", jobsRoute);
  app.route("/api/sync", syncRoute);
  app.route("/api/unsave", unsaveHandler);
  app.route("/api/export", exportRoute);

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.onError(errorHandler);

  // SPA fallback — only when a static source is configured, only for non-/api/* paths.
  const assets = options.staticAssets;
  if (assets) {
    app.get("*", async (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith("/api/")) {
        return c.notFound();
      }
      if (assets.has(url.pathname)) {
        const file = assets.file(url.pathname);
        const mime = MIME[extname(url.pathname).toLowerCase()] ?? "application/octet-stream";
        c.header("Content-Type", mime);
        return c.body(await file.arrayBuffer());
      }
      if (!shouldServeSpaFallback(url.pathname)) {
        return c.notFound();
      }
      // Fallback: SPA index
      const index = assets.indexHtml();
      if (index) {
        c.header("Content-Type", "text/html");
        return c.body(await index.text());
      }
      return c.notFound();
    });
  }

  return app;
}

export interface StartServerOptions extends CreateAppOptions {
  port: number;
}

export function startServer(options: StartServerOptions): ReturnType<typeof Bun.serve> {
  const app = createApp(options);
  return Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
    idleTimeout: 120, // SSE syncs may run a while
  });
}
