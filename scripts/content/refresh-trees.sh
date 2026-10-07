#!/usr/bin/env bash
# Refresh public/trees/trees.bin.gz — Seattle's street trees, for trees.exe —
# from the City of Seattle's ArcGIS layer. Gitignored, and a static file the
# window fetches from this site, so nothing calls ArcGIS at runtime.
#
# scripts/deploy/deploy.sh runs this before every build (best-effort). It
# skips the download when the file is under a week old; pass --force to
# refetch anyway. See refresh-trees.mjs for the file format.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

node "$SCRIPT_DIR/refresh-trees.mjs" "$@"
