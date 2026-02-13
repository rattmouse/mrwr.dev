"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { GroupBox, Table, TableBody, TableDataCell, TableHead, TableHeadCell, TableRow } from "react95";
import type { GitChangeEntry, GitChangeIssueRef, GitChangeType } from "@/lib/gitChanges.types";
import { stripImagesAndCollect } from "@/lib/imageRefs";
import LowResImageModal from "@/components/common/LowResImageModal";
import { formatRelativeCompact, replaceIsoDateTimesWithRelative } from "@/lib/relativeTime";

export type ChangesTreeViewHandle = {
  expandAll: () => void;
  collapseAll: () => void;
  expandFeatures: () => void;
  expandFixes: () => void;
  expandDocs: () => void;
  expandOther: () => void;
};

type Props = {
  entries: GitChangeEntry[];
  showFrame?: boolean;
};

type FocusFilter = GitChangeType | "all";

type DailySummary = {
  day: string;
  entries: GitChangeEntry[];
  total: number;
  features: number;
  fixes: number;
  docs: number;
  other: number;
  summary: string;
  issueRefs: GitChangeIssueRef[];
};

function labelForType(type: GitChangeType): string {
  if (type === "fixes") return "Fixed";
  if (type === "features") return "Changed";
  if (type === "docs") return "Documented";
  return "Updated";
}

function trimPunctuation(input: string): string {
  return input.trim().replace(/[.!\s]+$/, "");
}

function buildSingleSummary(entries: GitChangeEntry[]): string {
  const preferred = [...entries].sort((a, b) => {
    const rank = (t: GitChangeType) => (t === "fixes" ? 0 : t === "features" ? 1 : t === "docs" ? 2 : 3);
    return rank(a.type) - rank(b.type);
  });
  const top = preferred.slice(0, 2);
  return top.map((entry) => `${labelForType(entry.type)}: ${trimPunctuation(entry.subject)}`).join(" | ");
}

const SEARCH_PROMPT_HOST = "mrwr.dev";

type SearchEntryLine = {
  entry: string;
  when: string;
  atMs: number;
};

type ParsedSearchLine = {
  idx: number;
  parsed: SearchEntryLine;
};

function stripDuplicateSearchPrefix(entry: string): string {
  const stripped = entry.replace(/^\s*(?:from\s+search\s+bar(?:\s+logging)?|search(?:ed)?)\s*:?\s*/i, "");
  return stripped || entry;
}

function parseSearchEntryLine(line: string): SearchEntryLine | null {
  const match = line.match(/^(.*?)(?:\s*@\s*)(\d{4}-\d{2}-\d{2}T[^ \n]+)\s*$/);
  if (!match) return null;
  const atMs = Date.parse(match[2]);
  return {
    entry: stripDuplicateSearchPrefix(match[1].trimEnd()),
    when: formatRelativeCompact(match[2]),
    atMs: Number.isFinite(atMs) ? atMs : 0,
  };
}

