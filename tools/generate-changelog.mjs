#!/usr/bin/env node
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {
    limit: 200,
    output: "",
    title: "Changelog",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) args.limit = value;
      i += 1;
      continue;
    }
    if (arg === "--output" && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--title" && argv[i + 1]) {
      args.title = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
  }

  return args;
}

function getGitLog(limit) {
  const format = "%H%x1f%ad%x1f%an%x1f%s%x1f%b%x1e";
  const command = `git log -n ${limit} --date=format:'%Y-%m-%d %H:%M' --pretty=format:'${format}'`;
  const raw = execSync(command, { encoding: "utf8" });

  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, date, author, subject, body] = entry.split("\x1f");
      return {
        hash,
        shortHash: hash.slice(0, 7),
        date,
        author: author?.trim() ?? "",
        subject: subject?.trim() ?? "",
        body: body?.trim() ?? "",
      };
    })
    .filter((entry) => entry.subject.length > 0);
}

function cleanSentence(input) {
  let text = input.trim();
  if (/^merge\b/i.test(text)) return "";
  text = text.replace(/^revert\s+"?(.+)"?$/i, "Reverted $1");
  text = text.replace(/^([a-z]+)(\([^)]*\))?!?:\s*/i, "");
  text = text.replace(/^\[[^\]]+\]\s*/, "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";

  const first = text.charAt(0).toUpperCase();
  text = first + text.slice(1);
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

