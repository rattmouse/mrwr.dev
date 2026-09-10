#!/usr/bin/env bash
# Refresh src/data/projects.json (+ public/projects/remote/) from GitHub —
# the descriptions and preview images behind the Projects window. Both are
# gitignored and read at build time, so the site never calls GitHub at
# runtime; src/lib/projects.ts falls back to src/data/projects.base.json.
#
# scripts/deploy/deploy.sh runs this before every build (best-effort). Run
# it by hand when you want `npm run dev` or a local build to pick up new
# metadata too.
#
# Needs the `gh` CLI, authenticated (`gh auth status`).

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT="$SCRIPT_DIR/../../src/data/projects.json"

# src/lib/projects.ts imports projects.json unconditionally, so make sure it
# exists even when we can't reach GitHub — an empty map just means every
# project renders from src/data/projects.base.json.
[[ -f "$OUT" ]] || echo '{}' > "$OUT"

command -v gh >/dev/null 2>&1 || {
  echo "gh CLI not found — install it first (e.g. brew install gh / apt install gh)" >&2
  exit 1
}

gh auth status >/dev/null 2>&1 || {
  echo "gh is not authenticated — run 'gh auth login' first" >&2
  exit 1
}

node "$SCRIPT_DIR/refresh-projects.mjs"
