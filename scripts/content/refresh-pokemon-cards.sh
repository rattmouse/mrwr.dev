#!/usr/bin/env bash
# Refresh public/collections/cards.json (+ public/collections/cards/) from the
# card-binder collection — the Pokémon cards behind the Collections window's
# "Cards" tab.
#
# Reads ../card-binder/binder.db read-only (CARD_BINDER_DB or --db points it
# elsewhere), takes the most valuable cards and copies their scans locally. The
# outputs are gitignored, like everything else under public/collections/.
#
# Unlike the issue/project refreshes this is not wired into a deploy: the
# collection only changes when you scan something new, so run it by hand and the
# downloaded scans serve every build after that.
#
#   scripts/content/refresh-pokemon-cards.sh                 # top 48 cards
#   scripts/content/refresh-pokemon-cards.sh --limit 100
#   scripts/content/refresh-pokemon-cards.sh --all
#
# Needs Node 22+ (node:sqlite) and network access to the binder's image host.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# node:sqlite is still flagged experimental in Node 22 and says so on every run;
# everything else still gets through.
node --disable-warning=ExperimentalWarning "$SCRIPT_DIR/refresh-pokemon-cards.mjs" "$@"
