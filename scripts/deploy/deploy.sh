#!/usr/bin/env bash
# Build the static export locally and ship it to prod as a new release.
#
# Usage:
#   scripts/deploy/deploy.sh [--allow-dirty] [--skip-build] [--skip-issues]
#                            [--skip-search-history] [--skip-projects]
#                            [--skip-probes] [--skip-trees]
#                            [--yes-search-history]
#
# Run this from whatever machine has the repo checked out and can reach prod
# over ssh — that's your Kubuntu box, not a separate build VM. There's no
# middle build hop anymore: this script builds locally, uploads the result,
# and switches prod over to it as an atomic, rollback-able release.
#
# One-time setup: cp deploy.config.example.sh deploy.config.sh and fill it
# in (see that file's comments).
#
# Before building, it lists search-history sessions the live site doesn't show
# yet and asks y/n whether to publish them; "n" ships only what's already live.
# With no terminal to ask on it answers "n"; --yes-search-history answers "y".

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
load_config

ALLOW_DIRTY=0
SKIP_BUILD=0
SKIP_ISSUES=0
SKIP_SEARCH_HISTORY=0
SKIP_PROJECTS=0
SKIP_PROBES=0
SKIP_TREES=0
YES_SEARCH_HISTORY=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-issues) SKIP_ISSUES=1 ;;
    --skip-search-history) SKIP_SEARCH_HISTORY=1 ;;
    --skip-projects) SKIP_PROJECTS=1 ;;
    --skip-probes) SKIP_PROBES=1 ;;
    --skip-trees) SKIP_TREES=1 ;;
    --yes-search-history) YES_SEARCH_HISTORY=1 ;;
    *) fail "Unknown argument: $arg (known: --allow-dirty, --skip-build, --skip-issues, --skip-search-history, --skip-projects, --skip-probes, --skip-trees, --yes-search-history)" ;;
  esac
done

cd "$REPO_ROOT"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  warn "You're on branch '$CURRENT_BRANCH', not main."
fi

if [[ -n "$(git status --porcelain)" && "$ALLOW_DIRTY" -ne 1 ]]; then
  fail "Working tree has uncommitted changes. Commit or stash first, or re-run with --allow-dirty for a deliberate test deploy of local changes."
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  LOCAL_SHA=$(git rev-parse HEAD)
  UPSTREAM_SHA=$(git rev-parse '@{u}')
  if [[ "$LOCAL_SHA" != "$UPSTREAM_SHA" ]]; then
    warn "HEAD differs from its upstream — fine for a manual test deploy, just know this isn't exactly what's on origin."
  fi
fi

RELEASE_ID=$(date -u +%Y%m%d%H%M%S)
SEARCH_HISTORY="$REPO_ROOT/src/data/search-history.json"
# What the live site's search history was built from — saved after every
# healthy deploy, so "new" means new to the public site, whichever machine
# deployed last.
SEARCH_HISTORY_DEPLOYED="$PROD_BASE/shared/search-history-deployed.json"
STAGE_DIR="$REPO_ROOT/.deploy/$RELEASE_ID"

log "Preparing release $RELEASE_ID"

