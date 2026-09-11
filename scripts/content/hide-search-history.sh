#!/usr/bin/env bash
# Keep chosen search sessions out of the search-bar history dropdown.
#
# search-history.json is rebuilt from prod before every deploy, so deleting a
# session from it by hand doesn't stick. Hidden session ids live on prod
# instead, next to the archive ($PROD_BASE/shared/search-history-hidden.json),
# and refresh-search-history.sh fetches that list and leaves those sessions out
# — so they stay hidden whichever machine deploys. The archive itself is never
# touched, so search-to-issue.sh still sees hidden sessions.
#
# Usage:
#   scripts/content/hide-search-history.sh [options] list
#   scripts/content/hide-search-history.sh [options] add <session-id>...
#   scripts/content/hide-search-history.sh [options] remove <session-id>...
#
#   --file PATH     Use a local hide list instead of the one on prod (offline /
#                   testing; pair with refresh-search-history.sh --hidden-file).
#   -h, --help      This help.
#
# Session ids are the `id` field in src/data/search-history.json. `add` also
# strips them from that file right away; `remove` takes effect on the next
# refresh. Requirements: node, plus ssh to prod and
# scripts/deploy/deploy.config.sh (same as deploy.sh) unless --file is given.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# shellcheck source=../deploy/lib/common.sh
source "$REPO_ROOT/scripts/deploy/lib/common.sh"

LOCAL_FILE=""
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) LOCAL_FILE="${2:?--file needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

[[ ${#ARGS[@]} -gt 0 ]] || fail "Say list, add <id>... or remove <id>... (try --help)"
CMD="${ARGS[0]}"
case "$CMD" in
  list) ;;
  add|remove) [[ ${#ARGS[@]} -gt 1 ]] || fail "$CMD needs at least one session id" ;;
  *) fail "Unknown command: $CMD (try --help)" ;;
esac

command -v node >/dev/null 2>&1 || fail "node not found."
MJS="$SCRIPT_DIR/hide-search-history.mjs"

if [[ -n "$LOCAL_FILE" ]]; then
  exec node "$MJS" "${ARGS[@]}" --hidden "$LOCAL_FILE"
fi

load_config
REMOTE="$PROD_BASE/shared/search-history-hidden.json"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hide-search-history.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT
LIST="$WORK_DIR/hidden.json"

# A missing list on prod is just an empty one; an ssh failure is fatal, so we
# never upload a list built from nothing over the real one.
ssh_prod "cat '$REMOTE' 2>/dev/null || true" > "$LIST" \
  || fail "Could not read $PROD_HOST:$REMOTE — nothing changed."

node "$MJS" "${ARGS[@]}" --hidden "$LIST"
[[ "$CMD" == list ]] && exit 0

ssh_prod "mkdir -p '$PROD_BASE/shared' && cat > '$REMOTE.tmp' && mv '$REMOTE.tmp' '$REMOTE'" < "$LIST" \
  || fail "Could not write $PROD_HOST:$REMOTE — the hide list on prod is unchanged."
log "Hide list saved to $PROD_HOST:$REMOTE"
