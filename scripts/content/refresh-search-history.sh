#!/usr/bin/env bash
# Rebuild src/data/search-history.json — the data behind the search-bar history
# dropdown. Fetches the durable search-log NDJSON archive from prod over ssh
# ($PROD_BASE/shared/search-log.ndjson, + one rotated .1), then hands it to
# refresh-search-history.mjs, which groups it into search sessions. Sessions on
# the hide list ($PROD_BASE/shared/search-history-hidden.json, managed with
# hide-search-history.sh) are left out, whichever machine runs this.
#
# The file is gitignored and read only at build time; the site never calls
# anything at runtime. scripts/deploy/deploy.sh runs this before every build.
# Run it by hand to make `npm run dev` / a local build pick up newer searches.
#
# This step is best-effort: if prod is unreachable (or --file points nowhere),
# it warns and writes an empty history rather than failing. It fails closed: if
# the archive is reachable but the hide list isn't, nothing is shipped either.
#
# Usage:
#   scripts/content/refresh-search-history.sh [options]
#
#   --file PATH         Read records from a local NDJSON copy instead of ssh.
#   --hidden-file PATH  With --file: a local hide list to apply (default: none).
#   --since DATE        Ignore entries before DATE (e.g. 2026-08-01).
#   --max-sessions N    Keep only the newest N sessions (default 250).
#   -h, --help          This help.
#
# Requirements for the ssh path: scripts/deploy/deploy.config.sh (same as
# deploy.sh) and node. --file needs neither ssh nor config.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# shellcheck source=../deploy/lib/common.sh
source "$REPO_ROOT/scripts/deploy/lib/common.sh"

LOCAL_FILE=""
HIDDEN_FILE=""
SINCE=""
MAX_SESSIONS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) LOCAL_FILE="${2:?--file needs a path}"; shift 2 ;;
    --hidden-file) HIDDEN_FILE="${2:?--hidden-file needs a path}"; shift 2 ;;
    --since) SINCE="${2:?--since needs a date}"; shift 2 ;;
    --max-sessions) MAX_SESSIONS="${2:?--max-sessions needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown argument: $1 (try --help)" ;;
  esac
done

command -v node >/dev/null 2>&1 || fail "node not found — needed to build search-history.json."

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/refresh-search-history.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT
RECORDS="$WORK_DIR/records.ndjson"
HIDDEN="$WORK_DIR/hidden.json"
: > "$RECORDS"
: > "$HIDDEN"

if [[ -n "$LOCAL_FILE" ]]; then
  if [[ -f "$LOCAL_FILE" ]]; then
    cp "$LOCAL_FILE" "$RECORDS"
    log "Reading records from $LOCAL_FILE"
  else
    warn "No such file: $LOCAL_FILE — writing an empty history."
  fi
  if [[ -n "$HIDDEN_FILE" ]]; then
    if [[ -f "$HIDDEN_FILE" ]]; then
      cp "$HIDDEN_FILE" "$HIDDEN"
    else
      warn "No such hide list: $HIDDEN_FILE — writing an empty history."
      : > "$RECORDS"
    fi
  fi
else
  load_config
  ARCHIVE="$PROD_BASE/shared/search-log.ndjson"
  log "Fetching search-log archive from $PROD_HOST ..."
  # .1 first so records stay in chronological order; both may be absent.
  ssh_prod "cat '$ARCHIVE.1' '$ARCHIVE' 2>/dev/null || true" > "$RECORDS" || true
  if [[ ! -s "$RECORDS" ]]; then
    warn "Archive is empty or unreachable ($PROD_HOST:$ARCHIVE) — writing an empty history."
  elif ! ssh_prod "cat '$PROD_BASE/shared/search-history-hidden.json' 2>/dev/null || true" > "$HIDDEN"; then
    # Missing on prod just means nothing is hidden; an ssh failure means we
    # can't tell what's hidden, so ship nothing rather than resurface it.
    warn "Could not read the hide list from $PROD_HOST — writing an empty history."
    : > "$RECORDS"
  fi
fi

MJS_ARGS=(--records "$RECORDS" --hidden "$HIDDEN")
[[ -n "$SINCE" ]] && MJS_ARGS+=(--since "$SINCE")
[[ -n "$MAX_SESSIONS" ]] && MJS_ARGS+=(--max-sessions "$MAX_SESSIONS")

node "$SCRIPT_DIR/refresh-search-history.mjs" "${MJS_ARGS[@]}"
