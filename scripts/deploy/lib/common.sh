#!/usr/bin/env bash
# Shared helpers for the mrwr.dev deploy scripts.
# Sourced by deploy.sh / rollback.sh / status.sh — not meant to be run directly.

set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO_ROOT=$(cd "$DEPLOY_DIR/../.." && pwd)

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

load_config() {
  local config_file="$DEPLOY_DIR/deploy.config.sh"
  local example_file="$DEPLOY_DIR/deploy.config.example.sh"

  if [[ ! -f "$config_file" ]]; then
    fail "Missing $config_file — copy $example_file to deploy.config.sh and fill in your prod host details. It's gitignored on purpose (machine-local, never committed), so this is a one-time setup on each machine that deploys."
  fi

  # shellcheck disable=SC1090
  source "$config_file"

  : "${PROD_HOST:?Set PROD_HOST in deploy.config.sh (an ssh host/alias, e.g. root@prod)}"
  : "${PROD_BASE:?Set PROD_BASE in deploy.config.sh (e.g. /root/dev/mrwr-app)}"
  : "${SERVICE_NAME:=mrwr.dev.service}"
  : "${KEEP_RELEASES:=5}"
  : "${APP_PORT:=3000}"

  export PROD_HOST PROD_BASE SERVICE_NAME KEEP_RELEASES APP_PORT

  # -o BatchMode=yes: never sit waiting on a password/passphrase/host-key
  # prompt that has nowhere to go in a script — fail fast with a clear
  # error instead of hanging silently (this is what a first-ever
  # connection from a new machine to $PROD_HOST would otherwise do: block
  # on an "are you sure you want to continue connecting?" prompt).
  # -o ConnectTimeout=10: same idea for an unreachable host.
  SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
}

ssh_prod() {
  ssh "${SSH_OPTS[@]}" "$PROD_HOST" "$@"
}
