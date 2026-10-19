"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MenuList, TextInput } from "react95";
import styled from "styled-components";

import { Z } from "@/constants/zIndex";
import { useSearchPlayback } from "@/components/common/SearchPlayback";
import type { SearchEntryLine } from "@/lib/searchPlayback";
import type { SearchHistorySession } from "@/lib/searchHistory.types";
import { useLiveSearchHistory } from "@/lib/liveSearchHistory";
import { formatRelativeCompact } from "@/lib/relativeTime";
import { likelyWindows } from "@/lib/windowSearch";
import { PROGRAMS, type WindowId } from "@/components/windows/programs";

const MAX_ROWS = 8;
// Past searches older than this drop out of the dropdown. The build already
// leaves them out (refresh-search-history.mjs, same two weeks); this catches the
// ones that age past it while a build is still live.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function isRecent(session: SearchHistorySession, nowMs: number): boolean {
  const startedMs = Date.parse(session.startedAt);
  return Number.isFinite(startedMs) && nowMs - startedMs <= MAX_AGE_MS;
}

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

const Label = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Dim = styled.span<{ $active: boolean }>`
  flex: 0 0 auto;
  opacity: ${({ $active }) => ($active ? 0.85 : 0.6)};
`;

const Icon = styled.img`
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  image-rendering: pixelated;
`;

const Heading = styled.li`
  list-style: none;
  padding: 2px 4px 0;
  font-size: 11px;
  opacity: 0.7;
`;

