#!/usr/bin/env node
// The site's version lives in three places that have to agree:
//   package.json            "version": "6.0.1"
//   package-lock.json       the same, twice
//   src/data/versions.json  versions[0].version — the newest card in the
//                           Changes window, written "6.0" for a x.y.0 release
//                           and "6.0.1" once it has a patch.
//
//   node scripts/version.mjs bump [patch|minor|major]
//     Moves all three on together. A patch relabels the newest card (its
//     bullets carry on accumulating there); a minor or major opens a new,
//     empty card at the top for the new milestone — fill in its name,
//     summary and era by hand.
//
//   node scripts/version.mjs check [--against <git-ref>]
//     Fails if the three disagree. With --against, also fails unless the
//     version is newer than the one at that ref — the "every PR bumps the
//     version" gate containers/ci.sh runs on a branch against origin/main.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "package.json");
const LOCK = join(ROOT, "package-lock.json");
const VERSIONS = join(ROOT, "src/data/versions.json");

function parse(version) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(version).trim());
  if (!m) throw new Error(`not a version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}
const full = ([a, b, c]) => `${a}.${b}.${c}`;
// The Changes window's label: "6.0" for a x.y.0 release, "6.0.1" after.
const label = ([a, b, c]) => (c === 0 ? `${a}.${b}` : `${a}.${b}.${c}`);
const compare = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

// versions.json is edited as text rather than re-serialised: it is hand-kept,
// and a round trip through JSON.stringify would rewrite every escaped
// character in the file.
const FIRST_CARD_VERSION = /("versions"\s*:\s*\[\s*\{\s*"version"\s*:\s*")([^"]*)(")/;

function cardVersion() {
  const m = FIRST_CARD_VERSION.exec(readFileSync(VERSIONS, "utf8"));
  if (!m) throw new Error("couldn't find versions[0].version in src/data/versions.json");
  return m[2];
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bump(kind) {
  const pkg = readJson(PKG);
  const [a, b, c] = parse(pkg.version);
  const next =
    kind === "major" ? [a + 1, 0, 0] : kind === "minor" ? [a, b + 1, 0] : kind === "patch" ? [a, b, c + 1] : null;
  if (!next) throw new Error(`bump what? patch, minor or major — not "${kind}"`);

  pkg.version = full(next);
  writeJson(PKG, pkg);

  const lock = readJson(LOCK);
  lock.version = full(next);
  if (lock.packages?.[""]) lock.packages[""].version = full(next);
  writeJson(LOCK, lock);

  let text = readFileSync(VERSIONS, "utf8");
  if (kind === "patch") {
    text = text.replace(FIRST_CARD_VERSION, `$1${label(next)}$3`);
    text = text.replace(/("versions"\s*:\s*\[\s*\{[^{}]*?"date"\s*:\s*")[^"]*(")/, `$1${today()}$2`);
  } else {
    const card = [
      "    {",
      `      "version": "${label(next)}",`,
      `      "era": "claude",`,
      `      "name": "",`,
      `      "date": "${today()}",`,
      `      "summary": "",`,
      `      "issues": [],`,
      `      "changes": []`,
      "    },",
    ].join("\n");
    text = text.replace(/("versions"\s*:\s*\[\n)/, `$1${card}\n`);
  }
  writeFileSync(VERSIONS, text);

  console.log(`[version] ${full([a, b, c])} -> ${full(next)}`);
  if (kind !== "patch") console.log("[version] new card at the top of versions.json: fill in its name, summary and era");
}

function check(against) {
  const pkg = parse(readJson(PKG).version);
  const problems = [];

  const lock = readJson(LOCK);
  if (lock.version !== full(pkg) || (lock.packages?.[""] && lock.packages[""].version !== full(pkg))) {
    problems.push(`package-lock.json is not at ${full(pkg)} — run npm install, or bump with scripts/version.mjs`);
  }
  const card = cardVersion();
  if (compare(parse(card), pkg) !== 0 || card !== label(pkg)) {
    problems.push(`versions.json's newest card is "${card}" but package.json is ${full(pkg)} (expected "${label(pkg)}")`);
  }

  if (against) {
    let base = null;
    try {
      base = JSON.parse(execFileSync("git", ["show", `${against}:package.json`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).version;
    } catch {
      console.warn(`[version] warning: couldn't read package.json at ${against}; skipping the bump check`);
    }
    if (base && compare(pkg, parse(base)) <= 0) {
      problems.push(`${full(pkg)} isn't newer than ${against} (${base}) — every PR bumps the version: node scripts/version.mjs bump patch`);
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`[version] ${p}`);
    process.exit(1);
  }
  console.log(`[version] ${full(pkg)} ok`);
}

const [cmd, arg, value] = process.argv.slice(2);
try {
  if (cmd === "bump") bump(arg ?? "patch");
  else if (cmd === "check") check(arg === "--against" ? value : null);
  else {
    console.error("usage: node scripts/version.mjs bump [patch|minor|major] | check [--against <git-ref>]");
    process.exit(2);
  }
} catch (err) {
  console.error(`[version] ${err.message}`);
  process.exit(1);
}
