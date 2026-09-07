"use strict";

// Shared search-session grouping heuristics.
//
// The search box doubles as a scratchpad: every keystroke-change is POSTed to
// /log-search and appended to a durable NDJSON archive on prod. A "session" is
// a maximal run of those records that represents one thought — same browser
// session id, no pause longer than the idle gap, and no hard "typing reset"
// (the query cleared and restarted with something unrelated).
//
// Two consumers need these exact rules:
//   - server.js — buffers live records per browser session and fires a
//     notification once a session goes quiet (SEARCH_NOTIFY_KIND).
//   - scripts/content/refresh-search-history.mjs — re-derives the same sessions
//     at build time for the search-bar history dropdown.
//
// scripts/content/search_to_issue.py keeps its own copy of the same constants
// and heuristics (documented there); keep all three in lockstep.
//
// Kept at the repo root (next to server.js) with zero dependencies so
// scripts/deploy/deploy.sh can copy it into the prod release bundle the same
// way it copies server.js and search-guard.js.

// A session ends after this much silence even within one browser session.
const DEFAULT_IDLE_GAP_S = 180;
// A short, low-overlap entry this long after the previous one starts a fresh
// session rather than continuing the current one.
const RESET_MIN_GAP_S = 4;
// Sessions whose headline is this short or shorter are dropped as noise
// (a stray keystroke, an "x" to clear the box, ...).
const MIN_HEADLINE_LEN = 3;

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * True when `cur` looks like the query was wiped and an unrelated one started,
 * even though not enough time passed to trip the idle gap. Both records carry
 * `query` (string) and `atMs` (epoch ms, or NaN when undated).
 * @returns {boolean}
 */
function isTypingReset(prev, cur) {
  let gapS = 0;
  if (Number.isFinite(prev.atMs) && Number.isFinite(cur.atMs)) {
    gapS = (cur.atMs - prev.atMs) / 1000;
  }
  return (
    gapS > RESET_MIN_GAP_S &&
    commonPrefixLen(prev.query, cur.query) <= 2 &&
    cur.query.length < Math.max(4, prev.query.length * 0.5)
  );
}

/**
 * The headline of a session is its longest entry, trimmed. Records carry
 * `query` (string).
 * @returns {string}
 */
function headlineOf(records) {
  let longest = "";
  for (const rec of records) if (rec.query.length > longest.length) longest = rec.query;
  return longest.trim();
}

module.exports = {
  DEFAULT_IDLE_GAP_S,
  RESET_MIN_GAP_S,
  MIN_HEADLINE_LEN,
  commonPrefixLen,
  isTypingReset,
  headlineOf,
};
