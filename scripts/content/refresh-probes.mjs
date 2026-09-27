#!/usr/bin/env node
// Build src/data/probes.json from the prod tripwire archive and endlessh's log. scripts/content/refresh-probes.sh fetches
// both over ssh (or takes local copies) and then runs this.
//
// Everything here is attacker-supplied text (paths, user agents), so it is
// clipped, and raw IPs never leave this script: sources are counted, and the few
// shown are masked to their /24 (IPv4) or /48 (IPv6).
//
// Never fatal: the build imports the file, so on any failure this still writes
// an empty report.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const OUT_PATH = resolve(REPO_ROOT, "src/data/probes.json");

const DAYS = 14; // daily-count window
const TOP = 8; // top paths / agents kept
const RECENT = 6; // latest catches kept
const MAX_TEXT = 80;

function warn(msg) {
  process.stderr.write(`refresh-probes: ${msg}\n`);
}

function parseArgs(argv) {
  const args = { records: "", tarpit: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--records" && argv[i + 1]) args.records = argv[++i];
    else if (argv[i] === "--tarpit" && argv[i + 1]) args.tarpit = argv[++i];
  }
  return args;
}

function readLines(path) {
  if (!path) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch (err) {
    warn(`could not read ${path}: ${err.message}`);
    return [];
  }
}

function clip(value) {
  // Control characters out, so a hostile path can't do anything odd to the terminal.
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_TEXT);
}

/** 203.0.113.9 → 203.0.113.x, 2001:db8:1:2::9 → 2001:db8:1:… */
function maskIp(ip) {
  const bare = String(ip ?? "").replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return `${bare.split(".").slice(0, 3).join(".")}.x`;
  if (bare.includes(":")) return `${bare.split(":").slice(0, 3).join(":")}:…`;
  return "?";
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

/** Counts per UTC day for the last DAYS days, oldest first, zero-filled. */
function daily(items) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    days.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  const counts = new Map(days.map((d) => [d, 0]));
  for (const item of items) {
    const day = item.at.slice(0, 10);
    if (counts.has(day)) counts.set(day, counts.get(day) + 1);
  }
  return days.map((date) => ({ date, count: counts.get(date) }));
}

function webReport(lines) {
  const probes = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at))) continue;
      probes.push({ at: r.at, ip: String(r.ip ?? ""), path: clip(r.path), ua: clip(r.ua), trap: clip(r.trap), bait: r.bait === true });
    } catch {
      // torn line — skip
    }
  }
  probes.sort((a, b) => a.at.localeCompare(b.at));

  return {
    total: probes.length,
    sources: new Set(probes.map((p) => p.ip)).size,
    baitServed: probes.filter((p) => p.bait).length,
    since: probes[0]?.at ?? null,
    byTrap: countBy(probes, (p) => p.trap).map(({ value, count }) => ({ trap: value, count })),
    topPaths: countBy(probes, (p) => p.path).slice(0, TOP).map(({ value, count }) => ({ path: value, count })),
    topAgents: countBy(probes, (p) => p.ua).slice(0, TOP).map(({ value, count }) => ({ agent: value, count })),
    daily: daily(probes),
    recent: probes
      .slice(-RECENT)
      .reverse()
      .map((p) => ({ at: p.at, path: p.path, trap: p.trap, from: maskIp(p.ip) })),
  };
}

// endlessh: "2026-09-27T06:00:00.000Z CLOSE host=::ffff:1.2.3.4 port=5555 fd=4 time=123.456 bytes=789"
function tarpitReport(lines) {
  const held = [];
  for (const line of lines) {
    const m = /^(\S+)\s+CLOSE\s.*\bhost=(\S+).*\btime=([\d.]+)/.exec(line);
    if (!m || !Number.isFinite(Date.parse(m[1]))) continue;
    held.push({ at: new Date(Date.parse(m[1])).toISOString(), ip: m[2], seconds: Number.parseFloat(m[3]) || 0 });
  }
  held.sort((a, b) => a.at.localeCompare(b.at));
  const longest = held.reduce((best, h) => (h.seconds > (best?.seconds ?? -1) ? h : best), null);

  return {
    held: held.length,
    sources: new Set(held.map((h) => h.ip)).size,
    totalSeconds: Math.round(held.reduce((sum, h) => sum + h.seconds, 0)),
    longest: longest ? { seconds: Math.round(longest.seconds), from: maskIp(longest.ip), at: longest.at } : null,
    since: held[0]?.at ?? null,
    daily: daily(held),
    recent: held
      .slice(-RECENT)
      .reverse()
      .map((h) => ({ at: h.at, seconds: Math.round(h.seconds), from: maskIp(h.ip) })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = {
    generatedAt: new Date().toISOString(),
    web: webReport(readLines(args.records)),
    ssh: tarpitReport(readLines(args.tarpit)),
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `refresh-probes: ${report.web.total} web probes, ${report.ssh.held} tarpit catches → ${OUT_PATH}\n`
  );
}

try {
  main();
} catch (err) {
  warn(`failed (${err.message}) — writing an empty report`);
  const empty = { generatedAt: new Date().toISOString(), web: webReport([]), ssh: tarpitReport([]) };
  writeFileSync(OUT_PATH, `${JSON.stringify(empty, null, 2)}\n`);
}
