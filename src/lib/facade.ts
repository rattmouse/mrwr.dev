/**
 * facade.exe's two halves: what a file is, and the program it gets.
 *
 * `readFacts` hashes a file and reads enough out of it to fill a convincing
 * window — byte statistics, an entropy profile, the printable strings, a guess
 * at its format. `buildSpec` then takes the hash as a seed and lays out a whole
 * application around those facts: its name, menus, toolbar, panes and status
 * bar. The same file always gets the same program; a different file, a
 * different one. None of it does anything.
 */

/** Everything the panels show about the file, read once when it's opened. */
export type FileFacts = {
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** SHA-256 of the whole file, lowercase hex. The seed. */
  hash: string;
  /** Shannon entropy of the sampled bytes, 0–8 bits a byte. */
  entropy: number;
  /** Byte values counted into 32 buckets, scaled so the tallest is 1. */
  histogram: number[];
  /** Entropy of each successive slice of the sample, 0–8. */
  profile: number[];
  /** Printable runs of four or more characters, in the order they appear. */
  strings: string[];
  /** Distinct word-like tokens out of `strings`, for naming things. */
  words: string[];
  /** The opening of the file, when it reads as text. */
  text: string | null;
  lines: number;
  /** What it looks like it is, by magic number, then extension, then content. */
  kind: string;
  /** The bytes the statistics were read from — the first megabyte, at most. */
  sample: Uint8Array;
  /** How many bytes of `sample` each entry of `profile` covers. */
  span: number;
  /** Which histogram bucket each region of `profile` has the most of. */
  regionBucket: number[];
  /** The file itself, when it's a picture the browser can show. */
  imageUrl: string | null;
};

/** How much of the file is read for statistics. The hash always covers all of it. */
const SAMPLE = 1 << 20;

const MAGIC: { bytes: number[]; kind: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], kind: "PNG image" },
  { bytes: [0xff, 0xd8, 0xff], kind: "JPEG image" },
  { bytes: [0x47, 0x49, 0x46, 0x38], kind: "GIF image" },
  { bytes: [0x52, 0x49, 0x46, 0x46], kind: "RIFF container" },
  { bytes: [0x25, 0x50, 0x44, 0x46], kind: "PDF document" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: "ZIP archive" },
  { bytes: [0x1f, 0x8b], kind: "gzip stream" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], kind: "ELF executable" },
  { bytes: [0x4d, 0x5a], kind: "DOS/PE executable" },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], kind: "Mach-O binary" },
  { bytes: [0x4d, 0x54, 0x68, 0x64], kind: "MIDI sequence" },
  { bytes: [0x49, 0x44, 0x33], kind: "MP3 audio" },
  { bytes: [0x4f, 0x67, 0x67, 0x53], kind: "Ogg stream" },
  { bytes: [0x66, 0x4c, 0x61, 0x43], kind: "FLAC audio" },
  { bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], kind: "SQLite database" },
  { bytes: [0x00, 0x61, 0x73, 0x6d], kind: "WebAssembly module" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf], kind: "7-Zip archive" },
  { bytes: [0x42, 0x4d], kind: "bitmap image" },
];

function entropyOf(bytes: Uint8Array, from: number, to: number): number {
  const counts = new Uint32Array(256);
  for (let i = from; i < to; i++) counts[bytes[i]]++;
  const n = to - from;
  if (n <= 0) return 0;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function guessKind(head: Uint8Array, ext: string, printable: number): string {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => head[i] === b)) return m.kind;
  }
  if (printable > 0.95) {
    const known: Record<string, string> = {
      json: "JSON document",
      md: "Markdown text",
      csv: "comma-separated values",
      html: "HTML document",
      svg: "SVG drawing",
      js: "JavaScript source",
      ts: "TypeScript source",
      tsx: "TypeScript source",
      py: "Python source",
      xml: "XML document",
      log: "log file",
    };
    return known[ext] ?? "plain text";
  }
  return ext ? `${ext.toUpperCase()} data` : "binary data";
}

