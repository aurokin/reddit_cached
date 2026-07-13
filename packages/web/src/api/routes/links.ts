/**
 * Link routes — read-only views over the derived link_occurrences index.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAppContext } from "../context";

const app = new Hono();

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HTTPException(400, {
      message: `Invalid '${name}' query parameter. Expected a number.`,
    });
  }
  return parsed;
}

function parseLimit(value: string | undefined, defaultValue: number): number {
  const parsed = parseOptionalNumber(value, "limit") ?? defaultValue;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HTTPException(400, {
      message: "Invalid 'limit' query parameter. Expected a positive integer.",
    });
  }
  return Math.min(parsed, 200);
}

// IMPORTANT: /search before / so Hono doesn't shadow it.
app.get("/search", (c) => {
  const ctx = getAppContext();
  const q = c.req.query("q") ?? "";
  if (!q.trim()) {
    throw new HTTPException(400, { message: "Missing 'q' query parameter." });
  }
  const items = ctx.storage.searchLinks(q, { limit: parseLimit(c.req.query("limit"), 50) });
  return c.json({ items, query: q });
});

app.get("/", (c) => {
  const ctx = getAppContext();
  const items = ctx.storage.topLinks({
    since: parseOptionalNumber(c.req.query("since"), "since"),
    excludeReddit: c.req.query("excludeReddit") === "true",
    limit: parseLimit(c.req.query("limit"), 25),
  });
  return c.json({ items });
});

export default app;
