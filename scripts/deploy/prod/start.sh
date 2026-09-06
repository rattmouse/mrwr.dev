#!/usr/bin/env bash
# systemd's ExecStart target. Runs the prod server in place of the current
# release's directory. Using `exec` (not a backgrounded process + a .pid
# file) means systemd tracks the actual node process directly, so
# `systemctl restart`/`stop` signal it correctly without any pid bookkeeping.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec /usr/bin/node "$SCRIPT_DIR/server.js"
