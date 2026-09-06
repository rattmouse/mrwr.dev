#!/usr/bin/env bash
# Show prod's recorded searches through the search-line formatter.
#
# Prefers the durable append-only archive written by server.js
# ($PROD_BASE/shared/search-log.ndjson, plus one rotated .1 generation) so
# nothing is lost to journal rotation (issue #55). Falls back to journalctl
# when the archive isn't there yet (e.g. a box still on an old release).
#
# Usage: scripts/deploy/prod/logs.sh [service-name]
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SERVICE_NAME="${1:-mrwr.dev.service}"

# This script ships inside a release dir: $PROD_BASE/releases/<id>/logs.sh
PROD_BASE=$(cd "$SCRIPT_DIR/../.." && pwd)
SEARCH_LOG_FILE="${SEARCH_LOG_FILE:-$PROD_BASE/shared/search-log.ndjson}"

if [ -s "$SEARCH_LOG_FILE" ] || [ -s "$SEARCH_LOG_FILE.1" ]; then
  cat "$SEARCH_LOG_FILE.1" "$SEARCH_LOG_FILE" 2>/dev/null | "$SCRIPT_DIR/journalctl_to_readme.sh"
else
  journalctl -u "$SERVICE_NAME" --no-pager -o short | "$SCRIPT_DIR/journalctl_to_readme.sh"
fi
