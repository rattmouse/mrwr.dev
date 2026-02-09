"use client";

import React, {
    forwardRef,
    useImperativeHandle,
    useMemo,
    useState,
} from "react";
import { GroupBox, TreeLeaf, TreeView } from "react95";

import issuesRaw from "@/data/issues.json";

import styled from "styled-components";

type IssueState = "OPEN" | "CLOSED";

type IssueComment = {
    id?: string;
    body?: string;
    createdAt?: string;
    author?: { login?: string };
};

type Issue = {
    number?: number;
    title: string;
    state: IssueState;
    body?: string;
    comments?: IssueComment[];
};

function safeSnippet(text: string, max = 80) {
    const t = (text ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "(empty)";
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function parseTime(s?: string): number {
    if (!s) return Number.POSITIVE_INFINITY;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function collectIds(node: TreeLeaf<string>, out: string[]) {
    out.push(node.id);
    node.items?.forEach((child) => collectIds(child, out));
}

function uniq<T>(arr: T[]) {
    return Array.from(new Set(arr));
}

// Normalize whatever TreeView gives us into a *single* selected id (as array)
function normalizeSelected(input: unknown, fallback: string): string[] {
    if (typeof input === "string") return [input];
    if (Array.isArray(input)) {
        const last = [...input].filter((x): x is string => typeof x === "string").pop();
        return [last ?? fallback];
    }
    return [fallback];
}

function normalizeIssues(raw: unknown): Issue[] {
    if (!Array.isArray(raw)) return [];

    return raw
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x, idx) => {
            const title =
                typeof x.title === "string" && x.title.trim() ? x.title : `(untitled #${idx + 1})`;

            const state = x.state === "CLOSED" ? "CLOSED" : "OPEN"; // default OPEN

            const body = typeof x.body === "string" ? x.body : "";

            const commentsRaw = Array.isArray(x.comments) ? x.comments : [];
            const comments: IssueComment[] = commentsRaw
                .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
                .map((c) => ({
                    id: typeof c.id === "string" ? c.id : undefined,
                    body: typeof c.body === "string" ? c.body : undefined,
                    createdAt: typeof c.createdAt === "string" ? c.createdAt : undefined,
                    author:
                        c.author && typeof c.author === "object"
                            ? { login: typeof (c.author as any).login === "string" ? (c.author as any).login : undefined }
                            : undefined,
                }));

            return { title, state, body, comments };
        });
}

function buildIssuesTree(issues: Issue[]): TreeLeaf<string>[] {
    const open = issues.filter((i) => i.state === "OPEN");
    const closed = issues.filter((i) => i.state === "CLOSED");

    const issueNode = (issue: Issue, idx: number): TreeLeaf<string> => {
        const n = issue.number ?? idx + 1;
        const issueId = `issue:${issue.state}:${n}`;

        const bodyText = issue.body ?? "";
        const comments = (issue.comments ?? [])
            .slice()
            .sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt));

        return {
            id: issueId,
            label: `#${n} ${issue.title}`,

            items: [
                {
                    id: `${issueId}:body`,
                    label: `${safeSnippet(bodyText)}`,
                    icon: <>📝</>,
                },
                {
                    id: `${issueId}:comments`,
                    label: `comments (${comments.length})`,
                    icon: <>💬</>,
                    items: comments.map((c, cIdx) => {
                        const who = c.author?.login ?? "unknown";
                        const when = c.createdAt ? new Date(c.createdAt).toLocaleString() : "unknown time";
                        const body = (c.body ?? "").trim() || "(empty)";

                        const commentId = `${issueId}:comment:${cIdx}:${c.id ?? "noid"}`;

                        return {
                            id: commentId,
                            icon: <>💬</>,
                            label: `${who}@${when}:\n${body}`,
                        } as TreeLeaf<string>;
                    }),

                },
            ],
        };
    };

    return [
        {
            id: "issues:open",
            label: `[${open.length}]`,
            icon: <>⚠️</>,
            items: open.map(issueNode),
        },
        {
            id: "issues:closed",
            label: `[${closed.length}]`,
            icon: <>✅</>,
            items: closed.map(issueNode),
        },
    ];
}

export type IssuesTreeViewHandle = {
    expandAll: () => void;
    collapseAll: () => void;
    expandOpen: () => void;
    expandClosed: () => void;
    getSelected: () => string;
    setSelected: (id: string) => void;
};

type Props = {
    showFrame?: boolean;
    onSelectId?: (id: string) => void;
    initialSelected?: string;
    initialExpanded?: string[];
};

const IssuesTreeView = forwardRef<IssuesTreeViewHandle, Props>(
    function IssuesTreeView(
        {
            showFrame = true,
            onSelectId,
            initialSelected = "issues:open",
            initialExpanded = ["issues:open"],
        },
        ref
    ) {
        const issues = useMemo(() => normalizeIssues(issuesRaw as unknown), []);
        const tree = useMemo(() => buildIssuesTree(issues), [issues]);

        const allIds = useMemo(() => {
            const ids: string[] = [];
            tree.forEach((n) => collectIds(n, ids));
            return ids;
        }, [tree]);

        const openIds = useMemo(() => {
            const openNode = tree.find((n) => n.id === "issues:open");
            if (!openNode) return ["issues:open"];
            const ids: string[] = [];
            collectIds(openNode, ids);
            return ids;
        }, [tree]);

        const closedIds = useMemo(() => {
            const closedNode = tree.find((n) => n.id === "issues:closed");
            if (!closedNode) return ["issues:closed"];
            const ids: string[] = [];
            collectIds(closedNode, ids);
            return ids;
        }, [tree]);

        const [selected, setSelected] = useState<string[]>([initialSelected]);
        const [expanded, setExpanded] = useState<string[]>(initialExpanded);

        useImperativeHandle(
            ref,
            () => ({
                expandAll: () => setExpanded(allIds),
                collapseAll: () => setExpanded([]),
                expandOpen: () => setExpanded(openIds),
                expandClosed: () => setExpanded(closedIds),
                getSelected: () => selected[0] ?? initialSelected,
                setSelected: (id: string) => setSelected([id]),
            }),
            [allIds, openIds, closedIds, selected, initialSelected]
        );


        const TreeContainer = styled.div`
            /* left justify */
            text-align: left;

            /* Most reliable: force label spans to respect \n */
            span {
                text-align: left;
                white-space: pre-line;
                display: block;
            }

            /* Some builds wrap labels differently; this helps too */
            li {
                text-align: left;
            }
            `;

        const content = (
            <div style={{ overflow: "auto", padding: 2 }}>
                <TreeContainer>
                    <TreeView
                        tree={tree}
                        selected={selected as any}
                        expanded={expanded}
                        onNodeSelect={(_, idOrIds) => {
                            const next = normalizeSelected(idOrIds, selected[0] ?? initialSelected);
                            setSelected(next);
                            onSelectId?.(next[0]);
                        }}
                        onNodeToggle={(_, ids) => setExpanded(uniq(ids))}
                    />
                </TreeContainer>
            </div>
        );

        if (!showFrame) return content;

        return (
            <GroupBox label="Issues Browser" style={{ width: "100%" }}>
                {content}
            </GroupBox>
        );
    }
);

export default IssuesTreeView;
