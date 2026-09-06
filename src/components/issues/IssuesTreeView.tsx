"use client";

import React, {
    forwardRef,
    useImperativeHandle,
    useMemo,
    useState,
} from "react";
import { GroupBox, TreeLeaf } from "react95";
import { TreeView } from "@/components/issues/React95TreeViewPatched";
import useImagePreview from "@/components/common/useImagePreview";
import { renderSearchPrompt, SearchPlaybackText } from "@/components/common/SearchPlayback";

import issuesRaw from "@/data/issues.json";
import { stripImagesAndCollect } from "@/lib/imageRefs";
import {
    parseSearchEntryLine,
    type ParsedSearchLine,
    type SearchEntryLine,
} from "@/lib/searchPlayback";
import { formatRelativeCompact, replaceIsoDateTimesWithRelative } from "@/lib/relativeTime";

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
    stateReason?: string;
    body?: string;
    comments?: IssueComment[];
};

function safeSnippet(text: string, max = 2800) {
    const t = (text ?? "").trim();
    if (!t) return "(empty)";
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function parseTime(s?: string): number {
    if (!s) return Number.POSITIVE_INFINITY;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

type SearchPlaybackLineProps = {
    entries: SearchEntryLine[];
    reserveBodyIconSpace: boolean;
    showBodyIcon: boolean;
};

// Thin wrapper: keeps the issue-tree line/gutter markup; the recorded-rate
// typing animation itself lives in the shared <SearchPlaybackText />.
function SearchPlaybackLine({
    entries,
    reserveBodyIconSpace,
    showBodyIcon,
}: SearchPlaybackLineProps): React.ReactNode {
    return (
        <span className={`search-line${reserveBodyIconSpace ? " search-line-with-gutter" : ""}`}>
            {reserveBodyIconSpace ? (
                <span className="body-inline-icon-slot" aria-hidden>
                    {showBodyIcon ? <span className="body-inline-icon">📝</span> : null}
                </span>
            ) : null}
            <span className="search-line-text">
                <SearchPlaybackText entries={entries} />
            </span>
        </span>
    );
}

function renderSearchAwareLine(
    line: string,
    key: string,
    onOpenImage: (url: string) => void,
    showBodyIcon = false,
    reserveBodyIconSpace = false
): React.ReactNode {
    const extracted = stripImagesAndCollect(line);
    const parsed = parseSearchEntryLine(extracted.text);
    const content = !parsed ? (
        replaceIsoDateTimesWithRelative(extracted.text) || "\u00a0"
    ) : renderSearchPrompt(parsed.entry, parsed.when);

    return (
        <span
            key={key}
            className={`search-line${reserveBodyIconSpace ? " search-line-with-gutter" : ""}`}
        >
            {reserveBodyIconSpace ? (
                <span className="body-inline-icon-slot" aria-hidden>
                    {showBodyIcon ? <span className="body-inline-icon">📝</span> : null}
                </span>
            ) : null}
            <span className="search-line-text">
                {content}
                {extracted.images.map((url, idx) => (
                    <span
                        key={`${key}:img:${idx}`}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onOpenImage(url);
                        }}
                        title={url}
                        aria-label="Open image preview"
                        style={{
                            display: "inline-block",
                            marginLeft: 4,
                            cursor: "pointer",
                            lineHeight: 1,
                            userSelect: "none",
                        }}
                    >
                        🖼️
                    </span>
                ))}
            </span>
        </span>
    );
}

function renderSearchAwareLines(
    text: string,
    keyPrefix: string,
    onOpenImage: (url: string) => void,
    reserveBodyIconSpace = false
): React.ReactNode[] {
    const lines = text.split("\n");
    const parsedSearchLines: ParsedSearchLine[] = lines
        .map((line, idx) => ({ idx, parsed: parseSearchEntryLine(stripImagesAndCollect(line).text) }))
        .filter((x): x is ParsedSearchLine => !!x.parsed);

    if (parsedSearchLines.length < 2) {
        return lines.map((line, idx) =>
            renderSearchAwareLine(line, `${keyPrefix}:${idx}`, onOpenImage, false, reserveBodyIconSpace)
        );
    }

    const out: React.ReactNode[] = [];
    let playbackInserted = false;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const parsed = parseSearchEntryLine(stripImagesAndCollect(line).text);
        if (parsed) {
            if (!playbackInserted) {
                out.push(
                    <SearchPlaybackLine
                        key={`${keyPrefix}:playback`}
                        entries={parsedSearchLines.map((x) => x.parsed)}
                        reserveBodyIconSpace={reserveBodyIconSpace}
                        showBodyIcon={false}
                    />
                );
                playbackInserted = true;
            }
            continue;
        }
        out.push(renderSearchAwareLine(line, `${keyPrefix}:${idx}`, onOpenImage, false, reserveBodyIconSpace));
    }
    return out;
}

