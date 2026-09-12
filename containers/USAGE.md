# Using the containers, step by step

A manual for driving the Podman setup by hand. `README.md` next to this file
explains how it's built and why; this one is just "what do I type".

Everything below is run from the repo root, as your normal user. Nothing here
needs `sudo` — it's all rootless.

---

## 0. One time, on a new machine

**Install Podman** (already present on falcon):

```bash
sudo apt install podman
```

**Check your user has subuid/subgid ranges** — rootless Podman needs them.
This should print two lines:

```bash
grep "$USER" /etc/subuid /etc/subgid
```

If it prints nothing, run `sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"` and then `podman system migrate`.

**Make sure the host can reach prod and GitHub.** The container borrows both
from you, so they have to work outside it first:

```bash
ssh -o BatchMode=yes root@prod hostname     # should print the prod hostname
gh auth status                              # should say "Logged in to github.com"
```

**Copy the deploy config** if this machine has never deployed:

```bash
cp scripts/deploy/deploy.config.example.sh scripts/deploy/deploy.config.sh
```

Then edit it — `PROD_HOST`, `PROD_BASE`, etc. It's gitignored and
machine-local. See `scripts/deploy/README.md`.

**Build the image:**

```bash
containers/ci.sh image
```

Takes a couple of minutes the first time. You only need to repeat it when
`containers/Containerfile` changes (say, to bump Node or `gh`).

---

## 1. Day-to-day: working on the site

**Start the dev server:**

```bash
containers/ci.sh dev
```

Wait a few seconds, then open <http://localhost:3000>. It's serving your
actual working tree — edit a file in your editor as usual and the page
reloads. You do **not** need to restart the container after editing code.

**Watch its output** (Ctrl-C stops watching, not the server):

```bash
containers/ci.sh logs -f
```

**Run something inside it** — this is the one to reach for when you want a
real Node 22 or a current `gh`:

```bash
containers/ci.sh exec npm run lint
containers/ci.sh exec node --version
containers/ci.sh exec gh issue list --repo rattmouse/mrwr.dev --limit 5
```

**Get a shell in it:**

```bash
containers/ci.sh shell
```

You land in `/workspace`, which *is* the repo. Type `exit` to leave.

**Stop it when you're done:**

```bash
containers/ci.sh stop
```

It's just a container — stopping and starting costs seconds and loses
nothing.

---

## 2. Before you open a PR

```bash
containers/ci.sh ci
```

This runs the same sequence a deploy does, minus anything that touches prod:

1. refreshes `src/data/issues.json` from GitHub (**required** — it's
   gitignored and imported at build time, so the build fails without it)
2. refreshes the search history from prod's archive, and the project
   metadata from GitHub (both best-effort; a failure just warns)
3. `npm ci`
4. eslint — **report-only**, full output written to `.deploy/lint.txt`
5. `npm run build`

**What counts as a failure:** step 5. If the build passes, you're good. The
lint line will say something like `6102 problems (111 errors, 5991 warnings)`
— that's the tree's pre-existing state, not something you broke. Don't chase
it unless you're deliberately cleaning up.

Because `next build` runs TypeScript, a **type error will fail this** — which
is the point.

To read the lint output afterwards:

```bash
less .deploy/lint.txt
```

---

## 3. Deploying

Remember what a deploy is here: **`main`, fast-forwarded to `origin`** — not
whatever branch you're on.

```bash
git checkout main
git pull --ff-only
containers/ci.sh deploy
```

That runs `scripts/deploy/deploy.sh` inside the container. It will:

refresh the data files → `npm ci` → build → stage the bundle → rsync it to
prod as a brand-new timestamped release → `npm install --omit=dev` there →
install the systemd unit → flip the `current` symlink → restart → health-check.

**If the health check fails it rolls itself back automatically** and exits
non-zero. You don't have to do anything.

Useful flags (they pass straight through to `deploy.sh`):

```bash
containers/ci.sh deploy --allow-dirty      # deliberately ship uncommitted changes
containers/ci.sh deploy --skip-build       # re-ship the existing out/ as-is
containers/ci.sh deploy --skip-issues      # don't re-pull issues.json
```

`deploy.sh` refuses to run on a dirty tree unless you pass `--allow-dirty`,
and warns (but continues) if you're not on `main`.

**Check what's live:**

```bash
containers/ci.sh status
```

**Roll back:**

```bash
containers/ci.sh rollback                  # to the previous release
containers/ci.sh rollback 20260911153342   # to a specific one
```

Rollback is instant — it just repoints the `current` symlink at a release
already sitting on prod's disk.

---

## 4. When something looks wrong

**"podman not found"** — `sudo apt install podman`.

**The dev server won't come up / port 3000 is taken.** Something else is on
the port. Either stop it, or run on another one:

```bash
APP_PORT=3001 containers/ci.sh dev
```

**`gh` fails inside the container / the issue refresh bails out.** The
container gets its GitHub token from *your* host `gh` at run time. Fix it on
the host and re-run:

```bash
gh auth status || gh auth login
```

**ssh to prod fails inside the container.** Same idea — it borrows `~/.ssh`.
Confirm it works outside first:

```bash
ssh -o BatchMode=yes root@prod hostname
```

If that hangs or prompts, it's a host-key or key-auth problem on the host,
not a container problem.

**The build behaves strangely, or `node_modules` seems wrong.** Wipe the
cached volumes and let it reinstall:

```bash
containers/ci.sh clean
containers/ci.sh ci
```

**You changed the Containerfile and nothing happened.** Rebuild the image —
running containers keep using the old one:

```bash
containers/ci.sh image
containers/ci.sh stop && containers/ci.sh dev
```

**Force a fully fresh image:**

```bash
containers/ci.sh image --no-cache
```

**See what's actually running:**

```bash
podman ps
podman volume ls
podman images
```

---

## 5. Cheat sheet

| I want to… | Type |
| --- | --- |
| work on the site | `containers/ci.sh dev` → <http://localhost:3000> |
| see the dev server's output | `containers/ci.sh logs -f` |
| run a command with Node 22 | `containers/ci.sh exec <cmd>` |
| poke around inside | `containers/ci.sh shell` |
| check it still builds | `containers/ci.sh ci` |
| put it on the internet | `git checkout main && git pull --ff-only && containers/ci.sh deploy` |
| see what's live | `containers/ci.sh status` |
| undo a bad deploy | `containers/ci.sh rollback` |
| stop the dev server | `containers/ci.sh stop` |
| start completely fresh | `containers/ci.sh clean && containers/ci.sh image` |

Every one of these also exists as an npm script — `npm run container:dev`,
`container:ci`, `container:deploy`, `container:shell`, `container:stop`,
`container:image` — if that's easier to remember.
