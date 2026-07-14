import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

/** Route-like URLs should fall back to index.html; asset/file requests should not. */
export function shouldServeSpaFallback(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/assets/")) return false;
  return extname(pathname) === "";
}

/** Resolve a request pathname beneath dist/ without allowing absolute-path or
 *  traversal escapes. Returns null for the root route or invalid paths. */
export function resolveDistAssetPath(distDir: string, pathname: string): string | null {
  if (pathname === "/") return null;

  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) return null;

  const assetPath = resolve(distDir, relativePath);
  const relativeToDist = relative(distDir, assetPath);
  if (relativeToDist.startsWith("..") || isAbsolute(relativeToDist)) {
    return null;
  }

  return assetPath;
}

/** Where the SPA's static files come from: a dist/ directory on disk (bun run
 *  start) or a manifest of files embedded in the compiled CLI binary. */
export interface AssetSource {
  /** True when the request pathname maps to a servable file. */
  has(pathname: string): boolean;
  /** The file for a pathname `has()` accepted. */
  file(pathname: string): ReturnType<typeof Bun.file>;
  /** The SPA index.html, or null when missing. */
  indexHtml(): ReturnType<typeof Bun.file> | null;
}

/** Serve from a vite dist/ directory, guarding against path escapes. */
export function createDiskAssetSource(distDir: string): AssetSource {
  const resolveExisting = (pathname: string): string | null => {
    const assetPath = resolveDistAssetPath(distDir, pathname);
    if (!assetPath || !existsSync(assetPath)) return null;
    return statSync(assetPath).isFile() ? assetPath : null;
  };

  return {
    has: (pathname) => resolveExisting(pathname) !== null,
    file: (pathname) => {
      const assetPath = resolveExisting(pathname);
      if (!assetPath) throw new Error(`No dist asset for ${pathname}`);
      return Bun.file(assetPath);
    },
    indexHtml: () => {
      const indexPath = join(distDir, "index.html");
      return existsSync(indexPath) ? Bun.file(indexPath) : null;
    },
  };
}

/** Serve from a manifest of request pathname → embedded file reference
 *  (Bun `with { type: "file" }` imports in a compiled binary). */
export function createEmbeddedAssetSource(manifest: Record<string, string>): AssetSource {
  return {
    has: (pathname) => pathname in manifest,
    file: (pathname) => {
      const ref = manifest[pathname];
      if (ref === undefined) throw new Error(`No embedded asset for ${pathname}`);
      return Bun.file(ref);
    },
    indexHtml: () => {
      const ref = manifest["/index.html"];
      return ref === undefined ? null : Bun.file(ref);
    },
  };
}