function renderBodyLines(text: string, keyPrefix: string, onOpenImage: (url: string) => void): React.ReactNode[] {
    const lines = text.split("\n");
    const parsedSearchLines: ParsedSearchLine[] = lines
        .map((line, idx) => ({ idx, parsed: parseSearchEntryLine(stripImagesAndCollect(line).text) }))
        .filter((x): x is ParsedSearchLine => !!x.parsed);

    if (parsedSearchLines.length < 2) {
        return lines.map((line, idx) =>
            renderSearchAwareLine(line, `${keyPrefix}:${idx}`, onOpenImage, idx === 0, true)
        );
    }

    const out: React.ReactNode[] = [];
    let playbackInserted = false;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const parsed = parseSearchEntryLine(stripImagesAndCollect(line).text);
        if (parsed) {
            if (!playbackInserted) {
                out.push(
                    <SearchPlaybackLine
                        key={`${keyPrefix}:playback`}
                        entries={parsedSearchLines.map((x) => x.parsed)}
                        reserveBodyIconSpace
                        showBodyIcon={idx === 0}
                    />
                );
                playbackInserted = true;
            }
            continue;
        }
        out.push(renderSearchAwareLine(line, `${keyPrefix}:${idx}`, onOpenImage, idx === 0, true));
    }
    return out;
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

            const number = typeof x.number === "number" && Number.isFinite(x.number) ? x.number : undefined;

            const state = x.state === "CLOSED" ? "CLOSED" : "OPEN"; // default OPEN

            const stateReason = typeof x.stateReason === "string" ? x.stateReason : "";

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
                            ? { login: typeof (c.author as { login?: string }).login === "string" ? (c.author as { login?: string }).login : undefined }
                            : undefined,
                }));

            return { number, title, state, stateReason, body, comments };
        });
}

