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

function formatStats(stats: VersionEntry["stats"]): string {
  const parts = [
    `${stats.commits} commit${stats.commits === 1 ? "" : "s"}`,
    `${stats.files} file${stats.files === 1 ? "" : "s"}`,
    `+${stats.insertions.toLocaleString()} −${stats.deletions.toLocaleString()}`,
  ];
  return parts.join("  ·  ");
}

const ChangesTreeView = forwardRef<ChangesTreeViewHandle, Props>(function ChangesTreeView(
  { versions, showFrame = true },
  ref
) {
  const [filter, setFilter] = useState<EraFilter>("all");

  useImperativeHandle(ref, () => ({
    filterAll: () => setFilter("all"),
    filterHandmade: () => setFilter("handmade"),
    filterChatgpt: () => setFilter("chatgpt"),
    filterCodex: () => setFilter("codex"),
    filterClaude: () => setFilter("claude"),
  }));

  const shown = useMemo(
    () => (filter === "all" ? versions : versions.filter((entry) => entry.era === filter)),
    [versions, filter]
  );

  const content = (
    <div style={{ overflow: "auto", padding: 2, display: "flex", flexDirection: "column", gap: 8 }}>
      {filter !== "all" && (
        <div style={{ fontSize: 11 }}>
          Showing {ERA_META[filter].label} versions.{" "}
          <button
            type="button"
            onClick={() => setFilter("all")}
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
        const hasStats =
          entry.stats.commits > 0 ||
          entry.stats.files > 0 ||
          entry.stats.insertions > 0 ||
          entry.stats.deletions > 0;
        return (
          <div
            key={entry.version}
            style={{ border: "2px solid rgba(0,0,0,0.35)", padding: 6, background: "rgba(255,255,255,0.35)" }}
          >
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
              <strong style={{ fontSize: 13 }}>v{entry.version}</strong>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 2,
                  background: era.tint,
                  color: era.ink,
                  border: `1px solid ${era.ink}`,
                }}
              >
                {era.icon} {era.label}
              </span>
              <span style={{ fontSize: 10, color: "#444" }} title={entry.date}>
                {entry.date ? formatRelativeCompact(`${entry.date}T00:00:00Z`) : ""}
              </span>
            </div>

            {entry.summary && <div style={{ fontSize: 12, marginTop: 3 }}>{entry.summary}</div>}

            {hasStats && (
              <div style={{ fontSize: 10, color: "#333", marginTop: 3 }}>{formatStats(entry.stats)}</div>
            )}

            {entry.changes.length > 0 && (
              <ul style={{ margin: "5px 0 0", paddingLeft: 16, fontSize: 11, lineHeight: 1.4 }}>
                {entry.changes.map((line, idx) => (
                  <li key={`${entry.version}:change:${idx}`}>{line}</li>
                ))}
              </ul>
            )}

            {entry.issueRefs.length > 0 && (
              <div style={{ fontSize: 10, color: "#333", marginTop: 5 }}>
                <div style={{ fontWeight: "bold" }}>
                  {entry.issueRefs.every((issue) => issue.closed) ? "Complaints closed" : "Complaints touched"}
                </div>
                {entry.issueRefs.map((issue) => (
                  <div key={`${entry.version}:issue:${issue.number}`} style={{ paddingLeft: 6 }}>
                    {issue.closed ? "✓" : "•"} #{issue.number} {issue.title}
                    {issue.closedByPr && (
                      <span style={{ color: "#555" }}> · PR #{issue.closedByPr.number}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
