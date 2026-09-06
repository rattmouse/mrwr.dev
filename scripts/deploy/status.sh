#!/usr/bin/env bash
# Show what's currently deployed on prod: service state, active release,
# and the release history available for rollback.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
load_config

ssh "$PROD_HOST" bash -s -- "$PROD_BASE" "$SERVICE_NAME" <<'REMOTE'
set -euo pipefail
PROD_BASE="$1"
SERVICE_NAME="$2"

echo "== service =="
systemctl is-active "$SERVICE_NAME" || true
systemctl status "$SERVICE_NAME" --no-pager -l | head -n 10

echo
echo "== current release =="
readlink -f "$PROD_BASE/current" 2>/dev/null || echo "(no current symlink yet — nothing deployed with the new pipeline)"

echo
echo "== releases (newest first) =="
ls -1t "$PROD_BASE/releases" 2>/dev/null || echo "(none)"
REMOTE
