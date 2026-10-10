"use client";

import { useEffect, useMemo, useState } from "react";

import { normalizeSession } from "@/lib/searchHistory.normalize";
import type { SearchHistorySession } from "@/lib/searchHistory.types";

// Searches approved from the Telegram notifier since the last build. server.js
// serves them; `next dev` has no such route, and any failure just leaves the
// build-time history as it is.
const LIVE_URL = "/search-history/live";
// A tab left open picks up newer approvals when the dropdown opens again.
const REFETCH_AFTER_MS = 5 * 60 * 1000;

async function fetchLive(): Promise<SearchHistorySession[]> {
  try {
    const res = await fetch(LIVE_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeSession).filter((s): s is SearchHistorySession => s !== null);
  } catch {
    return [];
  }
}

// The build's copy wins: it can carry an issue link. A live session is also
// dropped when any of its keystrokes is already in a built one, in case the
// build grouped the same search under a different id.
export function mergeLiveHistory(
  built: SearchHistorySession[],
  live: SearchHistorySession[]
): SearchHistorySession[] {
  if (live.length === 0) return built;
  const ids = new Set(built.map((s) => s.id));
  const ats = new Set(built.flatMap((s) => s.entries.map((e) => e.at)).filter(Boolean));
  const extra = live.filter((s) => !ids.has(s.id) && !s.entries.some((e) => e.at && ats.has(e.at)));
  if (extra.length === 0) return built;
  const startedMs = (s: SearchHistorySession) => {
    const t = Date.parse(s.startedAt);
    return Number.isFinite(t) ? t : 0;
  };
  return [...built, ...extra].sort((a, b) => startedMs(b) - startedMs(a));
}

/** `built` plus approved searches the server has that the build doesn't; refetched on `open` when stale. */
export function useLiveSearchHistory(built: SearchHistorySession[], open: boolean): SearchHistorySession[] {
  const [live, setLive] = useState<{ sessions: SearchHistorySession[]; at: number } | null>(null);

  useEffect(() => {
    if (live && (!open || Date.now() - live.at < REFETCH_AFTER_MS)) return;
    let cancelled = false;
    fetchLive().then((sessions) => {
      if (!cancelled) setLive({ sessions, at: Date.now() });
    });
    return () => {
      cancelled = true;
    };
  }, [live, open]);

  return useMemo(() => mergeLiveHistory(built, live?.sessions ?? []), [built, live]);
}