/** Hash the file and pull out what the panels need. */
export async function readFacts(file: File): Promise<FileFacts> {
  const buffer = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  const all = new Uint8Array(buffer);
  const bytes = all.subarray(0, SAMPLE);
  const n = bytes.length;

  const counts = new Uint32Array(256);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    counts[b]++;
    if ((b >= 0x20 && b < 0x7f) || b === 9 || b === 10 || b === 13 || b >= 0x80) printable++;
  }
  const buckets = new Array(32).fill(0);
  for (let i = 0; i < 256; i++) buckets[i >> 3] += counts[i];
  const tallest = Math.max(1, ...buckets);
  const histogram = buckets.map((c) => c / tallest);

  const slices = Math.max(1, Math.min(64, Math.floor(n / 64)));
  const span = Math.max(1, Math.ceil(n / slices));
  const profile: number[] = [];
  const regionBucket: number[] = [];
  for (let s = 0; s < slices; s++) {
    const from = s * span;
    const to = Math.min(n, from + span);
    profile.push(entropyOf(bytes, from, to));
    const local = new Uint32Array(32);
    for (let i = from; i < to; i++) local[bytes[i] >> 3]++;
    let best = 0;
    for (let i = 1; i < 32; i++) if (local[i] > local[best]) best = i;
    regionBucket.push(best);
  }

  const strings: string[] = [];
  let run = "";
  for (let i = 0; i < n && strings.length < 400; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b < 0x7f) {
      run += String.fromCharCode(b);
    } else {
      if (run.trim().length >= 4) strings.push(run.trim().slice(0, 60));
      run = "";
    }
  }
  if (run.trim().length >= 4 && strings.length < 400) strings.push(run.trim().slice(0, 60));

  const seen = new Set<string>();
  const words: string[] = [];
  for (const s of strings) {
    for (const w of s.match(/[A-Za-z][A-Za-z0-9_]{3,15}/g) ?? []) {
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(w);
      if (words.length >= 160) break;
    }
    if (words.length >= 160) break;
  }

  const ratio = n ? printable / n : 1;
  const isText = n > 0 && ratio > 0.95 && counts[0] === 0;
  const text = isText ? new TextDecoder().decode(bytes.subarray(0, 65536)) : null;
  let lines = 0;
  if (isText) for (let i = 0; i < n; i++) if (bytes[i] === 10) lines++;

  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const kind = guessKind(bytes.subarray(0, 16), ext, isText ? 1 : ratio);
  const isImage = file.type.startsWith("image/");

  return {
    name: file.name || "untitled",
    ext,
    size: file.size,
    modified: file.lastModified,
    hash,
    entropy: entropyOf(bytes, 0, n),
    histogram,
    profile,
    strings,
    words,
    text,
    lines: isText ? lines + 1 : 0,
    kind,
    // A copy, so the rest of a big file's buffer can be let go.
    sample: bytes.slice(),
    span,
    regionBucket,
    imageUrl: isImage ? URL.createObjectURL(file) : null,
  };
}

/** A small seeded generator (sfc32), so a hash always unfolds the same way. */
export type Rng = {
  /** 0 ≤ x < 1 */
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(list: readonly T[]) => T;
  chance: (p: number) => boolean;
  /** A fresh 32-bit seed, for handing a part of the window its own stream. */
  fork: () => number;
};

export function rng(seed: string | number): Rng {
  let a: number, b: number, c: number, d: number;
  if (typeof seed === "string") {
    const hex = seed.padEnd(32, "0");
    a = parseInt(hex.slice(0, 8), 16) | 0;
    b = parseInt(hex.slice(8, 16), 16) | 0;
    c = parseInt(hex.slice(16, 24), 16) | 0;
    d = parseInt(hex.slice(24, 32), 16) | 0;
  } else {
    a = seed | 0;
    b = (seed ^ 0x9e3779b9) | 0;
    c = Math.imul(seed, 0x85ebca6b);
    d = 1;
  }
  const next = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    fork: () => Math.floor(next() * 4294967296),
  };
}

export type PanelKind =
  | "tree"
  | "table"
  | "hex"
  | "props"
  | "histogram"
  | "profile"
  | "controls"
  | "preview"
  | "log"
  | "meters";

/** One page of a pane: what it draws, under what name, from what seed. */
export type PanelSpec = { kind: PanelKind; title: string; seed: number };

/** A pane: one page, or several behind tabs, in one of three kinds of frame. */
export type PaneSpec = { pages: PanelSpec[]; chrome: "group" | "well" | "bare" };

export type LayoutNode =
  | { split: "row" | "column"; ratio: number; a: LayoutNode; b: LayoutNode }
  | { pane: PaneSpec };

/**
 * Something a menu item or toolbar button does to the window. No two controls
 * in one window share one: each is dealt out of the pool once.
 */
