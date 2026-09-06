#!/usr/bin/env python3
"""Group recorded search-bar entries into sessions and file the good ones as
GitHub issues, interactively.

Driven by scripts/content/search-to-issue.sh — see that file's header for the
full picture. This module does the grouping, the backlog filtering, the
terminal prompt loop, and the `gh issue create` / `gh issue comment` calls
(a session can open a new issue or be appended as a comment to an existing one).

A "session" is a maximal run of recorded entries that represents one thought:
same browser session id, no pause longer than --idle-gap, and no hard "typing
reset" (the query being cleared and restarted with something unrelated). The
longest entry in a session is its headline / suggested issue title.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# A session ends after this much silence even within one browser session.
DEFAULT_IDLE_GAP_S = 180
# A short, low-overlap entry this many seconds after the previous one is treated
# as a fresh thought rather than continued typing.
RESET_MIN_GAP_S = 4
# Sessions whose headline is this short or shorter are dropped as noise
# (stray single keystrokes, an "x" to clear the box, ...).
MIN_HEADLINE_LEN = 3


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--records", required=True, type=Path)
    p.add_argument("--issues", required=True, type=Path)
    p.add_argument("--state", required=True, type=Path)
    p.add_argument("--formatter", required=True, type=Path)
    p.add_argument("--repo", required=True)
    p.add_argument("--idle-gap", type=int, default=DEFAULT_IDLE_GAP_S)
    p.add_argument("--since", default="")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


# --- loading -----------------------------------------------------------------

class Record:
    __slots__ = ("query", "at", "at_ms", "session", "raw")

    def __init__(self, query: str, at: str, at_ms: float, session: str, raw: str):
        self.query = query
        self.at = at
        self.at_ms = at_ms
        self.session = session
        self.raw = raw


def _parse_iso_ms(value: str) -> float:
    if not value:
        return float("nan")
    try:
        v = value.replace("Z", "+00:00")
        return datetime.fromisoformat(v).timestamp() * 1000.0
    except ValueError:
        return float("nan")


def load_records(path: Path, since: str) -> list[Record]:
    since_ms = _parse_iso_ms(since + "T00:00:00+00:00") if since else float("-inf")
    out: list[Record] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line[0] != "{":
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        query = str(obj.get("query", "")).strip()
        if not query:
            continue
        at = str(obj.get("at") or obj.get("time") or "")
        at_ms = _parse_iso_ms(at)
        if at_ms == at_ms and since_ms > float("-inf") and at_ms < since_ms:
            continue
        out.append(Record(query, at, at_ms, str(obj.get("session") or ""), line))
    # Stable sort by timestamp; undated lines keep their archive order.
    out.sort(key=lambda r: (r.at_ms if r.at_ms == r.at_ms else float("inf")))
    return out


# --- grouping --------------------------------------------------------------

def common_prefix_len(a: str, b: str) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def is_typing_reset(prev: Record, cur: Record) -> bool:
    """cur looks like the query was wiped and a new, unrelated one started."""
    gap_s = 0.0
    if prev.at_ms == prev.at_ms and cur.at_ms == cur.at_ms:
        gap_s = (cur.at_ms - prev.at_ms) / 1000.0
    return (
        gap_s > RESET_MIN_GAP_S
        and common_prefix_len(prev.query, cur.query) <= 2
        and len(cur.query) < max(4, len(prev.query) * 0.5)
    )


class Session:
    def __init__(self, records: list[Record]):
        self.records = records

    @property
    def headline(self) -> str:
        return max(self.records, key=lambda r: len(r.query)).query.strip()

    @property
    def key(self) -> str:
        first = self.records[0]
        return f"{first.session or 'anon'}:{first.at or first.query[:24]}"

    @property
    def started(self) -> str:
        ms = self.records[0].at_ms
        if ms != ms:
            return self.records[0].at or "(undated)"
        return datetime.fromtimestamp(ms / 1000.0).strftime("%Y-%m-%d %H:%M")

    @property
    def span_s(self) -> float:
        a, b = self.records[0].at_ms, self.records[-1].at_ms
        if a != a or b != b:
            return 0.0
        return max(0.0, (b - a) / 1000.0)


def group(records: list[Record], idle_gap_s: int) -> list[Session]:
    sessions: list[Session] = []
    cur: list[Record] = []
    for rec in records:
        if cur:
            prev = cur[-1]
            gap_s = float("inf")
            if prev.at_ms == prev.at_ms and rec.at_ms == rec.at_ms:
                gap_s = (rec.at_ms - prev.at_ms) / 1000.0
            if rec.session != prev.session or gap_s > idle_gap_s or is_typing_reset(prev, rec):
                sessions.append(Session(cur))
                cur = []
        cur.append(rec)
    if cur:
        sessions.append(Session(cur))
    return [s for s in sessions if len(s.headline) > MIN_HEADLINE_LEN]


# --- backlog filtering -----------------------------------------------------

def normalize(text: str) -> str:
    return " ".join(text.lower().split())


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"handled": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("handled", [])
        return data
    except (json.JSONDecodeError, OSError):
        print(f"warning: could not read {path}, starting fresh", file=sys.stderr)
        return {"handled": []}


def save_state(path: Path, state: dict) -> None:
    state["handled"].sort(key=lambda h: h.get("at", ""))
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def already_filed(session: Session, issue_bodies: list[str]) -> bool:
    """True if this session's text is already sitting in some issue body —
    covers everything filed by hand before this tool existed."""
    needles = {normalize(session.headline), normalize(session.records[-1].query)}
    needles = {n for n in needles if len(n) > MIN_HEADLINE_LEN}
    return any(n in body for body in issue_bodies for n in needles)


# --- formatting & filing -------------------------------------------------

def format_block(session: Session, formatter: Path) -> str:
    proc = subprocess.run(
        ["bash", str(formatter)],
        input="\n".join(r.raw for r in session.records) + "\n",
        capture_output=True,
        text=True,
    )
    lines = proc.stdout.strip("\n")
    return "from search bar:\n" + lines if lines else ""


def title_from(headline: str) -> str:
    t = headline.strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "'\"`":
        t = t[1:-1].strip()
    return t[:120].rstrip()


def create_issue(repo: str, title: str, body: str) -> str | None:
    proc = subprocess.run(
        ["gh", "issue", "create", "--repo", repo, "--title", title, "--body", body],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.strip() or "gh issue create failed", file=sys.stderr)
        return None
    return proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "(created)"


def add_comment(repo: str, number: int, body: str) -> str | None:
    proc = subprocess.run(
        ["gh", "issue", "comment", str(number), "--repo", repo, "--body", body],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.strip() or "gh issue comment failed", file=sys.stderr)
        return None
    return proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "(commented)"


# --- main loop ----------------------------------------------------------

MENU = ("[c] create   [e] edit title + create   [a] append to an existing issue   "
        "[s] skip forever   [l] later   [q] quit")


def prompt(text: str) -> str:
    """input() that treats Ctrl-D / Ctrl-C as an explicit quit."""
    try:
        return input(text)
    except (EOFError, KeyboardInterrupt):
        print()
        return "q"


def choose_issue(issues: list[dict]) -> dict | None:
    """Pick an existing issue by number, or by searching its title. Blank
    input cancels."""
    by_number = {int(i["number"]): i for i in issues if i.get("number") is not None}
    while True:
        raw = prompt("  issue # or title search (blank cancels): ").strip()
        if not raw:
            return None
        if raw.lstrip("#").isdigit():
            issue = by_number.get(int(raw.lstrip("#")))
            if issue:
                return issue
            print(f"  no issue #{raw.lstrip('#')} in the snapshot")
            continue
        needle = raw.lower()
        matches = sorted(
            (i for i in issues if needle in (i.get("title") or "").lower()),
            key=lambda i: int(i["number"]), reverse=True,
        )
        if not matches:
            print("  no title matches — try again")
            continue
        for i in matches[:15]:
            print(f"    #{int(i['number']):<4} [{(i.get('state') or '?').lower():<6}] {i.get('title', '')}")
        if len(matches) > 15:
            print(f"    … and {len(matches) - 15} more — narrow the search")


def main() -> int:
    args = parse_args()

    records = load_records(args.records, args.since)
    if not records:
        print("No search records found.")
        return 0

    sessions = group(records, args.idle_gap)
    state = load_state(args.state)
    handled_keys = {h["key"] for h in state["handled"]}

    issues = json.loads(args.issues.read_text(encoding="utf-8"))
    issue_bodies = [normalize(i.get("body") or "") for i in issues]

    queue = [
        s for s in sessions
        if s.key not in handled_keys and not already_filed(s, issue_bodies)
    ]

    print(
        f"{len(records)} records -> {len(sessions)} sessions "
        f"-> {len(queue)} new to triage "
        f"({len(sessions) - len(queue)} already filed or dismissed)\n"
    )
    if not queue:
        return 0

    if not args.dry_run and not sys.stdin.isatty():
        print("Not a TTY — re-run in an interactive terminal to triage.", file=sys.stderr)
        return 1

    dirty = False
    try:
        for idx, session in enumerate(queue, 1):
            body = format_block(session, args.formatter)
            if not body:
                print(f"[{idx}/{len(queue)}] skipping — formatter produced nothing")
                continue
            suggested = title_from(session.headline)

            print("=" * 72)
            n = len(session.records)
            print(f"[{idx}/{len(queue)}] session {session.key.split(':', 1)[0][:8]} · "
                  f"{session.started} · {n} entr{'y' if n == 1 else 'ies'} · "
                  f"{session.span_s:.0f}s span")
            print()
            print("\n".join("  " + ln for ln in body.splitlines()))
            print()
            print(f"  suggested title: {suggested}")
            print()

            if args.dry_run:
                print("  (dry run — not filing)")
                continue

            print(MENU)
            choice = prompt("> ").strip().lower()

            if choice == "q":
                break
            if choice == "l" or choice == "":
                continue
            if choice == "s":
                state["handled"].append({
                    "key": session.key, "action": "skipped",
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                dirty = True
                print("  skipped — won't show again\n")
                continue
            if choice in ("c", "e"):
                title = suggested
                if choice == "e":
                    entered = prompt(f"  title [{suggested}]: ").strip()
                    if entered:
                        title = entered
                ref = create_issue(args.repo, title, body)
                if ref is None:
                    print("  not filed — left in the queue\n")
                    continue
                state["handled"].append({
                    "key": session.key, "action": "filed", "issue": ref,
                    "title": title, "at": datetime.now(timezone.utc).isoformat(),
                })
                dirty = True
                print(f"  filed: {ref}\n")
                continue
            if choice == "a":
                issue = choose_issue(issues)
                if issue is None:
                    print("  cancelled — left in the queue\n")
                    continue
                num = int(issue["number"])
                print(f"  comment on #{num} [{(issue.get('state') or '?').lower()}] "
                      f"{issue.get('title', '')}")
                if prompt("  confirm? [y/N] ").strip().lower() not in ("y", "yes"):
                    print("  cancelled — left in the queue\n")
                    continue
                ref = add_comment(args.repo, num, body)
                if ref is None:
                    print("  not posted — left in the queue\n")
                    continue
                state["handled"].append({
                    "key": session.key, "action": "commented", "issue": num,
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                dirty = True
                print(f"  commented: {ref}\n")
                continue
            print(f"  ? unrecognized '{choice}' — treating as 'later'\n")
    finally:
        if dirty and not args.dry_run:
            save_state(args.state, state)
            print(f"state written to {args.state}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