function getSearchSpanSeconds(entries: SearchEntryLine[]): number {
  if (entries.length < 2) return 0;
  const first = entries[0]?.atMs ?? 0;
  const last = entries[entries.length - 1]?.atMs ?? first;
  return Math.max(0, last - first) / 1000;
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function textAfterTransitionStep(from: string, to: string, step: number): string {
  const cpl = commonPrefixLen(from, to);
  const deletes = from.length - cpl;
  const inserts = to.slice(cpl);
  if (step <= deletes) return from.slice(0, from.length - step);
  return from.slice(0, cpl) + inserts.slice(0, step - deletes);
}

function renderSearchPrompt(entry: string, when: string, spanSeconds: number): React.ReactNode {
  const spanLabel = `Δ${spanSeconds.toFixed(1)}s`;
  return (
    <>
      <span style={{ color: "#ffe066", textShadow: "0 0 1px #000, 0 0 2px #000" }}>{`@[${when}] `}</span>
      <span style={{ color: "#61f7ff", textShadow: "0 0 1px #000, 0 0 2px #000" }}>{`[${spanLabel}] `}</span>
      <span style={{ color: "#0057d8" }}>os</span>
      {"@"}
      <span style={{ color: "#a00055" }}>{SEARCH_PROMPT_HOST}</span>
      {`: ${entry}`}
    </>
  );
}

type SearchPlaybackInlineProps = {
  entries: SearchEntryLine[];
};

function SearchPlaybackInline({ entries }: SearchPlaybackInlineProps): React.ReactNode {
  const spanSeconds = useMemo(() => getSearchSpanSeconds(entries), [entries]);
  const timeline = useMemo(() => {
    if (!entries.length) return null;
    if (entries.length === 1) {
      return {
        segments: [],
        totalMs: 1200,
        finalEntry: entries[0],
      };
    }

    const initialDurationMs = 850;
    let cursor = 0;
    const segments = [
      {
        start: cursor,
        duration: initialDurationMs,
        from: "",
        to: entries[0].entry,
        when: entries[0].when,
      },
    ];
    cursor += initialDurationMs;

    for (let i = 1; i < entries.length; i += 1) {
      const prev = entries[i - 1];
      const next = entries[i];
      const deltaMs = Math.max(60, next.atMs - prev.atMs);
      segments.push({
        start: cursor,
        duration: deltaMs,
        from: prev.entry,
        to: next.entry,
        when: next.when,
      });
      cursor += deltaMs;
    }

    return {
      segments,
      totalMs: cursor + 1200,
      finalEntry: entries[entries.length - 1],
    };
  }, [entries]);

  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!timeline) return;
    const startedAt = Date.now();
    const tick = () => setElapsedMs((Date.now() - startedAt) % timeline.totalMs);
    tick();
    const timer = window.setInterval(tick, 33);
    return () => window.clearInterval(timer);
  }, [timeline]);

  if (!timeline || !timeline.segments.length) {
    const single = entries[0];
    return <>{renderSearchPrompt(single?.entry ?? "", single?.when ?? "unknown", spanSeconds)}</>;
  }

  const currentSegment = timeline.segments.find((seg) => elapsedMs >= seg.start && elapsedMs < seg.start + seg.duration);
  const fallback = timeline.finalEntry;
  let currentText = fallback.entry;
  let currentWhen = fallback.when;

  if (currentSegment) {
    currentWhen = currentSegment.when;
    const cpl = commonPrefixLen(currentSegment.from, currentSegment.to);
    const deleteOps = currentSegment.from.length - cpl;
    const insertOps = currentSegment.to.length - cpl;
    const totalOps = deleteOps + insertOps;
    if (totalOps > 0) {
      const localMs = elapsedMs - currentSegment.start;
      const stepMs = currentSegment.duration / totalOps;
      const step = Math.max(0, Math.min(totalOps, Math.floor(localMs / stepMs)));
      currentText = textAfterTransitionStep(currentSegment.from, currentSegment.to, step);
    } else {
      currentText = currentSegment.to;
    }
  }

  return <>{renderSearchPrompt(currentText, currentWhen, spanSeconds)}</>;
}

function renderIssueBody(
  text: string,
  keyPrefix: string,
  onOpenImage: (url: string) => void
): React.ReactNode {
  const lines = text.split("\n");
  const parsedSearchLines: ParsedSearchLine[] = lines
    .map((line, idx) => ({ idx, parsed: parseSearchEntryLine(stripImagesAndCollect(line).text) }))
    .filter((x): x is ParsedSearchLine => !!x.parsed);

  if (!text.trim()) return "(no description)";
  if (parsedSearchLines.length < 2) {
    return lines.map((line, idx) => {
      const extracted = stripImagesAndCollect(line);
      const parsed = parseSearchEntryLine(extracted.text);
      const content = parsed
        ? renderSearchPrompt(parsed.entry, parsed.when, 0)
        : replaceIsoDateTimesWithRelative(extracted.text) || "\u00a0";
      return (
        <div key={`${keyPrefix}:${idx}`}>
          {content}
          {extracted.images.map((url, imageIdx) => (
            <button
              key={`${keyPrefix}:${idx}:img:${imageIdx}`}
              type="button"
              onClick={() => onOpenImage(url)}
              title={url}
              aria-label="Open image preview"
              style={{
                marginLeft: 4,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                color: "inherit",
              }}
            >
              🖼️
            </button>
          ))}
        </div>
      );
    });
  }

  const out: React.ReactNode[] = [];
  let playbackInserted = false;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const extracted = stripImagesAndCollect(line);
    const parsed = parseSearchEntryLine(extracted.text);
    if (parsed) {
      if (!playbackInserted) {
        out.push(
          <div key={`${keyPrefix}:playback`}>
            <SearchPlaybackInline entries={parsedSearchLines.map((x) => x.parsed)} />
          </div>
        );
        playbackInserted = true;
      }
      continue;
    }

    out.push(
      <div key={`${keyPrefix}:${idx}`}>
        {replaceIsoDateTimesWithRelative(extracted.text) || "\u00a0"}
        {extracted.images.map((url, imageIdx) => (
          <button
            key={`${keyPrefix}:${idx}:img:${imageIdx}`}
            type="button"
            onClick={() => onOpenImage(url)}
            title={url}
            aria-label="Open image preview"
            style={{
              marginLeft: 4,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              color: "inherit",
            }}
          >
            🖼️
          </button>
        ))}
      </div>
    );
  }
  return out;
}