export type Command =
  | { do: "step"; by: number }
  | { do: "seek"; to: "start" | "end" | "densest" | "sparsest" | "middle" }
  | { do: "back" }
  | { do: "order"; order: number }
  | { do: "threshold"; by?: number; to?: number }
  | { do: "tabs" }
  | { do: "follow" }
  | { do: "pick" }
  | { do: "findNext" }
  | { do: "clear" }
  | { do: "mark" }
  | { do: "nextMark" }
  | { do: "markSimilar" }
  | { do: "unmark" }
  | { do: "report" }
  | { do: "rescan" }
  | { do: "verify" };

export type CommandSpec = { label: string; command: Command };

export type MenuSpec = { name: string; items: CommandSpec[] };

export type ToolSpec =
  | { kind: "button"; label: string; command: Command }
  | { kind: "gap" }
  | { kind: "select"; options: string[] }
  | { kind: "search"; placeholder: string };

export type UiSpec = {
  product: string;
  version: string;
  /** What this program calls a region of the file: Block, Segment, Chunk… */
  unit: string;
  /** Extra rows for the File menu, under Open and Close. */
  file: CommandSpec[];
  menus: MenuSpec[];
  tools: ToolSpec[];
  root: LayoutNode;
  /** What the status bar's middle fields say, after the message and before the seed. */
  status: string[];
};

const SYLLABLES = ["ar", "ex", "on", "vi", "qu", "ta", "lo", "ze", "ri", "um", "sy", "ka", "nor", "dex", "tron", "mo", "pha", "lyn", "ix", "or"];
const PRODUCT_TAILS = ["Studio", "Inspector", "Workbench", "Analyzer", "Explorer", "Pro", "Manager", "Suite", "Toolkit", "Viewer", "Lab", "Console"];
const UNITS = ["Region", "Block", "Segment", "Chunk", "Section", "Frame", "Page", "Cluster"];
const TITLES: Record<PanelKind, string[]> = {
  tree: ["Structure", "Outline", "Objects", "Navigator", "Hierarchy", "Library"],
  table: ["Segments", "Records", "Entries", "Blocks", "Sections", "Symbols"],
  hex: ["Raw", "Hex", "Bytes", "Memory", "Dump"],
  props: ["Properties", "Details", "Attributes", "Info", "Inspector"],
  histogram: ["Distribution", "Spectrum", "Histogram", "Byte Levels"],
  profile: ["Entropy", "Density", "Timeline", "Signal", "Profile"],
  controls: ["Options", "Parameters", "Settings", "Filters", "Mode"],
  preview: ["Preview", "Render", "Output", "View", "Canvas"],
  log: ["Log", "Output", "Messages", "Events", "Console"],
  meters: ["Metrics", "Levels", "Health", "Analysis", "Scores"],
};

/** The kinds that are worth a big pane, and those that suit a narrow one. */
const WIDE: PanelKind[] = ["table", "hex", "preview", "profile", "histogram"];
const NARROW: PanelKind[] = ["tree", "props", "controls", "meters", "log"];

type Category = "nav" | "view" | "analyze" | "marks";

const MENU_NAMES: Record<Category, string[]> = {
  nav: ["Go", "Navigate", "Seek"],
  view: ["View", "Display", "Options"],
  analyze: ["Analyze", "Tools", "Query", "Run"],
  marks: ["Bookmarks", "Markers", "Edit"],
};

/**
 * Every command a window can deal out, each with a few ways of naming it.
 * `{u}` is the program's word for a region, `{us}` its plural.
 */
