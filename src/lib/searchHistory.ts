import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  SearchHistoryEntry,
  SearchHistorySession,
  SearchIssueLink,
} from "@/lib/searchHistory.types";

// Read at build time only. Missing/empty/corrupt file -> [] so `next dev` and a
// plain `next build` work before the first refresh-search-history.sh run, the
// same way the site tolerates a stale issues.json.
const DATA_PATH = resolve(process.cwd(), "src/data/search-history.json");
const ISSUES_PATH = resolve(process.cwd(), "src/data/issues.json");

// The `@ <ISO>` stamp on each line of a keystroke log quoted into an issue.
const LOG_STAMP = /@\s*(\d{4}-\d{2}-\d{2}T[^\s]+)/g;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function normalizeEntry(raw: unknown): SearchHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const query = asString(r.query);
  if (!query) return null;

  const rawDelta = r.inputDeltaMs;
  const inputDeltaMs =
    typeof rawDelta === "number" && Number.isFinite(rawDelta) ? Math.max(0, rawDelta) : null;

  const entry: SearchHistoryEntry = {
    query,
    at: asString(r.at),
    inputDeltaMs,
  };

  const displayQuery = asString(r.displayQuery);
  if (displayQuery) entry.displayQuery = displayQuery;

  const categories = asStringArray(r.categories);
  if (r.flagged === true || categories.length > 0) {
    entry.flagged = true;
    entry.categories = categories;
  }

  return entry;
}

function normalizeSession(raw: unknown): SearchHistorySession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const entries = Array.isArray(r.entries)
    ? r.entries.map(normalizeEntry).filter((e): e is SearchHistoryEntry => e !== null)
    : [];
  if (entries.length === 0) return null;

  const startedAt = asString(r.startedAt) || entries[0].at;
  const spanMs =
    typeof r.spanMs === "number" && Number.isFinite(r.spanMs) ? Math.max(0, r.spanMs) : 0;

  const categories = asStringArray(r.categories);
  const flagged = r.flagged === true || entries.some((e) => e.flagged);
  const mergedCategories = flagged
    ? Array.from(new Set([...categories, ...entries.flatMap((e) => e.categories ?? [])]))
    : [];

  return {
    id: asString(r.id) || `${startedAt}:${entries.length}`,
    startedAt,
    spanMs,
    flagged,
    categories: mergedCategories,
    entries,
  };
}

// One issue body or comment that quotes a keystroke log.
type LogQuote = { link: SearchIssueLink; atMs: number; stamps: Set<string> };

// A search that became an issue has its keystroke log (`- 'query' @ <ISO> +Nms`)
// quoted in the issue body or a comment. Collect every such quote so a session
// can find its way back there.
function collectLogQuotes(): LogQuote[] {
  const quotes: LogQuote[] = [];
  const issues = readJson(ISSUES_PATH);
  if (!Array.isArray(issues)) return quotes;

  const add = (text: unknown, createdAt: unknown, link: SearchIssueLink) => {
    if (typeof text !== "string") return;
    const stamps = new Set(Array.from(text.matchAll(LOG_STAMP), (m) => m[1]));
    if (stamps.size === 0) return;
    const atMs = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    quotes.push({ link, atMs: Number.isFinite(atMs) ? atMs : Number.POSITIVE_INFINITY, stamps });
  };

  for (const raw of issues) {
    if (!raw || typeof raw !== "object") continue;
    const issue = raw as Record<string, unknown>;
    const number = issue.number;
    if (typeof number !== "number") continue;

    add(issue.body, issue.createdAt, { number });
    if (!Array.isArray(issue.comments)) continue;
    for (const comment of issue.comments) {
      if (!comment || typeof comment !== "object") continue;
      const c = comment as Record<string, unknown>;
      add(c.body, c.createdAt, typeof c.id === "string" ? { number, commentId: c.id } : { number });
    }
  }
  return quotes;
}

// The same log can be quoted in more than one place (e.g. pasted into a
// meta-issue as an example). Take the quote with the most of this session's
// keystrokes, then the earliest — where the search was first filed.
function findIssue(session: SearchHistorySession, quotes: LogQuote[]): SearchIssueLink | undefined {
  let best: LogQuote | undefined;
  let bestHits = 0;
  for (const quote of quotes) {
    const hits = session.entries.filter((e) => quote.stamps.has(e.at)).length;
    if (hits > bestHits || (hits > 0 && hits === bestHits && best && quote.atMs < best.atMs)) {
      best = quote;
      bestHits = hits;
    }
  }
  return best?.link;
}

export function getSearchHistory(): SearchHistorySession[] {
  const parsed = readJson(DATA_PATH);
  if (!Array.isArray(parsed)) return [];

  const sessions = parsed
    .map(normalizeSession)
    .filter((s): s is SearchHistorySession => s !== null);

  const quotes = collectLogQuotes();
  for (const session of sessions) {
    const link = findIssue(session, quotes);
    if (link) session.issue = link;
  }

  // Newest first.
  sessions.sort((a, b) => {
    const at = Date.parse(a.startedAt);
    const bt = Date.parse(b.startedAt);
    const av = Number.isFinite(at) ? at : 0;
    const bv = Number.isFinite(bt) ? bt : 0;
    return bv - av;
  });

  return sessions;
}