if [[ "$SKIP_BUILD" -ne 1 ]]; then
  if [[ "$SKIP_ISSUES" -ne 1 ]]; then
    log "Refreshing issues from GitHub..."
    # issues.json is gitignored and read at build time — pull it fresh here
    # so every deploy ships current issues without a manual pre-step. The
    # site itself never calls GitHub at runtime.
    "$REPO_ROOT/scripts/content/refresh-issues.sh" \
      || fail "Issue refresh failed. Fix gh (install + 'gh auth login'), or re-run with --skip-issues to deploy the src/data/issues.json already in the tree."
  else
    warn "Skipping issue refresh (--skip-issues) — shipping src/data/issues.json as-is."
  fi

  if [[ "$SKIP_SEARCH_HISTORY" -ne 1 ]]; then
    log "Refreshing search history from the prod archive..."
    # search-history.json is gitignored and read at build time — the data
    # behind the search-bar history dropdown. Best-effort: an unreachable
    # prod just ships an empty history, never a failed deploy.
    "$REPO_ROOT/scripts/content/refresh-search-history.sh" \
      || warn "Search-history refresh failed; shipping src/data/search-history.json as-is."
  else
    warn "Skipping search-history refresh (--skip-search-history) — shipping src/data/search-history.json as-is."
  fi

  if [[ -f "$SEARCH_HISTORY" ]]; then
    log "Checking for search history the live site doesn't show yet..."
    SH_BASELINE=$(mktemp "${TMPDIR:-/tmp}/search-history-deployed.XXXXXX")
    if ! ssh_prod "cat '$SEARCH_HISTORY_DEPLOYED' 2>/dev/null || true" > "$SH_BASELINE"; then
      warn "Couldn't read $SEARCH_HISTORY_DEPLOYED from prod — treating every session as new."
      : > "$SH_BASELINE"
    elif [[ ! -s "$SH_BASELINE" ]]; then
      warn "No record on prod of what the live site shows yet — treating every session as new."
    fi
    set +e
    SH_DIFF=$(node "$REPO_ROOT/scripts/content/diff-search-history.mjs" --baseline "$SH_BASELINE" --current "$SEARCH_HISTORY")
    SH_STATUS=$?
    set -e
    if [[ "$SH_STATUS" -eq 10 ]]; then
      warn "This deploy would publish search history the live site doesn't show yet:"
      printf '%s\n' "$SH_DIFF" >&2
      if [[ "$YES_SEARCH_HISTORY" -eq 1 ]]; then
        SH_ANSWER=y
        log "Publishing them (--yes-search-history)."
      elif [[ -t 0 ]]; then
        SH_ANSWER=""
        while [[ "$SH_ANSWER" != y && "$SH_ANSWER" != n ]]; do
          read -r -p "Publish these searches? [y/n] " SH_ANSWER
          SH_ANSWER=$(printf '%s' "$SH_ANSWER" | tr '[:upper:]' '[:lower:]' | cut -c1)
        done
      else
        SH_ANSWER=n
        warn "No terminal to ask on — leaving them out (pass --yes-search-history to publish)."
      fi
      if [[ "$SH_ANSWER" == n ]]; then
        node "$REPO_ROOT/scripts/content/diff-search-history.mjs" --baseline "$SH_BASELINE" --current "$SEARCH_HISTORY" --drop-new
        log "Held back for now; to keep one out for good: scripts/content/hide-search-history.sh add <id>"
      fi
    elif [[ "$SH_STATUS" -ne 0 ]]; then
      rm -f "$SH_BASELINE"
      fail "Search-history check failed (exit $SH_STATUS)."
    else
      log "No new search history."
    fi
    rm -f "$SH_BASELINE"
  fi

  if [[ "$SKIP_PROJECTS" -ne 1 ]]; then
    log "Refreshing project metadata from GitHub..."
    # src/data/projects.json + public/projects/remote/ are gitignored and
    # read at build time — the GitHub descriptions and README images behind
    # the Projects window. Best-effort: on failure the site falls back to
    # src/data/projects.base.json and /projects/thumbs/, never a failed
    # deploy (or pass --skip-projects).
    "$REPO_ROOT/scripts/content/refresh-projects.sh" \
      || warn "Project metadata refresh failed; shipping src/data/projects.json as-is."
  else
    warn "Skipping project metadata refresh (--skip-projects) — shipping src/data/projects.json as-is."
  fi

  if [[ "$SKIP_PROBES" -ne 1 ]]; then
    log "Refreshing probe report..."
    # probes.json is gitignored and read at build time. Best-effort, and it
    # always writes the file (empty on failure) because the build imports it.
    "$REPO_ROOT/scripts/content/refresh-probes.sh" \
      || warn "Probe refresh failed; shipping src/data/probes.json as-is."
  elif [[ ! -f "$REPO_ROOT/src/data/probes.json" ]]; then
    # The build imports it, so --skip-probes still needs something there.
    node "$REPO_ROOT/scripts/content/refresh-probes.mjs"
  else
    warn "Skipping probe refresh (--skip-probes) — shipping src/data/probes.json as-is."
  fi

  if [[ "$SKIP_TREES" -ne 1 ]]; then
    log "Refreshing street trees..."
    # public/trees/ is gitignored — Seattle's street trees for trees.exe and
    # the ground under them, static files the window fetches from this site. Best-effort
    # (trees.exe says so when the file is missing), and it skips the download
    # while the file is under a week old.
    "$REPO_ROOT/scripts/content/refresh-trees.sh" \
      || warn "Street-tree refresh failed; shipping public/trees/ as-is."
  else
    warn "Skipping street-tree refresh (--skip-trees) — shipping public/trees/ as-is."
  fi

  log "Installing dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  log "Building static export..."
  npm run build
else
  warn "Skipping build (--skip-build) — deploying whatever is currently in out/."
fi

[[ -d "$REPO_ROOT/out" ]] || fail "out/ not found — build didn't run or failed."

log "Staging release bundle..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp -r "$REPO_ROOT/out/." "$STAGE_DIR/"
cp "$REPO_ROOT/server.js" "$STAGE_DIR/server.js"
# server.js require()s these at startup: search-guard.js flags hostile queries,
# search-sessions.js groups live keystrokes into sessions for the notifier.
cp "$REPO_ROOT/search-guard.js" "$STAGE_DIR/search-guard.js"
cp "$REPO_ROOT/search-sessions.js" "$STAGE_DIR/search-sessions.js"

