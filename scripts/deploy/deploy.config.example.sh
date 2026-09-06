#!/usr/bin/env bash
# Copy this file to deploy.config.sh (same directory) and fill in your own
# values:
#
#   cp scripts/deploy/deploy.config.example.sh scripts/deploy/deploy.config.sh
#
# deploy.config.sh is gitignored on purpose: it's machine-local and never
# committed. Both your dev machine and Kubuntu need their own copy, since
# either one could run these scripts, but only Kubuntu actually needs to
# reach prod for a real deploy.

# SSH host/alias for the prod box. Set this up in ~/.ssh/config so plain
# `ssh prod` already works (the "already works" answer that shaped this
# rewrite) — don't hardcode a real hostname/IP here even though this file
# never gets committed.
PROD_HOST="root@prod"

# Where releases live on prod. This intentionally does NOT reuse the old
# flat /root/dev/mrwr directory from the retired build-VM pipeline, so the
# first deploy under this new layout can't collide with whatever is
# currently live there. Point it back at /root/dev/mrwr once you've
# decommissioned the old layout, if you want.
PROD_BASE="/root/dev/mrwr-app"

# systemd unit name installed on prod.
SERVICE_NAME="mrwr.dev.service"

# How many releases to keep on prod (current + this many older, for
# rollback). Older ones are pruned automatically after a healthy deploy.
KEEP_RELEASES=5

# Port server.js listens on — must match the Caddy reverse_proxy target.
APP_PORT=3000
