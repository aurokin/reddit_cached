import type { RedditApiClient } from "../api/client";
import type { SqliteAdapter } from "../storage/sqlite-adapter";
import type { InboxItemRow, InboxItemType, RedditItem, RedditItemData } from "../types";

/**
 * Inbox sync: pages through /message/inbox (comment replies, post replies,
 * username mentions, private messages) newest-first into the inbox_items
 * table, which is the source of truth for inbox semantics (type, unread flag).
 *
 * Hybrid storage: t1 items are real Reddit comments on the user's content, so
 * qualifying ones are ALSO stored as content_origin='context' rows in posts —
 * they reach FTS/threads/research through the existing context machinery.
 * t4 private messages never touch the posts table (no permalink/subreddit).
 *
 * The inbox listing is append-mostly, so paging stops early once a full page
 * produces no inserts and no updates (updates include is_new flips, which is
 * how recent unread→read transitions are picked up).
 */

export interface InboxSyncOptions {
  /** Max inbox items to fetch this run (default 200, Reddit caps ~1000) */
  limit?: number;
  signal?: AbortSignal;
  onPage?: (page: number, count: number) => void;
}

export interface InboxSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  /** t1 items mirrored into posts as context rows */
  contextItemsStored: number;
  pages: number;
  stoppedEarly: boolean;
  wasCancelled: boolean;
}

export const INBOX_SYNC_DEFAULT_LIMIT = 200;
const INBOX_PAGE_SIZE = 100;
const INBOX_HARD_CAP = 1000;

export async function syncInbox(
  storage: SqliteAdapter,
  api: RedditApiClient,
  options: InboxSyncOptions = {},
): Promise<InboxSyncResult> {
  const limit = Math.min(options.limit ?? INBOX_SYNC_DEFAULT_LIMIT, INBOX_HARD_CAP);

  const result: InboxSyncResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    contextItemsStored: 0,
    pages: 0,
    stoppedEarly: false,
    wasCancelled: false,
  };

  let after: string | null = null;

  while (result.fetched < limit) {
    if (options.signal?.aborted) {
      result.wasCancelled = true;
      break;
    }

    const pageSize = Math.min(INBOX_PAGE_SIZE, limit - result.fetched);
    let page: { items: RedditItem[]; after: string | null };
    try {
      page = await api.fetchInboxPage("inbox", pageSize, after, options.signal);
    } catch (err) {
      if (options.signal?.aborted) {
        result.wasCancelled = true;
        break;
      }
      throw err;
    }

    if (page.items.length === 0) break;

    result.pages++;
    result.fetched += page.items.length;
    options.onPage?.(result.pages, page.items.length);

    const now = Date.now();
    const rows = page.items.map((item) => toInboxRow(item, now));
    const outcome = storage.upsertInboxItems(rows);
    result.inserted += outcome.inserted;
    result.updated += outcome.updated;

    // Hybrid: mirror this page's t1 items into posts as context rows.
    const contextItems = page.items
      .filter((item) => item.kind === "t1")
      .map(toContextItem)
      .filter((item): item is RedditItem => item !== null);
    if (contextItems.length > 0) {
      storage.upsertContextItems(contextItems);
      result.contextItemsStored += contextItems.length;
    }

    // Append-mostly listing: a page of entirely known, unchanged items means
    // everything older is known too.
    if (outcome.inserted === 0 && outcome.updated === 0) {
      result.stoppedEarly = true;
      break;
    }

    if (!page.after) break;
    after = page.after;
  }

  return result;
}

/** Inbox item shape beyond the shared RedditItemData fields. */
interface InboxItemData extends RedditItemData {
  type?: string;
  was_comment?: boolean;
  subject?: string;
  dest?: string;
  context?: string;
  new?: boolean;
  first_message_name?: string;
  parent_id?: string;
}

/** Classify an inbox child. t4 → message; t1 via Reddit's `type` field with
 *  was_comment/subject fallbacks (Reddit occasionally reports type "unknown"). */
export function deriveInboxType(kind: string, data: InboxItemData): InboxItemType {
  if (kind === "t4") return "message";
  switch (data.type) {
    case "comment_reply":
      return "comment_reply";
    case "post_reply":
      return "post_reply";
    case "username_mention":
      return "mention";
  }
  const subject = (data.subject ?? "").toLowerCase();
  if (subject.includes("username mention")) return "mention";
  if (subject.includes("post reply")) return "post_reply";
  if (data.was_comment === false) return "message";
  return "comment_reply";
}

function toInboxRow(item: RedditItem, now: number): InboxItemRow {
  const d = item.data as InboxItemData;
  return {
    id: d.id,
    name: d.name,
    kind: item.kind,
    type: deriveInboxType(item.kind, d),
    author: d.author ?? null,
    subject: d.subject ?? null,
    body: d.body ?? null,
    dest: d.dest ?? null,
    subreddit: d.subreddit ?? null,
    context: d.context ?? null,
    link_title: d.link_title ?? null,
    parent_id: d.parent_id ?? null,
    first_message_name: d.first_message_name ?? null,
    created_utc: d.created_utc,
    is_new: d.new ? 1 : 0,
    fetched_at: now,
    updated_at: now,
    raw_json: JSON.stringify(item),
  };
}

/** Convert a t1 inbox item into a storable context RedditItem, or null when
 *  it lacks a field the posts mapper requires. Inbox t1s carry `context`
 *  (a permalink with ?context=N) instead of `permalink` — synthesize it. */
function toContextItem(item: RedditItem): RedditItem | null {
  const d = item.data as InboxItemData;
  const permalink = d.permalink ?? d.context?.split("?")[0];
  if (!d.id || !d.name || !permalink || !d.subreddit || d.created_utc === undefined) {
    return null;
  }
  // Strip nested replies like context-sync's toContextItem — descendants are
  // their own rows and threads reassemble via parent_id.
  const { replies: _replies, ...rest } = d;
  return {
    kind: "t1",
    data: {
      ...rest,
      permalink,
      author: rest.author ?? "[deleted]",
      score: rest.score ?? 0,
    },
  };
}
