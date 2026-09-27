import probesRaw from "@/data/probes.json";

/**
 * What probes.exe prints: the bots server.js's tripwire and the endlessh ssh
 * tarpit caught on prod. src/data/probes.json is written at build time by
 * scripts/content/refresh-probes.sh — gitignored, never fetched at runtime.
 * Paths and agents are whatever the bots sent (already clipped), and every
 * address is masked to its /24 before it gets here.
 */

type Count<K extends string> = { [key in K]: string } & { count: number };
type Day = { date: string; count: number };

type ProbesData = {
  generatedAt?: string;
  web?: {
    total?: number;
    sources?: number;
    baitServed?: number;
    since?: string | null;
    byTrap?: Count<"trap">[];
    topPaths?: Count<"path">[];
    daily?: Day[];
    recent?: { at: string; path: string; trap: string; from: string }[];
  };
  ssh?: {
    held?: number;
    sources?: number;
    totalSeconds?: number;
    longest?: { seconds: number; from: string } | null;
    since?: string | null;
    daily?: Day[];
    recent?: { at: string; seconds: number; from: string }[];
  };
};

/** How wide the bash window reads, in characters. */
const WIDTH = 46;
const BAR_WIDTH = 14;
const SPARKS = "▁▂▃▄▅▆▇█";

const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");
const plural = (n: number | undefined, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "?");
const stamp = (iso: string) => iso.slice(5, 16).replace("T", " ");

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function rule(title: string): string {
  return `${title} ${"─".repeat(Math.max(3, WIDTH - title.length - 1))}`;
}

function duration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function sparkline(days: Day[] | undefined): string {
  if (!days?.length) return "";
  const max = Math.max(...days.map((d) => d.count));
  if (!max) return "";
  const line = days
    .map((d) => (d.count ? SPARKS[Math.min(SPARKS.length - 1, Math.floor((d.count / max) * SPARKS.length))] : " "))
    .join("");
  return `last ${days.length} days  ${line}`;
}

function webSection(web: NonNullable<ProbesData["web"]>): string[] {
  const out = [rule("web tripwire"), `${plural(web.total, "probe")} from ${plural(web.sources, "source")}`];
  if (web.baitServed) out.push(`fake .env handed out ${plural(web.baitServed, "time")}`);
  const spark = sparkline(web.daily);
  if (spark) out.push(spark);

  const traps = web.byTrap ?? [];
  if (traps.length) {
    const top = traps[0].count;
    out.push("");
    for (const t of traps) {
      const bar = "█".repeat(Math.max(1, Math.round((t.count / top) * BAR_WIDTH)));
      out.push(`${t.trap.padEnd(12)}${String(t.count).padStart(6)} ${bar}`);
    }
  }

  if (web.topPaths?.length) {
    out.push("", "most wanted");
    for (const p of web.topPaths) out.push(`${String(p.count).padStart(6)}  ${clip(p.path, WIDTH - 8)}`);
  }

  if (web.recent?.length) {
    out.push("", "latest");
    for (const r of web.recent) {
      out.push(`  ${stamp(r.at)}  ${clip(r.path, WIDTH - 15)}`, `${" ".repeat(15)}from ${r.from}`);
    }
  }
  return out;
}

function sshSection(ssh: NonNullable<ProbesData["ssh"]>): string[] {
  const out = [
    rule("ssh tarpit :22"),
    `${plural(ssh.held, "bot")} held from ${plural(ssh.sources, "source")}`,
    `${((ssh.totalSeconds ?? 0) / 3600).toFixed(1)}h of their time wasted`,
  ];
  if (ssh.longest) out.push(`longest: ${duration(ssh.longest.seconds)} (${ssh.longest.from})`);
  const spark = sparkline(ssh.daily);
  if (spark) out.push(spark);

  if (ssh.recent?.length) {
    out.push("", "latest");
    for (const r of ssh.recent) out.push(`  ${stamp(r.at)}  ${duration(r.seconds).padEnd(8)} ${r.from}`);
  }
  return out;
}

export function probesReport(): string {
  const data = probesRaw as ProbesData;
  const web = data.web ?? {};
  const ssh = data.ssh ?? {};

  const firsts = [web.since, ssh.since].filter((s): s is string => Boolean(s)).sort();
  const out = [`caught probes · as of ${day(data.generatedAt)}`];
  if (firsts[0]) out.push(`watching since ${day(firsts[0])}`);

  if (!web.total && !ssh.held) {
    out.push("", "nothing caught yet.", "the traps are set.");
    return out.join("\n");
  }
  if (web.total) out.push("", ...webSection(web));
  if (ssh.held) out.push("", ...sshSection(ssh));
  return out.join("\n");
}