function groupDaily(entries: GitChangeEntry[]): DailySummary[] {
  const byDay = new Map<string, GitChangeEntry[]>();
  for (const entry of entries) {
    const day = entry.date.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, dayEntries]) => {
      const features = dayEntries.filter((e) => e.type === "features").length;
      const fixes = dayEntries.filter((e) => e.type === "fixes").length;
      const docs = dayEntries.filter((e) => e.type === "docs").length;
      const other = dayEntries.filter((e) => e.type === "other").length;
      const issueRefs = Array.from(
        new Map(dayEntries.flatMap((e) => e.issueRefs).map((issue) => [issue.number, issue])).values()
      );
      return {
        day,
        entries: dayEntries,
        total: dayEntries.length,
        features,
        fixes,
        docs,
        other,
        summary: buildSingleSummary(dayEntries),
        issueRefs,
      };
    });
}

const ChangesTreeView = forwardRef<ChangesTreeViewHandle, Props>(function ChangesTreeView(
  { entries, showFrame = true },
  ref
) {
  const [focus, setFocus] = useState<FocusFilter>("all");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    expandAll: () => setFocus("all"),
    collapseAll: () => setFocus("all"),
    expandFeatures: () => setFocus("features"),
    expandFixes: () => setFocus("fixes"),
    expandDocs: () => setFocus("docs"),
    expandOther: () => setFocus("other"),
  }));

  const filteredEntries = useMemo(
    () => (focus === "all" ? entries : entries.filter((entry) => entry.type === focus)),
    [entries, focus]
  );

  const rows = useMemo(() => groupDaily(filteredEntries), [filteredEntries]);

  const content = (
    <div style={{ overflow: "auto", padding: 2 }}>
      <Table style={{ width: "100%", tableLayout: "fixed" }}>
        <TableHead>
          <TableRow>
            <TableHeadCell style={{ width: 88 }}>Day</TableHeadCell>
            <TableHeadCell>Summary</TableHeadCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            return (
              <TableRow key={row.day}>
                <TableDataCell style={{ verticalAlign: "top" }} title={row.day}>
                  {formatRelativeCompact(`${row.day}T00:00:00Z`)}
                </TableDataCell>
                <TableDataCell style={{ verticalAlign: "top" }}>
                  <div>{replaceIsoDateTimesWithRelative(row.summary)}</div>
                  {row.issueRefs.map((issue) => {
                    return (
                      <div key={issue.number} style={{ marginTop: 2 }}>
                        <div>{`#${issue.number} ${issue.title}:`}</div>
                        <div style={{ paddingLeft: 12 }}>
                          {renderIssueBody(issue.body, `issue:${issue.number}`, setPreviewImageUrl)}
                        </div>
                      </div>
                    );
                  })}
                </TableDataCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  if (!showFrame) {
    return (
      <>
        {content}
        <LowResImageModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      </>
    );
  }

  return (
    <>
      <GroupBox label="Updates" style={{ width: "100%" }}>
        {content}
      </GroupBox>
      <LowResImageModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
    </>
  );
});

export default ChangesTreeView;
