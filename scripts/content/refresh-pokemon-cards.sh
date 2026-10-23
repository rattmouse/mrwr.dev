#!/usr/bin/env bash
# Refresh public/collections/cards.json (+ public/collections/cards/) from the
# card-binder collection — the Pokémon cards behind the Collections window's
# "Cards" tab.
#
# Reads ../card-binder/binder.db read-only (CARD_BINDER_DB or --db points it
# elsewhere), takes the most valuable cards and copies their scans locally. The
# outputs are gitignored, like everything else under public/collections/.
#
# deploy.sh runs it with --keep-count, so every deploy picks up newly scanned
# cards while the shelf stays the size cards.json already is. Scans already
# downloaded are reused, so only new picks hit the network. Run it by hand with
# --limit to change the size; later deploys keep the new one.
#
#   scripts/content/refresh-pokemon-cards.sh                 # top 40 cards
#   scripts/content/refresh-pokemon-cards.sh --limit 100
#   scripts/content/refresh-pokemon-cards.sh --all
#   scripts/content/refresh-pokemon-cards.sh --keep-count    # as many as cards.json has
#
# Needs Node 22+ (node:sqlite) and network access to the binder's image host.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# node:sqlite is still flagged experimental in Node 22 and says so on every run;
# everything else still gets through.
node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/refresh-pokemon-cards.mjs" "$@"