const POOL: { command: Command; category: Category; labels: string[] }[] = [
  { command: { do: "step", by: 1 }, category: "nav", labels: ["Next {u}", "{u} Forward", "Step Forward"] },
  { command: { do: "step", by: -1 }, category: "nav", labels: ["Previous {u}", "{u} Back", "Step Back"] },
  { command: { do: "step", by: 4 }, category: "nav", labels: ["Skip Ahead 4 {us}", "Jump Forward", "Fast Forward"] },
  { command: { do: "step", by: -4 }, category: "nav", labels: ["Skip Back 4 {us}", "Jump Back", "Rewind"] },
  { command: { do: "seek", to: "start" }, category: "nav", labels: ["First {u}", "Go to Start", "Home"] },
  { command: { do: "seek", to: "end" }, category: "nav", labels: ["Last {u}", "Go to End"] },
  { command: { do: "seek", to: "middle" }, category: "nav", labels: ["Go to Middle", "Center View"] },
  { command: { do: "seek", to: "densest" }, category: "nav", labels: ["Densest {u}", "Go to Peak", "Find Hotspot"] },
  { command: { do: "seek", to: "sparsest" }, category: "nav", labels: ["Emptiest {u}", "Find Padding", "Go to Trough"] },
  { command: { do: "back" }, category: "nav", labels: ["Go Back", "Previous Location", "Return"] },
  { command: { do: "order", order: 0 }, category: "view", labels: ["Sort by Offset", "Order by Position", "Arrange by Offset"] },
  { command: { do: "order", order: 1 }, category: "view", labels: ["Sort by Entropy", "Order by Density", "Arrange by Entropy"] },
  { command: { do: "order", order: 2 }, category: "view", labels: ["Sort by Name", "Order by Label", "Arrange A\u2013Z"] },
  { command: { do: "threshold", by: 10 }, category: "view", labels: ["Raise Threshold", "Tighten Filter", "Increase Sensitivity"] },
  { command: { do: "threshold", by: -10 }, category: "view", labels: ["Lower Threshold", "Loosen Filter", "Decrease Sensitivity"] },
  { command: { do: "threshold", to: 0 }, category: "view", labels: ["Show All {us}", "Reset Threshold"] },
  { command: { do: "threshold", to: 75 }, category: "view", labels: ["Strict Mode", "High Threshold"] },
  { command: { do: "tabs" }, category: "view", labels: ["Next View", "Cycle Panels", "Switch Tabs"] },
  { command: { do: "follow" }, category: "view", labels: ["Follow Cursor", "Auto-Advance", "Track Playback"] },
  { command: { do: "pick" }, category: "analyze", labels: ["Isolate Byte Range", "Pick Bytes at Cursor", "Highlight Similar Bytes"] },
  { command: { do: "findNext" }, category: "analyze", labels: ["Find Next Match", "Next Occurrence", "Find Again"] },
  { command: { do: "clear" }, category: "analyze", labels: ["Clear Filters", "Reset Highlights", "Clear Selection"] },
  { command: { do: "markSimilar" }, category: "analyze", labels: ["Mark Similar {us}", "Find Lookalikes", "Cluster {us}"] },
  { command: { do: "rescan" }, category: "analyze", labels: ["Rescan", "Reanalyze File", "Refresh Analysis", "Rebuild Index"] },
  { command: { do: "verify" }, category: "analyze", labels: ["Verify Integrity", "Run Checks", "Validate Structure"] },
  { command: { do: "mark" }, category: "marks", labels: ["Bookmark {u}", "Set Marker", "Mark {u}"] },
  { command: { do: "nextMark" }, category: "marks", labels: ["Next Bookmark", "Go to Marker", "Cycle Markers"] },
  { command: { do: "unmark" }, category: "marks", labels: ["Clear Bookmarks", "Remove Markers", "Forget Marks"] },
  { command: { do: "report" }, category: "marks", labels: ["Summarize {u}", "Export Report\u2026", "Dump Details"] },
];

