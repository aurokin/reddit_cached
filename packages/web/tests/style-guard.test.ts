import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("style guard", () => {
  test("no arbitrary var(--color-…) utility classes remain in components", () => {
    // The @theme block already generates semantic utilities (bg-card,
    // border-border, …) for every color token; the arbitrary-value spelling is
    // pure verbosity. Functional uses like color-mix(...var(--color-x)...) are
    // allowed — they compute a color rather than alias one.
    const offenders: string[] = [];
    for (const file of collectTsx(join(import.meta.dir, "../src"))) {
      const content = readFileSync(file, "utf8");
      for (const [index, line] of content.split("\n").entries()) {
        if (line.includes("-[var(--color-")) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
