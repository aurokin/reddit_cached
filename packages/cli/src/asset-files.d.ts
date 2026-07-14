/**
 * Bun resolves `import ref from "./x.svg" with { type: "file" }` to a path
 * string (embedded in compiled binaries). These declarations cover the asset
 * extensions the generated web-assets module (scripts/embed-web-assets.ts)
 * may import from packages/web/dist. Extensions bun-types already declares
 * (*.html, *.txt) are omitted — the generated module casts those instead.
 */

declare module "*.js" {
  const path: string;
  export default path;
}

declare module "*.mjs" {
  const path: string;
  export default path;
}

declare module "*.css" {
  const path: string;
  export default path;
}

declare module "*.map" {
  const path: string;
  export default path;
}

declare module "*.svg" {
  const path: string;
  export default path;
}

declare module "*.png" {
  const path: string;
  export default path;
}

declare module "*.jpg" {
  const path: string;
  export default path;
}

declare module "*.jpeg" {
  const path: string;
  export default path;
}

declare module "*.gif" {
  const path: string;
  export default path;
}

declare module "*.webp" {
  const path: string;
  export default path;
}

declare module "*.ico" {
  const path: string;
  export default path;
}

declare module "*.woff" {
  const path: string;
  export default path;
}

declare module "*.woff2" {
  const path: string;
  export default path;
}

declare module "*.webmanifest" {
  const path: string;
  export default path;
}
