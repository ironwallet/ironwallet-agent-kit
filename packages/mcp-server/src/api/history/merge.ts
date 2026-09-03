/**
 * K-way merge of newest-first sources with a resumable cursor.
 *
 * Each source is a paged stream. Per source we remember which page we are on
 * (`cursor`, the value that fetched it) and how many items of that page were
 * already emitted (`skip`). Re-fetching a partially consumed page and skipping
 * is what makes partial consumption exact for cursor-only APIs (TronGrid
 * fingerprints, Esplora last_seen_txid, Solana `before`), where a mid-page
 * cursor cannot be synthesized.
 *
 * Per call we load at most two pages per source, so a window always holds at
 * least `limit` items unless the source is exhausted. The merge then emits up
 * to `limit` items strictly by timestamp. If some source has an empty window
 * but is not exhausted (an API returned fewer rows than asked), we stop early
 * rather than emit out-of-order items — unless nothing was emitted yet, in
 * which case progress beats perfect ordering.
 *
 * Offset-paged indexers (Etherscan-compatible, NodeReal, TronScan, TonCenter)
 * drift when a new transaction lands between two calls: every page shifts by
 * one and the last row of the previous page shows up again. The cursor
 * therefore also carries the boundary — the oldest emitted timestamp and the
 * hashes emitted at it — and later pages drop anything newer than or equal to
 * that boundary. Newer rows are either duplicates or transactions that arrived
 * after the first page; both belong to a fresh query, not to page N.
 */

import type { HistoryItem, HistorySource, SourceContext, SourceItem } from "./types.js";

const CURSOR_VERSION = 1;

export interface SourceState {
  /** Page cursor that fetches the current page (null = first page). */
  cursor: string | null;
  /** Items of that page already emitted. */
  skip: number;
  /** True when the stream is fully consumed. */
  done: boolean;
}

/** Oldest emitted row(s): timestamp and every hash emitted at that timestamp. */
export interface Boundary {
  ts: number;
  h: string[];
}

export interface CursorState {
  v: number;
  /** Provider kind the cursor belongs to (page numbers / fingerprints are kind-specific). */
  p: string;
  s: Record<string, SourceState>;
  b?: Boundary;
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid cursor: not a cursor issued by get_transaction_history.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as CursorState).v !== CURSOR_VERSION ||
    typeof (parsed as CursorState).p !== "string" ||
    !(parsed as CursorState).s ||
    typeof (parsed as CursorState).s !== "object"
  ) {
    throw new Error("Invalid cursor: unsupported format. Call again without cursor.");
  }
  const state = parsed as CursorState;
  for (const [name, st] of Object.entries(state.s)) {
    if (
      !st ||
      typeof st !== "object" ||
      (st.cursor !== null && typeof st.cursor !== "string") ||
      !Number.isInteger(st.skip) ||
      st.skip < 0 ||
      typeof st.done !== "boolean"
    ) {
      throw new Error(`Invalid cursor: bad state for source "${name}".`);
    }
  }
  if (state.b !== undefined) {
    const b = state.b;
    if (
      !b ||
      typeof b !== "object" ||
      !Number.isFinite(b.ts) ||
      !Array.isArray(b.h) ||
      b.h.some((h) => typeof h !== "string")
    ) {
      throw new Error("Invalid cursor: bad boundary.");
    }
  }
  return state;
}

/** True when a row is at or above the boundary, i.e. already emitted or newer than page 1. */
function beforeBoundary(item: SourceItem, b: Boundary | undefined): boolean {
  if (!b) return false;
  return item.ts > b.ts || (item.ts === b.ts && b.h.includes(item.item.hash));
}

interface WindowEntry {
  item: SourceItem;
  /** State to persist once this item has been emitted. */
  after: SourceState;
}

interface Window {
  source: HistorySource;
  entries: WindowEntry[];
  /** No more pages after what was loaded. */
  exhausted: boolean;
  state: SourceState;
}

