"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type LogLine = { id: number; at: number; text: string };

/** How much of the log the Console panel keeps before the top scrolls away. */
const KEPT = 160;

/**
 * How long a value has to sit still before its change is written down. Dragging
 * a slider fires a change a frame; what belongs in the log is where it was
 * before you took hold of it and where you let go, on one line.
 */
const SETTLE_MS = 450;

export type PartyLog = {
  lines: LogLine[];
  /** Write a line down now. */
  note: (text: string) => void;
  /** Write down where a value started and where it came to rest. */
  changed: (key: string, label: string, from: string | number, to: string | number) => void;
  clear: () => void;
};

/**
 * The teletype behind party.webp's Console panel: a running account of what the
 * window has been up to, so a canvas of drifting figures reads as an
 * application with something going on in it rather than a screensaver.
 *
 * Nothing in here leaves the browser, and it lasts as long as the window does.
 */
export function usePartyLog(): PartyLog {
  const [lines, setLines] = useState<LogLine[]>([]);
  const nextId = useRef(1);
  // Values still being dragged: where each one was when it was first touched,
  // and the timer that will write it down once it stops moving.
  const settling = useRef(new Map<string, { from: string; timer: number }>());

  const note = useCallback((text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: nextId.current++, at: Date.now(), text }];
      return next.length > KEPT ? next.slice(next.length - KEPT) : next;
    });
  }, []);

  const changed = useCallback(
    (key: string, label: string, from: string | number, to: string | number) => {
      const pending = settling.current.get(key);
      if (pending) window.clearTimeout(pending.timer);
      const first = pending?.from ?? String(from);
      const timer = window.setTimeout(() => {
        settling.current.delete(key);
        if (first !== String(to)) note(`${label} ${first} → ${to}`);
      }, SETTLE_MS);
      settling.current.set(key, { from: first, timer });
    },
    [note],
  );

  const clear = useCallback(() => setLines([]), []);

  // A window that closes mid-drag shouldn't leave a timer running.
  useEffect(() => {
    const timers = settling.current;
    return () => {
      for (const pending of timers.values()) window.clearTimeout(pending.timer);
      timers.clear();
    };
  }, []);

  return useMemo(() => ({ lines, note, changed, clear }), [lines, note, changed, clear]);
}

/** "14:02:31" — the log is a thing that happened at a time, not a duration. */
export const logTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false });
