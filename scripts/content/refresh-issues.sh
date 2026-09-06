#!/usr/bin/env bash
# Refresh src/data/issues.json from GitHub issues (powers the Issues
# window). Needs `gh` and macOS for --json stateReason support. This used
# to scp the result to the build VM for the next deploy to pick up — that
# VM is gone, so it just writes straight into the checked-out repo now.
# The file stays gitignored; copy it to Kubuntu (or wherever you deploy
# from) by hand, same as public/collections/.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

command -v gh >/dev/null 2>&1 || {
  echo "gh CLI not found — install it first (e.g. brew install gh)" >&2
  exit 1
}

gh issue list --repo rattmouse/mrwr.dev \
  --json number,title,body,state,stateReason,comments \
  --state all --limit 1000 \
  > "$REPO_ROOT/src/data/issues.json"

echo "wrote $REPO_ROOT/src/data/issues.json"
