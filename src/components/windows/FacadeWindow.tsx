"use client";

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Checkbox,
  Frame,
  GroupBox,
  Hourglass,
  NumberInput,
  ProgressBar,
  Radio,
  Select,
  Slider,
  Tab,
  TabBody,
  Table,
  TableBody,
  TableDataCell,
  TableHead,
  TableHeadCell,
  TableRow,
  Tabs,
  TextInput,
  TreeView,
} from "react95";
import type { TreeLeaf } from "react95";
import CommandIcon from "@/components/windows/FacadeIcons";
import { Command, FileFacts, LayoutNode, PaneSpec, PanelSpec, Rng, ToolSpec, UiSpec, formatSize, rng } from "@/lib/facade";

const MONO: React.CSSProperties = { fontFamily: "monospace", fontSize: 11, lineHeight: 1.35 };
const NAVY = "#000080";
const TEAL = "#008080";
/** Where something else in the window is pointing: a match, a filter hit, a scan going past. */
const MARK = "#ffff80";
const SCAN = "#d8d8f0";
const CELL: React.CSSProperties = { padding: "1px 6px", whiteSpace: "nowrap", fontSize: 11, height: 16, lineHeight: "16px" };

/** The orders the table can be put in. Every mode switch in the window picks one of these. */
const ORDERS = ["offset", "entropy", "name"];

const hex = (n: number, width = 6) => `0x${n.toString(16).padStart(width, "0")}`;

/*
 * The bus. Every pane reads the same few things — which region of the file is
 * selected, which byte values are picked out, the threshold, the order, the
 * search — and every pane can change at least one of them, so touching any
 * one of them moves the rest. Jobs (from menus, toolbar, clicks, or the idle
 * loop) run a progress sweep across the window and leave a line in the log.
 */

type LogEntry = { id: number; at: number; text: string; region?: number; warn?: boolean };

type Bus = {
  facts: FileFacts;
  regions: number;
  cursor: number;
  setCursor: (region: number, from: string) => void;
  /** The byte offset under the mouse, if anything is under it. */
  pointer: number | null;
  setPointer: (offset: number | null) => void;
  /** A histogram bucket (eight byte values) picked out, or none. */
  bucket: number | null;
  setBucket: (bucket: number | null, from: string) => void;
  /** 0–100: regions with less entropy than this are dimmed. */
  threshold: number;
  setThreshold: (value: number) => void;
  order: number;
  setOrder: (order: number, from: string) => void;
  query: string;
  setQuery: (query: string) => void;
  /** While on, the idle loop walks the cursor along the file. */
  follow: boolean;
  setFollow: (on: boolean) => void;
  /** Counts finished jobs; the meters settle on new readings each time. */
  epoch: number;
  /** Regions bookmarked, by hand or by a command. */
  marks: Set<number>;
  /** Bumped to send every tabbed pane on to its next tab. */
  tabTurn: number;
  /** What this program calls a region. */
  unit: string;
  log: LogEntry[];
  say: (text: string, region?: number, warn?: boolean) => void;
  run: (label: string) => void;
  /** Carries out a menu item's or toolbar button's command. */
  act: (label: string, command: Command) => void;
};

type JobState = { label: string; progress: number } | null;

const BusContext = createContext<Bus | null>(null);
/** Kept apart from the bus because it changes many times a second while a job runs. */
const JobContext = createContext<{ job: JobState; scan: number | null }>({ job: null, scan: null });

function useBus() {
  const bus = useContext(BusContext);
  if (!bus) throw new Error("facade pane outside its window");
  return bus;
}

const JOB_RESULTS = ["done", "0 warnings", "OK", "complete", "no changes", "updated", "verified"];
const AMBIENT_JOBS = ["Indexing", "Autosave", "Verifying checksums", "Refreshing cache", "Compacting", "Prefetching", "Rebuilding index"];
const AMBIENT_LINES = [
  (r: Rng) => `GC: freed ${(r.next() * 4).toFixed(1)} MB`,
  (r: Rng) => `Worker ${r.int(1, 8)} idle`,
  (r: Rng) => `Cache hit ${r.int(80, 99)}%`,
  (r: Rng) => `Heartbeat ${r.int(10, 99)} ms`,
  () => "Watcher: no changes on disk",
  (r: Rng) => `Pool: ${r.int(2, 16)} threads, ${r.int(0, 3)} busy`,
];

function stamp(ms: number) {
  const s = Math.floor(ms / 1000);
  return `[${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}]`;
}

/** What a newly opened file gets in its log, one line at a time. */
function introLines(facts: FileFacts, r: Rng, unit: string): Omit<LogEntry, "id" | "at">[] {
  const lines: Omit<LogEntry, "id" | "at">[] = [
    { text: `Opened ${facts.name} (${formatSize(facts.size)})` },
    { text: `Detected ${facts.kind}` },
    { text: `Mapped ${facts.profile.length} ${unit.toLowerCase()}s` },
    { text: `Entropy ${facts.entropy.toFixed(2)} bits/byte` },
  ];
  if (facts.lines) lines.push({ text: `Indexed ${facts.lines.toLocaleString()} lines` });
  lines.push({ text: `Extracted ${facts.strings.length} strings` });
  const n = facts.profile.length;
  for (let i = 0; i < r.int(2, 5); i++) {
    const region = r.int(0, n - 1);
    const word = facts.words.length ? r.pick(facts.words) : "block";
    const warn = r.chance(0.2);
    lines.push({
      text: warn
        ? `Warning: ${r.int(1, 12)} unaligned ${r.pick(["blocks", "fields", "records"])} at ${hex(region * facts.span)}`
        : r.pick([`Resolved '${word}' at ${hex(region * facts.span)}`, `Linked '${word}' → ${unit.toLowerCase()} ${region}`, `Checksum ${facts.hash.slice(i * 8, i * 8 + 8)} OK`]),
      region,
      warn,
    });
  }
  lines.push({ text: "Ready" });
  return lines;
}

