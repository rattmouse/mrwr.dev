#!/usr/bin/env node
// Hide-list bookkeeping for the search-bar history dropdown.
//
// src/data/search-history.json is rebuilt from the prod archive before every
// build (refresh-search-history.sh, run by deploy.sh), so deleting a session
// from it by hand only lasts until the next deploy. Instead, hidden session ids
// live in a hide list on prod ($PROD_BASE/shared/search-history-hidden.json,
// next to the archive), and refresh-search-history.mjs drops every hidden id on
// each rebuild — from whichever machine runs the deploy. The raw archive is
// never touched.
//
// Run it through scripts/content/hide-search-history.sh, which fetches the
// list from prod, runs this on the local copy, and uploads the result. Direct:
//   node scripts/content/hide-search-history.mjs list   --hidden PATH
//   node scripts/content/hide-search-history.mjs add    --hidden PATH <session-id>...
//   node scripts/content/hide-search-history.mjs remove --hidden PATH <session-id>...
//
// `add` also strips the sessions from the current search-history.json, so
// `npm run dev` reflects it without a re-fetch. `remove` takes effect on the
// next refresh. Session ids are the `id` field in search-history.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const HISTORY_PATH = resolve(REPO_ROOT, "src/data/search-history.json");

// A missing or empty file is an empty list; anything unparseable throws, so a
// corrupt list is never silently treated as "nothing hidden" (or overwritten).
export function loadHidden(path) {
  const text = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  if (!text) return [];
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.hidden)) throw new Error(`${path} has no "hidden" array`);
  return data.hidden.filter((h) => h && typeof h.id === "string");
}

export function loadHiddenIds(path) {
  return new Set(loadHidden(path).map((h) => h.id));
}

function saveHidden(path, hidden) {
  hidden.sort((a, b) => String(a.hiddenAt).localeCompare(String(b.hiddenAt)));
  writeFileSync(path, `${JSON.stringify({ hidden }, null, 2)}\n`);
}

function readHistory() {
  try {
    const data = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Longest query in the session — what the dropdown and triage lists show.
function headlineOf(session) {
  const entries = Array.isArray(session?.entries) ? session.entries : [];
  let best = null;
  for (const e of entries) {
    if (!best || String(e.query ?? "").length > String(best.query ?? "").length) best = e;
  }
  return best ? String(best.displayQuery ?? best.query ?? "") : "";
}

function list(path) {
  const hidden = loadHidden(path);
  if (!hidden.length) {
    console.log("No hidden search sessions.");
    return 0;
  }
  for (const h of hidden) console.log(`${h.id}\t${h.hiddenAt ?? ""}\t${JSON.stringify(h.headline ?? "")}`);
  return 0;
}

function add(path, ids) {
  const sessions = readHistory();
  const byId = new Map(sessions.map((s) => [s.id, s]));

  const hidden = loadHidden(path);
  const known = new Set(hidden.map((h) => h.id));
  const now = new Date().toISOString();
  let added = 0;

  for (const id of ids) {
    if (known.has(id)) {
      console.log(`already hidden: ${id}`);
      continue;
    }
    const session = byId.get(id);
    if (!session) console.log(`warning: ${id} is not in search-history.json — hiding it anyway`);
    hidden.push({ id, headline: session ? headlineOf(session) : "", hiddenAt: now });
    known.add(id);
    added += 1;
    console.log(`hidden: ${id}${session ? `  ${JSON.stringify(headlineOf(session))}` : ""}`);
  }
  saveHidden(path, hidden);

  const kept = sessions.filter((s) => !known.has(s.id));
  if (kept.length !== sessions.length) {
    writeFileSync(HISTORY_PATH, `${JSON.stringify(kept, null, 2)}\n`);
  }
  console.log(`${added} added, ${hidden.length} hidden in total; search-history.json now has ${kept.length} sessions`);
  return 0;
}

function remove(path, ids) {
  const drop = new Set(ids);
  const hidden = loadHidden(path);
  const kept = hidden.filter((h) => !drop.has(h.id));
  for (const id of ids) {
    console.log(hidden.some((h) => h.id === id) ? `unhidden: ${id}` : `not hidden: ${id}`);
  }
  saveHidden(path, kept);
  console.log(`${hidden.length - kept.length} removed; they come back on the next refresh-search-history.sh`);
  return 0;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  let path = "";
  const ids = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--hidden" && rest[i + 1]) path = rest[++i];
    else ids.push(rest[i]);
  }

  const usage = "usage: hide-search-history.mjs list | add <id>... | remove <id>...  --hidden PATH\n";
  if (!path || !["list", "add", "remove"].includes(cmd) || (cmd !== "list" && !ids.length)) {
    process.stderr.write(usage);
    return 2;
  }

  try {
    if (cmd === "list") return list(path);
    return cmd === "add" ? add(path, ids) : remove(path, ids);
  } catch (err) {
    process.stderr.write(`hide-search-history: ${err.message} — not changing anything\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
