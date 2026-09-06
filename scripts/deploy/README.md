# Deploy pipeline

Replaces the old build-VM pipeline (`build/scripts/deploy/*`, now retired —
that VM is gone). There's no separate build host anymore: whatever machine
runs `deploy.sh` builds the static export itself and ships it straight to
prod.

**Split across machines, by design:** develop on your day-to-day machine,
then run these scripts from Kubuntu to actually test-build and deploy. Any
machine with Node, npm, ssh, and rsync can run them, though — nothing here
is Kubuntu-specific.

## How it works

```
scripts/deploy/deploy.sh
  1. npm ci && npm run build          (local — produces out/)
  2. stage out/ + server.js + package.json + prod/{start,logs}.sh
     + a systemd unit filled in from mrwr.dev.service.template
  3. rsync the stage dir to $PROD_HOST:$PROD_BASE/releases/<timestamp>/
  4. on prod: npm install --omit=dev, install the systemd unit,
     atomically swap the `current` symlink to the new release, restart
  5. health-check (systemctl is-active + curl localhost); on failure,
     automatically swap `current` back and exit non-zero
  6. prune old releases beyond KEEP_RELEASES
```

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

**Also gitignored, so `git pull` alone won't bring them to a new
machine — copy by hand once (e.g. `rsync -av` from your dev machine):**

- `public/collections/` (album cover images + `content.json`) — the
  Collections window needs these to build correctly.
- `src/data/issues.json` — powers the Issues window.

A build without them still succeeds; those two windows just come up empty.

## First deploy under this pipeline

`PROD_BASE` defaults to `/root/dev/mrwr-app`, deliberately *not* the old
flat `/root/dev/mrwr` directory the retired pipeline used — so the first
run here can't collide with whatever is still live from before. Once
you've confirmed the new deploy works, the old directory and
`build/scripts/` are no longer used and can be removed whenever you like
(`rm -rf /root/dev/mrwr` on prod, `rm -rf build/` locally).

## Usage

```
npm run deploy                  # build + deploy
npm run deploy -- --allow-dirty # deploy with uncommitted local changes (testing)
npm run deploy -- --skip-build  # re-deploy the existing out/ as-is
npm run deploy:status           # what's live on prod right now
npm run deploy:rollback         # back to the previous release
npm run deploy:rollback -- 20260905101500   # back to a specific release
```

(Or call the scripts directly: `scripts/deploy/deploy.sh`, etc.)

By default `deploy.sh` refuses to run with uncommitted changes, so a normal
deploy always ships exactly what's committed. `--allow-dirty` is there for
trying something out on prod before committing — use it deliberately.
