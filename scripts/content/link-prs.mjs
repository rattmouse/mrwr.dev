#!/usr/bin/env node
// Stamp a `closedByPr` field onto closed issues in src/data/issues.json,
// pointing at the merged pull request that resolved them.
//
// scripts/content/refresh-issues.sh runs this straight after it rewrites
// issues.json from `gh issue list`, so a normal deploy always ships current
// links. The site never calls GitHub at runtime — this is build-time data.
//
// The link comes from what GitHub itself recorded, strongest first:
//   1. the issue's timeline: the `closed` event's commit, resolved to the
//      pull request that carried that commit. This is what "Closed by #NN"
//      in the GitHub UI is built from.
//   2. the PR's declared closing-issue references (the `Fixes #NN` links
//      GitHub resolved at merge time).
// Issues closed by hand, with no linked commit or PR, get no link — better
// than guessing from a stray `#NN` in some unrelated PR body.
//
// Never fatal: if `gh` is missing/unauthenticated or a call fails, this
// prints a warning and exits 0, leaving issues.json as-is. A single issue
// whose lookup fails is skipped, not aborted.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ISSUES_PATH = resolve(SCRIPT_DIR, "../../src/data/issues.json");
const REPO = "rattmouse/mrwr.dev";

function warn(msg) {
  process.stderr.write(`link-prs: ${msg}\n`);
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function ghJson(args) {
  const out = gh(args).trim();
  return out ? JSON.parse(out) : [];
}

// A paginated `gh api --paginate --slurp` call returns [[page], [page], ...];
// flatten one level back to a flat event list.
function ghPaginated(path) {
  const pages = ghJson(["api", "--paginate", "--slurp", path]);
  return Array.isArray(pages) ? pages.flat() : [];
}

function loadIssues() {
  const parsed = JSON.parse(readFileSync(ISSUES_PATH, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("issues.json is not an array");
  return parsed;
}

// commitSha -> { number, title, url } | null   (cached; null = looked up, no PR)
const commitPrCache = new Map();

function prForCommit(sha) {
  if (commitPrCache.has(sha)) return commitPrCache.get(sha);
  let result = null;
  try {
    const pulls = ghJson(["api", `repos/${REPO}/commits/${sha}/pulls`]);
    const merged = (Array.isArray(pulls) ? pulls : [])
      .filter((p) => p && p.merged_at)
      .sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at));
    const pick = merged[0] || pulls[0];
    if (pick && typeof pick.number === "number") {
      result = {
        number: pick.number,
        title: typeof pick.title === "string" ? pick.title : "",
        url: typeof pick.html_url === "string" ? pick.html_url : "",
      };
    }
  } catch (err) {
    warn(`commit ${sha.slice(0, 9)} -> PR lookup failed: ${firstLine(err)}`);
  }
  commitPrCache.set(sha, result);
  return result;
}

function closingCommitForIssue(number) {
  const events = ghPaginated(`repos/${REPO}/issues/${number}/timeline`);
  let sha = null;
  for (const e of events) {
    if (e && e.event === "closed" && typeof e.commit_id === "string" && e.commit_id) {
      sha = e.commit_id; // keep the last one — the close that stuck
    }
  }
  return sha;
}

function firstLine(err) {
  return (err.stderr || err.message || "").toString().trim().split("\n")[0] || "unknown error";
}

function main() {
  let issues;
  try {
    issues = loadIssues();
  } catch (err) {
    warn(`could not read issues.json (${err.message}); skipping`);
    process.exit(0);
  }

  // Tier 2 fallback: PR-declared closing references.
  const refPr = new Map(); // issueNumber -> { number, title, url }
  try {
    const prs = ghJson([
      "pr",
      "list",
      "--repo",
      REPO,
      "--state",
      "merged",
      "--limit",
      "1000",
      "--json",
      "number,title,url,mergedAt,closingIssuesReferences",
    ]);
    for (const pr of [...prs].sort((a, b) => Date.parse(a.mergedAt || 0) - Date.parse(b.mergedAt || 0))) {
      for (const ref of pr.closingIssuesReferences ?? []) {
        if (typeof ref?.number === "number" && !refPr.has(ref.number)) {
          refPr.set(ref.number, { number: pr.number, title: pr.title ?? "", url: pr.url ?? "" });
        }
      }
    }
  } catch (err) {
    warn(`gh pr list failed (${firstLine(err)}); continuing with timeline data only`);
  }

  let linked = 0;
  let cleared = 0;
  let timelineOk = 0;
  let timelineFailed = 0;

  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const isClosed = issue.state === "CLOSED" && typeof issue.number === "number";
    if (!isClosed) continue;

    let pr;
    let lookupFailed = false;
    try {
      const sha = closingCommitForIssue(issue.number);
      timelineOk += 1;
      if (sha) pr = prForCommit(sha);
    } catch (err) {
      lookupFailed = true;
      timelineFailed += 1;
      warn(`issue #${issue.number} timeline lookup failed: ${firstLine(err)}`);
    }
    if (!pr) pr = refPr.get(issue.number);

    if (pr) {
      issue.closedByPr = { number: pr.number, title: pr.title, url: pr.url };
      linked += 1;
    } else if (!lookupFailed && "closedByPr" in issue) {
      // Only drop a stale link when the lookup actually succeeded and found
      // nothing — never because the API call errored.
      delete issue.closedByPr;
      cleared += 1;
    }
  }

  // A wholesale gh outage (every timeline call threw, none succeeded) must
  // not rewrite the file — leave whatever links are already there.
  if (timelineOk === 0 && timelineFailed > 0) {
    warn(`every timeline lookup failed (${timelineFailed}); leaving issues.json unchanged`);
    process.exit(0);
  }

  writeFileSync(ISSUES_PATH, `${JSON.stringify(issues)}\n`);
  warn(
    `linked ${linked} issue${linked === 1 ? "" : "s"} to a PR` +
      (cleared ? `, cleared ${cleared} stale` : "")
  );
}

main();