function BusProvider({
  facts,
  spec,
  running,
  onStatus,
  runRef,
  children,
}: {
  facts: FileFacts;
  spec: UiSpec;
  running: boolean;
  onStatus: (text: string) => void;
  runRef: React.MutableRefObject<((label: string, command: Command) => void) | null>;
  children: React.ReactNode;
}) {
  const regions = Math.max(1, facts.profile.length);
  const r = useRef(rng(facts.hash.slice(32)));
  const opened = useRef(0);
  const touched = useRef(0);
  const nextId = useRef(0);

  const [cursor, setCursorState] = useState(0);
  const [pointer, setPointer] = useState<number | null>(null);
  const [bucket, setBucketState] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(() => rng(facts.hash).int(15, 60));
  const [order, setOrderState] = useState(0);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [job, setJob] = useState<JobState>(null);
  const [scan, setScan] = useState<number | null>(null);
  const [marks, setMarks] = useState<Set<number>>(() => new Set());
  const [tabTurn, setTabTurn] = useState(0);
  const unit = spec.unit;
  /** Where the cursor has been, for Back. */
  const history = useRef<number[]>([]);

  const say = useCallback((text: string, region?: number, warn?: boolean) => {
    const at = performance.now() - opened.current;
    setLog((prev) => [...prev.slice(-299), { id: nextId.current++, at, text, region, warn }]);
  }, []);

  const setCursor = useCallback(
    (region: number, from: string) => {
      const next = ((Math.round(region) % regions) + regions) % regions;
      if (from !== "idle") touched.current = performance.now();
      setCursorState((prev) => {
        if (prev !== next && from !== "idle" && from !== "back") history.current = [...history.current.slice(-49), prev];
        return next;
      });
      if (from !== "idle") onStatus(`${unit} ${next} of ${regions} — ${hex(next * facts.span)}`);
    },
    [regions, facts.span, onStatus, unit],
  );

  const setBucket = useCallback(
    (b: number | null, from: string) => {
      touched.current = performance.now();
      setBucketState(b);
      if (b !== null) {
        onStatus(`Bytes ${hex(b * 8, 2)}–${hex(b * 8 + 7, 2)} highlighted`);
        if (from !== "histogram") say(`Filter: bytes ${hex(b * 8, 2)}–${hex(b * 8 + 7, 2)} (from ${from})`);
      }
    },
    [onStatus, say],
  );

  const setOrder = useCallback(
    (o: number, from: string) => {
      touched.current = performance.now();
      setOrderState(o % ORDERS.length);
      say(`Order: by ${ORDERS[o % ORDERS.length]} (${from})`);
    },
    [say],
  );

  // One job at a time; a new one cuts in on the last.
  const raf = useRef(0);
  const run = useCallback(
    (label: string, after?: (rr: Rng) => void) => {
      cancelAnimationFrame(raf.current);
      const rr = r.current;
      const duration = 700 + rr.next() * 2300;
      const start = performance.now();
      const clean = label.replace("…", "");
      onStatus(`${clean}…`);
      say(`${clean}…`);
      let lastStep = -1;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        // Re-render a few dozen times a job, not every frame.
        const step = Math.floor(p * 40);
        if (step !== lastStep) {
          lastStep = step;
          setJob({ label: clean, progress: p });
          setScan(Math.min(regions - 1, Math.floor(p * regions)));
        }
        if (p < 1) {
          raf.current = requestAnimationFrame(tick);
          return;
        }
        setJob(null);
        setScan(null);
        setEpoch((e) => e + 1);
        if (after) {
          after(rr);
          return;
        }
        const warn = rr.chance(0.12);
        const region = rr.int(0, regions - 1);
        const result = warn ? `${rr.int(1, 9)} warnings at ${hex(region * facts.span)}` : rr.pick(JOB_RESULTS);
        onStatus(`${clean} — ${result}`);
        say(`${clean}: ${result}`, warn ? region : undefined, warn);
      };
      raf.current = requestAnimationFrame(tick);
    },
    [onStatus, say, regions, facts.span],
  );
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const userRun = useCallback(
    (label: string) => {
      touched.current = performance.now();
      run(label);
    },
    [run],
  );
  // Each command does its own thing to the window; no two controls share one.
  const act = useCallback(
    (label: string, c: Command) => {
      touched.current = performance.now();
      const clean = label.replace("…", "");
      const go = (region: number) => setCursor(region, clean);
      const profile = facts.profile;
      const lower = unit.toLowerCase();
      switch (c.do) {
        case "step":
          go(cursor + c.by);
          break;
        case "seek": {
          let at = 0;
          if (c.to === "end") at = regions - 1;
          if (c.to === "middle") at = Math.floor(regions / 2);
          if (c.to === "densest" || c.to === "sparsest") {
            for (let i = 1; i < profile.length; i++) {
              if (c.to === "densest" ? profile[i] > profile[at] : profile[i] < profile[at]) at = i;
            }
          }
          go(at);
          say(`${clean}: ${lower} ${at} (${(profile[at] ?? 0).toFixed(2)} bits)`, at);
          break;
        }
        case "back": {
          const prev = history.current.pop();
          if (prev === undefined) onStatus("No earlier location");
          else setCursor(prev, "back");
          break;
        }
        case "order":
          setOrder(c.order, clean);
          onStatus(`Sorted by ${ORDERS[c.order]}`);
          break;
        case "threshold": {
          const next = Math.max(0, Math.min(100, c.to ?? threshold + (c.by ?? 0)));
          setThreshold(next);
          const dimmed = profile.filter((h) => (h / 8) * 100 < next).length;
          onStatus(`Threshold ${next}% — ${dimmed} of ${regions} ${lower}s dimmed`);
          say(`Threshold set to ${next}%`);
          break;
        }
        case "tabs":
          setTabTurn((t) => t + 1);
          onStatus("Switched views");
          break;
        case "follow":
          setFollow(!follow);
          onStatus(follow ? "Follow off" : "Following cursor");
          say(follow ? "Follow: off" : "Follow: on");
          break;
        case "pick":
          setBucket(facts.regionBucket[cursor] ?? 0, clean.toLowerCase());
          break;
        case "findNext": {
          const want = bucket ?? facts.regionBucket[cursor] ?? 0;
          if (bucket === null) setBucket(want, clean.toLowerCase());
          for (let k = 1; k <= regions; k++) {
            const region = (cursor + k) % regions;
            if (facts.regionBucket[region] === want) {
              go(region);
              break;
            }
          }
          break;
        }
        case "clear":
          setBucketState(null);
          setQuery("");
          onStatus("Filters cleared");
          say("Filters cleared");
          break;
        case "mark": {
          const next = new Set(marks);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          setMarks(next);
          onStatus(`${next.has(cursor) ? "Bookmarked" : "Unmarked"} ${lower} ${cursor} — ${next.size} total`);
          say(`${next.has(cursor) ? "Bookmark" : "Removed bookmark"} at ${hex(cursor * facts.span)}`, cursor);
          break;
        }
        case "nextMark": {
          const sorted = [...marks].sort((a, b) => a - b);
          if (!sorted.length) onStatus("No bookmarks");
          else go(sorted.find((m) => m > cursor) ?? sorted[0]);
          break;
        }
        case "markSimilar": {
          const here = profile[cursor] ?? 0;
          const next = new Set(marks);
          profile.forEach((h, i) => {
            if (Math.abs(h - here) < 0.15) next.add(i);
          });
          setMarks(next);
          onStatus(`${next.size - marks.size} similar ${lower}s marked`);
          say(`${clean}: ${next.size - marks.size} within 0.15 bits of ${lower} ${cursor}`, cursor);
          break;
        }
        case "unmark":
          setMarks(new Set());
          onStatus(`${marks.size} bookmarks cleared`);
          say("Bookmarks cleared");
          break;
        case "report": {
          const from = cursor * facts.span;
          const bytes = facts.sample.subarray(from, from + facts.span);
          let printable = 0;
          let zeros = 0;
          for (const b of bytes) {
            if (b >= 0x20 && b < 0x7f) printable++;
            if (b === 0) zeros++;
          }
          const dominant = (facts.regionBucket[cursor] ?? 0) * 8;
          say(`--- ${unit} ${cursor} ---`, cursor);
          say(`  ${hex(from)}–${hex(from + Math.max(0, bytes.length - 1))}, ${bytes.length} bytes`);
          say(`  ${(profile[cursor] ?? 0).toFixed(3)} bits, ${Math.round((printable / Math.max(1, bytes.length)) * 100)}% printable, ${zeros} zeros`);
          say(`  mostly bytes ${hex(dominant, 2)}–${hex(dominant + 7, 2)}`);
          onStatus(`${unit} ${cursor} summarized in the log`);
          break;
        }
        case "rescan":
          run(clean, (rr) => {
            setEpoch((e) => e + 1);
            const changed = rr.int(0, 3);
            onStatus(`${clean} — ${regions} ${lower}s, ${changed} changed`);
            say(`${clean}: ${regions} ${lower}s, ${changed} changed`);
          });
          break;
        case "verify":
          run(clean, (rr) => {
            // A verify always turns something up, and bookmarks it.
            const found = rr.int(1, 3);
            const next = new Set(marks);
            for (let i = 0; i < found; i++) {
              const region = rr.int(0, regions - 1);
              next.add(region);
              say(`Warning: ${rr.pick(["checksum drift", "unaligned field", "orphaned reference", "truncated record"])} at ${hex(region * facts.span)}`, region, true);
            }
            setMarks(next);
            onStatus(`${clean} — ${found} issue${found > 1 ? "s" : ""} bookmarked`);
          });
          break;
      }
    },
    [facts, regions, cursor, marks, bucket, threshold, follow, unit, run, say, setCursor, setBucket, setOrder, onStatus],
  );

  useEffect(() => {
    runRef.current = act;
    return () => {
      runRef.current = null;
    };
  }, [runRef, act]);

  // The log fills in line by line as the file "loads".
  useEffect(() => {
    opened.current = performance.now();
    const lines = introLines(facts, rng(facts.hash.slice(16)), unit);
    let i = 0;
    const id = window.setInterval(() => {
      const line = lines[i++];
      if (line) say(line.text, line.region, line.warn);
      if (i >= lines.length) window.clearInterval(id);
    }, 110);
    return () => window.clearInterval(id);
  }, [facts, say, unit]);

  // Left alone, the program keeps itself busy: background jobs, the odd log
  // line, and — with follow on — the cursor walking the file. It gives way to
  // anyone actually using it, and stops while the window is minimized.
  const jobRef = useRef<JobState>(null);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);
  useEffect(() => {
    if (!running) return;
    let timer = 0;
    const loop = () => {
      const rr = r.current;
      const idle = performance.now() - touched.current > 4000;
      if (follow) setCursorState((c) => (c + 1) % regions);
      if (idle && !jobRef.current) {
        const roll = rr.next();
        if (roll < 0.35) {
          const word = facts.words.length ? rr.pick(facts.words) : "";
          run(word && rr.chance(0.3) ? `Resolving '${word}'` : rr.pick(AMBIENT_JOBS));
        } else if (roll < 0.6 && !follow) {
          setCursorState((c) => (c + rr.int(1, 3)) % regions);
        } else {
          say(rr.pick(AMBIENT_LINES)(rr));
        }
      }
      timer = window.setTimeout(loop, follow ? 700 : 2200 + rr.next() * 3800);
    };
    // Switching follow on starts the walk at once rather than after the next quiet spell.
    timer = window.setTimeout(loop, follow ? 300 : 2500);
    return () => window.clearTimeout(timer);
  }, [running, follow, regions, facts.words, run, say]);

  const bus = useMemo<Bus>(
    () => ({
      facts,
      regions,
      cursor,
      setCursor,
      pointer,
      setPointer,
      bucket,
      setBucket,
      threshold,
      setThreshold: (v: number) => {
        touched.current = performance.now();
        setThreshold(v);
      },
      order,
      setOrder,
      query,
      setQuery: (q: string) => {
        touched.current = performance.now();
        setQuery(q);
      },
      follow,
      setFollow: (on: boolean) => {
        touched.current = performance.now();
        setFollow(on);
        say(on ? "Follow: on" : "Follow: off");
      },
      epoch,
      marks,
      tabTurn,
      unit,
      log,
      say,
      run: userRun,
      act,
    }),
    [facts, regions, cursor, setCursor, pointer, bucket, setBucket, threshold, order, setOrder, query, follow, epoch, marks, tabTurn, unit, log, say, userRun, act],
  );
  const jobValue = useMemo(() => ({ job, scan }), [job, scan]);

  return (
    <BusContext.Provider value={bus}>
      <JobContext.Provider value={jobValue}>
        {children}
        <StatusBar spec={spec} />
      </JobContext.Provider>
    </BusContext.Provider>
  );
}