function cap(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function shuffle<T>(r: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function productName(r: Rng, facts: FileFacts) {
  let base = "";
  const parts = r.int(2, 3);
  for (let i = 0; i < parts; i++) base += r.pick(SYLLABLES);
  // Now and then the program takes its name from something inside the file.
  const borrowed = facts.words.filter((w) => w.length >= 4 && w.length <= 9);
  if (borrowed.length && r.chance(0.25)) base = r.pick(borrowed).toLowerCase();
  return `${cap(base)} ${r.pick(PRODUCT_TAILS)}`;
}

/**
 * The smallest share of the window's width and height a pane may be given.
 * Below that its contents stop fitting, so the generator stops splitting and
 * puts whatever is left behind tabs instead.
 */
const MIN_W = 0.28;
const MIN_H = 0.5;

/**
 * Splits panes into a tree of row and column splits, keeping track of how much
 * of the window each part has left. The first split usually leaves a sidebar,
 * the way real programs are drawn.
 */
function layout(r: Rng, kinds: PanelKind[], w: number, h: number, depth: number, used: Set<PanelKind>): LayoutNode {
  const canRow = w >= 2 * MIN_W;
  const canColumn = h >= 2 * MIN_H;
  if (kinds.length === 1 || (!canRow && !canColumn)) return { pane: pane(r, kinds, used) };
  const preferRow = depth === 0 ? r.chance(0.75) : r.chance(w >= h ? 0.65 : 0.35);
  const split: "row" | "column" = canRow && (preferRow || !canColumn) ? "row" : "column";
  const take = kinds.length === 2 ? 1 : r.int(1, kinds.length - 1);
  const narrowFirst = split === "row" && take === 1 && NARROW.includes(kinds[0]);
  const size = split === "row" ? w : h;
  const min = (split === "row" ? MIN_W : MIN_H) / size;
  const ratio = Math.max(min, Math.min(1 - min, narrowFirst ? 0.22 + r.next() * 0.12 : 0.35 + r.next() * 0.3));
  const [aw, ah, bw, bh] = split === "row" ? [w * ratio, h, w * (1 - ratio), h] : [w, h * ratio, w, h * (1 - ratio)];
  return {
    split,
    ratio,
    a: layout(r, kinds.slice(0, take), aw, ah, depth + 1, used),
    b: layout(r, kinds.slice(take), bw, bh, depth + 1, used),
  };
}

/**
 * One pane for `kinds` — several of them land here when there was no room to
 * split. A lone pane sometimes keeps more behind tabs anyway. `used` is every
 * kind already in the window, so a tab never repeats a pane.
 */
function pane(r: Rng, kinds: PanelKind[], used: Set<PanelKind>): PaneSpec {
  const pages: PanelSpec[] = kinds.map((kind) => ({ kind, title: r.pick(TITLES[kind]), seed: r.fork() }));
  if (pages.length === 1 && r.chance(0.3)) {
    const extra = r.int(1, 2);
    for (let i = 0; i < extra; i++) {
      const free = [...WIDE, ...NARROW].filter((k) => !used.has(k));
      if (!free.length) break;
      const other = r.pick(free);
      used.add(other);
      pages.push({ kind: other, title: r.pick(TITLES[other]), seed: r.fork() });
    }
  }
  return { pages, chrome: pages.length > 1 ? "bare" : r.pick(["group", "group", "well", "bare"] as const) };
}

/** The whole application this file gets. */
export function buildSpec(facts: FileFacts): UiSpec {
  const r = rng(facts.hash);
  const product = productName(r, facts);
  const version = `${r.int(1, 9)}.${r.int(0, 12)}${r.chance(0.4) ? `.${r.int(0, 40)}` : ""}`;
  const unit = r.pick(UNITS);
  const name = (labels: string[]) => r.pick(labels).replace("{us}", `${unit}s`).replace("{u}", unit);

  // The table's order is either a drop-down on the toolbar or a set of commands, never both.
  const select = r.chance(0.5);
  let deck = shuffle(r, POOL.filter((entry) => !(select && entry.command.do === "order")));
  const deal = (test: (entry: (typeof POOL)[number]) => boolean, count: number) => {
    const taken = deck.filter(test).slice(0, count);
    deck = deck.filter((entry) => !taken.includes(entry));
    return taken;
  };

  const file = deal((e) => e.command.do === "report" || e.command.do === "rescan" || e.command.do === "verify", r.int(1, 2)).map((e) => ({
    label: name(e.labels),
    command: e.command,
  }));

  const tools: ToolSpec[] = [];
  const groups = r.int(2, 3);
  for (let g = 0; g < groups; g++) {
    for (const e of deal(() => true, r.int(2, 4))) tools.push({ kind: "button", label: name(e.labels), command: e.command });
    if (g < groups - 1) tools.push({ kind: "gap" });
  }
  if (select) tools.push({ kind: "gap" }, { kind: "select", options: ["By offset", "By entropy", "By name"] });
  if (r.chance(0.6)) tools.push({ kind: "gap" }, { kind: "search", placeholder: r.pick(["Find", "Filter", "Search"]) });

  const menus: MenuSpec[] = [];
  for (const category of shuffle(r, ["nav", "view", "analyze", "marks"] as Category[])) {
    const items = deal((e) => e.category === category, 7).map((e) => ({ label: name(e.labels), command: e.command }));
    if (items.length >= 2) menus.push({ name: r.pick(MENU_NAMES[category]), items });
  }

  // Which panes, and in what order: a sidebar sort first, then the big ones.
  const count = r.int(2, 5);
  const wide = WIDE.filter((k) => k !== "preview" || facts.text !== null || facts.imageUrl !== null || r.chance(0.5));
  const chosen: PanelKind[] = [];
  if (r.chance(0.8)) chosen.push(r.pick(NARROW));
  chosen.push(r.pick(wide));
  while (chosen.length < count) {
    const k = r.pick(r.chance(0.5) ? wide : NARROW);
    if (!chosen.includes(k)) chosen.push(k);
  }

  const status = [r.pick(["NUM", "CAP", "INS", "OVR", "READ"])];

  return { product, version, unit, file, menus, tools, root: layout(r, chosen, 1, 1, 0, new Set(chosen)), status };
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[u]}`;
}
