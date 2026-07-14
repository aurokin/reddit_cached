import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createDiskAssetSource,
  createEmbeddedAssetSource,
  resolveDistAssetPath,
  shouldServeSpaFallback,
} from "@/api/static";

describe("shouldServeSpaFallback", () => {
  test("allows route-like URLs", () => {
    expect(shouldServeSpaFallback("/")).toBe(true);
    expect(shouldServeSpaFallback("/settings")).toBe(true);
    expect(shouldServeSpaFallback("/posts/abc123")).toBe(true);
  });

  test("rejects asset and file-like URLs", () => {
    expect(shouldServeSpaFallback("/assets/index-oldhash.js")).toBe(false);
    expect(shouldServeSpaFallback("/assets/chunk")).toBe(false);
    expect(shouldServeSpaFallback("/favicon.ico")).toBe(false);
    expect(shouldServeSpaFallback("/site.webmanifest")).toBe(false);
  });
});

describe("resolveDistAssetPath", () => {
  const distDir = "/tmp/reddit-cached-dist";

  test("resolves request paths relative to dist", () => {
    expect(resolveDistAssetPath(distDir, "/assets/index-abc123.js")).toBe(
      resolve(distDir, "assets/index-abc123.js"),
    );
    expect(resolveDistAssetPath(distDir, "/favicon.ico")).toBe(resolve(distDir, "favicon.ico"));
  });

  test("returns null for the root route and traversal attempts", () => {
    expect(resolveDistAssetPath(distDir, "/")).toBeNull();
    expect(resolveDistAssetPath(distDir, "/../etc/passwd")).toBeNull();
  });
});

describe("createDiskAssetSource", () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), "reddit-cached-static-"));
    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<html>spa</html>");
    writeFileSync(join(distDir, "assets", "index-abc123.js"), "console.log(1);");
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  test("serves existing files and index.html", async () => {
    const source = createDiskAssetSource(distDir);

    expect(source.has("/assets/index-abc123.js")).toBe(true);
    expect(await source.file("/assets/index-abc123.js").text()).toBe("console.log(1);");
    expect(await source.indexHtml()?.text()).toBe("<html>spa</html>");
  });

  test("rejects missing files, directories, and traversal attempts", () => {
    const source = createDiskAssetSource(distDir);

    expect(source.has("/assets/missing.js")).toBe(false);
    expect(source.has("/assets")).toBe(false);
    expect(source.has("/../etc/passwd")).toBe(false);
  });

  test("indexHtml is null when dist has no index.html", () => {
    const source = createDiskAssetSource(join(distDir, "assets"));
    expect(source.indexHtml()).toBeNull();
  });
});

describe("createEmbeddedAssetSource", () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), "reddit-cached-embedded-"));
    writeFileSync(join(distDir, "index.html"), "<html>embedded</html>");
    writeFileSync(join(distDir, "app.js"), "console.log(2);");
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  test("serves only manifest entries", async () => {
    const source = createEmbeddedAssetSource({
      "/index.html": join(distDir, "index.html"),
      "/assets/index-abc123.js": join(distDir, "app.js"),
    });

    expect(source.has("/assets/index-abc123.js")).toBe(true);
    expect(source.has("/assets/other.js")).toBe(false);
    expect(await source.file("/assets/index-abc123.js").text()).toBe("console.log(2);");
    expect(await source.indexHtml()?.text()).toBe("<html>embedded</html>");
  });

  test("indexHtml is null when the manifest has no index.html", () => {
    const source = createEmbeddedAssetSource({});
    expect(source.indexHtml()).toBeNull();
  });
});
