export type GitChangeType = "feat" | "fix" | "docs" | "chore" | "other";

export type GitChangeEntry = {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
  type: GitChangeType;
};
