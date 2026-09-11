#!/usr/bin/env bash
# Refresh src/data/issues.json from GitHub issues — the data behind the
# Issues window (and the closed-issue links in the Changes window). The
# file is gitignored and read at build time, so the site never calls
# GitHub at runtime.
#
# After the refresh it runs link-prs.mjs, which stamps a `closedByPr`
# field onto each closed issue that a merged pull request resolved.
#
# scripts/deploy/deploy.sh runs this automatically before each build, so a
# normal deploy always ships current issues. Run it by hand whenever you
# want `npm run dev` or a local build to pick up new issues too.
#
# Needs the `gh` CLI, authenticated (`gh auth status`).

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

command -v gh >/dev/null 2>&1 || {
  echo "gh CLI not found — install it first (e.g. brew install gh / apt install gh)" >&2
  exit 1
}

gh auth status >/dev/null 2>&1 || {
  echo "gh is not authenticated — run 'gh auth login' first" >&2
  exit 1
}

DEST="$REPO_ROOT/src/data/issues.json"
TMP=$(mktemp "${DEST}.XXXXXX")
trap 'rm -f "$TMP"' EXIT

gh issue list --repo rattmouse/mrwr.dev \
  --json number,title,body,state,stateReason,comments,createdAt \
  --state all --limit 1000 \
  > "$TMP"

mv "$TMP" "$DEST"
trap - EXIT

echo "wrote $DEST"

# Link closed issues to the PR that resolved them. Non-fatal: a failure here
# just means issues.json ships without closedByPr data.
node "$SCRIPT_DIR/link-prs.mjs" \
  || echo "warning: PR link pass failed; issues.json has no closedByPr data" >&2
