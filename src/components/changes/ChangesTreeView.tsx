"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { GroupBox } from "react95";
import type { ChangeEra, VersionEntry } from "@/lib/versions.types";
import { formatRelativeCompact } from "@/lib/relativeTime";

export type ChangesTreeViewHandle = {
  filterAll: () => void;
  filterHandmade: () => void;
  filterChatgpt: () => void;
  filterCodex: () => void;
  filterClaude: () => void;
};

type Props = {
  versions: VersionEntry[];
  showFrame?: boolean;
};

type EraFilter = ChangeEra | "all";

const ERA_META: Record<ChangeEra, { label: string; icon: string; tint: string; ink: string }> = {
  handmade: { label: "Handmade", icon: "✋", tint: "#d7f0e4", ink: "#0b6b47" },
  chatgpt: { label: "Chat GPT", icon: "💬", tint: "#d9efe9", ink: "#0a7d5a" },
  codex: { label: "Codex", icon: "⚙️", tint: "#e6ddfa", ink: "#5b34b0" },
  claude: { label: "Claude", icon: "🧹", tint: "#f6e2d2", ink: "#b8541a" },
};

const MUTED = "#555";

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function formatStats(stats: VersionEntry["stats"]): string {
  const parts = [
    plural(stats.commits, "commit"),
    plural(stats.files, "file"),
    `+${stats.insertions.toLocaleString()} −${stats.deletions.toLocaleString()}`,
  ];
  return parts.join(" · ");
}

// A reset elsewhere strips list markers, and without them one change runs
// straight into the next — so each row draws its own marker and hangs its
// wrapped lines off it.
function Row({ marker, children }: { marker: React.ReactNode; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
      <span aria-hidden style={{ flex: "0 0 8px", textAlign: "center" }}>
        {marker}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </li>
  );
}

const ChangesTreeView = forwardRef<ChangesTreeViewHandle, Props>(function ChangesTreeView(
  { versions, showFrame = true },
  ref
) {
  const [filter, setFilter] = useState<EraFilter>("all");
  // Only the newest card starts open; the rest fold down to their header so
  // the whole history fits on one screen.
  const [open, setOpen] = useState<Set<string>>(() => new Set(versions[0] ? [versions[0].version] : []));

  const applyFilter = (next: EraFilter) => {
    setFilter(next);
    const first = next === "all" ? versions[0] : versions.find((entry) => entry.era === next);
    setOpen(new Set(first ? [first.version] : []));
  };

  useImperativeHandle(ref, () => ({
    filterAll: () => applyFilter("all"),
    filterHandmade: () => applyFilter("handmade"),
    filterChatgpt: () => applyFilter("chatgpt"),
    filterCodex: () => applyFilter("codex"),
    filterClaude: () => applyFilter("claude"),
  }));

  const shown = useMemo(
    () => (filter === "all" ? versions : versions.filter((entry) => entry.era === filter)),
    [versions, filter]
  );

  const toggle = (version: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });

  const content = (
    <div style={{ overflow: "auto", padding: 2, display: "flex", flexDirection: "column", gap: 6 }}>
      {filter !== "all" && (
        <div style={{ fontSize: 11 }}>
          Showing {ERA_META[filter].label} versions.{" "}
          <button
            type="button"
            onClick={() => applyFilter("all")}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              color: "#0057d8",
              textDecoration: "underline",
              font: "inherit",
            }}
          >
            show all
          </button>
        </div>
      )}

      {shown.length === 0 && <div style={{ fontSize: 11 }}>No versions in this category.</div>}

      {shown.map((entry) => {
        const era = ERA_META[entry.era];
        const isOpen = open.has(entry.version);
        const hasStats =
          entry.stats.commits > 0 ||
          entry.stats.files > 0 ||
          entry.stats.insertions > 0 ||
          entry.stats.deletions > 0;
        const meta = [
          entry.date ? formatRelativeCompact(`${entry.date}T00:00:00Z`) : "",
          entry.changes.length > 0 ? plural(entry.changes.length, "change") : "",
        ].filter(Boolean);
        const showName = entry.name && entry.name !== entry.version;
        return (
          <section
            key={entry.version}
            style={{ border: "1px solid #808080", background: "#fff", fontSize: 11 }}
          >
            <button
              type="button"
              onClick={() => toggle(entry.version)}
              aria-expanded={isOpen}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                width: "100%",
                padding: "5px 7px",
                border: "none",
                borderBottom: isOpen ? "1px solid #c0c0c0" : "none",
                background: isOpen ? era.tint : "#fff",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <span aria-hidden style={{ flex: "0 0 8px", fontSize: 9, lineHeight: "16px" }}>
                {isOpen ? "▼" : "▶"}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, lineHeight: "16px" }}>
                  <strong>v{entry.version}</strong>
                  {showName && <> — {entry.name}</>}
                </span>
                <span style={{ display: "block", color: MUTED, marginTop: 1 }} title={entry.date}>
                  {meta.join(" · ")}
                </span>
              </span>
              <span
                title={`Built with ${era.label}`}
                style={{
                  flex: "0 0 auto",
                  padding: "0 5px",
                  background: era.tint,
                  color: era.ink,
                  border: `1px solid ${era.ink}`,
                  whiteSpace: "nowrap",
                }}
              >
                {era.icon} {era.label}
              </span>
            </button>

            {isOpen && (
              <div style={{ padding: "6px 8px 8px", lineHeight: 1.4 }}>
                {entry.summary && <div style={{ fontStyle: "italic", color: MUTED }}>{entry.summary}</div>}

                {entry.changes.length > 0 && (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: entry.summary ? "6px 0 0" : 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    {entry.changes.map((line, idx) => (
                      <Row key={`${entry.version}:change:${idx}`} marker="•">
                        {line}
                      </Row>
                    ))}
                  </ul>
                )}

                {entry.issueRefs.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dotted #999" }}>
                    <div style={{ fontWeight: "bold", marginBottom: 3 }}>
                      {entry.issueRefs.every((issue) => issue.closed) ? "Complaints closed" : "Complaints touched"}
                    </div>
                    <ul
                      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}
                    >
                      {entry.issueRefs.map((issue) => (
                        <Row key={`${entry.version}:issue:${issue.number}`} marker={issue.closed ? "✓" : "•"}>
                          <span style={{ color: MUTED }}>#{issue.number}</span> {issue.title}
                          {issue.closedByPr && (
                            <span style={{ color: MUTED }}> · PR #{issue.closedByPr.number}</span>
                          )}
                        </Row>
                      ))}
                    </ul>
                  </div>
                )}

                {hasStats && <div style={{ color: MUTED, marginTop: 8 }}>{formatStats(entry.stats)}</div>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  if (!showFrame) return content;

  return (
    <GroupBox label="Version history" style={{ width: "100%" }}>
      {content}
    </GroupBox>
  );
});

export default ChangesTreeView;
