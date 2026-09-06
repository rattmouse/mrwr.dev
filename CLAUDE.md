# CLAUDE.md

Orientation notes for working in this repo.

## Deploying

- **"Deploy" means `main`, fast-forwarded to `origin`** — not the current feature
  branch. Ship with `npm run deploy` (`scripts/deploy/deploy.sh`); see
  `scripts/deploy/README.md`.
- `src/data/issues.json` is gitignored and read **only at build time**. The site
  never calls GitHub (or anything else) at runtime. `scripts/deploy/deploy.sh`
  runs `scripts/content/refresh-issues.sh` before every build to refresh it.
- `src/data/search-history.json` (the search-bar history dropdown) is the same
  deal: gitignored, build-time only, refreshed by
  `scripts/content/refresh-search-history.sh` — which `deploy.sh` also runs
  before every build. It pulls the prod search-log archive over ssh; a failure
  is non-fatal (ships an empty history). `server.js` flags malicious queries via
  `search-guard.js` (repo root); `deploy.sh` ships that file with `server.js`.

## Every PR updates the changelog

The **changes app** (`changes.exe` / the "Version history" window) is driven by
the hand-curated `src/data/versions.json`. Update it **in the same PR** that makes
the change — the edit to `versions.json` is part of the PR's own diff, not a
follow-up commit or a separate "record PR #NN" PR after merge.

Do this on your feature branch before the PR merges:

1. **Add one bullet** to `versions[0].changes[]` — the newest card (currently
   v4.0). Describe the **user-facing effect**, not the mechanics, and match the
   voice of the bullets already there (short, plain, no hashes or file paths).
2. **Record closed issues.** If the PR closes any issues, add their numbers to
   `versions[0].issues[]` (deduped, keep it sorted). Their titles and the "closed
   by PR #NN" link are resolved automatically from `issues.json` at build time —
   do **not** hand-write those.
3. **Put a closing keyword in the PR description** (`Closes #NN` / `Fixes #NN`)
   for every issue you listed in step 2. That is what lets `link-prs.mjs` attach
   the "closed by PR #NN" link automatically once the PR merges — nothing to add
   by hand afterward. See below.
4. **Stats are optional.** `versions[0].stats` (commits / files / +− lines) is a
   milestone-time chore, not a per-PR one. Leave it unless you're keeping it
   roughly current on purpose.

Nothing here needs the PR number — the bullet carries no hashes, and the issue ↔
PR link is resolved from the closing keyword at build time. So there is no
after-merge step.

Start a **new** `versions[0]` object (bump `version`, set `era` / `name` / `date`)
only when the work opens a genuinely new milestone — most PRs are just a new
bullet on the current card.

### How the issue ↔ PR links work

`scripts/content/refresh-issues.sh` runs `scripts/content/link-prs.mjs`, which
stamps `closedByPr` onto every closed issue that a merged PR resolved (matching on
GitHub closing refs, then `fixes #NN` / `closes #NN` keywords, then a bare `#NN`
in the PR title or body for already-closed issues). The Issues window shows it as
a "closed by PR #NN" row; the Changes window appends "· PR #NN" to each closed
complaint. This is generated data — nothing to maintain by hand.
