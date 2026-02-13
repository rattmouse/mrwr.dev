export type GitChangeType = "features" | "fixes" | "docs" | "other";

export type GitChangeIssueRef = {
  number: number;
  title: string;
  body: string;
};

export type GitChangeEntry = {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
  type: GitChangeType;
  issueRefs: GitChangeIssueRef[];
};
