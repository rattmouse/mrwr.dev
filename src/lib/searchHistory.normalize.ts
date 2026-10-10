import type { SearchHistoryEntry, SearchHistorySession } from "@/lib/searchHistory.types";

// Validates one session from search-history.json, or from the approved list
// server.js serves at /search-history/live. No Node imports, so the browser
// can use it too.

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

export function normalizeSession(raw: unknown): SearchHistorySession | null {
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
