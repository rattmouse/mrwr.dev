export type ChangeEra = "handmade" | "chatgpt" | "codex" | "claude";

export type VersionIssueRef = {
  number: number;
  title: string;
  closed: boolean;
};

export type VersionStats = {
  commits: number;
  files: number;
  insertions: number;
  deletions: number;
};

export type VersionEntry = {
  version: string;
  era: ChangeEra;
  name: string;
  date: string;
  summary: string;
  stats: VersionStats;
  changes: string[];
  issueRefs: VersionIssueRef[];
};
