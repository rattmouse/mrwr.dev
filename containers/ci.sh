#!/usr/bin/env bash
# Podman front end for mrwr.dev's build/deploy pipeline.
#
#   containers/ci.sh image            build (or rebuild) the image
#   containers/ci.sh dev              start the dev server at http://localhost:3000
#   containers/ci.sh shell            interactive shell in the dev container
#   containers/ci.sh exec <cmd...>    run a command in the dev container
#   containers/ci.sh run <cmd...>     run a command in a throwaway container
#   containers/ci.sh ci               refresh + install + lint + build, the pre-PR check
#   containers/ci.sh deploy [args]    scripts/deploy/deploy.sh, with prod creds
#   containers/ci.sh status           what's live on prod right now
#   containers/ci.sh rollback [id]    roll prod back
#   containers/ci.sh logs [-f]        dev server logs
#   containers/ci.sh stop             stop + remove the dev container
#   containers/ci.sh clean            stop, and drop the cached volumes too
#
# Everything runs rootless. The repo is bind-mounted, so edits on the host
# are live inside the container and build output lands back in your tree;
# node_modules, .next and the npm cache live in named volumes so the
# container's Linux/Node-22 install never collides with whatever the host
# has in its own node_modules.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

IMAGE="localhost/mrwr.dev-ci:latest"
DEV_CONTAINER="mrwr-dev"
APP_PORT="${APP_PORT:-3000}"

log()  { printf '\033[1;36m[podman]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[podman]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[podman]\033[0m %s\n' "$*" >&2; exit 1; }

command -v podman >/dev/null 2>&1 || fail "podman not found. Install it: sudo apt install podman"

# --- shared run arguments -------------------------------------------------

# Named volumes, so a `git clean` or a host-side npm never disturbs them and
# repeat builds stay warm.
common_args() {
  printf '%s\n' \
    --userns=keep-id \
    -e HOME=/home/node \
    -e "APP_PORT=$APP_PORT" \
    -v "$REPO_ROOT:/workspace" \
    -v mrwr-node-modules:/workspace/node_modules \
    -v mrwr-next-cache:/workspace/.next \
    -v mrwr-npm-cache:/home/node/.npm \
    -w /workspace
}

# The host's gh keeps its token in the system keyring, not in
# ~/.config/gh/hosts.yml — mounting that directory alone gets you a gh that
# knows your username and nothing else. So ask the host gh for the token and
# hand it over as GH_TOKEN. That is the only GitHub credential the container
# gets — the config directory is deliberately NOT mounted, because a copied
# hosts.yml adds a second, tokenless account entry that makes `gh auth
# status` exit 1 and refresh-issues.sh bail out even though gh works fine.
#
# Exported, not passed as an argument: `podman run --env GH_TOKEN` with no
# value inherits it from this shell, so the token never appears in the
# process list.
ensure_gh_token() {
  [[ -n "${GH_TOKEN:-}" ]] && return 0
  command -v gh >/dev/null 2>&1 || {
    warn "No gh on this host — the container can't be given a GitHub token, so the issue/projects refresh will fail."
    return 0
  }
  GH_TOKEN=$(gh auth token 2>/dev/null) || GH_TOKEN=""
  if [[ -n "$GH_TOKEN" ]]; then
    export GH_TOKEN
  else
    warn "Host gh isn't authenticated — run 'gh auth login'. The issue/projects refresh will fail without it."
  fi
}

