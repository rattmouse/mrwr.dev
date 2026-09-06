import type { ChangeEra, ClosingPrRef, VersionEntry, VersionIssueRef } from "@/lib/versions.types";
import versionData from "@/data/versions.json";
import issues from "@/data/issues.json";

type RawVersion = {
  version?: string;
  era?: string;
  name?: string;
  date?: string;
  summary?: string;
  stats?: {
    commits?: number;
    files?: number;
    insertions?: number;
    deletions?: number;
  };
  changes?: string[];
  issues?: number[];
};

type IssueItem = {
  number?: number;
  state?: string;
  title?: string;
  closedByPr?: {
    number?: number;
    title?: string;
    url?: string;
  };
};

function resolveClosingPr(raw: IssueItem["closedByPr"]): ClosingPrRef | undefined {
  if (!raw || typeof raw.number !== "number") return undefined;
  return {
    number: raw.number,
    title: raw.title?.trim() || `PR #${raw.number}`,
    url: raw.url?.trim() ?? "",
  } satisfies ClosingPrRef;
}

const ERAS: ChangeEra[] = ["handmade", "chatgpt", "codex", "claude"];

function isEra(value: string | undefined): value is ChangeEra {
  return !!value && (ERAS as string[]).includes(value);
}

function buildIssueIndex(raw: unknown): Map<number, IssueItem> {
  const map = new Map<number, IssueItem>();
  if (!Array.isArray(raw)) return map;
  for (const issue of raw as IssueItem[]) {
    if (typeof issue.number === "number") map.set(issue.number, issue);
  }
  return map;
}

function resolveIssueRefs(numbers: number[] | undefined, index: Map<number, IssueItem>): VersionIssueRef[] {
  if (!Array.isArray(numbers)) return [];
  return numbers.map((number) => {
    const match = index.get(number);
    const closed = match?.state === "CLOSED";
    return {
      number,
      title: match?.title?.trim() || `issue #${number}`,
      closed,
      closedByPr: closed ? resolveClosingPr(match?.closedByPr) : undefined,
    } satisfies VersionIssueRef;
  });
}

export function getLatestVersion(): string {
  const payload = versionData as { versions?: RawVersion[] };
  return payload.versions?.[0]?.version?.trim() ?? "";
}

export function getVersions(): VersionEntry[] {
  const payload = versionData as { versions?: RawVersion[] };
  const issueIndex = buildIssueIndex(issues as unknown);

  return (payload.versions ?? [])
    .map((entry) => {
      const version = entry.version?.trim() ?? "";
      const era = isEra(entry.era) ? entry.era : "handmade";
      if (!version) return null;

      return {
        version,
        era,
        name: entry.name?.trim() || version,
        date: entry.date?.trim() ?? "",
        summary: entry.summary?.trim() ?? "",
        stats: {
          commits: entry.stats?.commits ?? 0,
          files: entry.stats?.files ?? 0,
          insertions: entry.stats?.insertions ?? 0,
          deletions: entry.stats?.deletions ?? 0,
        },
        changes: (entry.changes ?? []).map((line) => line.trim()).filter(Boolean),
        issueRefs: resolveIssueRefs(entry.issues, issueIndex),
      } satisfies VersionEntry;
    })
    .filter((entry): entry is VersionEntry => entry !== null);
}
