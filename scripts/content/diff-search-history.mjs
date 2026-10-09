#!/usr/bin/env node
// Compare a freshly built src/data/search-history.json against the copy the
// live site was built from ($PROD_BASE/shared/search-history-deployed.json,
// written by deploy.sh after every healthy deploy), so deploy.sh can ask before
// shipping searches that aren't public yet.
//
// Usage:
//   node diff-search-history.mjs --baseline FILE --current FILE
//     Lists sessions that are new (id not in the baseline) or have grown (more
//     entries than the baseline's copy). Exit 0 = nothing new, 10 = something new.
//   node diff-search-history.mjs --baseline FILE --current FILE --drop-new
//     Rewrites --current so it holds only what the baseline already showed:
//     new sessions removed, grown ones reverted to the baseline's copy.
//
// A missing or unreadable baseline counts as empty, so everything is "new".

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { headlineOf } = require(resolve(REPO_ROOT, "search-sessions.js"));

function readSessions(path) {
  if (!path) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : "";
};
const baselinePath = opt("--baseline");
const currentPath = opt("--current");
if (!currentPath) {
  process.stderr.write("diff-search-history: --current is required\n");
  process.exit(2);
}

const baseline = new Map(readSessions(baselinePath).map((s) => [s.id, s]));
const current = readSessions(currentPath);
const changed = current.filter((s) => {
  const old = baseline.get(s.id);
  return !old || (s.entries?.length ?? 0) > (old.entries?.length ?? 0);
});

if (argv.includes("--drop-new")) {
  const kept = current.filter((s) => baseline.has(s.id)).map((s) => baseline.get(s.id));
  writeFileSync(currentPath, `${JSON.stringify(kept, null, 2)}\n`);
  process.stdout.write(`Left out ${changed.length} new/grown session(s); shipping ${kept.length}.\n`);
  process.exit(0);
}

if (!changed.length) process.exit(0);

for (const s of changed) {
  const tag = baseline.has(s.id) ? "grown" : "new  ";
  const headline = (s.entries ?? []).map((e) => ({ query: e.displayQuery ?? e.query }));
  const flag = s.flagged ? "  [flagged]" : "";
  process.stdout.write(`  ${tag} ${s.startedAt}  "${headlineOf(headline)}"${flag}\n         id ${s.id}\n`);
}
process.exit(10);
