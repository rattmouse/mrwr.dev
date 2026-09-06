#!/usr/bin/env bash
# Roll back prod to a previous release without rebuilding anything.
#
# Usage:
#   scripts/deploy/rollback.sh              # roll back to the release before current
#   scripts/deploy/rollback.sh <release-id> # roll back to a specific one (see status.sh)

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
load_config

TARGET_RELEASE="${1:-}"

ssh_prod bash -s -- "$PROD_BASE" "$SERVICE_NAME" "$APP_PORT" "$TARGET_RELEASE" <<'REMOTE'
set -euo pipefail
PROD_BASE="$1"
SERVICE_NAME="$2"
APP_PORT="$3"
TARGET_RELEASE="$4"

cd "$PROD_BASE/releases"
CURRENT_RELEASE=$(basename "$(readlink -f "$PROD_BASE/current")")

if [ -z "$TARGET_RELEASE" ]; then
  TARGET_RELEASE=$(ls -1t | grep -v "^$CURRENT_RELEASE\$" | head -n 1)
fi

if [ -z "$TARGET_RELEASE" ] || [ ! -d "$PROD_BASE/releases/$TARGET_RELEASE" ]; then
  echo "No such release: '$TARGET_RELEASE'" >&2
  echo "Available releases:" >&2
  ls -1t >&2
  exit 1
fi

if [ "$TARGET_RELEASE" = "$CURRENT_RELEASE" ]; then
  echo "Already on $TARGET_RELEASE" >&2
  exit 1
fi

echo "Rolling back: $CURRENT_RELEASE -> $TARGET_RELEASE"
ln -sfn "$PROD_BASE/releases/$TARGET_RELEASE" "$PROD_BASE/current.tmp"
mv -Tf "$PROD_BASE/current.tmp" "$PROD_BASE/current"
systemctl restart "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME" && curl -fsS --max-time 5 -o /dev/null "http://localhost:$APP_PORT/"; then
  echo "Now serving $TARGET_RELEASE"
else
  echo "Rolled back but health check failed — check: journalctl -u $SERVICE_NAME -n 100 --no-pager" >&2
  exit 1
fi
REMOTE
