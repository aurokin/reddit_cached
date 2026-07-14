import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "@/api/app";
import { closeAppContext } from "@/api/context";
import { createEmbeddedAssetSource } from "@/api/static";

describe("createApp", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-cached-web-app-"));
    process.env.REDDIT_CACHED_DB = join(tempDir, "test.db");
    writeFileSync(join(tempDir, "index.html"), '<html><div id="root"></div></html>');
    writeFileSync(join(tempDir, "app.js"), "console.log(1);");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_CACHED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeApp() {
    return createApp({
      staticAssets: createEmbeddedAssetSource({
        "/index.html": join(tempDir, "index.html"),
        "/assets/index-abc123.js": join(tempDir, "app.js"),
      }),
    });
  }

  test("mounts the API alongside static serving", async () => {
    const res = await makeApp().request("http://localhost/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("serves assets with their MIME type", async () => {
    const res = await makeApp().request("http://localhost/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript");
    expect(await res.text()).toBe("console.log(1);");
  });

  test("serves the SPA index for / and route-like paths", async () => {
    const app = makeApp();
    for (const path of ["/", "/settings"]) {
      const res = await app.request(`http://localhost${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  test("404s missing assets and unknown /api/ paths instead of falling back", async () => {
    const app = makeApp();
    expect((await app.request("http://localhost/assets/index-oldhash.js")).status).toBe(404);
    expect((await app.request("http://localhost/api/nope")).status).toBe(404);
  });

  test("has no static fallback without an asset source", async () => {
    const app = createApp();
    expect((await app.request("http://localhost/")).status).toBe(404);
    expect((await app.request("http://localhost/api/health")).status).toBe(200);
  });
});
