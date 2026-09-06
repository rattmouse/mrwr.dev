#!/usr/bin/env bash
# Interactive triage: turn recorded search-bar entries into GitHub issues.
#
# The search bar doubles as a scratchpad — every keystroke-change is POSTed to
# /log-search and appended to a durable NDJSON archive on prod
# ($PROD_BASE/shared/search-log.ndjson, + one rotated .1). Historically, turning
# one of those noted thoughts into an issue meant SSHing in, running
# scripts/deploy/prod/logs.sh, and hand-pasting the formatted lines into a new
# GitHub issue. This automates everything except the judgement call.
#
# What it does:
#   1. Pulls the NDJSON archive from prod over ssh (uses scripts/deploy config).
#   2. Groups consecutive entries into "search sessions" (one thought = one
#      run of edits to the same query, same browser session, no long pause).
#   3. Hides sessions you've already filed or dismissed (state file below) and
#      sessions whose text already shows up in a live issue body.
#   4. For each remaining session: shows the formatted `from search bar:` block
#      exactly as it will appear on GitHub, then waits for you to pick
#      create / edit-title-and-create / append-to-an-existing-issue /
#      skip-forever / later / quit.
#   5. `gh issue create`s (or `gh issue comment`s) the ones you approve.
#
# The body block is produced by piping the session's raw NDJSON back through
# scripts/deploy/prod/journalctl_to_readme.sh, so it is byte-identical to what
# logs.sh prints and IssuesTreeView's playback parser already understands.
#
# Nothing is filed without an explicit keypress, and every create shows the
# full title + body first.
#
# State (which sessions are already handled) lives in
#   scripts/content/.search-triage-state.json   (gitignored, machine-local)
#
# Requirements: the `gh` CLI authenticated (`gh auth status`), ssh access to
# prod (same as deploy.sh — needs scripts/deploy/deploy.config.sh), python3.
#
# Usage:
#   scripts/content/search-to-issue.sh [options]
#
#   --file PATH     Read records from a local NDJSON file instead of ssh'ing
#                   to prod (handy offline, or against a saved copy).
#   --since DATE    Ignore entries before DATE (e.g. 2026-08-01). Default: all.
#   --idle-gap SEC  Seconds of silence that ends a session (default 180).
#   --repo OWNER/REPO  Target repo (default rattmouse/mrwr.dev).
#   --dry-run       Show what would be offered; never call gh or touch state.
#   -h, --help      This help.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# shellcheck source=../deploy/lib/common.sh
source "$REPO_ROOT/scripts/deploy/lib/common.sh"

REPO_SLUG="rattmouse/mrwr.dev"
LOCAL_FILE=""
SINCE=""
IDLE_GAP=180
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) LOCAL_FILE="${2:?--file needs a path}"; shift 2 ;;
    --since) SINCE="${2:?--since needs a date}"; shift 2 ;;
    --idle-gap) IDLE_GAP="${2:?--idle-gap needs seconds}"; shift 2 ;;
    --repo) REPO_SLUG="${2:?--repo needs OWNER/REPO}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown argument: $1 (try --help)" ;;
  esac
done

command -v python3 >/dev/null 2>&1 || fail "python3 not found."
command -v gh >/dev/null 2>&1 || fail "gh CLI not found — install it (brew install gh / apt install gh)."
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run 'gh auth login' first."

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/search-to-issue.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

RECORDS="$WORK_DIR/records.ndjson"
ISSUES="$WORK_DIR/issues.json"

if [[ -n "$LOCAL_FILE" ]]; then
  [[ -f "$LOCAL_FILE" ]] || fail "No such file: $LOCAL_FILE"
  cp "$LOCAL_FILE" "$RECORDS"
  log "Reading records from $LOCAL_FILE"
else
  load_config
  ARCHIVE="$PROD_BASE/shared/search-log.ndjson"
  log "Fetching search-log archive from $PROD_HOST ..."
  # .1 first so records stay in chronological order; both may be absent.
  ssh_prod "cat '$ARCHIVE.1' '$ARCHIVE' 2>/dev/null || true" > "$RECORDS"
  [[ -s "$RECORDS" ]] || fail "Archive is empty or unreachable ($PROD_HOST:$ARCHIVE). Is the current release new enough to write it? (issue #55)"
fi

log "Loading existing issues from $REPO_SLUG ..."
gh issue list --repo "$REPO_SLUG" \
  --json number,title,body,state \
  --state all --limit 1000 > "$ISSUES"

PY_ARGS=(
  --records "$RECORDS"
  --issues "$ISSUES"
  --state "$SCRIPT_DIR/.search-triage-state.json"
  --formatter "$REPO_ROOT/scripts/deploy/prod/journalctl_to_readme.sh"
  --repo "$REPO_SLUG"
  --idle-gap "$IDLE_GAP"
)
[[ -n "$SINCE" ]] && PY_ARGS+=(--since "$SINCE")
[[ "$DRY_RUN" -eq 1 ]] && PY_ARGS+=(--dry-run)

exec python3 "$SCRIPT_DIR/search_to_issue.py" "${PY_ARGS[@]}"
