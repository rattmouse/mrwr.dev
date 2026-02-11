export type GitChangeType = "features" | "fixes" | "docs" | "other";

export type GitChangeEntry = {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
  type: GitChangeType;
};
