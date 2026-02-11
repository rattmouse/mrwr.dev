import type { GitChangeEntry, GitChangeType } from "@/lib/gitChanges.types";
import changelogs from "@/data/changelogs.json";

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

function fromSection(items: ChangelogItem[] | undefined, type: GitChangeType): GitChangeEntry[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((entry) => {
      const subject = entry.text?.trim() ?? "";
      const shortHash = entry.shortHash?.trim() ?? "";
      const date = entry.date?.trim() ?? "";
      const author = entry.author?.trim() || "unknown";

      if (!subject || !shortHash || !date) return null;

      return {
        hash: shortHash,
        shortHash,
        date,
        author,
        subject,
        type,
      } satisfies GitChangeEntry;
    })
    .filter((entry): entry is GitChangeEntry => entry !== null);
}

export function getGitChanges(limit = 0): GitChangeEntry[] {
  const payload = changelogs as ChangelogPayload;
  const sections = payload.sections ?? {};
  const all = [
    ...fromSection(sections.featuresAdded, "features"),
    ...fromSection(sections.issuesFixed, "fixes"),
    ...fromSection(sections.documentation, "docs"),
    ...fromSection(sections.otherChanges, "other"),
  ];

  if (limit > 0) return all.slice(0, limit);
  return all;
}
