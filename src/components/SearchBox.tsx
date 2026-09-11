"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MenuList, TextInput } from "react95";
import styled from "styled-components";

import { Z } from "@/constants/zIndex";
import { useSearchPlayback } from "@/components/common/SearchPlayback";
import type { SearchEntryLine } from "@/lib/searchPlayback";
import type { SearchHistorySession } from "@/lib/searchHistory.types";
import { formatRelativeCompact } from "@/lib/relativeTime";

const MAX_ROWS = 8;

// Map a stored session onto the parsed-line shape the playback engine wants.
// Flagged entries play back their defanged text, never the raw payload.
function toPlaybackEntries(session: SearchHistorySession): SearchEntryLine[] {
  return session.entries.map((entry) => {
    const text = entry.displayQuery ?? entry.query;
    const atMs = Date.parse(entry.at);
    return {
      entry: text,
      when: Number.isFinite(atMs) ? formatRelativeCompact(entry.at) : "just now",
      atMs: Number.isFinite(atMs) ? atMs : Number.NaN,
      deltaMs: entry.inputDeltaMs ?? null,
    };
  });
}

function headline(session: SearchHistorySession): string {
  let longest = "";
  for (const entry of session.entries) {
    const text = entry.displayQuery ?? entry.query;
    if (text.length > longest.length) longest = text;
  }
  return longest;
}

function matchesQuery(session: SearchHistorySession, needle: string): boolean {
  if (!needle) return true;
  return session.entries.some((entry) =>
    (entry.displayQuery ?? entry.query).toLowerCase().includes(needle)
  );
}

const Dropdown = styled(MenuList)`
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  width: 320px;
  max-width: 78vw;
  z-index: ${Z.START_SUBMENU};
  margin: 0;
  padding: 2px;
`;

const Row = styled.li<{ $active: boolean }>`
  list-style: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  background: ${({ $active }) => ($active ? "#000080" : "transparent")};
  color: ${({ $active }) => ($active ? "#fff" : "inherit")};
`;

const When = styled.span<{ $active: boolean }>`
  flex: 0 0 auto;
  color: ${({ $active }) => ($active ? "#ffe9a8" : "#a06a00")};
`;

// Shrink but don't grow, so the caret after it trails the text instead of
// being pushed to the row's right edge.
const QueryText = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Warn = styled.span`
  flex: 0 0 auto;
`;

const Empty = styled.li`
  list-style: none;
  padding: 4px;
  font-size: 11px;
  opacity: 0.7;
`;

type HistoryRowProps = {
  session: SearchHistorySession;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
};

function HistoryRow({ session, active, onHover, onPick }: HistoryRowProps) {
  const entries = useMemo(() => toPlaybackEntries(session), [session]);
  const frame = useSearchPlayback(entries);
  const text = frame?.text ?? headline(session);
  const when = frame?.when ?? formatRelativeCompact(session.startedAt);
  const caretVisible = frame?.caretVisible ?? false;

  return (
    <Row
      $active={active}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        // Keep focus in the input so the dropdown's blur handler doesn't
        // race the click.
        event.preventDefault();
        onPick();
      }}
      title={session.flagged ? `blocked · ${session.categories.join(", ") || "flagged"}` : headline(session)}
    >
      {session.flagged ? <Warn aria-hidden>⚠️</Warn> : null}
      <When $active={active}>{when}</When>
      <QueryText>{text}</QueryText>
      <span aria-hidden style={{ flex: "0 0 auto", marginLeft: -4, opacity: caretVisible ? 1 : 0 }}>
        ▮
      </span>
    </Row>
  );
}

type SearchBoxProps = {
  history: SearchHistorySession[];
  /** Picking a past search hands it here, with the text its row shows; the desktop decides where it opens. */
  onOpen?: (session: SearchHistorySession, text: string) => void;
};

export default function SearchBox({ history, onOpen }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<string>("");
  const lastInputAtRef = useRef<number | null>(null);
  const searchSessionIdRef = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem("searchLogSessionId");
    if (existing) {
      searchSessionIdRef.current = existing;
      return;
    }
    const created = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem("searchLogSessionId", created);
    searchSessionIdRef.current = created;
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((session) => matchesQuery(session, needle)).slice(0, MAX_ROWS);
  }, [history, query]);

  const showDropdown = open && matches.length > 0;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (event.target instanceof Node && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const logSearch = (value: string) => {
    const q = value.trim();
    if (!q) return;
    if (q === lastSentRef.current) return;

    const now = Date.now();
    const inputDeltaMs = lastInputAtRef.current === null ? 0 : Math.max(0, now - lastInputAtRef.current);
    lastInputAtRef.current = now;
    lastSentRef.current = q;

    fetch("/log-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q,
        sessionId: searchSessionIdRef.current || undefined,
        at: new Date(now).toISOString(),
        inputDeltaMs,
      }),
    }).catch((err) => {
      console.error("log-search failed", err);
    });
  };

  const pick = (session: SearchHistorySession) => {
    setOpen(false);
    setActiveIndex(-1);
    // Let go of the search box so typing lands in whatever opens, not here.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onOpen?.(session, headline(session));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!showDropdown) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length > 0) {
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1 >= matches.length ? 0 : i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && activeIndex < matches.length) {
      event.preventDefault();
      pick(matches[activeIndex]);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <TextInput
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setActiveIndex(-1);
          if (!open) setOpen(true);
          logSearch(next);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search..."
        width={150}
      />

      {showDropdown && (
        <Dropdown onMouseLeave={() => setActiveIndex(-1)}>
          {matches.map((session, idx) => (
            <HistoryRow
              key={session.id}
              session={session}
              active={idx === activeIndex}
              onHover={() => setActiveIndex(idx)}
              onPick={() => pick(session)}
            />
          ))}
          {query.trim() && (
            <Empty aria-hidden>{`${matches.length} of ${history.length} past searches`}</Empty>
          )}
        </Dropdown>
      )}
    </div>
  );
}
