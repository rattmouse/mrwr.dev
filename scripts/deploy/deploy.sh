#!/usr/bin/env bash
# Build the static export locally and ship it to prod as a new release.
#
# Usage:
#   scripts/deploy/deploy.sh [--allow-dirty] [--skip-build]
#
# Run this from whatever machine has the repo checked out and can reach prod
# over ssh — that's your Kubuntu box, not a separate build VM. There's no
# middle build hop anymore: this script builds locally, uploads the result,
# and switches prod over to it as an atomic, rollback-able release.
#
# One-time setup: cp deploy.config.example.sh deploy.config.sh and fill it
# in (see that file's comments).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
load_config

ALLOW_DIRTY=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) fail "Unknown argument: $arg (known: --allow-dirty, --skip-build)" ;;
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
STAGE_DIR="$REPO_ROOT/.deploy/$RELEASE_ID"

log "Preparing release $RELEASE_ID"

if [[ "$SKIP_BUILD" -ne 1 ]]; then
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
cp "$REPO_ROOT/package.json" "$STAGE_DIR/package.json"
[[ -f "$REPO_ROOT/package-lock.json" ]] && cp "$REPO_ROOT/package-lock.json" "$STAGE_DIR/package-lock.json"
cp "$SCRIPT_DIR/prod/start.sh" "$STAGE_DIR/start.sh"
cp "$SCRIPT_DIR/prod/logs.sh" "$STAGE_DIR/logs.sh"
cp "$SCRIPT_DIR/prod/journalctl_to_readme.sh" "$STAGE_DIR/journalctl_to_readme.sh"
chmod +x "$STAGE_DIR/"*.sh
sed "s#__APP_DIR__#$PROD_BASE#g" "$SCRIPT_DIR/prod/mrwr.dev.service.template" > "$STAGE_DIR/$SERVICE_NAME"

log "Uploading to $PROD_HOST:$PROD_BASE/releases/$RELEASE_ID ..."
ssh "$PROD_HOST" "mkdir -p '$PROD_BASE/releases'"
rsync -az --delete "$STAGE_DIR/" "$PROD_HOST:$PROD_BASE/releases/$RELEASE_ID/"

log "Installing dependencies + switching over on prod..."
set +e
ssh "$PROD_HOST" bash -s -- "$PROD_BASE" "$RELEASE_ID" "$SERVICE_NAME" "$APP_PORT" "$KEEP_RELEASES" <<'REMOTE'
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
npm install --omit=dev

cp "$RELEASE_DIR/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null

ln -sfn "$RELEASE_DIR" "$PROD_BASE/current.tmp"
mv -Tf "$PROD_BASE/current.tmp" "$PROD_BASE/current"
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME" && curl -fsS -o /dev/null "http://localhost:$APP_PORT/"; then
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
else
  fail "Deploy $RELEASE_ID failed its health check and was rolled back. Check: ssh $PROD_HOST journalctl -u $SERVICE_NAME -n 100 --no-pager"
fi