/** Scrolls `el` into view inside the nearest scrolling pane, never the page. */
function reveal(el: HTMLElement | null) {
  if (!el) return;
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const top = el.offsetTop - box.offsetTop;
  if (top < box.scrollTop) box.scrollTop = top - 4;
  else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 4;
}

/** Toolbar: buttons start jobs, the drop-down reorders the table, the box searches every pane. */
function ToolRow({ tools }: { tools: ToolSpec[] }) {
  const bus = useBus();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", padding: "0 0 2px" }}>
      {tools.map((tool, i) => {
        if (tool.kind === "gap") return <div key={i} style={{ width: 2, height: 22, margin: "0 3px", borderLeft: "1px solid #808080", borderRight: "1px solid #fff" }} />;
        if (tool.kind === "button")
          return (
            <Button key={i} size="sm" square variant="thin" title={tool.label} aria-label={tool.label} onClick={() => bus.act(tool.label, tool.command)}>
              <CommandIcon command={tool.command} />
            </Button>
          );
        if (tool.kind === "select")
          return (
            <Select
              key={i}
              width={110}
              menuMaxHeight={160}
              value={bus.order}
              options={tool.options.map((label, value) => ({ label, value }))}
              onChange={(option) => bus.setOrder(option.value, tool.options[option.value])}
            />
          );
        return (
          <TextInput
            key={i}
            placeholder={tool.placeholder}
            value={bus.query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => bus.setQuery(event.target.value)}
            style={{ width: 120, height: 24, fontSize: 11 }}
          />
        );
      })}
    </div>
  );
}

