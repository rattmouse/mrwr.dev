#!/usr/bin/env bash
# Tail prod's service logs through the search-line formatter.
# Usage: scripts/deploy/prod/logs.sh [service-name]
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SERVICE_NAME="${1:-mrwr.dev.service}"
journalctl -u "$SERVICE_NAME" --no-pager -o short | "$SCRIPT_DIR/journalctl_to_readme.sh"
