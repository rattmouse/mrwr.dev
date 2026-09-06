#!/usr/bin/env node
// Build src/data/search-history.json from the prod search-log NDJSON archive.
//
// The search box doubles as a scratchpad: every keystroke-change is POSTed to
// /log-search and appended to a durable NDJSON archive on prod
// ($PROD_BASE/shared/search-log.ndjson, + one rotated .1). This script groups
// those records into *search sessions* and writes the file the search-bar
// history dropdown reads. Like issues.json it is gitignored and consumed only
// at build time — the site never calls anything at runtime.
//
// scripts/content/refresh-search-history.sh fetches the archive over ssh (or
// takes a local copy with --file) and then runs this. scripts/deploy/deploy.sh
// calls that wrapper before every build.
//
// Session grouping mirrors scripts/content/search_to_issue.py exactly (same
// idle gap, same "typing reset" heuristic, same minimum headline length) so the
// dropdown and the issue-triage tool carve the same log into the same sessions.
//
// Never fatal: any failure prints a warning and writes `[]` so a build still
// succeeds (with an empty history) rather than breaking.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const OUT_PATH = resolve(REPO_ROOT, "src/data/search-history.json");

const { detectMaliciousSearch, defang } = require(resolve(REPO_ROOT, "search-guard.js"));

// --- session-grouping knobs (keep in lockstep with search_to_issue.py) -------
const DEFAULT_IDLE_GAP_S = 180; // silence this long ends a session
const RESET_MIN_GAP_S = 4; // a short, low-overlap entry this long after the
//                            previous one starts a fresh session
const MIN_HEADLINE_LEN = 3; // sessions with a headline this short are noise
const DEFAULT_MAX_SESSIONS = 250; // newest N kept in the shipped file

function warn(msg) {
  process.stderr.write(`refresh-search-history: ${msg}\n`);
}

function parseArgs(argv) {
  const args = { records: "", since: "", maxSessions: DEFAULT_MAX_SESSIONS, idleGap: DEFAULT_IDLE_GAP_S };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--records" && argv[i + 1]) { args.records = argv[++i]; continue; }
    if (arg === "--since" && argv[i + 1]) { args.since = argv[++i]; continue; }
    if (arg === "--idle-gap" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) args.idleGap = n;
      continue;
    }
    if (arg === "--max-sessions" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) args.maxSessions = n;
      continue;
    }
  }
  return args;
}

function parseIsoMs(value) {
  if (!value) return Number.NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NaN;
}

// --- load -------------------------------------------------------------------
function loadRecords(path, since) {
  const sinceMs = since ? parseIsoMs(`${since}T00:00:00Z`) : Number.NEGATIVE_INFINITY;
  const text = readFileSync(path, "utf8");
  const out = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line[0] !== "{") continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const query = String(obj.query ?? "").trim();
    if (!query) continue;

    const at = String(obj.at ?? obj.time ?? "");
    const atMs = parseIsoMs(at);
    if (Number.isFinite(atMs) && Number.isFinite(sinceMs) && atMs < sinceMs) continue;

    const rawDelta = obj.input_delta_ms ?? obj.delta_ms;
    const inputDeltaMs =
      typeof rawDelta === "number" && Number.isFinite(rawDelta) ? Math.max(0, Math.round(rawDelta)) : null;

    out.push({
      query,
      at,
      atMs,
      session: String(obj.session ?? ""),
      inputDeltaMs,
    });
  }

  // Stable sort by timestamp; undated lines keep their archive order (sorted last).
  out.sort((a, b) => {
    const av = Number.isFinite(a.atMs) ? a.atMs : Number.POSITIVE_INFINITY;
    const bv = Number.isFinite(b.atMs) ? b.atMs : Number.POSITIVE_INFINITY;
    return av - bv;
  });

  return out;
}

// --- grouping (ported from search_to_issue.py) -----------------------------
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

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

function headlineOf(records) {
  let longest = "";
  for (const rec of records) if (rec.query.length > longest.length) longest = rec.query;
  return longest.trim();
}

function group(records, idleGapS) {
  const sessions = [];
  let cur = [];

  for (const rec of records) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      let gapS = Number.POSITIVE_INFINITY;
      if (Number.isFinite(prev.atMs) && Number.isFinite(rec.atMs)) {
        gapS = (rec.atMs - prev.atMs) / 1000;
      }
      if (rec.session !== prev.session || gapS > idleGapS || isTypingReset(prev, rec)) {
        sessions.push(cur);
        cur = [];
      }
    }
    cur.push(rec);
  }
  if (cur.length) sessions.push(cur);

  return sessions.filter((s) => headlineOf(s).length > MIN_HEADLINE_LEN);
}

// --- shape for the dropdown ----------------------------------------------
function toSession(records) {
  const first = records[0];
  const last = records[records.length - 1];

  const spanMs =
    Number.isFinite(first.atMs) && Number.isFinite(last.atMs)
      ? Math.max(0, last.atMs - first.atMs)
      : 0;

  const sessionCategories = new Set();
  let sessionFlagged = false;

  const entries = records.map((rec) => {
    const { flagged, categories } = detectMaliciousSearch(rec.query);
    const entry = {
      query: rec.query,
      at: rec.at,
      inputDeltaMs: rec.inputDeltaMs,
    };
    if (flagged) {
      entry.flagged = true;
      entry.categories = categories;
      entry.displayQuery = defang(rec.query);
      sessionFlagged = true;
      for (const c of categories) sessionCategories.add(c);
    }
    return entry;
  });

  const key = `${first.session || "anon"}:${first.at || first.query.slice(0, 24)}`;

  return {
    id: key,
    startedAt: first.at || "",
    spanMs,
    flagged: sessionFlagged,
    categories: Array.from(sessionCategories),
    entries,
  };
}

// --- main ----------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.records) {
    warn("no --records path given; writing []");
    writeFileSync(OUT_PATH, "[]\n");
    return 0;
  }

  let records;
  try {
    records = loadRecords(args.records, args.since);
  } catch (err) {
    warn(`could not read ${args.records}: ${err.message}; writing []`);
    writeFileSync(OUT_PATH, "[]\n");
    return 0;
  }

  const sessions = group(records, args.idleGap)
    .map(toSession)
    .sort((a, b) => {
      const av = parseIsoMs(a.startedAt);
      const bv = parseIsoMs(b.startedAt);
      return (Number.isFinite(bv) ? bv : 0) - (Number.isFinite(av) ? av : 0);
    })
    .slice(0, args.maxSessions);

  writeFileSync(OUT_PATH, `${JSON.stringify(sessions, null, 2)}\n`);

  const flagged = sessions.filter((s) => s.flagged).length;
  process.stderr.write(
    `refresh-search-history: ${records.length} records -> ${sessions.length} sessions ` +
      `(${flagged} flagged) -> ${OUT_PATH}\n`
  );
  return 0;
}

process.exit(main());
