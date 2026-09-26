"use client";

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "@fontsource/vt323";
import { PROJECTS } from "@/lib/projects";
import { getVersions } from "@/lib/versions";
import issuesRaw from "@/data/issues.json";
import type { ProgramWindowId, WindowId } from "@/components/windows/windowTypes";
import { LIGHTS_MESSAGE_TYPE } from "@/lib/cubicle";

/**
 * A toy filesystem, not a real one — no backend, no real process spawns.
 * Directories are keyed by path (always starting and ending without a
 * trailing slash, "" for root); files are leaf strings under a directory.
 * A file can carry a `program` id — "running" it opens that real window —
 * or a `special` action for the handful of files that do something odder.
 */
type FsNode =
  | { type: "dir"; children: Record<string, FsNode> }
  | { type: "file"; content: string; program?: ProgramWindowId; special?: "lights" | "denied" };

const HOME = "/home/guest";

function dir(children: Record<string, FsNode>): FsNode {
  return { type: "dir", children };
}
function file(content: string, program?: ProgramWindowId, special?: "lights" | "denied"): FsNode {
  return { type: "file", content, program, special };
}

/** The real programs this desktop has, as files sitting in the guest's home dir. */
const PROGRAMS: { file: string; id: ProgramWindowId; blurb: string }[] = [
  { file: "notepad.exe", id: "notepad", blurb: "a blank page, the way it used to be." },
  { file: "paint.exe", id: "paint", blurb: "a little painting program." },
  { file: "player.exe", id: "player", blurb: "plays whatever you give it." },
  { file: "strudel.cc", id: "music", blurb: "live-code some music." },
  { file: "midi.exe", id: "midi", blurb: "a MIDI keyboard, no piano required." },
  { file: "party.webp", id: "party", blurb: "a party that broke out of its picture frame." },
  { file: "marbles.exe", id: "marbles", blurb: "a physics toy: marbles on a course." },
  { file: "tasks.exe", id: "tasks", blurb: "survive the workday." },
  { file: "cubicles.exe", id: "cubicles", blurb: "a first-person office you can walk around." },
  { file: "issues.exe", id: "issues", blurb: "every issue this site has ever had." },
  { file: "changes.exe", id: "changes", blurb: "the version history." },
];

/**
 * Same trick cubicles.exe uses to know it's the browser standing on its own
 * desk: this site, inside an iframe of itself, only happens one way here.
 */
const nestedStore = {
  subscribe: () => () => {},
  get: () => window.self !== window.top,
  onServer: () => false,
};

type IssueItem = {
  number?: number;
  state?: string;
  title?: string;
  closedByPr?: { number?: number };
};

/** Turns a name into a safe single filesystem path segment. */
function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function buildProjectsDir(): FsNode {
  const children: Record<string, FsNode> = {};
  for (const p of PROJECTS) {
    const lines = [
      `${p.name} (${p.kind})`,
      `built with: ${p.built}`,
      "",
      p.blurb,
    ];
    const link = p.href ?? p.repo;
    if (link) lines.push("", link);
    children[`${p.slug}.txt`] = file(lines.join("\n"));
  }
  return dir(children);
}

function buildChangelogDir(): FsNode {
  const versions = getVersions();
  const children: Record<string, FsNode> = {};
  for (const v of versions) {
    const lines = [
      `${v.name} — v${v.version} (${v.date})`,
      v.summary,
      "",
      ...v.changes.map((c) => `- ${c}`),
    ];
    children[`${v.version}.txt`] = file(lines.join("\n"));
  }
  if (versions[0]) {
    children["latest.txt"] = children[`${versions[0].version}.txt`];
  }
  return dir(children);
}

function buildIssuesDir(): FsNode {
  const issues = (issuesRaw as IssueItem[]).filter((i) => i.state === "CLOSED" && typeof i.number === "number");
  const children: Record<string, FsNode> = {};
  for (const issue of issues) {
    const title = issue.title?.trim() || `issue #${issue.number}`;
    const closedByPr = issue.closedByPr?.number;
    const lines = [`#${issue.number} ${title}`, closedByPr ? `closed by PR #${closedByPr}` : "closed"];
    children[`${issue.number}-${slugifyName(title)}.txt`] = file(lines.join("\n"));
  }
  return dir(children);
}

