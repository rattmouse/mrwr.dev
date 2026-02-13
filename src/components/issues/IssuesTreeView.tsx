"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useState,
} from "react";
import { GroupBox, TreeLeaf } from "react95";
import { TreeView } from "@/components/issues/React95TreeViewPatched";
import LowResImageModal from "@/components/common/LowResImageModal";

import issuesRaw from "@/data/issues.json";
import { stripImagesAndCollect } from "@/lib/imageRefs";
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

const SEARCH_PROMPT_HOST = "mrwr.dev";

function stripDuplicateSearchPrefix(entry: string): string {
    const stripped = entry.replace(
        /^\s*(?:from\s+search\s+bar(?:\s+logging)?|search(?:ed)?)\s*:?\s*/i,
        ""
    );
    return stripped || entry;
}

type SearchEntryLine = {
    entry: string;
    when: string;
    atMs: number;
};

type ParsedSearchLine = {
    idx: number;
    parsed: SearchEntryLine;
};

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
    const spanMs = Math.max(0, last - first);
    return spanMs / 1000;
}

function renderSearchPrompt(entry: string, when: string, spanSeconds: number): React.ReactNode {
    return (
        <>
            <span style={{ color: "#ffe066", textShadow: "0 0 1px #000, 0 0 2px #000" }}>{`@[${when}] `}</span>
            <span style={{ color: "#0057d8" }}>os</span>
            {"@"}
            <span style={{ color: "#a00055" }}>{SEARCH_PROMPT_HOST}</span>
            {`: ${entry}`}
        </>
    );
}

type SearchPlaybackLineProps = {
    entries: SearchEntryLine[];
    reserveBodyIconSpace: boolean;
    showBodyIcon: boolean;
};

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

function SearchPlaybackLine({
    entries,
    reserveBodyIconSpace,
    showBodyIcon,
}: SearchPlaybackLineProps): React.ReactNode {
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

        const holdMs = 1200;
        return {
            segments,
            totalMs: cursor + holdMs,
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
        return (
            <span className={`search-line${reserveBodyIconSpace ? " search-line-with-gutter" : ""}`}>
                {reserveBodyIconSpace ? (
                    <span className="body-inline-icon-slot" aria-hidden>
                        {showBodyIcon ? <span className="body-inline-icon">📝</span> : null}
                    </span>
                ) : null}
                <span className="search-line-text">{renderSearchPrompt(single?.entry ?? "", single?.when ?? "unknown", spanSeconds)}</span>
            </span>
        );
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
        if (totalOps <= 0) {
            currentText = currentSegment.to;
        }
        else {
            const localMs = elapsedMs - currentSegment.start;
            const stepMs = currentSegment.duration / totalOps;
            const step = Math.max(0, Math.min(totalOps, Math.floor(localMs / stepMs)));
            currentText = textAfterTransitionStep(currentSegment.from, currentSegment.to, step);
        }
    }

    return (
        <span className={`search-line${reserveBodyIconSpace ? " search-line-with-gutter" : ""}`}>
            {reserveBodyIconSpace ? (
                <span className="body-inline-icon-slot" aria-hidden>
                    {showBodyIcon ? <span className="body-inline-icon">📝</span> : null}
                </span>
            ) : null}
            <span className="search-line-text">{renderSearchPrompt(currentText, currentWhen, spanSeconds)}</span>
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
    ) : renderSearchPrompt(parsed.entry, parsed.when, 0);

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
                    <button
                        key={`${key}:img:${idx}`}
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
                            ? { login: typeof (c.author as any).login === "string" ? (c.author as any).login : undefined }
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
        const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
        const tree = useMemo(() => buildIssuesTree(issues, setPreviewImageUrl), [issues]);

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
                    <LowResImageModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
                </>
            );
        }

        return (
            <>
                <GroupBox label="Issues Browser" style={{ width: "100%" }}>
                    {content}
                </GroupBox>
                <LowResImageModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
            </>
        );
    }
);

export default IssuesTreeView;
