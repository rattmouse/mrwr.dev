"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { GroupBox, TreeLeaf } from "react95";
import { TreeView } from "@/components/issues/React95TreeViewPatched";
import type { GitChangeEntry, GitChangeType } from "@/lib/gitChanges.types";
import styled from "styled-components";

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
  initialSelected?: string;
  initialExpanded?: string[];
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function normalizeSelected(input: unknown, fallback: string): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) {
    const last = [...input].filter((x): x is string => typeof x === "string").pop();
    return [last ?? fallback];
  }
  return [fallback];
}

function collectIds(node: TreeLeaf<string>, out: string[]) {
  out.push(node.id);
  node.items?.forEach((child) => collectIds(child, out));
}

const TYPE_ORDER: GitChangeType[] = ["features", "fixes", "docs", "other"];

const TYPE_META: Record<GitChangeType, { label: string; icon: React.ReactNode }> = {
  features: { label: "FEATURES", icon: <>✨</> },
  fixes: { label: "FIXES", icon: <>🛠️</> },
  docs: { label: "DOCS", icon: <>📝</> },
  other: { label: "OTHER", icon: <>📦</> },
};

function buildTree(entries: GitChangeEntry[]): TreeLeaf<string>[] {
  return TYPE_ORDER.map((type) => {
    const sectionEntries = entries.filter((entry) => entry.type === type);
    const meta = TYPE_META[type];

    return {
      id: `changes:${type}`,
      label: `[${sectionEntries.length}] ${meta.label}`,
      icon: meta.icon,
      items: sectionEntries.map((entry) => {
        const baseId = `changes:${type}:${entry.hash}`;
        return {
          id: baseId,
          label: `${entry.date}  ${entry.subject}`,
          icon: <>•</>,
          items: [
            { id: `${baseId}:author`, label: `author: ${entry.author}`, icon: <>👤</> },
            { id: `${baseId}:hash`, label: `hash: ${entry.shortHash}`, icon: <>#</> },
          ],
        };
      }),
    };
  });
}

const ChangesTreeView = forwardRef<ChangesTreeViewHandle, Props>(function ChangesTreeView(
  {
    entries,
    showFrame = true,
    initialSelected = "changes:features",
    initialExpanded = ["changes:features"],
  },
  ref
) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const allIds = useMemo(() => {
    const ids: string[] = [];
    tree.forEach((n) => collectIds(n, ids));
    return ids;
  }, [tree]);

  const [selected, setSelected] = useState<string[]>([initialSelected]);
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);

  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => setExpanded(allIds),
      collapseAll: () => setExpanded([]),
      expandFeatures: () => setExpanded(["changes:features"]),
      expandFixes: () => setExpanded(["changes:fixes"]),
      expandDocs: () => setExpanded(["changes:docs"]),
      expandOther: () => setExpanded(["changes:other"]),
    }),
    [allIds]
  );

  const TreeContainer = styled.div`
    text-align: left;

    li {
      text-align: left;
    }
  `;

  const PatchedTreeView = TreeView as any;

  const content = (
    <div style={{ overflow: "auto", padding: 2 }}>
      <TreeContainer>
        <PatchedTreeView
          tree={tree}
          selected={selected as any}
          expanded={expanded}
          onNodeSelect={(_event: unknown, idOrIds: unknown) => {
            const next = normalizeSelected(idOrIds, selected[0] ?? initialSelected);
            setSelected(next);
          }}
          onNodeToggle={(_event: unknown, ids: string[]) => setExpanded(uniq(ids))}
        />
      </TreeContainer>
    </div>
  );

  if (!showFrame) return content;

  return (
    <GroupBox label="Changes Browser" style={{ width: "100%" }}>
      {content}
    </GroupBox>
  );
});

export default ChangesTreeView;