function buildHomeDir(): FsNode {
  const children: Record<string, FsNode> = {
    "about.txt": file(
      [
        "mrwr.dev is a collection of apps that live in a browser tab.",
        "This window is a toy shell: no real process runs behind it.",
        "",
        "The other programs on this desktop are right here — ls, then type one to run it.",
      ].join("\n")
    ),
    ".bash_history": file(
      ["ls", "cat about.txt", "notepad.exe", "cd /changelog", "cat latest.txt", "whoami", "sudo rm -rf /"].join("\n")
    ),
  };
  for (const p of PROGRAMS) {
    children[p.file] = file(`${p.file} — ${p.blurb}\ntype "${p.file}" to run it`, p.id);
  }
  return dir(children);
}

function buildFs(nested: boolean): FsNode {
  return dir({
    home: dir({
      guest: buildHomeDir(),
    }),
    projects: buildProjectsDir(),
    changelog: buildChangelogDir(),
    issues: buildIssuesDir(),
    ...(nested
      ? {
          hacks: dir({
            "lights.exe": file(
              "lights.exe — flip the switch.\ntype \"lights.exe\" to run it",
              undefined,
              "lights"
            ),
            "unlock.exe": file(
              "unlock.exe — try it and see.\ntype \"unlock.exe\" to run it",
              undefined,
              "denied"
            ),
          }),
        }
      : {}),
  });
}

function resolvePath(cwd: string, input: string): string {
  const base = input.startsWith("/") ? "/" : cwd;
  const parts = (input.startsWith("/") ? input : `${cwd}/${input}`).split("/").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  void base;
  return `/${out.join("/")}`;
}

function lookup(fs: FsNode, path: string): FsNode | null {
  if (path === "/" || path === "") return fs;
  const parts = path.split("/").filter(Boolean);
  let node: FsNode = fs;
  for (const part of parts) {
    if (node.type !== "dir" || !node.children[part]) return null;
    node = node.children[part];
  }
  return node;
}

function buildMotd(): string[] {
  return [new Date().toISOString(), 'type "help" for usage', ""];
}

/** How wide the terminal reads, in characters, for wrapping `ls` into columns. */
const LS_TERM_WIDTH = 46;

/** `ls -F` style: "/" for a directory, "*" for a runnable program, nothing otherwise. */
function classify(name: string, node: FsNode): string {
  if (node.type === "dir") return `${name}/`;
  if (node.program || node.special) return `${name}*`;
  return name;
}

/** Lays sorted, classified names out column-major, the way a real `ls` wraps a terminal. */
function formatLsColumns(labels: string[]): string {
  if (!labels.length) return "";
  const colWidth = Math.max(...labels.map((l) => l.length)) + 2;
  const cols = Math.max(1, Math.floor(LS_TERM_WIDTH / colWidth));
  const rows = Math.ceil(labels.length / cols);
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let line = "";
    for (let c = 0; c < cols; c += 1) {
      const idx = c * rows + r;
      if (idx >= labels.length) continue;
      line += labels[idx].padEnd(colWidth);
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}

const MAN_PAGES: Record<string, string> = {
  ls: "ls [path] - list a directory in columns",
  cd: "cd [path] - change directory",
  cat: "cat <file> - print a file",
  sudo: "sudo <command> - pretend to be root. you are not root.",
  vim: "vim [file] - open the one true editor. good luck leaving.",
};

type Line = { text: string; kind?: "input" | "output" | "error" };

function useHistory() {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);
  return {
    push(cmd: string) {
      if (cmd.trim()) historyRef.current.push(cmd);
      indexRef.current = historyRef.current.length;
    },
    prev(): string | null {
      if (historyRef.current.length === 0) return null;
      indexRef.current = Math.max(0, indexRef.current - 1);
      return historyRef.current[indexRef.current] ?? null;
    },
    next(): string | null {
      if (historyRef.current.length === 0) return null;
      indexRef.current = Math.min(historyRef.current.length, indexRef.current + 1);
      return historyRef.current[indexRef.current] ?? "";
    },
    all(): string[] {
      return historyRef.current;
    },
  };
}

