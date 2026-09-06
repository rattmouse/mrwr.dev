# CLAUDE.md

Orientation notes for working in this repo.

## Deploying

- **"Deploy" means `main`, fast-forwarded to `origin`** — not the current feature
  branch. Ship with `npm run deploy` (`scripts/deploy/deploy.sh`); see
  `scripts/deploy/README.md`.
- `src/data/issues.json` is gitignored and read **only at build time**. The site
  never calls GitHub (or anything else) at runtime. `scripts/deploy/deploy.sh`
  runs `scripts/content/refresh-issues.sh` before every build to refresh it.

## Completing a pull request

When a PR is merged to `main`, record it in the **changes app** (`changes.exe` /
the "Version history" window) before the next deploy. That app is driven by the
hand-curated `src/data/versions.json`.

1. **Add one bullet** to `versions[0].changes[]` — the newest card (currently
   v4.0). Describe the **user-facing effect**, not the mechanics, and match the
   voice of the bullets already there (short, plain, no hashes or file paths).
2. **Record closed issues.** If the PR closed any issues, add their numbers to
   `versions[0].issues[]` (deduped, keep it sorted). Their titles and the "closed
   by PR #NN" link are resolved automatically from `issues.json` at build time —
   do **not** hand-write those.
3. **Stats are optional.** `versions[0].stats` (commits / files / +− lines) is a
   milestone-time chore, not a per-PR one. Leave it unless you're keeping it
   roughly current on purpose.

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
