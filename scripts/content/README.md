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