async function loadWindow(
  source: HistorySource,
  state: SourceState,
  limit: number,
  ctx: SourceContext,
  boundary: Boundary | undefined,
): Promise<Window> {
  if (state.done) return { source, entries: [], exhausted: true, state };

  const entries: WindowEntry[] = [];
  let pageCursor = state.cursor;
  let skip = state.skip;
  let exhausted = false;

  for (let pages = 0; pages < 2; pages++) {
    const page = await source.fetchPage(pageCursor, limit, ctx);
    const items = page.items;
    for (let i = skip; i < items.length; i++) {
      const lastOfPage = i === items.length - 1;
      const after: SourceState =
        lastOfPage && page.next === null
          ? { cursor: pageCursor, skip: i + 1, done: true }
          : lastOfPage
            ? { cursor: page.next, skip: 0, done: false }
            : { cursor: pageCursor, skip: i + 1, done: false };
      // Drifted duplicates and rows newer than page 1 are consumed (state
      // advances past them) but never emitted.
      if (beforeBoundary(items[i], boundary)) {
        if (entries.length === 0) state = after;
        continue;
      }
      entries.push({ item: items[i], after });
    }
    if (page.next === null) {
      exhausted = true;
      break;
    }
    if (entries.length >= limit) break;
    pageCursor = page.next;
    skip = 0;
  }

  // A page that ended exactly at its boundary with `skip` covering all rows:
  // nothing new here, but the stream continues from the next page.
  if (entries.length === 0 && !exhausted) {
    return { source, entries, exhausted: false, state: { cursor: pageCursor, skip: 0, done: false } };
  }
  if (entries.length === 0 && exhausted) {
    return { source, entries, exhausted: true, state: { ...state, done: true } };
  }
  return { source, entries, exhausted, state };
}

const KIND_RANK: Record<HistoryItem["kind"], number> = {
  token_transfer: 0,
  transfer: 1,
  contract_call: 2,
  other: 3,
};

/**
 * Newest first. Ties (same millisecond — common for a token transfer and the
 * call that carried it) go to: the row sharing the last emitted hash, then
 * the more informative kind, then source order.
 */
function pickNext(windows: Window[], heads: number[], last: HistoryItem | undefined): number {
  let best = -1;
  for (let i = 0; i < windows.length; i++) {
    if (heads[i] >= windows[i].entries.length) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const a = windows[i].entries[heads[i]].item;
    const b = windows[best].entries[heads[best]].item;
    if (a.ts !== b.ts) {
      if (a.ts > b.ts) best = i;
      continue;
    }
    const aSame = last !== undefined && a.item.hash === last.hash;
    const bSame = last !== undefined && b.item.hash === last.hash;
    if (aSame !== bSame) {
      if (aSame) best = i;
      continue;
    }
    if (KIND_RANK[a.item.kind] < KIND_RANK[b.item.kind]) best = i;
  }
  return best;
}

export interface MergeResult {
  items: HistoryItem[];
  /** Per-source state after this page; feed back through encodeCursor. */
  state: Record<string, SourceState>;
  /** Oldest emitted row(s) of this page, or the previous boundary when nothing was emitted. */
  boundary: Boundary | undefined;
  hasMore: boolean;
}

/**
 * @param limit    rows to emit
 * @param pageSize rows to request per source page (defaults to `limit`); a
 *                 refill round asks for a full page while emitting only the
 *                 remainder, so it does not crawl in tiny requests
 */
export async function mergeSources(
  sources: HistorySource[],
  limit: number,
  previous: Pick<CursorState, "s" | "b"> | undefined,
  ctx: SourceContext,
  pageSize: number = limit,
): Promise<MergeResult> {
  const windows = await Promise.all(
    sources.map((source) =>
      loadWindow(
        source,
        previous?.s[source.name] ?? { cursor: null, skip: 0, done: false },
        Math.max(limit, pageSize),
        ctx,
        previous?.b,
      ),
    ),
  );

  const heads = windows.map(() => 0);
  const out: HistoryItem[] = [];
  let lastTs = 0;

  for (;;) {
    const best = pickNext(windows, heads, out[out.length - 1]);
    if (best === -1) break;
    const entry = windows[best].entries[heads[best]];

    // Past the limit we only continue while the next row belongs to the same
    // transaction as the last one, so a tx is never split across pages.
    if (out.length >= limit && entry.item.item.hash !== out[out.length - 1]?.hash) break;

    const starved = windows.some(
      (w, i) => heads[i] >= w.entries.length && !w.exhausted && i !== best,
    );
    if (starved && out.length > 0) break;

    heads[best]++;
    windows[best].state = entry.after;
    out.push(entry.item.item);
    lastTs = entry.item.ts;
  }

  const state: Record<string, SourceState> = {};
  let hasMore = false;
  windows.forEach((w, i) => {
    state[w.source.name] = w.state;
    if (heads[i] < w.entries.length || !w.exhausted) hasMore = true;
  });

  let boundary = previous?.b;
  if (out.length > 0) {
    const hashes = new Set<string>();
    windows.forEach((w, i) => {
      for (let k = 0; k < heads[i]; k++) {
        const e = w.entries[k];
        if (e.item.ts === lastTs) hashes.add(e.item.item.hash);
      }
    });
    boundary = { ts: lastTs, h: [...hashes] };
  }

  return { items: out, state, boundary, hasMore };
}