# The only third-party module server.js loads is "express" (plus Node
# builtins and the zero-dependency ./search-guard.js copied just above) —
# it's a static file server for the already-built out/, nothing else in
# package.json's dependencies (next, react, react95, styled-components,
# the strudel packages — all build-time only) runs on prod. Shipping the
# repo's real package.json had prod's `npm install` pulling in the entire
# Next.js/React toolchain on every deploy, which is almost certainly what
# was getting OOM-killed on a small prod box. Ship a minimal one instead.
EXPRESS_SPEC=$(node -p "require('$REPO_ROOT/package.json').dependencies.express")
cat > "$STAGE_DIR/package.json" <<PKGJSON
{
  "name": "mrwr-dev-prod",
  "private": true,
  "dependencies": {
    "express": "$EXPRESS_SPEC"
  }
}
PKGJSON

cp "$SCRIPT_DIR/prod/start.sh" "$STAGE_DIR/start.sh"
cp "$SCRIPT_DIR/prod/logs.sh" "$STAGE_DIR/logs.sh"
cp "$SCRIPT_DIR/prod/journalctl_to_readme.sh" "$STAGE_DIR/journalctl_to_readme.sh"
chmod +x "$STAGE_DIR/"*.sh
sed "s#__APP_DIR__#$PROD_BASE#g" "$SCRIPT_DIR/prod/mrwr.dev.service.template" > "$STAGE_DIR/$SERVICE_NAME"

log "Uploading to $PROD_HOST:$PROD_BASE/releases/$RELEASE_ID ..."
# releases/ holds the swappable release dirs; shared/ holds state that must
# outlive them (the search-log archive — issue #55).
ssh_prod "mkdir -p '$PROD_BASE/releases' '$PROD_BASE/shared'"
rsync -az --delete "$STAGE_DIR/" "$PROD_HOST:$PROD_BASE/releases/$RELEASE_ID/"

log "Installing dependencies + switching over on prod..."
set +e
ssh_prod bash -s -- "$PROD_BASE" "$RELEASE_ID" "$SERVICE_NAME" "$APP_PORT" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
PROD_BASE="$1"
RELEASE_ID="$2"
SERVICE_NAME="$3"
APP_PORT="$4"
KEEP_RELEASES="$5"
RELEASE_DIR="$PROD_BASE/releases/$RELEASE_ID"

PREVIOUS_RELEASE=""
if [ -L "$PROD_BASE/current" ]; then
  PREVIOUS_RELEASE=$(readlink -f "$PROD_BASE/current")
fi

cd "$RELEASE_DIR"
timeout 300 npm install --omit=dev

# Home for the optional notifier env file (see the unit's EnvironmentFile).
# Just the dir — the operator drops notify.env in by hand, it holds secrets
# and is never shipped. Under /etc so SELinux lets PID 1 read it.
mkdir -p /etc/mrwr.dev

cp "$RELEASE_DIR/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null

ln -sfn "$RELEASE_DIR" "$PROD_BASE/current.tmp"
mv -Tf "$PROD_BASE/current.tmp" "$PROD_BASE/current"
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME" && curl -fsS --max-time 5 -o /dev/null "http://localhost:$APP_PORT/"; then
  echo "HEALTHY"
else
  echo "UNHEALTHY: new release failed to come up cleanly" >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    echo "Rolling back to $PREVIOUS_RELEASE" >&2
    ln -sfn "$PREVIOUS_RELEASE" "$PROD_BASE/current.tmp"
    mv -Tf "$PROD_BASE/current.tmp" "$PROD_BASE/current"
    systemctl restart "$SERVICE_NAME"
  else
    echo "No previous release to roll back to." >&2
  fi
  exit 1
fi

cd "$PROD_BASE/releases"
KEEP_DIR=$(basename "$(readlink -f "$PROD_BASE/current")")
ls -1t | grep -v "^$KEEP_DIR\$" | tail -n +"$KEEP_RELEASES" | while read -r old; do
  rm -rf "$old"
done
REMOTE
REMOTE_STATUS=$?
set -e

rm -rf "$STAGE_DIR"

if [[ "$REMOTE_STATUS" -eq 0 ]]; then
  log "Deploy $RELEASE_ID is live."
  # Record what the live search history was built from, for the next deploy's
  # "new search history" check. Only when this deploy actually built it.
  if [[ "$SKIP_BUILD" -ne 1 && -f "$SEARCH_HISTORY" ]]; then
    ssh_prod "cat > '$SEARCH_HISTORY_DEPLOYED'" < "$SEARCH_HISTORY" \
      || warn "Couldn't save $SEARCH_HISTORY_DEPLOYED on prod; the next deploy will treat all search history as new."
  fi
else
  fail "Deploy $RELEASE_ID failed its health check and was rolled back. Check: ssh $PROD_HOST journalctl -u $SERVICE_NAME -n 100 --no-pager"
fi
