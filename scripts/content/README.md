# scripts/content

Scripts that build the static content the site reads at build time. The site
never calls GitHub (or anything else) at runtime.

## The Issues window

The Issues window and the closed-issue links in the Changes window are driven by
`src/data/issues.json` — a snapshot of the repo's GitHub issues. It is gitignored
and read only at build time.

### `refresh-issues.sh` — pull issues out of GitHub

Rewrites `src/data/issues.json` from `gh issue list`, then runs `link-prs.mjs`
(below). `scripts/deploy/deploy.sh` runs it automatically before every build, so a
normal deploy always ships current issues. Run it by hand when you want
`npm run dev` or a local build to pick up new issues too.

### `link-prs.mjs` — link closed issues to the PR that fixed them

Runs as the last step of `refresh-issues.sh`. Reads `gh pr list --state merged` and
stamps a `closedByPr` (`{ number, title, url }`) onto each **closed** issue in
`src/data/issues.json`. The Issues window and the Changes window render it as
"closed by PR #NN".

Matching, strongest first: (1) GitHub's own closing-issue references, (2) a closing
keyword + `#NN` in the PR title or body (`fixes #12`, `closes #12`, …), (3) a bare
`#NN` anywhere in the PR title or body — this last one only for issues that are
already closed, so an open issue a PR merely mentions never gets linked. Earliest
merge wins ties. A missing/broken `gh` is non-fatal: it warns and leaves
`issues.json` as-is.

### `search-to-issue.sh` — turn recorded searches into issues

The site's search bar doubles as a scratchpad: every keystroke-change is POSTed to
`/log-search` and appended to a durable NDJSON archive on prod
(`$PROD_BASE/shared/search-log.ndjson`; see `server.js` and issue #55). Turning one
of those noted thoughts into a GitHub issue used to be a manual copy-paste out of
`scripts/deploy/prod/logs.sh`.

`search-to-issue.sh` automates everything but the judgement call:

1. pulls the NDJSON archive from prod over ssh (reuses `scripts/deploy` config;
    `--file PATH` reads a local copy instead),
2. groups consecutive entries into *search sessions* — one run of edits to the
    same query, same browser session, no long pause,
3. hides sessions already filed or dismissed (state file below) and sessions
    whose text already appears in a live issue body (clears the pre-tool
    backlog automatically),
4. for each remaining session, shows the `from search bar:` block exactly as it
    will land on GitHub — formatted by the same `journalctl_to_readme.sh` that
    `logs.sh` uses, so the playback parser in `IssuesTreeView` understands it in
    both issue bodies and comments — then waits for you to choose **create /
    edit title + create / append to an existing issue / skip forever / later /
    quit**,
5. `gh issue create`s a new issue, or `gh issue comment`s onto one you pick (by
    number or title search), for the sessions you approve.

Nothing is posted without a keypress. New issues and comments show up in the site
on the next `refresh-issues.sh` / deploy.

```
scripts/content/search-to-issue.sh              # triage against prod
scripts/content/search-to-issue.sh --dry-run    # preview only, no gh, no state
scripts/content/search-to-issue.sh --since 2026-08-01
scripts/content/search-to-issue.sh --file ./search-log.ndjson
```

Requires `gh` authenticated (`gh auth status`), ssh access to prod (same as
`deploy.sh`), and `python3`.

**State:** `scripts/content/.search-triage-state.json` records which sessions
you've filed or skipped so they don't come back. Gitignored, machine-local; delete
it to start triage over.

## The Projects window

The Projects window (`projects.txt`) renders `src/data/projects.base.json` — the
committed fallback list — merged with `src/data/projects.json`, a build-time
enrichment file that is gitignored and read only at build time.

### `refresh-projects.sh` — pull descriptions + README images from GitHub

Runs `refresh-projects.mjs`, which for every base entry with a `ghRepo` field
reads the repo's GitHub description and the first image in its README (via
`gh repo view` / `gh api .../readme`), downloads that image into
`public/projects/remote/`, and writes a `{ [slug]: { description, image } }` map
to `src/data/projects.json`. `src/lib/projects.ts` merges it over the base list,
so a missing description or image just falls back to the local blurb and
`/projects/thumbs/<slug>.webp`.

`scripts/deploy/deploy.sh` runs it before every build (best-effort — a GitHub
failure ships `projects.json` as-is, or pass `--skip-projects`). Run it by hand
to make `npm run dev` / a local build pick up new metadata.

## The search-bar history dropdown

The search box (top-right of the Start bar) shows a dropdown of earlier searches
that filters as you type and replays each one at the rate it was typed. It is
driven by `src/data/search-history.json` — like `issues.json`, gitignored and
read only at build time.

### `refresh-search-history.sh` — build the history file

Fetches the durable search-log NDJSON archive from prod
(`$PROD_BASE/shared/search-log.ndjson`, + one rotated `.1`; the same archive
`search-to-issue.sh` reads) and runs `refresh-search-history.mjs`, which groups
the records into **search sessions** using the exact same heuristic as
`search_to_issue.py` (180 s idle gap, "typing reset" detection, minimum headline
length), tags each entry with `search-guard.js`, and writes the newest ~250
sessions.

`scripts/deploy/deploy.sh` runs it before every build (best-effort: an
unreachable prod ships an empty history, never a failed deploy — or pass
`--skip-search-history`). Run it by hand to make `npm run dev` / a local build
pick up newer searches.

```
scripts/content/refresh-search-history.sh                       # against prod
scripts/content/refresh-search-history.sh --file ./search-log.ndjson
scripts/content/refresh-search-history.sh --since 2026-08-01
scripts/content/refresh-search-history.sh --max-sessions 100
```

### Malicious searches

`search-guard.js` (repo root, next to `server.js`) classifies a query as
`xss` / `sql` / `command` / `path-traversal` / `template-injection` /
`prompt-injection` / `overlong`. `server.js` tags each recorded search with
`flagged` + `categories` (the attempt is still logged verbatim and still shown
in history); this generator re-derives the tags at build time and adds a
`displayQuery` — a defanged, render-safe version the dropdown plays back instead
of the raw payload. `deploy.sh` copies `search-guard.js` into the prod release
bundle alongside `server.js`.
