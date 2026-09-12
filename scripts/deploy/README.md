# Deploy pipeline

Replaces the old build-VM pipeline (`build/scripts/deploy/*`, now retired —
that VM is gone). There's no separate build host anymore: whatever machine
runs `deploy.sh` builds the static export itself and ships it straight to
prod.

**Split across machines, by design:** develop on your day-to-day machine,
then run these scripts from Kubuntu to actually test-build and deploy. Any
machine with Node, npm, ssh, and rsync can run them, though — nothing here
is Kubuntu-specific.

**In a container instead:** `npm run container:deploy` runs `deploy.sh`
below, unchanged, inside a Podman container that carries its own Node 22 and
`gh`. That's the easier path on a machine whose own toolchain is too old to
build the app — which is every Linux box here with a system Node 18. Same
releases, same health check, same rollback; the container only supplies the
toolchain and the credentials. See `containers/USAGE.md`.

## How it works

```
scripts/deploy/deploy.sh
  1. refresh src/data/issues.json from GitHub  (scripts/content/refresh-issues.sh)
  2. npm ci && npm run build          (local — produces out/)
  3. stage out/ + server.js + package.json + prod/{start,logs}.sh
     + a systemd unit filled in from mrwr.dev.service.template
  4. rsync the stage dir to $PROD_HOST:$PROD_BASE/releases/<timestamp>/
  5. on prod: npm install --omit=dev, install the systemd unit,
     atomically swap the `current` symlink to the new release, restart
  6. health-check (systemctl is-active + curl localhost); on failure,
     automatically swap `current` back and exit non-zero
  7. prune old releases beyond KEEP_RELEASES
```

Step 1 keeps the Issues window current without a manual pre-step. It's
skipped with `--skip-build` (nothing rebuilds) or `--skip-issues` (ships
whatever `issues.json` is already in the tree). The site never calls
GitHub at runtime — this is the only fetch, and it happens at build time.

Prod layout:

```
$PROD_BASE/
  releases/
    20260906153000/   <- one directory per deploy, self-contained
    20260905101500/
  current -> releases/20260906153000   <- symlink; this is what's live
```

`current` is what the systemd unit and Caddy actually serve. Every deploy
is a brand new release directory — nothing is mutated in place — and
`current` only moves once the new release passes its health check. That's
what makes `rollback.sh` instant: it just repoints the symlink to a release
that already exists on disk and restarts.

Runtime on prod is unchanged from before: systemd (`mrwr.dev.service`) runs
`node server.js` (a small Express static file server with a `/log-search`
endpoint), fronted by Caddy reverse-proxying to `localhost:3000`.

## One-time setup (on each machine that will deploy)

```
cp scripts/deploy/deploy.config.example.sh scripts/deploy/deploy.config.sh
```

Fill in `PROD_HOST` / `PROD_BASE` / etc. — see the comments in that file.
`deploy.config.sh` is gitignored; it's machine-local and never committed.

This assumes `ssh $PROD_HOST` already works (keys set up, host reachable) —
these scripts don't do any of that setup for you.

**Also gitignored, so `git pull` alone won't bring it to a new machine —
copy by hand once (e.g. `rsync -av` from your dev machine):**

- `public/collections/` (album cover images + `content.json`) — the
  Collections window needs these to build correctly.

A build without it still succeeds; the Collections window just comes up
empty.

`src/data/issues.json` (which powers the Issues window) is no longer in
that list — `deploy.sh` refreshes it from GitHub on every run via
`scripts/content/refresh-issues.sh`. The deploy box just needs the `gh`
CLI installed and authenticated (`gh auth login`). Use `--skip-issues` to
deploy without that, shipping whatever `issues.json` is already checked
out.

## First deploy under this pipeline

`PROD_BASE` defaults to `/root/dev/mrwr-app`, deliberately *not* the old
flat `/root/dev/mrwr` directory the retired pipeline used — so the first
run here can't collide with whatever is still live from before. Once
you've confirmed the new deploy works, the old directory and
`build/scripts/` are no longer used and can be removed whenever you like
(`rm -rf /root/dev/mrwr` on prod, `rm -rf build/` locally).

## If it hangs

All ssh calls use `BatchMode=yes` + a connect timeout, and the remote
`npm install` is capped with `timeout 300`, specifically so a stuck deploy
fails with a clear error instead of hanging forever. If you're on an older
copy of these scripts (or still see a hang), the most likely cause is the
very first ssh connection from a *new* machine to `$PROD_HOST` — the "are
you sure you want to continue connecting (yes/no)?" host-key prompt. Try a
plain `ssh <your PROD_HOST value>` by hand first on any machine before its
first deploy; accepting the host key once there is enough.

## Usage

```
npm run deploy                  # refresh issues + build + deploy
npm run deploy -- --allow-dirty # deploy with uncommitted local changes (testing)
npm run deploy -- --skip-build  # re-deploy the existing out/ as-is
npm run deploy -- --skip-issues # build + deploy without re-pulling issues.json
npm run deploy:status           # what's live on prod right now
npm run deploy:rollback         # back to the previous release
npm run deploy:rollback -- 20260905101500   # back to a specific release
```

(Or call the scripts directly: `scripts/deploy/deploy.sh`, etc.)

By default `deploy.sh` refuses to run with uncommitted changes, so a normal
deploy always ships exactly what's committed. `--allow-dirty` is there for
trying something out on prod before committing — use it deliberately.
