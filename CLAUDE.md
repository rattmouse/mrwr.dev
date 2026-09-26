# CLAUDE.md

Orientation notes for working in this repo.

## Containers (Podman)

- The build/deploy toolchain is containerised — see `containers/USAGE.md`
  for step-by-step instructions. `containers/ci.sh` is the front end: `dev` (dev server on :3000), `ci`
  (refresh + install + lint + build, the pre-PR check), `deploy`, `shell`,
  `exec`. Also as npm scripts: `container:dev`, `container:ci`,
  `container:deploy`.
- **Prefer the container over the host toolchain on Linux.** Falcon's system
  Node is 18 (Next 16 needs ≥ 20.9) and its apt `gh` is 2.45, too old for the
  `stateReason` and `closingIssuesReferences` fields the content scripts ask
  GitHub for. The image pins Node 22 and a current `gh`, so a build there
  actually works and matches what gets deployed.
- Rootless, `--userns=keep-id`, repo bind-mounted at `/workspace` — output
  lands in your tree owned by you. `node_modules`, `.next` and the npm cache
  live in named volumes so the container never collides with a host install.
- `ci` runs eslint report-only (full output to the gitignored
  `.deploy/lint.txt`) because the tree already has ~6,100 findings. The build
  is the gate, and it type-checks.
- `~/.ssh` goes in read-only and is copied into the container's own HOME;
  GitHub auth is passed as `GH_TOKEN` from the host's keyring. Don't mount
  `~/.config/gh` — a copied tokenless `hosts.yml` makes `gh auth status` fail.

## Deploying

- **"Deploy" means `main`, fast-forwarded to `origin`** — not the current feature
  branch. Ship with `npm run deploy` (`scripts/deploy/deploy.sh`), or
  `npm run container:deploy` to run that same script inside the container; see
  `scripts/deploy/README.md` and `containers/USAGE.md`.
- `src/data/issues.json` is gitignored and read **only at build time**. The site
  never calls GitHub (or anything else) at runtime. `scripts/deploy/deploy.sh`
  runs `scripts/content/refresh-issues.sh` before every build to refresh it.
- `src/data/search-history.json` (the search-bar history dropdown) is the same
  deal: gitignored, build-time only, refreshed by
  `scripts/content/refresh-search-history.sh` — which `deploy.sh` also runs
  before every build. It pulls the prod search-log archive over ssh; a failure
  is non-fatal (ships an empty history). It also pulls the hide list
  (`$PROD_BASE/shared/search-history-hidden.json`, edited with
  `scripts/content/hide-search-history.sh`) and leaves those sessions out. The
  list lives on prod, not in the repo, so it applies whichever machine deploys.
- `src/data/projects.json` + `public/projects/remote/` (GitHub descriptions and
  README images for the Projects window) are the same deal again: gitignored,
  build-time only, refreshed by `scripts/content/refresh-projects.sh` (also run
  by `deploy.sh`). `src/lib/projects.ts` merges them over the committed
  fallbacks in `src/data/projects.base.json`; a failure is non-fatal. `server.js` flags malicious queries via
  `search-guard.js` (repo root); `deploy.sh` ships that file with `server.js`.
- `public/guys/guys.webp` + `src/data/guys.json` (the little painted figures
  party.webp draws in place of its dots) are the exception to all of the
  above: they are **committed**, not gitignored, and no deploy step regenerates
  them. `scripts/content/make-guys-sprites.mjs` (`npm run guys:sprites`) cuts
  them out of the photographs listed in its `SHEETS` — `public/guys.webp` and
  `public/guys2.webp`, unevenly lit photos of painted sheets, also committed —
  so the cutting is tuned by eye once rather than run in every visitor's
  browser. Each sheet gets its own hand-judged crop. Re-run it only when one of
  those photographs changes or another sheet is painted, and pass `--debug` for
  a contact sheet of the cut-outs to check.
- `public/mrwr.dev.png` is the README's screenshot of the site, and it is
  **committed**: the README links it and GitHub renders it from `public/`. It
  used to have a second job — cubicles.exe's in-world browser showed it when it
  found itself already running inside one — but that fallback is now a painted
  feedback loop (see below), so the screenshot is the README's alone. It stays
  in `public/` regardless; don't move it back under `docs/`.
