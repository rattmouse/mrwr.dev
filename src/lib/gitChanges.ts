import type { GitChangeEntry, GitChangeIssueRef, GitChangeType } from "@/lib/gitChanges.types";
import changelogs from "@/data/changelogs.json";
import issues from "@/data/issues.json";

type ChangelogItem = {
  text?: string;
  date?: string;
  author?: string;
  shortHash?: string;
};

type ChangelogPayload = {
  sections?: {
    featuresAdded?: ChangelogItem[];
    issuesFixed?: ChangelogItem[];
    documentation?: ChangelogItem[];
    otherChanges?: ChangelogItem[];
  };
};

type IssueItem = {
  number?: number;
  state?: string;
  title?: string;
  body?: string;
};

function extractIssueNumbers(text: string): number[] {
  const matches = text.match(/#(\d+)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((token) => Number(token.slice(1))).filter((n) => Number.isFinite(n))));
}

function buildClosedIssuesIndex(raw: unknown): Map<number, GitChangeIssueRef> {
  const map = new Map<number, GitChangeIssueRef>();
  if (!Array.isArray(raw)) return map;

  for (const issue of raw as IssueItem[]) {
    const number = issue.number;
    if (!number || issue.state !== "CLOSED") continue;
    map.set(number, {
      number,
      title: issue.title?.trim() ?? "(untitled)",
      body: issue.body?.trim() ?? "",
    });
  }

  return map;
}

function fromSection(
  items: ChangelogItem[] | undefined,
  type: GitChangeType,
  closedIssuesByNumber: Map<number, GitChangeIssueRef>
): GitChangeEntry[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((entry) => {
      const subject = entry.text?.trim() ?? "";
      const shortHash = entry.shortHash?.trim() ?? "";
      const date = entry.date?.trim() ?? "";
      const author = entry.author?.trim() || "unknown";
      const issueRefs = extractIssueNumbers(subject)
        .map((issueNumber) => closedIssuesByNumber.get(issueNumber))
        .filter((issue): issue is GitChangeIssueRef => issue !== undefined);

      if (!subject || !shortHash || !date) return null;

      return {
        hash: shortHash,
        shortHash,
        date,
        author,
        subject,
        type,
        issueRefs,
      } satisfies GitChangeEntry;
    })
    .filter((entry): entry is GitChangeEntry => entry !== null);
}

export function getGitChanges(limit = 0): GitChangeEntry[] {
  const payload = changelogs as ChangelogPayload;
  const sections = payload.sections ?? {};
  const closedIssuesByNumber = buildClosedIssuesIndex(issues as unknown);
  const all = [
    ...fromSection(sections.featuresAdded, "features", closedIssuesByNumber),
    ...fromSection(sections.issuesFixed, "fixes", closedIssuesByNumber),
    ...fromSection(sections.documentation, "docs", closedIssuesByNumber),
    ...fromSection(sections.otherChanges, "other", closedIssuesByNumber),
  ];

  if (limit > 0) return all.slice(0, limit);
  return all;
}
