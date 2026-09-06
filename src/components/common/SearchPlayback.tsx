"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  SEARCH_PROMPT_HOST,
  buildPlaybackTimeline,
  playbackTextAt,
  type SearchEntryLine,
} from "@/lib/searchPlayback";

/**
 * The terminal-style prompt line: `@[when] os@mrwr.dev: <entry>` with an
 * optional trailing caret. The caret keeps its width when hidden so text
 * doesn't jitter as it blinks.
 */
export function renderSearchPrompt(
  entry: string,
  when: string,
  caretVisible = false
): React.ReactNode {
  return (
    <>
      <span style={{ color: "#ffe066", textShadow: "0 0 1px #000, 0 0 2px #000" }}>{`@[${when}] `}</span>
      <span style={{ color: "#0057d8" }}>os</span>
      {"@"}
      <span style={{ color: "#a00055" }}>{SEARCH_PROMPT_HOST}</span>
      {`: ${entry}`}
      <span aria-hidden style={{ opacity: caretVisible ? 1 : 0 }}>▮</span>
    </>
  );
}

export function useSearchPlayback(entries: SearchEntryLine[]) {
  const timeline = useMemo(() => buildPlaybackTimeline(entries), [entries]);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!timeline) return;
    const startedAt = Date.now();
    const tick = () => setElapsedMs((Date.now() - startedAt) % timeline.totalMs);
    tick();
    const timer = window.setInterval(tick, 33);
    return () => window.clearInterval(timer);
  }, [timeline]);

  return timeline ? playbackTextAt(timeline, elapsedMs) : null;
}

/**
 * Bare-fragment playback of a series of recorded search snapshots — types each
 * change as a burst at a natural cadence, then holds (blinking caret) for the
 * leftover recorded gap, plays once through, holds ~3s on the final query, and
 * loops. Callers wrap this in whatever line markup they need.
 */
export function SearchPlaybackText({ entries }: { entries: SearchEntryLine[] }): React.ReactNode {
  const frame = useSearchPlayback(entries);
  if (!frame) return null;
  return renderSearchPrompt(frame.text, frame.when, frame.caretVisible);
}
