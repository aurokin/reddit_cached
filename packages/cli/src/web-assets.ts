/**
 * Registry for the web dashboard assets embedded in the compiled binary.
 *
 * The committed default is the fallback stub: an empty manifest, meaning "no
 * embedded SPA" — `serve` then falls back to packages/web/dist on disk. The
 * `build:binary` codegen (scripts/embed-web-assets.ts) generates a binary
 * entry that registers the real manifest before the CLI boots.
 */

/** Request pathname ("/assets/index-abc.js") → embedded file reference. */
export type AssetManifest = Record<string, string>;

let embedded: AssetManifest = {};

export function setEmbeddedAssets(manifest: AssetManifest): void {
  embedded = manifest;
}

export function getEmbeddedAssets(): AssetManifest {
  return embedded;
}