# Credentials for anything that talks to prod or GitHub. Read-only here; the
# entrypoint copies them into the container's own HOME so nothing can write
# back out to the host.
cred_args() {
  local args=()
  if [[ -d "$HOME/.ssh" ]]; then
    args+=(-v "$HOME/.ssh:/run/host/ssh:ro")
  else
    warn "No ~/.ssh on this host — a deploy will not be able to reach prod."
  fi
  [[ -n "${GH_TOKEN:-}" ]] && args+=(--env GH_TOKEN)
  [[ ${#args[@]} -gt 0 ]] && printf '%s\n' "${args[@]}"
}

have_image() { podman image exists "$IMAGE"; }

ensure_image() {
  have_image || { log "Image $IMAGE not built yet — building it now."; cmd_image; }
}

dev_running() {
  [[ "$(podman inspect -f '{{.State.Running}}' "$DEV_CONTAINER" 2>/dev/null)" == "true" ]]
}

# --- subcommands ----------------------------------------------------------

cmd_image() {
  log "Building $IMAGE ..."
  podman build "$@" -t "$IMAGE" -f "$SCRIPT_DIR/Containerfile" "$SCRIPT_DIR"
  log "Built $IMAGE"
}

cmd_dev() {
  ensure_image
  if dev_running; then
    log "Dev container already up — http://localhost:$APP_PORT"
    return 0
  fi
  ensure_gh_token
  podman rm -f "$DEV_CONTAINER" >/dev/null 2>&1 || true
  log "Starting dev server on http://localhost:$APP_PORT ..."
  # shellcheck disable=SC2046
  podman run -d --name "$DEV_CONTAINER" \
    $(common_args) $(cred_args) \
    -p "$APP_PORT:$APP_PORT" \
    "$IMAGE" \
    bash -lc "npm install --no-audit --no-fund && exec npm run dev -- --hostname 0.0.0.0 --port $APP_PORT"
  log "Up. Follow it with: containers/ci.sh logs -f"
}

# -it only when there's actually a terminal — otherwise this can't be called
# from a script, a pipeline, or an agent that has no tty.
tty_args() { [[ -t 0 ]] && printf '%s\n' -i -t; }

cmd_exec() {
  [[ $# -gt 0 ]] || fail "exec needs a command, e.g. containers/ci.sh exec npm run lint"
  dev_running || { log "Dev container isn't running — starting it."; cmd_dev; }
  # shellcheck disable=SC2046
  podman exec $(tty_args) "$DEV_CONTAINER" "$@"
}

cmd_shell() {
  if dev_running; then
    # shellcheck disable=SC2046
    podman exec $(tty_args) "$DEV_CONTAINER" bash
  else
    cmd_run bash
  fi
}

cmd_run() {
  ensure_image
  ensure_gh_token
  [[ $# -gt 0 ]] || set -- bash
  # shellcheck disable=SC2046
  podman run --rm $(tty_args) $(common_args) $(cred_args) "$IMAGE" "$@"
}

# The same sequence deploy.sh runs, stopping before it touches prod: refresh
# the build-time data files, install, lint, build. Run it on a branch before
# you open a PR, or any time you want to know the tree still builds.
#
# The refreshes aren't optional garnish — src/data/issues.json is gitignored
# and imported by src/lib/versions.ts, so a fresh checkout cannot build
# without pulling it first.
cmd_ci() {
  log "refresh + install + lint + build"
  cmd_run bash -lc '
    set -uo pipefail

    scripts/content/refresh-issues.sh \
      || { echo "[ci] Issue refresh failed — src/data/issues.json is gitignored and required to build." >&2; exit 1; }
    scripts/content/refresh-search-history.sh \
      || echo "[ci] warning: search-history refresh failed; building with whatever is in the tree." >&2
    scripts/content/refresh-projects.sh \
      || echo "[ci] warning: project metadata refresh failed; falling back to projects.base.json." >&2

    set -e
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

    # Report-only. The tree already has thousands of eslint findings (mostly
    # react-hooks warnings in the bigger windows), so gating on a clean lint
    # would just mean nobody can ever run this. The build is the real gate.
    set +e
    mkdir -p .deploy
    npx --no-install eslint . > .deploy/lint.txt 2>&1
    lint_status=$?
    if [ "$lint_status" -eq 0 ]; then
      echo "[ci] lint: clean"
    else
      echo "[ci] lint (report-only): $(grep -E "[0-9]+ (problem|error|warning)" .deploy/lint.txt | tail -1 | sed "s/^[^0-9]*//")"
      echo "[ci] full output in .deploy/lint.txt"
    fi
    set -e

    npm run build
    echo "[ci] OK — static export in out/"
  '
}

cmd_deploy() {
  # deploy.sh itself refuses a dirty tree and warns about a non-main branch;
  # this just makes the machine-local config a clear error up front instead
  # of a confusing one halfway through a container run.
  [[ -f "$REPO_ROOT/scripts/deploy/deploy.config.sh" ]] \
    || fail "Missing scripts/deploy/deploy.config.sh — copy scripts/deploy/deploy.config.example.sh and fill it in (see scripts/deploy/README.md)."
  log "Deploying from the container (repo: $REPO_ROOT)"
  cmd_run bash scripts/deploy/deploy.sh "$@"
}

cmd_status()   { cmd_run bash scripts/deploy/status.sh "$@"; }
cmd_rollback() { cmd_run bash scripts/deploy/rollback.sh "$@"; }

cmd_logs() {
  dev_running || fail "Dev container isn't running. Start it: containers/ci.sh dev"
  podman logs "$@" "$DEV_CONTAINER"
}

cmd_stop() {
  podman rm -f "$DEV_CONTAINER" >/dev/null 2>&1 && log "Stopped $DEV_CONTAINER" || log "Nothing to stop."
}

cmd_clean() {
  cmd_stop
  for vol in mrwr-node-modules mrwr-next-cache mrwr-npm-cache; do
    podman volume rm "$vol" >/dev/null 2>&1 && log "Removed volume $vol" || true
  done
  log "Next run will reinstall from scratch."
}

usage() { sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  image)    shift; cmd_image "$@" ;;
  dev)      shift; cmd_dev "$@" ;;
  shell)    shift; cmd_shell "$@" ;;
  exec)     shift; cmd_exec "$@" ;;
  run)      shift; cmd_run "$@" ;;
  ci)       shift; cmd_ci "$@" ;;
  deploy)   shift; cmd_deploy "$@" ;;
  status)   shift; cmd_status "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  logs)     shift; cmd_logs "$@" ;;
  stop)     shift; cmd_stop "$@" ;;
  clean)    shift; cmd_clean "$@" ;;
  ""|-h|--help|help) usage ;;
  *) fail "Unknown command: $1 (try: containers/ci.sh --help)" ;;
esac
