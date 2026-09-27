#!/usr/bin/env bash
# Rebuild src/data/probes.json, a build-time summary of what the tripwire in
# server.js caught. Two sources, both on prod, fetched over ssh:
#
#   - $PROD_BASE/shared/tripwire.ndjson (+ one rotated .1): scanner requests
#     the tripwire in server.js caught (/.env, /wp-login.php, ...).
#   - endlessh's journal, one CLOSE line per client it let go.
#
# refresh-probes.mjs boils both down to counts, top paths and a few recent
# catches. Raw IPs never reach the build — only masked /24s (/48s for IPv6).
#
# The file is gitignored and read only at build time; the site never calls
# anything at runtime. scripts/deploy/deploy.sh runs this before every build.
#
# Best-effort: an unreachable prod (or a --file pointing nowhere) writes an
# empty report rather than failing — the build imports the file, so it is
# always written.
#
# Usage:
#   scripts/content/refresh-probes.sh [options]
#
#   --file PATH         Read tripwire records from a local NDJSON copy instead of ssh.
#   --tarpit-file PATH  With --file: a local copy of endlessh's log lines.
#   -h, --help          This help.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# shellcheck source=../deploy/lib/common.sh
source "$REPO_ROOT/scripts/deploy/lib/common.sh"

LOCAL_FILE=""
TARPIT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) LOCAL_FILE="${2:?--file needs a path}"; shift 2 ;;
    --tarpit-file) TARPIT_FILE="${2:?--tarpit-file needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown argument: $1 (try --help)" ;;
  esac
done

command -v node >/dev/null 2>&1 || fail "node not found — needed to build probes.json."

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/refresh-probes.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT
RECORDS="$WORK_DIR/tripwire.ndjson"
TARPIT="$WORK_DIR/tarpit.log"
: > "$RECORDS"
: > "$TARPIT"

if [[ -n "$LOCAL_FILE" ]]; then
  if [[ -f "$LOCAL_FILE" ]]; then
    cp "$LOCAL_FILE" "$RECORDS"
  else
    warn "No such file: $LOCAL_FILE — no web probes in this report."
  fi
  if [[ -n "$TARPIT_FILE" && -f "$TARPIT_FILE" ]]; then
    cp "$TARPIT_FILE" "$TARPIT"
  fi
else
  load_config
  ARCHIVE="$PROD_BASE/shared/tripwire.ndjson"
  log "Fetching tripwire archive + tarpit log from $PROD_HOST ..."
  # .1 first so records stay in chronological order; both may be absent.
  ssh_prod "cat '$ARCHIVE.1' '$ARCHIVE' 2>/dev/null || true" > "$RECORDS" \
    || warn "Could not reach $PROD_HOST — no web probes in this report."
  # Only the CLOSE lines matter (they carry the time held); journald's own
  # retention bounds how far back this goes.
  ssh_prod "journalctl -u endlessh -o cat --no-pager 2>/dev/null | grep ' CLOSE ' || true" > "$TARPIT" \
    || warn "Could not read endlessh's log — no tarpit numbers in this report."
fi

node "$SCRIPT_DIR/refresh-probes.mjs" --records "$RECORDS" --tarpit "$TARPIT"