const Divider = styled.li`
  list-style: none;
  margin: 2px 0;
  border-top: 1px solid #808080;
  border-bottom: 1px solid #fff;
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
  /** Picking a window the query looks like it means. */
  onOpenWindow?: (id: WindowId) => void;
};

/**
 * One line of the dropdown. Windows the query matches come first and take the
 * place of the past searches; until something matches, the past searches show
 * instead. With anything typed, the last line sends it in as feedback.
 */
type Choice =
  | { kind: "window"; id: WindowId }
  | { kind: "history"; session: SearchHistorySession }
  | { kind: "feedback" };

type FeedbackState = { text: string; status: "sending" | "sent" | "duplicate" | "failed" } | null;

// Feedback this browser has already sent, by the same normalized form the
// server compares (server.js normalizeFeedback), so the line says so instead
// of sending it again. A convenience only — the server is what refuses repeats.
const SENT_FEEDBACK_KEY = "searchFeedbackSent";
const MAX_SENT_FEEDBACK = 200;

function normalizeFeedback(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function loadSentFeedback(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SENT_FEEDBACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function rememberSentFeedback(norm: string) {
  try {
    const next = [...loadSentFeedback().filter((t) => t !== norm), norm].slice(-MAX_SENT_FEEDBACK);
    window.localStorage.setItem(SENT_FEEDBACK_KEY, JSON.stringify(next));
  } catch {
    // storage blocked — the server still refuses the repeat
  }
}

export default function SearchBox({ history: builtHistory, onOpen, onOpenWindow }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const history = useLiveSearchHistory(builtHistory, open);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

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

  // Recomputed each time the dropdown opens, so a tab left open for days still
  // lets old searches go.
  const recent = useMemo(() => {
    const nowMs = Date.now();
    return open ? history.filter((session) => isRecent(session, nowMs)) : [];
  }, [history, open]);

  const trimmed = query.trim();

  const windowMatches = useMemo(() => likelyWindows(trimmed), [trimmed]);

  // No window matched (yet): the past searches stay up, the ones that share
  // the text first.
  const historyRows = useMemo(() => {
    if (windowMatches.length > 0) return [];
    const needle = trimmed.toLowerCase();
    if (!needle) return recent.slice(0, MAX_ROWS);
    const hits = recent.filter((session) => matchesQuery(session, needle));
    const rest = recent.filter((session) => !matchesQuery(session, needle));
    return [...hits, ...rest].slice(0, MAX_ROWS);
  }, [recent, trimmed, windowMatches]);

  const choices = useMemo<Choice[]>(() => {
    const list: Choice[] = windowMatches.map((id) => ({ kind: "window", id }));
    for (const session of historyRows) list.push({ kind: "history", session });
    if (trimmed) list.push({ kind: "feedback" });
    return list;
  }, [windowMatches, historyRows, trimmed]);

  const showDropdown = open && choices.length > 0;

  // Only read while the dropdown is up; storage is never touched on the server.
  const alreadySent = useMemo(
    () => open && !!trimmed && loadSentFeedback().includes(normalizeFeedback(trimmed)),
    [open, trimmed, feedback],
  );

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

  const pickWindow = (id: WindowId) => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery("");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onOpenWindow?.(id);
  };

  const sendFeedback = () => {
    const text = trimmed;
    if (!text) return;
    if (feedback?.text === text && feedback.status !== "failed") return;
    const norm = normalizeFeedback(text);
    if (loadSentFeedback().includes(norm)) {
      setFeedback({ text, status: "duplicate" });
      return;
    }
    setFeedback({ text, status: "sending" });
    fetch("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        sessionId: searchSessionIdRef.current || undefined,
        at: new Date().toISOString(),
      }),
    })
      .then((res) => {
        // 204 is new feedback taken; 200 is the server saying it already has it.
        const status = res.status === 204 ? "sent" : res.status === 200 ? "duplicate" : "failed";
        if (status !== "failed") rememberSentFeedback(norm);
        setFeedback((now) => (now?.text === text ? { text, status } : now));
      })
      .catch((err) => {
        console.error("feedback failed", err);
        setFeedback((now) => (now?.text === text ? { text, status: "failed" } : now));
      });
  };

  const choose = (choice: Choice) => {
    if (choice.kind === "window") pickWindow(choice.id);
    else if (choice.kind === "history") pick(choice.session);
    else sendFeedback();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!showDropdown) {
      // Nothing to show just leaves it shut (showDropdown needs a match).
      if (event.key === "ArrowDown" || event.key === "ArrowUp") setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1 >= choices.length ? 0 : i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? choices.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < choices.length) {
        event.preventDefault();
        choose(choices[activeIndex]);
      } else if (windowMatches.length > 0) {
        // Enter on its own opens the best guess. It never sends feedback —
        // that takes picking the line.
        event.preventDefault();
        pickWindow(windowMatches[0]);
      }
    }
  };

  const feedbackLabel = (() => {
    if (feedback?.text === trimmed) {
      if (feedback.status === "sending") return "Sending feedback...";
      if (feedback.status === "sent") return "Feedback sent. Thanks!";
      if (feedback.status === "duplicate") return "Already sent as feedback. Thanks!";
      return `Couldn't send. Try again: "${trimmed}"`;
    }
    if (alreadySent) return "Already sent as feedback";
    return `Send "${trimmed}" as feedback`;
  })();

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
        // Its usual size on a desktop; on a phone it gives up some of its room
        // so the taskbar can still show the window you're in. (react95's
        // TextInput has no width prop — the size goes on its wrapper, and the
        // input fills it.)
        fullWidth
        style={{ width: "min(174px, 28vw)" }}
      />

      {showDropdown && (
        <Dropdown onMouseLeave={() => setActiveIndex(-1)}>
          {windowMatches.length > 0 && <Heading aria-hidden>Open</Heading>}
          {historyRows.length > 0 && trimmed && <Heading aria-hidden>No match yet · past searches</Heading>}
          {choices.map((choice, idx) => {
            const active = idx === activeIndex;
            const hover = () => setActiveIndex(idx);
            if (choice.kind === "history") {
              return (
                <HistoryRow
                  key={choice.session.id}
                  session={choice.session}
                  active={active}
                  onHover={hover}
                  onPick={() => pick(choice.session)}
                />
              );
            }
            const def = choice.kind === "window" ? PROGRAMS[choice.id] : null;
            return (
              <React.Fragment key={choice.kind === "window" ? choice.id : "feedback"}>
                {choice.kind === "feedback" && idx > 0 && <Divider aria-hidden />}
                <Row
                  $active={active}
                  onMouseEnter={hover}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(choice);
                  }}
                  title={def ? def.title : feedbackLabel}
                >
                  {def ? (
                    <>
                      <Icon src={def.icon} alt="" aria-hidden />
                      <Label>{def.menu?.label ?? def.title}</Label>
                      <Dim $active={active}>{def.title}</Dim>
                    </>
                  ) : (
                    <>
                      <Icon src="../w98_issues.ico" alt="" aria-hidden />
                      <Label>{feedbackLabel}</Label>
                    </>
                  )}
                </Row>
              </React.Fragment>
            );
          })}
        </Dropdown>
      )}
    </div>
  );
}
