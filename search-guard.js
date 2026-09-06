"use strict";

// Shared malicious-search classifier + display defanger.
//
// Used in two places:
//   - server.js `/log-search` — tags each recorded search with `flagged` /
//     `categories`. The attempt is still de-duped, still appended to the
//     archive, and still shown in the History window; this only marks it.
//   - scripts/content/refresh-search-history.mjs — re-derives the same tags
//     at build time so the History window can style hostile entries without
//     trusting a field an old archive might not carry.
//
// Kept at the repo root (next to server.js) with zero dependencies so
// scripts/deploy/deploy.sh can copy it into the prod release bundle the same
// way it copies server.js.

const OVERLONG_LEN = 180;
const MAX_DISPLAY_LEN = 180;
const ZWSP = "​";

const CATEGORIES = [
  "xss",
  "sql",
  "command",
  "path-traversal",
  "template-injection",
  "prompt-injection",
  "overlong",
];

// [category, pattern]. Case-insensitive where it matters. Deliberately broad:
// a false positive only puts a ⚠️ on one History entry, it never blocks a
// search or drops a record.
const RULES = [
  ["xss", /<\s*script\b/i],
  ["xss", /<\s*\/\s*script\s*>/i],
  ["xss", /<\s*(img|svg|iframe|body|video|audio|object|embed|details|marquee)\b/i],
  ["xss", /\bon(error|load|click|mouseover|focus|animationstart|toggle|pointerdown)\s*=/i],
  ["xss", /javascript\s*:/i],
  ["xss", /\bdocument\s*\.\s*(cookie|domain|write)\b/i],
  ["xss", /\b(alert|prompt|confirm)\s*\(/i],

  ["sql", /\bunion\b[\s\S]{0,20}\bselect\b/i],
  ["sql", /\bselect\b[\s\S]{0,80}\bfrom\b[\s\S]{0,40}\b(information_schema|pg_catalog|mysql\.)/i],
  ["sql", /(['"]|\s|\()\s*or\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i],
  ["sql", /;\s*(drop|truncate|delete|update|insert|alter)\s+/i],
  ["sql", /\b(sleep|benchmark|pg_sleep)\s*\(/i],
  ["sql", /\bwaitfor\s+delay\b/i],
  ["sql", /\b(xp_cmdshell|load_file|into\s+outfile)\b/i],
  ["sql", /--\s*$/],
  ["sql", /\/\*[\s\S]*?\*\//],

  ["command", /[;&|]\s*(cat|ls|rm|curl|wget|nc|bash|sh|python|perl|id|whoami|uname|ping)\b/i],
  ["command", /\$\([^)]*\)/],
  ["command", /`[^`]+`/],
  ["command", /\|\s*(bash|sh|nc)\b/i],

  ["path-traversal", /(\.\.[/\\]){2,}/],
  ["path-traversal", /\.\.[/\\](etc|proc|sys|windows|winnt)\b/i],
  ["path-traversal", /(%2e){2,}(%2f|%5c)/i],
  ["path-traversal", /\/etc\/(passwd|shadow|hosts)\b/i],
  ["path-traversal", /\bfile\s*:\s*\/\//i],

  ["template-injection", /\$\{[\s\S]*?\}/],
  ["template-injection", /\{\{[\s\S]*?\}\}/],
  ["template-injection", /<%[\s\S]*?%>/],
  ["template-injection", /#\{[\s\S]*?\}/],

  ["prompt-injection", /\bignore\s+(all\s+|any\s+)?(previous|prior|above|preceding)\s+(instructions|prompts|context)\b/i],
  ["prompt-injection", /\bdisregard\s+(the\s+)?(above|previous|earlier|system)\b/i],
  ["prompt-injection", /\b(system|developer)\s+prompt\b/i],
  ["prompt-injection", /\byou\s+are\s+now\b/i],
  ["prompt-injection", /\bact\s+as\s+(an?\s+)?(dan|jailbreak|unrestricted|evil)\b/i],
];

/**
 * Classify a (already sanitized) search string.
 * @param {unknown} query
 * @returns {{ flagged: boolean, categories: string[] }}
 */
function detectMaliciousSearch(query) {
  const text = String(query == null ? "" : query);
  const categories = [];

  for (const [category, pattern] of RULES) {
    if (categories.includes(category)) continue;
    if (pattern.test(text)) categories.push(category);
  }

  if (text.length > OVERLONG_LEN && !categories.includes("overlong")) {
    categories.push("overlong");
  }

  return { flagged: categories.length > 0, categories };
}

/**
 * Render-safe version of a query for the History window. Searches are already
 * rendered as React text nodes (never innerHTML), so this is defense in depth
 * plus a visible cue: angle brackets and backticks become look-alikes,
 * dangerous URI schemes are broken with a zero-width space, and traversal
 * runs are broken up so the string can't be copy-pasted into a real path.
 * @param {unknown} query
 * @returns {string}
 */
function defang(query) {
  let s = String(query == null ? "" : query);
  s = s
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/`/g, "ˋ")
    .replace(/(javascript|data|vbscript)\s*:/gi, `$1${ZWSP}:`)
    .replace(/\.\.([/\\])/g, `.${ZWSP}.${ZWSP}$1`);
  if (s.length > MAX_DISPLAY_LEN) s = s.slice(0, MAX_DISPLAY_LEN - 1) + "…";
  return s;
}

module.exports = { detectMaliciousSearch, defang, CATEGORIES };
