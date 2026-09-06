import { formatRelativeCompact } from "@/lib/relativeTime";

export const SEARCH_PROMPT_HOST = "mrwr.dev";

export type SearchEntryLine = {
  entry: string;
  when: string;
  atMs: number;
  deltaMs: number | null;
};

export type ParsedSearchLine = {
  idx: number;
  parsed: SearchEntryLine;
};

function stripDuplicateSearchPrefix(entry: string): string {
  const stripped = entry.replace(
    /^\s*(?:from\s+search\s+bar(?:\s+logging)?|search(?:ed)?)\s*:?\s*/i,
    ""
  );
  return stripped || entry;
}

/**
 * Recorded lines arrive wrapped for markdown — `- 'the query'` — courtesy of
 * journalctl_to_readme.sh. Playing that wrapper back keystroke-by-keystroke
 * (bullet, quote, query, quote) is a big part of why #53 looked fake, so peel
 * a leading list bullet and one layer of paired surrounding quotes.
 */
function stripListWrapper(entry: string): string {
  let s = entry.trim().replace(/^[-*•]\s+/, "");
  const paired = s.match(/^(['"`])([\s\S]*)\1$/);
  if (paired) s = paired[2];
  return s || entry;
}

function cleanEntry(raw: string): string {
  return stripListWrapper(stripDuplicateSearchPrefix(raw));
}

/**
 * Parse one recorded search line. Two shapes are accepted:
 *   `<entry> @ 2026-02-13T07:32:51.386Z`            (absolute timestamp)
 *   `<entry> @ 2026-02-13T07:32:51.386Z +790ms`     (absolute + recorded input gap)
 *   `<entry> +790ms`                                (recorded input gap only)
 * The `+Nms` figure comes from the server's `input_delta_ms` (client-measured
 * gap between keystroke-change events) and, when present, is the truer "rate
 * they typed at" than the wall-clock difference between timestamps.
 */
export function parseSearchEntryLine(line: string): SearchEntryLine | null {
  const isoMatch = line.match(
    /^(.*?)(?:\s*@\s*)(\d{4}-\d{2}-\d{2}T[^ \n]+)(?:\s+(?:\+|Δ|delta_ms=|input_delta_ms=)(\d+)\s*ms)?\s*$/i
  );
  if (isoMatch) {
    const explicitDeltaMs = isoMatch[3] ? Math.max(0, Number.parseInt(isoMatch[3], 10) || 0) : null;
    const atMs = Date.parse(isoMatch[2]);
    return {
      entry: cleanEntry(isoMatch[1].trimEnd()),
      when: formatRelativeCompact(isoMatch[2]),
      atMs: Number.isFinite(atMs) ? atMs : Number.NaN,
      deltaMs: explicitDeltaMs,
    };
  }

  const deltaMatch = line.match(/^(.*?)(?:\s*@\s*)?(?:\+|Δ|delta_ms=)(\d+)\s*ms\s*$/i);
  if (!deltaMatch) return null;
  const deltaMs = Math.max(0, Number.parseInt(deltaMatch[2], 10) || 0);
  return {
    entry: cleanEntry(deltaMatch[1].trimEnd()),
    when: deltaMs === 0 ? "just now" : `${Math.round(deltaMs / 100) / 10}s later`,
    atMs: Number.NaN,
    deltaMs,
  };
}

/**
 * Resolve every entry to an absolute-ish `atMs` on a single monotonically
 * advancing clock. Prefer the recorded input gap (`deltaMs`) when we have it,
 * otherwise fall back to the wall-clock timestamp, otherwise nudge forward a
 * token amount so ordering is preserved.
 */
export function withResolvedSearchTimes(entries: SearchEntryLine[]): SearchEntryLine[] {
  let cursor = 0;
  return entries.map((entry, index) => {
    if (entry.deltaMs !== null) {
      cursor += index === 0 ? 0 : entry.deltaMs;
      return { ...entry, atMs: cursor };
    }
    if (Number.isFinite(entry.atMs)) {
      cursor = entry.atMs;
      return entry;
    }
    cursor += index === 0 ? 0 : 60;
    return { ...entry, atMs: cursor };
  });
}

export function getSearchSpanSeconds(entries: SearchEntryLine[]): number {
  if (entries.length < 2) return 0;
  const first = entries[0]?.atMs ?? 0;
  const last = entries[entries.length - 1]?.atMs ?? first;
  return Math.max(0, last - first) / 1000;
}

export function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

/**
 * The value of the input after `step` edit operations have been applied to get
 * `from` towards `to`: first the trailing chars of `from` are deleted back to
 * the common prefix, then the tail of `to` is typed in.
 */
export function textAfterTransitionStep(from: string, to: string, step: number): string {
  const cpl = commonPrefixLen(from, to);
  const deletes = from.length - cpl;
  const inserts = to.slice(cpl);
  if (step <= deletes) return from.slice(0, from.length - step);
  return from.slice(0, cpl) + inserts.slice(0, step - deletes);
}

// --- Playback timeline -------------------------------------------------------
//
// A snapshot is only a sample of the input value at a moment in time; we don't
// have the individual keystrokes between two snapshots. So each snapshot->
// snapshot change is played as a quick *burst* of typing at a natural cadence,
// and whatever recorded time is left over becomes a visible *hesitation* hold
// (blinking caret, no text change). That reproduces the texture of the real
// signal — fast where they typed fast, paused where they paused — instead of
// smearing every change evenly across its gap.

const INSERT_MS = 55; // nominal per-character typing time
const DELETE_MS = 30; // per-character backspacing time
const CLEAR_MS = 200; // total time for a "select-all, delete" style wipe
const CLEAR_THRESHOLD = 8; // deletes beyond this collapse into one fast clear
const MAX_PAUSE_MS = 1600; // a long think is shown, but capped so playback moves
const FIRST_PAUSE_MS = 250; // brief beat before the very first characters
const HOLD_MS = 3000; // hold on the final query before the loop restarts

const SLOW_CHARS = new Set([" ", ".", ",", "!", "?", ";", ":", "—", "-"]);

export type PlaybackSegment = {
  start: number;
  pauseMs: number;
  typeMs: number;
  from: string;
  to: string;
  when: string;
  /** cumulative ms offsets (from typing-phase start) at which each op completes */
  steps: number[];
  ops: number;
};

export type PlaybackTimeline = {
  segments: PlaybackSegment[];
  totalMs: number;
  finalEntry: SearchEntryLine;
  singleEntry: SearchEntryLine | null;
};

function opDurations(from: string, to: string): number[] {
  const cpl = commonPrefixLen(from, to);
  const deletes = from.length - cpl;
  const inserts = to.length - cpl;
  const durations: number[] = [];

  if (deletes > 0) {
    const perDelete = deletes > CLEAR_THRESHOLD ? CLEAR_MS / deletes : DELETE_MS;
    for (let i = 0; i < deletes; i += 1) durations.push(perDelete);
  }

  if (inserts > 0) {
    const factors: number[] = [];
    for (let i = 0; i < inserts; i += 1) {
      const ch = to[cpl + i] ?? "";
      factors.push(SLOW_CHARS.has(ch) ? 1.8 : 0.9);
    }
    const meanFactor = factors.reduce((sum, f) => sum + f, 0) / factors.length;
    // Normalized so the burst still averages INSERT_MS/char but isn't metronomic.
    for (let i = 0; i < inserts; i += 1) durations.push((INSERT_MS * factors[i]) / meanFactor);
  }

  return durations;
}

export function buildPlaybackTimeline(rawEntries: SearchEntryLine[]): PlaybackTimeline | null {
  const entries = withResolvedSearchTimes(rawEntries);
  if (!entries.length) return null;
  if (entries.length === 1) {
    return {
      segments: [],
      totalMs: HOLD_MS,
      finalEntry: entries[0],
      singleEntry: entries[0],
    };
  }

  const pairs: Array<{ from: SearchEntryLine | null; to: SearchEntryLine }> = [
    { from: null, to: entries[0] },
  ];
  for (let i = 1; i < entries.length; i += 1) {
    pairs.push({ from: entries[i - 1], to: entries[i] });
  }

  let cursor = 0;
  const segments: PlaybackSegment[] = pairs.map(({ from, to }, index) => {
    const fromText = from?.entry ?? "";
    const durations = opDurations(fromText, to.entry);
    const typeMs = durations.reduce((sum, d) => sum + d, 0);

    const steps: number[] = [];
    let acc = 0;
    for (const d of durations) {
      acc += d;
      steps.push(acc);
    }

    let pauseMs: number;
    if (index === 0) {
      pauseMs = FIRST_PAUSE_MS;
    } else {
      const recordedGapMs = Math.max(0, to.atMs - (from as SearchEntryLine).atMs);
      pauseMs = Math.max(0, Math.min(MAX_PAUSE_MS, recordedGapMs - typeMs));
    }

    const segment: PlaybackSegment = {
      start: cursor,
      pauseMs,
      typeMs,
      from: fromText,
      to: to.entry,
      when: to.when,
      steps,
      ops: durations.length,
    };
    cursor += pauseMs + typeMs;
    return segment;
  });

  return {
    segments,
    totalMs: cursor + HOLD_MS,
    finalEntry: entries[entries.length - 1],
    singleEntry: null,
  };
}

export type PlaybackFrame = {
  text: string;
  when: string;
  /** whether the trailing caret glyph should be visible this frame */
  caretVisible: boolean;
};

function caretBlink(ms: number): boolean {
  return Math.floor(ms / 500) % 2 === 0;
}

export function playbackTextAt(timeline: PlaybackTimeline, elapsedMs: number): PlaybackFrame {
  if (timeline.singleEntry) {
    return {
      text: timeline.singleEntry.entry,
      when: timeline.singleEntry.when,
      caretVisible: caretBlink(elapsedMs),
    };
  }

  const active = timeline.segments.find(
    (seg) => elapsedMs >= seg.start && elapsedMs < seg.start + seg.pauseMs + seg.typeMs
  );

  if (!active) {
    // In the trailing hold (or past it, right before the loop wraps).
    return {
      text: timeline.finalEntry.entry,
      when: timeline.finalEntry.when,
      caretVisible: caretBlink(elapsedMs),
    };
  }

  const local = elapsedMs - active.start;
  if (local < active.pauseMs) {
    // Hesitating before the next burst: hold the previous query, blink.
    return { text: active.from, when: active.when, caretVisible: caretBlink(elapsedMs) };
  }

  const localType = local - active.pauseMs;
  let step = 0;
  while (step < active.steps.length && active.steps[step] <= localType) step += 1;

  return {
    text: textAfterTransitionStep(active.from, active.to, step),
    when: active.when,
    caretVisible: true, // solid caret while actively typing
  };
}