function buildIssuesTree(issues: Issue[], onOpenImage: (url: string) => void): TreeLeaf<string>[] {
    const open = issues.filter((i) => i.state === "OPEN");
    const closed = issues.filter((i) => i.state === "CLOSED");

    const issueNode = (issue: Issue, idx: number): TreeLeaf<string> => {
        const n = issue.number ?? idx + 1;
        const issueId = `issue:${issue.state}:${n}`;

        return {
            id: issueId,
            label: `#${n} ${issue.title}`,
            items: (() => {
                const nodes: TreeLeaf<string>[] = [];

                // 1) Body/description node only if there is content
                const bodyText = (issue.body ?? "").trim();
                if (bodyText) {
                    nodes.push({
                        id: `${issueId}:body`,
                        label: (
                            <span className="tree-label">
                                {renderBodyLines(safeSnippet(bodyText), `${issueId}:body`, onOpenImage)}
                            </span>
                        ) as unknown as string,
                    });
                }

                const reasonText = (issue.stateReason ?? "").trim();
                if (reasonText) {
                    nodes.push({
                        id: `${issueId}:stateReason`,
                        label: reasonText,
                        icon: <>ℹ️</>,
                    });
                }

                // Normalize/sort comments
                const comments = (issue.comments ?? [])
                    .slice()
                    .filter((c) => (c.body ?? "").trim() || c.createdAt || c.author?.login) // optional: drop fully-empty shells
                    .sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt));

                // Helper to format a comment label consistently
                const formatCommentLabel = (c: IssueComment) => {
                    const who = c.author?.login ?? "unknown";
                    const when = c.createdAt ? formatRelativeCompact(c.createdAt) : "unknown";
                    const text = (c.body ?? "").trim() || "(empty)";
                    return (
                        <span className="tree-label">
                            <span className="search-line search-line-with-gutter">
                                <span className="body-inline-icon-slot" aria-hidden>
                                    <span className="body-inline-icon">💬</span>
                                </span>
                                <span className="search-line-text">{`${who} [${when}]`}</span>
                            </span>
                            {renderSearchAwareLines(text, `${who}:${when}`, onOpenImage, true)}
                        </span>
                    ) as unknown as string;
                };

                // 2) No comments node if there are none
                if (comments.length === 1) {
                    const c = comments[0];

                    nodes.push({
                        id: `${issueId}:comment:0:${c.id ?? "noid"}`,
                        icon: <>💬</>,
                        label: "comment",
                        items: [
                            {
                                id: `${issueId}:comment:0:${c.id ?? "noid"}:detail`,
                                label: formatCommentLabel(c),
                            },
                        ],
                    });
                }
                else if (comments.length > 1) {
                    nodes.push({
                        id: `${issueId}:comments`,
                        label: "comments",
                        icon: <>💬</>,
                        items: comments.map((c, cIdx) => ({
                            id: `${issueId}:comment:${cIdx}:${c.id ?? "noid"}`,
                            label: formatCommentLabel(c),
                        })),
                    });
                }


                return nodes;
            })(),

        };
    };

    return [
        {
            id: "issues:open",
            label: `[${open.length}] OPEN`,
            icon: <>⚠️</>,
            items: open.map(issueNode),
        },
        {
            id: "issues:closed",
            label: `[${closed.length}] CLOSED`,
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
    onModalOpenChange?: (open: boolean) => void;
    modalScale?: number;
    modalForceButtonOnly?: boolean;
    modalButtonOnlyWidth?: number;
    modalFakePreviewOnly?: boolean;
    openImagesInNewTab?: boolean;
    modalHideTitleBar?: boolean;
    initialSelected?: string;
    initialExpanded?: string[];
};

const IssuesTreeView = forwardRef<IssuesTreeViewHandle, Props>(
    function IssuesTreeView(
        {
            showFrame = true,
            onSelectId,
            onModalOpenChange,
            modalScale = 1,
            modalForceButtonOnly = false,
            modalButtonOnlyWidth,
            modalFakePreviewOnly = false,
            openImagesInNewTab = false,
            modalHideTitleBar = false,
            initialSelected = "issues:open",
            initialExpanded = ["issues:open"],
        },
        ref
    ) {
        const issues = useMemo(() => normalizeIssues(issuesRaw as unknown), []);
        const { openImage, previewLayer } = useImagePreview({
            openImagesInNewTab,
            modalScale,
            modalForceButtonOnly,
            modalButtonOnlyWidth,
            modalFakePreviewOnly,
            modalHideTitleBar,
            onOpenChange: onModalOpenChange,
        });
        const tree = useMemo(() => buildIssuesTree(issues, openImage), [issues, openImage]);

        const allIds = useMemo(() => {
            const ids: string[] = [];
            tree.forEach((n) => collectIds(n, ids));
            return ids;
        }, [tree]);

        const openIds = useMemo(() => ["issues:open"], []);
        const closedIds = useMemo(() => ["issues:closed"], []);

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

            .tree-label {
                text-align: left;
                display: block;
            }

            .search-line {
                text-align: left;
                white-space: pre-wrap;
                display: block;
                width: 100%;
            }

            .search-line-with-gutter {
                display: flex;
                align-items: flex-start;
                gap: 0.2em;
            }

            .body-inline-icon-slot {
                width: 1.2em;
                display: inline-flex;
                justify-content: center;
                align-items: flex-start;
                flex: 0 0 1.2em;
            }

            .search-line-text {
                display: block;
                min-width: 0;
                flex: 1 1 auto;
            }

            .body-inline-icon {
                display: inline-flex;
                align-items: flex-start;
                justify-content: center;
                width: 1.1em;
                line-height: 1;
                margin-left: -0.45em;
            }

            li {
                text-align: left;
            }
        `;

        type PatchedTreeViewProps = {
            tree?: TreeLeaf<string>[];
            selected?: string[];
            expanded?: string[];
            onNodeSelect?: (event: unknown, idOrIds: unknown) => void;
            onNodeToggle?: (event: unknown, ids: string[]) => void;
        };
        const PatchedTreeView = TreeView as unknown as React.ComponentType<PatchedTreeViewProps>;

        const content = (
            <div style={{ overflow: "auto", padding: 2 }}>
                <TreeContainer>
                    <PatchedTreeView
                        tree={tree}
                        selected={selected}
                        expanded={expanded}
                        onNodeSelect={(_event: unknown, idOrIds: unknown) => {
                            const next = normalizeSelected(idOrIds, selected[0] ?? initialSelected);
                            setSelected(next);
                            onSelectId?.(next[0]);
                        }}
                        onNodeToggle={(_event: unknown, ids: string[]) => setExpanded(uniq(ids))}
                    />
                </TreeContainer>
            </div>
        );

        if (!showFrame) {
            return (
                <>
                    {content}
                    {previewLayer}
                </>
            );
        }

        return (
            <>
                <GroupBox label="Issues Browser" style={{ width: "100%" }}>
                    {content}
                </GroupBox>
                {previewLayer}
            </>
        );
    }
);

export default IssuesTreeView;