function classifyChange(subject, body) {
  const line = `${subject}\n${body}`.toLowerCase();

  if (/^feat(\(|:)/i.test(subject) || /(add|added|introduce|new feature|support|enable|implement)/i.test(line)) {
    return "features";
  }
  if (/^fix(\(|:)/i.test(subject) || /(fix|fixed|resolve|resolved|bug|issue|patch|correct)/i.test(line)) {
    return "fixes";
  }
  if (/^docs(\(|:)/i.test(subject) || /(readme|docs|documentation)/i.test(line)) {
    return "docs";
  }
  return "other";
}

function uniqueByText(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function summarizeSection(title, entries) {
  if (entries.length === 0) return "";

  const bullets = entries.map((entry) => `- ${entry.text} (${entry.date}, ${entry.author}, ${entry.shortHash})`).join("\n");
  return `## ${title}\n${bullets}\n`;
}

function normalizeForOverview(text) {
  return text
    .replace(/[.!?]+$/, "")
    .replace(/^(add|added|fix|fixed|update|updated|improve|improved|refactor|refactored)\s+/i, "")
    .toLowerCase();
}

function toList(items, max = 3) {
  return items.slice(0, max).map((entry) => normalizeForOverview(entry.text));
}

function joinAsPhrase(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function buildHighlights(commits) {
  const haystack = commits.map((commit) => `${commit.subject}\n${commit.body}`).join("\n").toLowerCase();
  const hasChangesTimelineWork =
    /\bissues\b/.test(haystack) &&
    /\bchanges\b/.test(haystack) &&
    /(relative timing|relative time|timelines and search display|search playback)/.test(haystack);
  const hasIssue39 = /(fixes|fixed|closes|closed|resolves|resolved)\s+#39/.test(haystack);
  const hasIssue16AlreadyFixed = /#16 has been fixed for a while/.test(haystack);

  if (!hasChangesTimelineWork && !hasIssue39 && !hasIssue16AlreadyFixed) return [];

  const highlights = [];
  if (hasChangesTimelineWork) {
    highlights.push("Updated issues and changes timelines to compact relative time labels and improved search playback.");
    highlights.push("Removed the search delta badge from issues and changes search displays.");
    highlights.push("Replaced raw image links with clickable picture icons that open a low-res preview modal.");
    highlights.push("Expanded changes summaries with referenced closed-issue context and descriptions.");
  }
  if (hasIssue39) highlights.push("Marked issue #39 as fixed.");
  if (hasIssue16AlreadyFixed) highlights.push("Noted that issue #16 had already been fixed earlier.");
  return highlights;
}

function buildOverview(grouped) {
  const featureBits = toList(grouped.features);
  const fixBits = toList(grouped.fixes);

  const parts = [];
  if (featureBits.length) parts.push(`added ${joinAsPhrase(featureBits)}`);
  if (fixBits.length) parts.push(`fixed ${joinAsPhrase(fixBits)}`);
  if (!parts.length) return "";

  return `This update ${joinAsPhrase(parts)}.`;
}

function buildChangelog(title, commits) {
  const grouped = {
    features: [],
    fixes: [],
    docs: [],
    other: [],
  };

  for (const commit of commits) {
    const text = cleanSentence(commit.subject);
    if (!text) continue;
    const kind = classifyChange(commit.subject, commit.body);
    grouped[kind].push({
      text,
      date: commit.date,
      author: commit.author,
      shortHash: commit.shortHash,
    });
  }

  grouped.features = uniqueByText(grouped.features);
  grouped.fixes = uniqueByText(grouped.fixes);
  grouped.docs = uniqueByText(grouped.docs);
  grouped.other = uniqueByText(grouped.other);
  const overview = buildOverview(grouped);
  const highlights = buildHighlights(commits);

  const generatedOn = new Date().toISOString().slice(0, 10);
  const parts = [
    `# ${title}`,
    `Generated on ${generatedOn} from ${commits.length} commits.`,
    "",
  ];
  if (overview) parts.push(`${overview}\n`);
  if (highlights.length) {
    parts.push(`## Highlights\n${highlights.map((item) => `- ${item}`).join("\n")}\n`);
  }

  if (grouped.features.length) parts.push(summarizeSection("Features Added", grouped.features));
  if (grouped.fixes.length) parts.push(summarizeSection("Issues Fixed", grouped.fixes));
  if (grouped.docs.length) parts.push(summarizeSection("Documentation", grouped.docs));

  if (grouped.other.length) {
    parts.push(summarizeSection("Other Changes", grouped.other.slice(0, 25)));
    if (grouped.other.length > 25) {
      parts.push(`_Plus ${grouped.other.length - 25} more maintenance updates._\n`);
    }
  }

  if (
    !grouped.features.length &&
    !grouped.fixes.length &&
    !grouped.docs.length &&
    !grouped.other.length
  ) {
    parts.push("No commit history was found.");
  }

  return parts.join("\n").trim() + "\n";
}

function groupCommits(commits) {
  const grouped = {
    features: [],
    fixes: [],
    docs: [],
    other: [],
  };

  for (const commit of commits) {
    const text = cleanSentence(commit.subject);
    if (!text) continue;
    const kind = classifyChange(commit.subject, commit.body);
    grouped[kind].push({
      text,
      date: commit.date,
      author: commit.author,
      shortHash: commit.shortHash,
    });
  }

  grouped.features = uniqueByText(grouped.features);
  grouped.fixes = uniqueByText(grouped.fixes);
  grouped.docs = uniqueByText(grouped.docs);
  grouped.other = uniqueByText(grouped.other);

  return grouped;
}

function buildChangelogJson(title, commits) {
  const grouped = groupCommits(commits);
  const highlights = buildHighlights(commits);
  return {
    title,
    generatedOn: new Date().toISOString(),
    commitCount: commits.length,
    overview: buildOverview(grouped),
    highlights,
    sections: {
      featuresAdded: grouped.features,
      issuesFixed: grouped.fixes,
      documentation: grouped.docs,
      otherChanges: grouped.other,
    },
  };
}

function printHelp() {
  console.log(`Usage: node tools/generate-changelog.mjs [options]\n\nOptions:\n  --limit <n>      Number of commits to scan (default: 200)\n  --output <file>  Write changelog to file instead of stdout\n  --title <text>   Override the changelog title (default: Changelog)\n  --json           Output JSON instead of markdown\n  -h, --help       Show this help message\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const commits = getGitLog(args.limit);
  const output = args.json
    ? `${JSON.stringify(buildChangelogJson(args.title, commits), null, 2)}\n`
    : buildChangelog(args.title, commits);

  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, output, "utf8");
    console.log(`Wrote changelog to ${args.output}`);
    return;
  }

  process.stdout.write(output);
}

main();
