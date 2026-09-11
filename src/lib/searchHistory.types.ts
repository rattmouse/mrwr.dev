// Shape of src/data/search-history.json — generated at build time by
// scripts/content/refresh-search-history.mjs from the prod search-log archive,
// gitignored, read only at build time (the site never calls anything at
// runtime). One object per *search session*: a run of edits to the same query
// in one browser session with no long pause.

export type SearchHistoryEntry = {
  /** The recorded query, verbatim (already server-sanitized). */
  query: string;
  /** Render-safe version, present only when the entry tripped a guard rule. */
  displayQuery?: string;
  /** ISO timestamp of the keystroke-change that produced this snapshot. */
  at: string;
  /** Client-measured gap since the previous keystroke-change, ms. */
  inputDeltaMs: number | null;
  flagged?: boolean;
  categories?: string[];
};

/** Where a search ended up: the issue whose body or comment quotes its keystroke log. */
export type SearchIssueLink = {
  number: number;
  /** Set when the log is in a comment rather than the issue body. */
  commentId?: string;
};

export type SearchHistorySession = {
  /** Stable id: `${browserSession}:${firstEntryTimestamp}`. */
  id: string;
  startedAt: string;
  /** Wall-clock span from first to last entry, ms. */
  spanMs: number;
  /** True if any entry in the session tripped a guard rule. */
  flagged: boolean;
  /** Union of every flagged entry's categories, deduped. */
  categories: string[];
  entries: SearchHistoryEntry[];
  /** Resolved at build time from issues.json; absent if the search never became an issue. */
  issue?: SearchIssueLink;
};
