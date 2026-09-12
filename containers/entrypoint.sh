#!/usr/bin/env bash
# Container entrypoint: make the mounted credentials usable, then exec the
# command.
#
# ssh keys come in on a read-only mount at /run/host/ssh and get copied into
# $HOME here rather than mounted straight at ~/.ssh. Two reasons: ssh wants
# to write (known_hosts) and fails awkwardly on a read-only mount, and a copy
# means nothing the container does can ever write back into your real ~/.ssh
# on the host. GitHub credentials arrive separately, as a GH_TOKEN env var.

set -euo pipefail

if [[ -d /run/host/ssh ]]; then
  mkdir -p "$HOME/.ssh"
  cp -a /run/host/ssh/. "$HOME/.ssh/" 2>/dev/null || true
  chmod 700 "$HOME/.ssh"
  # ssh refuses to use a private key that's group/world readable.
  find "$HOME/.ssh" -maxdepth 1 -type f ! -name '*.pub' ! -name 'known_hosts*' \
    -exec chmod 600 {} +
fi

# The repo is bind-mounted from the host. Even with matching uids git can be
# fussy about a worktree it considers foreign, and deploy.sh runs several
# git commands before it does anything else.
git config --global --add safe.directory /workspace 2>/dev/null || true

exec "$@"