/** Byte histogram. A bar click picks those bytes out everywhere and jumps to a region full of them. */
function Histogram({ seed }: { seed: number }) {
  const { facts, bucket, setBucket, cursor, setCursor, regions, threshold } = useBus();
  const { job } = useContext(JobContext);
  const colour = rng(seed).pick([NAVY, TEAL, "#800000", "#008000"]);
  const bars = facts.histogram;
  const here = facts.regionBucket[cursor];
  const done = job ? Math.floor(job.progress * bars.length) : bars.length;
  const pick = (i: number) => {
    setBucket(bucket === i ? null : i, "histogram");
    for (let k = 1; k <= regions; k++) {
      const region = (cursor + k) % regions;
      if (facts.regionBucket[region] === i) {
        setCursor(region, "histogram");
        break;
      }
    }
  };
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${bars.length * 4} 100`} preserveAspectRatio="none" style={{ display: "block", background: "#fff", cursor: "pointer" }}>
      {[25, 50, 75].map((y) => (
        <line key={y} x1={0} x2={bars.length * 4} y1={y} y2={y} stroke="#c0c0c0" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      ))}
      {bars.map((v, i) => (
        <g key={i} onClick={() => pick(i)}>
          <rect x={i * 4} y={0} width={4} height={100} fill={i === bucket ? MARK : "transparent"} />
          <rect
            x={i * 4 + 0.5}
            y={100 - v * 96}
            width={3}
            height={v * 96}
            fill={i === bucket ? "#c00000" : colour}
            opacity={i < done ? 1 : 0.35}
            stroke={i === here ? "#000" : "none"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
      <line x1={0} x2={bars.length * 4} y1={100 - threshold * 0.96} y2={100 - threshold * 0.96} stroke="#c00000" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Entropy along the file. Click to move the cursor; the threshold and any running scan show here too. */
function Profile({ seed }: { seed: number }) {
  const { facts, cursor, setCursor, setPointer, threshold, bucket, regions, marks } = useBus();
  const { scan } = useContext(JobContext);
  const dark = rng(seed).chance(0.5);
  const pts = facts.profile.length > 1 ? facts.profile : [facts.entropy, facts.entropy];
  const w = pts.length;
  const path = pts.map((v, i) => `${i + 0.5},${(100 - (v / 8) * 92).toFixed(2)}`).join(" ");
  const at = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(regions - 1, Math.floor(((event.clientX - rect.left) / rect.width) * regions)));
  };
  const line = 100 - (threshold / 100) * 92;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} 100`}
      preserveAspectRatio="none"
      style={{ display: "block", background: dark ? "#000" : "#fff", cursor: "crosshair" }}
      onClick={(event) => setCursor(at(event), "profile")}
      onMouseMove={(event) => setPointer(at(event) * facts.span)}
      onMouseLeave={() => setPointer(null)}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={(w * (i + 1)) / 10} x2={(w * (i + 1)) / 10} y1={0} y2={100} stroke={dark ? "#004000" : "#e0e0e0"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {bucket !== null &&
        facts.regionBucket.map((b, i) => (b === bucket ? <rect key={i} x={i} y={94} width={1} height={6} fill={dark ? "#ffff00" : "#c0a000"} /> : null))}
      <rect x={cursor} y={0} width={1} height={100} fill={dark ? "#004400" : SCAN} />
      {[...marks].map((m) => (
        <rect key={`m${m}`} x={m + 0.2} y={0} width={0.6} height={6} fill="#ff0000" />
      ))}
      {scan !== null && <line x1={scan + 0.5} x2={scan + 0.5} y1={0} y2={100} stroke={dark ? "#00ffff" : TEAL} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      <line x1={0} x2={w} y1={line} y2={line} stroke="#c00000" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polyline points={path} fill="none" stroke={dark ? "#00ff00" : NAVY} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** How many bytes a hex row shows at a given pane width: as many as fit, by halves. */
function hexWidth(px: number) {
  // Offset, gaps, three characters a byte and one more for its ASCII, at 11px monospace.
  const ch = 6.6;
  if (px >= (12 + 4 * 16) * ch + 10) return 16;
  if (px >= (12 + 4 * 8) * ch + 10) return 8;
  return 4;
}

/** The bytes at the cursor. Hovering points; a click picks that byte's value out everywhere. */
function HexView() {
  const { facts, cursor, bucket, setBucket, setPointer, query } = useBus();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [per, setPer] = useState(16);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setPer(hexWidth(box.clientWidth)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const start = cursor * facts.span;
  const end = Math.min(facts.sample.length, start + per * 24);
  const q = query.toLowerCase();
  const rows: React.ReactNode[] = [];
  for (let off = start - (start % per); off < end; off += per) {
    const chunk = Array.from(facts.sample.subarray(off, Math.min(off + per, facts.sample.length)));
    const ascii = chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    const hit = q.length >= 2 && ascii.toLowerCase().includes(q);
    rows.push(
      <div key={off} style={{ whiteSpace: "pre", display: "flex", background: hit ? MARK : undefined }}>
        <span style={{ color: NAVY }}>{off.toString(16).padStart(8, "0")}</span>
        <span>{"  "}</span>
        {chunk.map((b, i) => (
          <span
            key={i}
            className={off + i === start ? "facade-caret" : undefined}
            onMouseEnter={() => setPointer(off + i)}
            onMouseLeave={() => setPointer(null)}
            onClick={() => setBucket(b >> 3, "hex view")}
            style={{ background: bucket !== null && b >> 3 === bucket ? MARK : undefined, cursor: "pointer" }}
          >
            {b.toString(16).padStart(2, "0")}
            {i < per - 1 ? " " : ""}
          </span>
        ))}
        <span>{" ".repeat(Math.max(0, (per - chunk.length) * 3))}{"  "}</span>
        <span style={{ color: "#808080" }}>{ascii}</span>
      </div>,
    );
  }
  return (
    <div ref={boxRef} style={{ ...MONO, padding: 4, background: "#fff", minHeight: "100%", boxSizing: "border-box" }}>
      <style>{`@keyframes facade-blink { 50% { background: ${NAVY}; color: #fff; } } .facade-caret { animation: facade-blink 1s steps(1) infinite; }`}</style>
      {rows}
    </div>
  );
}

const COLUMN_POOL = ["Offset", "Length", "Entropy", "Type", "Name", "Flags", "Checksum", "Align", "Ratio"] as const;
const TYPE_POOL = ["DATA", "CODE", "META", "INDEX", "PAD", "TEXT", "BLOB", "HDR", "RES"];

/** One row a region. Click moves the cursor, double-click inspects; the threshold dims, the search marks. */
function SegmentTable({ seed }: { seed: number }) {
  const { facts, cursor, setCursor, threshold, order, query, run, bucket, marks } = useBus();
  const { scan } = useContext(JobContext);
  const r = rng(seed);
  const cols = ["Offset", ...[...COLUMN_POOL.slice(1)].sort(() => r.next() - 0.5).slice(0, r.int(2, 4))];
  const rows = useMemo(
    () =>
      facts.profile.map((h, i) => {
        const rr = rng(seed ^ Math.imul(i + 1, 2654435761));
        const name = facts.words.length ? facts.words[(i + rr.int(0, 3)) % facts.words.length] : `seg_${i}`;
        const value: Record<string, string> = {
          Offset: hex(i * facts.span),
          Length: String(Math.min(facts.span, facts.sample.length - i * facts.span)),
          Entropy: h.toFixed(3),
          Type: h > 7.5 ? "BLOB" : h < 1 ? "PAD" : facts.text ? "TEXT" : rr.pick(TYPE_POOL),
          Name: name,
          Flags: ["R", rr.chance(0.4) ? "W" : "-", rr.chance(0.2) ? "X" : "-"].join(""),
          Checksum: facts.hash.slice((i * 6) % 56, ((i * 6) % 56) + 8),
          Align: String(2 ** rr.int(0, 6)),
          Ratio: `${(100 - (h / 8) * 100).toFixed(1)}%`,
        };
        return { region: i, entropy: h, name, value };
      }),
    [facts, seed],
  );
  const sorted = useMemo(() => {
    const list = [...rows];
    if (order === 1) list.sort((a, b) => b.entropy - a.entropy);
    if (order === 2) list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows, order]);
  const selectedRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => reveal(selectedRef.current), [cursor, order]);
  const q = query.toLowerCase();
  return (
    <Table style={{ width: "100%", background: "#fff" }}>
      <TableHead>
        <TableRow>
          {cols.map((c) => (
            <TableHeadCell key={c} style={{ ...CELL, height: 20 }} sort={(c === "Entropy" && order === 1) || (c === "Name" && order === 2) || (c === "Offset" && order === 0) ? "desc" : undefined}>
              {c}
            </TableHeadCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map(({ region, entropy, name, value }) => {
          const selected = region === cursor;
          const dim = (entropy / 8) * 100 < threshold;
          const hit = (q.length >= 2 && name.toLowerCase().includes(q)) || (bucket !== null && facts.regionBucket[region] === bucket);
          return (
            <TableRow
              key={region}
              ref={selected ? selectedRef : undefined}
              onClick={() => setCursor(region, "table")}
              onDoubleClick={() => run(`Inspect ${name}`)}
              style={{
                cursor: "default",
                height: 18,
                lineHeight: "16px",
                background: selected ? NAVY : scan === region ? SCAN : hit ? MARK : undefined,
                color: selected ? "#fff" : dim ? "#808080" : undefined,
              }}
            >
              {cols.map((c) => (
                <TableDataCell key={c} style={{ ...CELL, ...(c === "Offset" || c === "Checksum" ? MONO : null) }}>
                  {c === "Offset" && (
                    <svg width={6} height={8} viewBox="0 0 6 8" aria-hidden style={{ marginRight: 4, visibility: marks.has(region) ? "visible" : "hidden" }}>
                      <path d="M0 0h6v8L3 5 0 8z" fill="#c00000" />
                    </svg>
                  )}
                  {value[c]}
                </TableDataCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Strings found in the file, filed into folders. Each leaf stands for a region; picking one moves there. */
function Structure({ seed }: { seed: number }) {
  const { facts, cursor, setCursor, regions, query } = useBus();
  const { tree, regionOf, folderOf } = useMemo(() => {
    const r = rng(seed);
    const folders = r.int(3, 5);
    // react95 keys tree rows by their labels, so every label in the tree has to differ.
    const names = ["Header", "Sections", "Resources", "Strings", "Symbols", "Metadata", "Streams", "Tables", "Assets"].sort(() => r.next() - 0.5);
    const seen = new Set(names.slice(0, folders));
    const pool: string[] = [];
    for (const raw of facts.strings.length ? facts.strings : facts.words) {
      const label = raw.length > 18 ? `${raw.slice(0, 17)}…` : raw;
      if (seen.has(label)) continue;
      seen.add(label);
      pool.push(label);
    }
    // A file with nothing printable in it still gets an outline, of numbered entries.
    for (let i = 0; pool.length < folders * 7; i++) {
      const label = `entry_${i.toString(16).padStart(4, "0")}`;
      if (!seen.has(label)) pool.push(label);
    }
    let k = 0;
    const out: TreeLeaf<string>[] = [];
    const regionOf = new Map<string, number>();
    const folderOf = new Map<string, string>();
    for (let f = 0; f < folders; f++) {
      const items: TreeLeaf<string>[] = [];
      const count = r.int(2, 7);
      for (let i = 0; i < count; i++) {
        const id = `${f}.${i}`;
        items.push({ id, label: pool[k] });
        // Spread the leaves along the file, in order, as a real outline would be.
        regionOf.set(id, Math.floor((k * regions) / Math.max(1, folders * 4.5)) % regions);
        folderOf.set(id, String(f));
        k++;
      }
      out.push({ id: String(f), label: names[f], items });
    }
    return { tree: out, regionOf, folderOf };
  }, [seed, facts, regions]);

  const q = query.toLowerCase();
  const shown = useMemo(() => {
    if (q.length < 2) return tree;
    return tree
      .map((folder) => ({ ...folder, items: folder.items?.filter((leaf) => leaf.label?.toLowerCase().includes(q)) }))
      .filter((folder) => folder.items?.length);
  }, [tree, q]);

  // The leaf nearest the cursor is the selected one, and its folder opens to show it.
  const selected = useMemo(() => {
    let best: string | undefined;
    let bestGap = Infinity;
    for (const [id, region] of regionOf) {
      const gap = Math.abs(region - cursor);
      if (gap < bestGap) {
        best = id;
        bestGap = gap;
      }
    }
    return best;
  }, [regionOf, cursor]);
  const [expanded, setExpanded] = useState<string[]>(["0"]);
  const open = selected ? folderOf.get(selected) : undefined;
  const effective = open && !expanded.includes(open) ? [...expanded, open] : expanded;

  return (
    <TreeView
      tree={shown}
      expanded={q.length >= 2 ? shown.map((f) => f.id) : effective}
      selected={selected}
      onNodeToggle={(_, ids) => setExpanded(ids)}
      onNodeSelect={(_, id) => {
        const region = regionOf.get(id);
        if (region !== undefined) setCursor(region, "outline");
      }}
      style={{ fontSize: 11, padding: 4, background: "#fff", minHeight: "100%" }}
    />
  );
}

/** Facts about the file and the selection. Every row can be re-checked, which starts a job. */
function Properties({ seed }: { seed: number }) {
  const { facts, cursor, regions, order, threshold, query, bucket, run, epoch, marks, unit } = useBus();
  const r = rng(seed);
  const rows: [string, string][] = [
    ["Name", facts.name],
    ["Type", facts.kind],
    ["Size", `${formatSize(facts.size)}${facts.size >= 1024 ? ` (${facts.size.toLocaleString()} bytes)` : ""}`],
    ["Modified", new Date(facts.modified).toLocaleString()],
    ["SHA-256", `${facts.hash.slice(0, 16)}…`],
    ["Entropy", `${facts.entropy.toFixed(3)} bits/byte`],
  ];
  if (facts.lines) rows.push(["Lines", facts.lines.toLocaleString()]);
  rows.push(["Strings", facts.strings.length >= 400 ? "400+" : String(facts.strings.length)]);
  // Distinct names: each row's name is also its key.
  const extra = ["Revision", "Profile", "Codec", "Layout", "Encoding", "Origin", "Build", "Level"].sort(() => r.next() - 0.5);
  const extras = r.int(1, 3);
  for (let i = 0; i < extras; i++) {
    rows.push([extra[i], r.pick([`r${r.int(2, 90)}`, `v${r.int(1, 4)}.${r.int(0, 9)}`, facts.ext.toUpperCase() || "RAW", r.pick(["Baseline", "Extended", "Main", "Strict", "Legacy"])])]);
  }
  const live: [string, string][] = [
    ["Selection", `${unit} ${cursor} of ${regions}`],
    ["Range", `${hex(cursor * facts.span)}–${hex(Math.min(facts.sample.length, (cursor + 1) * facts.span) - 1)}`],
    [`${unit} entropy`, (facts.profile[cursor] ?? 0).toFixed(3)],
    ["Order", `by ${ORDERS[order]}`],
    ["Threshold", `${threshold}%`],
    ["Filter", query.length >= 2 ? `"${query}"` : bucket !== null ? `bytes ${hex(bucket * 8, 2)}–${hex(bucket * 8 + 7, 2)}` : "none"],
    ["Bookmarks", String(marks.size)],
    ["Passes", String(epoch)],
  ];
  const grid = (list: [string, string][], liveRows: boolean) =>
    list.map(([k, v]) => (
      <React.Fragment key={k}>
        <span style={{ color: "#555", cursor: "pointer" }} onClick={() => run(`Verify ${k.toLowerCase()}`)}>
          {k}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: liveRows ? NAVY : undefined, cursor: "pointer" }} title={v} onClick={() => run(`Verify ${k.toLowerCase()}`)}>
          {v}
        </span>
      </React.Fragment>
    ));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 10px", padding: 6, fontSize: 11, background: "#fff", minHeight: "100%", alignContent: "start" }}>
      {grid(rows, false)}
      <span style={{ gridColumn: "1 / -1", borderTop: "1px solid #c0c0c0", margin: "3px 0" }} />
      {grid(live, true)}
    </div>
  );
}

const OPTION_POOL = [
  "Ignore padding", "Show offsets", "Merge adjacent", "Highlight changes", "Strict parsing",
  "Use cache", "Auto-refresh", "Wrap lines", "Group by type", "Show hidden", "Verify checksums",
];

/** Settings. Follow walks the cursor, the radios reorder, the slider sets the threshold every pane dims by. */
function Controls({ seed }: { seed: number }) {
  const bus = useBus();
  const [spec] = useState(() => {
    const r = rng(seed);
    const checks = [...OPTION_POOL].sort(() => r.next() - 0.5).slice(0, r.int(1, 3)).map((label) => ({ label, on: r.chance(0.5) }));
    const radios = r.chance(0.7) ? r.pick([["Offset", "Entropy", "Name"], ["Sequential", "Weighted", "Alphabetic"], ["Raw", "Scored", "Named"]]) : null;
    return { checks, radios, depth: r.int(1, 8), number: r.chance(0.5) };
  });
  const [checks, setChecks] = useState(spec.checks.map((c) => c.on));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6, fontSize: 11 }}>
      <Checkbox label="Follow cursor" checked={bus.follow} onChange={() => bus.setFollow(!bus.follow)} style={{ fontSize: 11 }} />
      {spec.checks.map((c, i) => (
        <Checkbox
          key={c.label}
          label={c.label}
          checked={checks[i]}
          onChange={() => {
            setChecks((prev) => prev.map((v, j) => (j === i ? !v : v)));
            bus.run(`${checks[i] ? "Disable" : "Enable"} ${c.label.toLowerCase()}`);
          }}
          style={{ fontSize: 11 }}
        />
      ))}
      {spec.radios && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
          {spec.radios.map((label, i) => (
            <Radio key={label} label={label} name={`r${seed}`} checked={bus.order === i} onChange={() => bus.setOrder(i, label)} style={{ fontSize: 11 }} />
          ))}
        </div>
      )}
      {/* The slider's thumb hangs past both ends of its track; the padding keeps it inside the pane. */}
      <div style={{ marginTop: 4, padding: "0 10px" }}>
        <div style={{ marginLeft: -10 }}>Threshold: {bus.threshold}%</div>
        <Slider
          min={0}
          max={100}
          value={bus.threshold}
          onChange={(v: number) => bus.setThreshold(v)}
          onChangeCommitted={(v: number) => bus.say(`Threshold set to ${v}%`)}
          style={{ marginBottom: 6 }}
        />
      </div>
      {spec.number && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          Depth <NumberInput defaultValue={spec.depth} min={1} max={32} width={64} onChange={(v) => bus.run(`Rebuild to depth ${v}`)} />
        </label>
      )}
    </div>
  );
}

/** For files that aren't text or pictures: the bytes themselves, one a pixel, over the whole sample. */
function BytePicture({ seed }: { seed: number }) {
  const { facts, cursor, setCursor, regions, bucket } = useBus();
  const { scan } = useContext(JobContext);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const W = 64;
  const H = Math.max(1, Math.min(128, Math.ceil(facts.sample.length / W)));
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const r = rng(seed);
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const tint = [r.next(), r.next(), r.next()];
    const n = facts.sample.length;
    for (let i = 0; i < W * H; i++) {
      const at = Math.floor((i * n) / (W * H));
      const b = n ? facts.sample[at] : 0;
      const lit = bucket !== null && b >> 3 === bucket;
      img.data[i * 4] = lit ? 255 : Math.round(b * (0.4 + tint[0] * 0.6));
      img.data[i * 4 + 1] = lit ? 255 : Math.round(b * (0.4 + tint[1] * 0.6));
      img.data[i * 4 + 2] = lit ? 0 : Math.round(b * (0.4 + tint[2] * 0.6));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [facts, seed, bucket, H]);
  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%", background: "#000", cursor: "crosshair" }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setCursor(Math.floor(((event.clientY - rect.top) / rect.height) * regions), "preview");
      }}
    >
      <canvas ref={ref} style={{ width: "100%", height: "100%", imageRendering: "pixelated", display: "block" }} />
      <Band at={cursor} of={regions} colour="rgba(255,255,255,0.35)" />
      {scan !== null && <Band at={scan} of={regions} colour="rgba(0,255,255,0.25)" />}
    </div>
  );
}

/** A horizontal stripe over a picture: where the cursor, or a scan, is. */
function Band({ at, of, colour }: { at: number; of: number; colour: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${(at / of) * 100}%`,
        height: `${Math.max(1, 100 / of)}%`,
        minHeight: 2,
        background: colour,
        outline: "1px dotted #fff",
        pointerEvents: "none",
      }}
    />
  );
}

function Preview({ seed }: { seed: number }) {
  const { facts, cursor, setCursor, regions, query } = useBus();
  const { scan } = useContext(JobContext);
  const lines = useMemo(() => {
    if (facts.text === null) return [];
    let offset = 0;
    return facts.text
      .split("\n")
      .slice(0, 300)
      .map((line) => {
        const at = offset;
        offset += line.length + 1;
        return { line, at };
      });
  }, [facts]);
  const currentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => reveal(currentRef.current), [cursor]);

  if (facts.imageUrl)
    return (
      <div
        style={{ width: "100%", height: "100%", background: "#808080", display: "flex", alignItems: "center", justifyContent: "center", cursor: "crosshair" }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setCursor(Math.floor(((event.clientY - rect.top) / rect.height) * regions), "preview");
        }}
      >
        <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={facts.imageUrl} alt={facts.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
          <Band at={cursor} of={regions} colour="rgba(0,0,128,0.25)" />
          {scan !== null && <Band at={scan} of={regions} colour="rgba(0,128,128,0.25)" />}
        </div>
      </div>
    );
  if (facts.text !== null) {
    const q = query.toLowerCase();
    const from = cursor * facts.span;
    const to = from + facts.span;
    // The first line inside the selected region is the one scrolled to.
    const first = lines.findIndex(({ line, at }) => at + line.length >= from && at < to);
    return (
      <pre style={{ ...MONO, margin: 0, padding: 4, background: "#fff", minHeight: "100%", boxSizing: "border-box", whiteSpace: "pre" }}>
        {lines.map(({ line, at }, i) => {
          const inRegion = at + line.length >= from && at < to;
          const hit = q.length >= 2 && line.toLowerCase().includes(q);
          return (
            <div
              key={i}
              ref={i === first ? currentRef : undefined}
              onClick={() => setCursor(Math.floor(at / facts.span), "preview")}
              style={{ background: hit ? MARK : inRegion ? SCAN : undefined, cursor: "default" }}
            >
              <span style={{ color: "#808080", userSelect: "none" }}>{String(i + 1).padStart(4, " ")} </span>
              {line}
            </div>
          );
        })}
      </pre>
    );
  }
  return <BytePicture seed={seed} />;
}

/** Everything the window has done, live. A line that names a place takes you there. */
function Log() {
  const { log, setCursor } = useBus();
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => reveal(endRef.current), [log.length]);
  return (
    <div style={{ ...MONO, padding: 4, background: "#fff", minHeight: "100%", boxSizing: "border-box" }}>
      {log.map((entry) => (
        <div
          key={entry.id}
          onClick={entry.region !== undefined ? () => setCursor(entry.region!, "log") : undefined}
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            paddingLeft: "2em",
            textIndent: "-2em",
            color: entry.warn ? "#800000" : undefined,
            textDecoration: entry.region !== undefined ? "underline dotted" : undefined,
            cursor: entry.region !== undefined ? "pointer" : "default",
          }}
        >
          {stamp(entry.at)} {entry.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/** Readings that never quite sit still. They follow the cursor and settle anew after each job; a click recalculates. */
function Meters({ seed }: { seed: number }) {
  const { facts, cursor, threshold, epoch, run, unit } = useBus();
  const { job } = useContext(JobContext);
  const picks = useMemo(() => {
    const r = rng(seed);
    const all = ["Region entropy", "Coverage", "Integrity", "Compression", "Confidence", "Density", "Load"];
    return all.sort(() => r.next() - 0.5).slice(0, r.int(3, 5));
  }, [seed]);
  const targets = useMemo(() => {
    const r = rng(seed + epoch * 7919);
    const local = facts.profile[cursor] ?? facts.entropy;
    const value: Record<string, number> = {
      "Region entropy": (local / 8) * 100,
      Coverage: Math.min(100, 55 + r.next() * 30 + (cursor / Math.max(1, facts.profile.length)) * 15),
      Integrity: Math.max(0, 100 - threshold * 0.4 - r.next() * 15),
      Compression: 100 - (local / 8) * 100,
      Confidence: 50 + r.next() * 50,
      Density: Math.min(100, (facts.strings.length / 4) * (0.5 + r.next())),
      Load: 20 + r.next() * 40,
    };
    return picks.map((label) => [label, value[label]] as const);
  }, [facts, cursor, threshold, epoch, picks, seed]);

  // Ease toward the targets, with a little noise on top so they're never still.
  const [shown, setShown] = useState<number[]>(() => targets.map(() => 0));
  const targetRef = useRef(targets);
  const busyRef = useRef(false);
  useEffect(() => {
    targetRef.current = targets;
    busyRef.current = job !== null;
  }, [targets, job]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = performance.now() / 1000;
      setShown((prev) =>
        targetRef.current.map(([, target], i) => {
          const noise = Math.sin(t * (1.3 + i * 0.7) + i) * (busyRef.current ? 6 : 1.5);
          const prevValue = prev[i] ?? 0;
          return prevValue + (Math.max(0, Math.min(100, target + noise)) - prevValue) * 0.25;
        }),
      );
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 6, fontSize: 11 }}>
      {targets.map(([label], i) => (
        <div key={label} onClick={() => run(`Recalculate ${label.toLowerCase()}`)} style={{ cursor: "pointer" }}>
          {/* The reading goes beside the label: react95 centres it for a 32px bar, and these are 18px. */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{label === "Region entropy" ? `${unit} entropy` : label}</span>
            <span style={{ fontFamily: "monospace" }}>{Math.round(shown[i] ?? 0)}%</span>
          </div>
          <ProgressBar value={Math.round(shown[i] ?? 0)} hideValue variant={job ? "tile" : "default"} style={{ height: 18 }} />
        </div>
      ))}
    </div>
  );
}

function Panel({ panel }: { panel: PanelSpec }) {
  switch (panel.kind) {
    case "tree":
      return <Structure seed={panel.seed} />;
    case "table":
      return <SegmentTable seed={panel.seed} />;
    case "hex":
      return <HexView />;
    case "props":
      return <Properties seed={panel.seed} />;
    case "histogram":
      return <Histogram seed={panel.seed} />;
    case "profile":
      return <Profile seed={panel.seed} />;
    case "controls":
      return <Controls seed={panel.seed} />;
    case "preview":
      return <Preview seed={panel.seed} />;
    case "log":
      return <Log />;
    case "meters":
      return <Meters seed={panel.seed} />;
  }
}

/** The kinds drawn on the window's grey rather than in a white well. */
const ON_GREY = new Set(["controls", "meters"]);

function Well({ panel, children }: { panel: PanelSpec; children: React.ReactNode }) {
  return (
    <Frame
      variant="field"
      data-pane={panel.kind}
      style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, overflow: "auto", background: ON_GREY.has(panel.kind) ? "#c6c6c6" : "#fff" }}
    >
      {children}
    </Frame>
  );
}

/**
 * Compact tabs, in react95's own proportions: the selected one is 4px taller
 * and 8px wider each side, since react95 pulls it up and over its neighbours
 * by exactly that much.
 */
const tabStyle = (selected: boolean): React.CSSProperties => ({
  fontSize: 11,
  height: selected ? 26 : 22,
  lineHeight: selected ? "26px" : "22px",
  padding: selected ? "0 16px" : "0 8px",
});

function Pane({ pane }: { pane: PaneSpec }) {
  const { tabTurn } = useBus();
  // The tab picked by hand, counted from wherever "next view" commands have turned it to.
  const [picked, setPicked] = useState(0);
  const n = pane.pages.length;
  const tab = (((picked + tabTurn) % n) + n) % n;
  // Titles are cut short with an ellipsis once the tabs would run wider than the pane.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(Infinity);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || n < 2) return;
    const observer = new ResizeObserver(() => setRoom(Math.floor(strip.clientWidth / n) - 24));
    observer.observe(strip);
    return () => observer.disconnect();
  }, [n]);
  const fill: React.CSSProperties = { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, minWidth: 0 };
  if (n > 1) {
    const page = pane.pages[tab];
    return (
      // The selected tab rises 4px above the row; the padding keeps it inside the pane.
      <div ref={stripRef} style={{ ...fill, paddingTop: 4, boxSizing: "border-box" }}>
        <Tabs value={tab} onChange={(v: number) => setPicked(v - tabTurn)} style={{ fontSize: 11, paddingLeft: 8, whiteSpace: "nowrap" }}>
          {pane.pages.map((p, i) => (
            <Tab key={i} value={i} title={p.title} style={tabStyle(i === tab)}>
              <span style={{ display: "inline-block", maxWidth: Number.isFinite(room) ? Math.max(24, room) : undefined, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "top" }}>{p.title}</span>
            </Tab>
          ))}
        </Tabs>
        <TabBody style={{ flex: "1 1 auto", minHeight: 0, padding: "8px 6px 6px", display: "flex" }}>
          <Well panel={page}>
            <Panel key={tab} panel={page} />
          </Well>
        </TabBody>
      </div>
    );
  }
  const page = pane.pages[0];
  if (pane.chrome === "group")
    return (
      // The group's title sits above its frame; the padding keeps it inside the pane rather than cropped by it.
      <div style={{ ...fill, paddingTop: 8, boxSizing: "border-box" }}>
        <GroupBox label={page.title} style={{ ...fill, boxSizing: "border-box", padding: "10px 6px 6px", margin: 0, fontSize: 11 }}>
          <Well panel={page}>
            <Panel panel={page} />
          </Well>
        </GroupBox>
      </div>
    );
  return (
    <div style={fill}>
      {pane.chrome === "well" && <div style={{ fontSize: 11, fontWeight: "bold", padding: "0 2px 2px" }}>{page.title}</div>}
      <Well panel={page}>
        <Panel panel={page} />
      </Well>
    </div>
  );
}

function Split({ node }: { node: LayoutNode }) {
  if ("pane" in node) return <Pane pane={node.pane} />;
  // Neither side is squeezed past usefulness; a window too small for both just crops.
  const least: React.CSSProperties = node.split === "row" ? { minWidth: 130, minHeight: 0 } : { minWidth: 0, minHeight: 80 };
  return (
    <div style={{ display: "flex", flexDirection: node.split, gap: 4, width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
      <div style={{ flex: `${node.ratio} 1 0`, ...least, display: "flex" }}>
        <Split node={node.a} />
      </div>
      <div style={{ flex: `${1 - node.ratio} 1 0`, ...least, display: "flex" }}>
        <Split node={node.b} />
      </div>
    </div>
  );
}

function StatusField({ children, grow, title, width }: { children: React.ReactNode; grow?: boolean; title?: string; width?: number }) {
  return (
    <Frame
      variant="status"
      title={title}
      style={{
        flex: grow ? "1 1 auto" : "0 0 auto",
        width,
        padding: "1px 6px",
        fontSize: 11,
        minWidth: grow ? 0 : 40,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </Frame>
  );
}

/** Message, the running job, where the cursor (or the mouse) is, and the seed. */
function StatusBar({ spec }: { spec: UiSpec }) {
  const { facts, cursor, pointer } = useBus();
  const { job } = useContext(JobContext);
  const message = useContext(MessageContext);
  const at = pointer ?? cursor * facts.span;
  return (
    <div style={{ display: "flex", gap: 2, minWidth: 0, overflow: "hidden" }}>
      <StatusField grow>{message}</StatusField>
      {job && (
        <div style={{ width: 120, flex: "0 0 auto" }} title={job.label}>
          <ProgressBar value={Math.round(job.progress * 100)} hideValue variant="tile" style={{ height: 18 }} />
        </div>
      )}
      <StatusField>{formatSize(facts.size)}</StatusField>
      <StatusField width={92}>
        {pointer !== null ? "Ptr" : "Pos"} {hex(at)}
      </StatusField>
      <StatusField>{spec.status[0]}</StatusField>
      <StatusField title={`SHA-256 ${facts.hash}`}>SHA-256: {facts.hash.slice(0, 12)}</StatusField>
    </div>
  );
}

const MessageContext = createContext("");

export type FacadeWindowHandle = {
  /** Carries out a menu item's command. */
  act: (label: string, command: Command) => void;
};

type FacadeWindowProps = {
  facts: FileFacts | null;
  spec: UiSpec | null;
  loading: boolean;
  /** False while minimized: the program stops keeping itself busy. */
  running: boolean;
  message: string;
  onStatus: (text: string) => void;
  onOpen: () => void;
  onDropFile: (file: File) => void;
};

/**
 * The body of facade.exe: before a file, an empty frame waiting for one; after,
 * the program that file's hash dreamed up — toolbar, panes and status bar, all
 * wired to one another and never quite idle.
 */
const FacadeWindow = forwardRef<FacadeWindowHandle, FacadeWindowProps>(function FacadeWindow(
  { facts, spec, loading, running, message, onStatus, onOpen, onDropFile },
  ref,
) {
  const [dragging, setDragging] = useState(false);
  const runRef = useRef<((label: string, command: Command) => void) | null>(null);
  useImperativeHandle(ref, () => ({ act: (label: string, command: Command) => runRef.current?.(label, command) }), []);
  const ready = spec && facts && !loading;

  return (
    <div
      style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, outline: dragging ? `2px dotted ${NAVY}` : undefined }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onDropFile(file);
      }}
    >
      <MessageContext.Provider value={message}>
        {ready ? (
          <BusProvider key={facts.hash} facts={facts} spec={spec} running={running} onStatus={onStatus} runRef={runRef}>
            <ToolRow tools={spec.tools} />
            <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex" }}>
              <Split node={spec.root} />
            </div>
          </BusProvider>
        ) : (
          <>
            <Frame
              variant="field"
              style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#808080", color: "#fff", fontSize: 12 }}
            >
              {loading ? (
                <>
                  <Hourglass size={32} />
                  <span>Reading file&hellip;</span>
                </>
              ) : (
                <>
                  <span>No file open.</span>
                  <Button onClick={onOpen}>Open&hellip;</Button>
                </>
              )}
            </Frame>
            <div style={{ display: "flex", gap: 2 }}>
              <StatusField grow>{message}</StatusField>
              <StatusField>SHA-256: </StatusField>
            </div>
          </>
        )}
      </MessageContext.Provider>
    </div>
  );
});

export default FacadeWindow;