type BashWindowProps = {
  onOpenWindow?: (id: WindowId) => void;
  onClose?: () => void;
};

export default function BashWindow({ onOpenWindow, onClose }: BashWindowProps) {
  const nested = useSyncExternalStore(nestedStore.subscribe, nestedStore.get, nestedStore.onServer);
  const FS = useMemo(() => buildFs(nested), [nested]);
  const lookupFs = (path: string) => lookup(FS, path);
  const [lines, setLines] = useState<Line[]>(() => buildMotd().map((text) => ({ text, kind: "output" })));
  const [cwd, setCwd] = useState(HOME);
  const [draft, setDraft] = useState("");
  const [rmAnimating, setRmAnimating] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const history = useHistory();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const print = (text: string, kind: Line["kind"] = "output") => {
    setLines((prev) => [...prev, ...text.split("\n").map((t) => ({ text: t, kind }))]);
  };

  const prompt = () => `guest@mrwr.dev:${cwd === HOME ? "~" : cwd}$`;

  /** Runs a program (or special) file if `typed` resolves to one from `cwd` — extension optional. */
  function tryLaunchProgram(typed: string): boolean {
    for (const candidate of [typed, `${typed}.exe`]) {
      const node = lookupFs(resolvePath(cwd, candidate));
      if (!node || node.type !== "file") continue;
      if (node.special === "lights") {
        print("Lights flickered.");
        window.parent?.postMessage({ type: LIGHTS_MESSAGE_TYPE }, window.location.origin);
        return true;
      }
      if (node.special === "denied") {
        print("Permission denied.", "error");
        return true;
      }
      if (node.program) {
        print(`Starting ${candidate}...`);
        onOpenWindow?.(node.program);
        return true;
      }
    }
    return false;
  }

  function run(raw: string) {
    const trimmed = raw.trim();
    print(`${prompt()} ${raw}`, "input");
    if (!trimmed) return;
    history.push(trimmed);

    const [cmd, ...rest] = trimmed.split(/\s+/);
    const args = rest;

    switch (cmd) {
      case "help": {
        print(
          [
            "ls [path]        list a directory",
            "cd [path]        change directory",
            "pwd              print working directory",
            "cat <file>       print a file",
            "clear            clear the screen",
            "echo <text>      print text",
            "whoami           who you are",
            "history          past commands",
            "man <cmd>        a one-line manual",
            "info             system info",
            "exit             close this window",
          ].join("\n")
        );
        return;
      }
      case "clear": {
        setLines([]);
        return;
      }
      case "pwd": {
        print(cwd);
        return;
      }
      case "echo": {
        print(args.join(" "));
        return;
      }
      case "whoami": {
        print("guest");
        return;
      }
      case "date": {
        print(new Date().toString());
        return;
      }
      case "history": {
        print(history.all().map((h, i) => `  ${i + 1}  ${h}`).join("\n") || "(empty)");
        return;
      }
      case "man": {
        const target = args[0];
        if (!target) {
          print("What manual page do you want?", "error");
          return;
        }
        print(MAN_PAGES[target] ?? `No manual entry for ${target}`);
        return;
      }
      case "uname":
      case "info": {
        print(
          [
            "guest@mrwr.dev",
            "--------------",
            "OS: mrwr.dev",
            "Host: your browser tab",
            "Shell: fake",
            "Terminal: react95",
          ].join("\n")
        );
        return;
      }
      case "ls": {
        const pathArg = args.find((a) => !a.startsWith("-"));
        const target = pathArg ? resolvePath(cwd, pathArg) : cwd;
        const node = lookupFs(target);
        if (!node) {
          print(`ls: cannot access '${pathArg}': No such file or directory`, "error");
          return;
        }
        if (node.type === "file") {
          print(classify(target.split("/").pop() ?? target, node));
          return;
        }
        const names = Object.keys(node.children).sort();
        print(formatLsColumns(names.map((name) => classify(name, node.children[name]))));
        return;
      }
      case "cd": {
        const target = args[0] ? resolvePath(cwd, args[0]) : HOME;
        const node = lookupFs(target);
        if (!node || node.type !== "dir") {
          print(`bash: cd: ${args[0] ?? target}: No such file or directory`, "error");
          return;
        }
        setCwd(target);
        return;
      }
      case "cat":
      case "less":
      case "more": {
        if (!args[0]) {
          print(`${cmd}: missing file operand`, "error");
          return;
        }
        const target = resolvePath(cwd, args[0]);
        const node = lookupFs(target);
        if (!node) {
          print(`${cmd}: ${args[0]}: No such file or directory`, "error");
          return;
        }
        if (node.type === "dir") {
          print(`${cmd}: ${args[0]}: Is a directory`, "error");
          return;
        }
        print(node.content);
        return;
      }
      case "sudo": {
        print("guest is not in the sudoers file. This incident will be reported.", "error");
        return;
      }
      case "rm": {
        if (args.includes("-rf") && (args.includes("/") || args.includes("--no-preserve-root"))) {
          setRmAnimating(true);
          print("deleting /...");
          window.setTimeout(() => {
            print("rm: permission denied -- nice try");
            setRmAnimating(false);
          }, 900);
          return;
        }
        print(`rm: ${args[0] ?? ""}: No such file or directory`, "error");
        return;
      }
      case "vim":
      case "nvim":
      case "emacs":
      case "nano": {
        print(`${cmd}: please exit previous vim session`, "error");
        return;
      }
      case "ssh":
      case "curl":
      case "wget":
      case "ping": {
        print(`${cmd}: network is not available in this sandbox`, "error");
        return;
      }
      case "exit":
      case "logout": {
        onClose?.();
        return;
      }
      default: {
        if (tryLaunchProgram(cmd)) return;
        print(`bash: ${cmd}: command not found`, "error");
        return;
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      run(draft);
      setDraft("");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = history.prev();
      if (prev !== null) setDraft(prev);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = history.next();
      if (next !== null) setDraft(next);
      return;
    }
    if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setLines([]);
    }
  };

  const CRT_FONT = '"VT323", "Courier New", monospace';
  const CRT_GREEN = "#3fff5f";
  const CRT_GREEN_DIM = "#2ecc47";
  const CRT_AMBER_ERROR = "#ff8a3f";

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: "#020a02",
        color: CRT_GREEN,
        fontFamily: CRT_FONT,
        fontSize: 28,
        lineHeight: 1.15,
        letterSpacing: "1px",
        WebkitTextStroke: "0.6px currentColor",
        padding: 8,
        overflow: "hidden",
        cursor: "default",
        userSelect: "none",
        WebkitFontSmoothing: "none",
        filter: rmAnimating ? "hue-rotate(-20deg)" : undefined,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(rgba(0,0,0,0) 0px, rgba(0,0,0,0) 1px, rgba(0,0,0,0.55) 2px, rgba(0,0,0,0.55) 3px)",
          mixBlendMode: "multiply",
          zIndex: 2,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          boxShadow: "inset 0 0 60px rgba(0,0,0,0.65)",
          zIndex: 2,
        }}
      />
      <div ref={scrollRef} style={{ flex: "1 1 auto", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.kind === "error" ? CRT_AMBER_ERROR : line.kind === "input" ? CRT_GREEN : CRT_GREEN_DIM,
              textShadow: `0 0 2px ${line.kind === "error" ? CRT_AMBER_ERROR : CRT_GREEN}`,
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 4 }}>
        <span style={{ color: CRT_GREEN, whiteSpace: "nowrap", textShadow: `0 0 2px ${CRT_GREEN}` }}>{prompt()}</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoFocus
          style={{
            flex: "1 1 auto",
            background: "transparent",
            border: "none",
            outline: "none",
            color: CRT_GREEN,
            fontFamily: CRT_FONT,
            fontSize: 28,
            letterSpacing: "1px",
            WebkitTextStroke: "0.6px currentColor",
            textShadow: `0 0 2px ${CRT_GREEN}`,
            cursor: "default",
          }}
        />
      </div>
    </div>
  );
}
