import { execSync } from "node:child_process";
import type { GitChangeEntry, GitChangeType } from "@/lib/gitChanges.types";

function detectType(subject: string): GitChangeType {
  const conventional = /^([a-z]+)(\(.+\))?!?:/i.exec(subject);
  const normalized = conventional?.[1]?.toLowerCase();

  if (normalized === "feat") return "feat";
  if (normalized === "fix") return "fix";
  if (normalized === "docs") return "docs";
  if (normalized === "chore") return "chore";
  return "other";
}

export function getGitChanges(limit = 100): GitChangeEntry[] {
  try {
    const raw = execSync(
      `git log -n ${limit} --date=format:'%Y-%m-%d %H:%M' --pretty=format:'%H%x1f%h%x1f%ad%x1f%an%x1f%s%x1e'`,
      { encoding: "utf8" },
    );

    return raw
      .split("\x1e")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, author, subject] = line.split("\x1f");
        return {
          hash,
          shortHash,
          date,
          author,
          subject,
          type: detectType(subject),
        };
      })
      .filter((entry) => entry.hash && entry.shortHash && entry.date && entry.subject);
  } catch {
    return [];
  }
}
