# Containers

The build and deploy toolchain for mrwr.dev, in Podman. One image
(`containers/Containerfile`), one front-end script (`containers/ci.sh`), two
roles: a **dev container** you work in, and the same container used as a
**deploy runner** that ships to prod.

Everything is rootless — no daemon, no `sudo`, no root-owned files left in
your tree.

## Why

The host toolchain isn't good enough to build this app any more, and pinning
it to the machine was the problem:

- Falcon's system Node is 18; Next 16 needs ≥ 20.9.
- Falcon's apt `gh` is 2.45, which rejects the `stateReason` field
  `scripts/content/refresh-issues.sh` asks GitHub for, and the
  `closingIssuesReferences` field `link-prs.mjs` uses for the changelog's
  issue ↔ PR links.

The image pins Node 22 and a current `gh`, so any machine with Podman can
build and deploy this identically, regardless of what it has installed.

## Quick start

```
containers/ci.sh image      # build the image (once, and after Containerfile edits)
containers/ci.sh dev        # dev server on http://localhost:3000
containers/ci.sh ci         # refresh + install + lint + build — run before a PR
containers/ci.sh deploy     # ship main to prod
```

Or through npm: `npm run container:dev`, `npm run container:ci`,
`npm run container:deploy`.

## Commands

| Command | What it does |
| --- | --- |
| `image` | Build/rebuild the image. Takes `--no-cache` and friends. |
| `dev` | Start the dev server detached, port 3000, with live reload against your working tree. |
| `logs [-f]` | Dev server output. |
| `shell` | Interactive shell — inside the running dev container if there is one, otherwise a throwaway. |
| `exec <cmd>` | Run a command in the dev container. Works without a tty, so scripts and agents can use it. |
| `run <cmd>` | Run a command in a throwaway container. |
| `ci` | Refresh the build-time data, install, lint, build. The pre-PR check. |
| `deploy [args]` | `scripts/deploy/deploy.sh` inside the container. All its flags pass through. |
| `status` / `rollback [id]` | The matching deploy scripts. |
| `stop` | Stop and remove the dev container. |
| `clean` | `stop`, plus drop the cached volumes. |

## How it's wired

**The repo is bind-mounted** at `/workspace`, so edits on the host are live
in the container and build output (`out/`, the refreshed `src/data/*.json`)
lands back in your tree. `--userns=keep-id` maps your host uid to the
container's `node` user, so those files come out owned by you.

**Three named volumes** keep container state out of your working tree:

- `mrwr-node-modules` → `/workspace/node_modules`
- `mrwr-next-cache` → `/workspace/.next`
- `mrwr-npm-cache` → `/home/node/.npm`

That matters because the host may have its own `node_modules` installed by a
different Node; the two never see each other. `containers/ci.sh clean` drops
all three.

**Credentials are handed in narrowly, and never written back:**

- `~/.ssh` is mounted read-only at `/run/host/ssh`; the entrypoint copies it
  into the container's own `$HOME` (ssh wants to write `known_hosts`, and a
  copy means the container can't touch your real keys).
- GitHub auth comes in as a `GH_TOKEN` env var, read from the host's `gh`
  (`gh auth token`) at run time. `~/.config/gh` is deliberately **not**
  mounted: your token lives in the system keyring rather than in
  `hosts.yml`, and copying that file in just adds a tokenless account entry
  that makes `gh auth status` fail. The token is exported and inherited via
  `--env GH_TOKEN`, so it never appears in the process list.

## `ci` is not a gate on lint

`ci` runs eslint **report-only** and writes the full output to
`.deploy/lint.txt` (gitignored). The tree currently has ~6,100 findings
(111 errors, mostly `react-hooks` complaints in the larger windows), so
gating on a clean lint would mean nobody could ever run it. The build is the
real gate — and since `next build` runs TypeScript, a type error does fail
`ci`.

The refreshes at the start of `ci` aren't optional garnish:
`src/data/issues.json` is gitignored and imported by `src/lib/versions.ts`,
so a fresh checkout genuinely cannot build until it's pulled.

## Deploying from a container

`deploy` runs the existing `scripts/deploy/deploy.sh` unchanged — same
release directories, same health check, same automatic rollback. The
container only supplies the toolchain and the credentials. It still needs
the machine-local `scripts/deploy/deploy.config.sh` (gitignored; see
`scripts/deploy/README.md`), and it still refuses to run on a dirty tree.

Remember what "deploy" means here: `main`, fast-forwarded to `origin` — not
whatever feature branch you're sitting on.