- `public/collections/` (everything the Collections window shows) is gitignored
  in full and read only at build time: the album covers, the Bluesky picklists
  behind Paintings and Songs, and — for the Cards tab, the one the window opens
  on — `cards.json` + `public/collections/cards/`, written by
  `scripts/content/refresh-pokemon-cards.sh`. That one reads the **card-binder**
  app's SQLite collection (`../card-binder/binder.db`, read-only; needs Node 22+
  for `node:sqlite`), takes the most valuable cards and copies their scans
  locally rather than hotlinking. `deploy.sh` does **not** run it — the
  collection only changes when you scan something new, so run it by hand. Mind
  the size: the default 48 cards is ~38MB, and `--all` would be 300MB+.
- `search-sessions.js` (repo root, also shipped by `deploy.sh`) holds the
  session-grouping heuristics shared by `refresh-search-history.mjs` and
  `server.js`. At runtime `server.js` buffers keystroke records per browser
  session and, once one goes quiet, POSTs a summary to whatever
  `SEARCH_NOTIFY_KIND` (`telegram` | `ntfy` | `webhook`) points at. Config +
  secrets live in prod's `/etc/mrwr.dev/notify.env` (`EnvironmentFile` in the
  systemd unit) — under `/etc`, not `$PROD_BASE/shared/`, because a file in
  `/root` is SELinux-labelled `admin_home_t` which PID 1 can't read; `deploy.sh`
  makes the dir, you drop the (uncommitted) file in by hand. Unset ⇒ notifier
  is a no-op. In-memory only — a restart drops sessions mid-flight, but the
  NDJSON archive still has every record.

## Every PR bumps the version and updates the changelog

The **changes app** (`changes.exe` / the "Version history" window) is driven by
the hand-curated `src/data/versions.json`. Update it **in the same PR** that makes
the change — the edit to `versions.json` is part of the PR's own diff, not a
follow-up commit or a separate "record PR #NN" PR after merge.

Do this on your feature branch before the PR merges:

1. **Bump the version.** `npm run version:bump` (a patch; `-- minor` /
   `-- major` for a new milestone) moves `package.json`, `package-lock.json`
   and `versions[0].version` on together — see `scripts/version.mjs`. A patch
   just relabels the newest card (`6.0` → `6.0.1` → `6.0.2`); a minor or major
   opens a new empty card at the top for you to name. `containers/ci.sh ci`
   fails on a branch that isn't ahead of `origin/main`, and every build
   (`prebuild`) fails if the three files disagree — so don't hand-edit one.
2. **Add one bullet** to `versions[0].changes[]` — the newest card. Describe
   the **user-facing effect**, not the mechanics, and match the voice of the
   bullets already there (short, plain, no hashes or file paths).
3. **Record closed issues.** If the PR closes any issues, add their numbers to
   `versions[0].issues[]` (deduped, keep it sorted). Their titles and the "closed
   by PR #NN" link are resolved automatically from `issues.json` at build time —
   do **not** hand-write those.
4. **Put a closing keyword in the PR description** (`Closes #NN` / `Fixes #NN`)
   for every issue you listed in step 3. That is what lets `link-prs.mjs` attach
   the "closed by PR #NN" link automatically once the PR merges — nothing to add
   by hand afterward. See below.
5. **Stats are optional.** `versions[0].stats` (commits / files / +− lines) is a
   milestone-time chore, not a per-PR one. Leave it unless you're keeping it
   roughly current on purpose.
6. **Never write up a cubicles.exe secret.** The nested `/hacks/` directory
   bash.exe exposes only when it's running on the computer inside cubicles.exe
   (`lights.exe`, `unlock.exe`, and whatever gets added there later) stays out
   of every changelog bullet, no matter how much of the PR it was. Same for any
   other hidden easter egg on the desktop — a changelog entry documenting a
   secret defeats the secret. Describe the shipped feature around it if there
   is one worth a bullet; otherwise leave the PR off the changelog entirely.

Nothing here needs the PR number — the bullet carries no hashes, and the issue ↔
PR link is resolved from the closing keyword at build time. So there is no
after-merge step.

Start a **new** `versions[0]` card (`npm run version:bump -- minor`, then set
`era` / `name` / `summary`) only when the work opens a genuinely new milestone —
most PRs are a patch bump plus a new bullet on the current card.

### How the issue ↔ PR links work

`scripts/content/refresh-issues.sh` runs `scripts/content/link-prs.mjs`, which
stamps `closedByPr` onto every closed issue that a merged PR resolved (matching on
GitHub closing refs, then `fixes #NN` / `closes #NN` keywords, then a bare `#NN`
in the PR title or body for already-closed issues). The Issues window shows it as
a "closed by PR #NN" row; the Changes window appends "· PR #NN" to each closed
complaint. This is generated data — nothing to maintain by hand.
