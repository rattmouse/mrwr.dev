const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

// Malicious-search classifier. A missing module (e.g. a deploy that forgot to
// ship search-guard.js) must not 500 every search — degrade to "nothing is
// flagged" and say so once, loudly.
let detectMaliciousSearch;
let defang;
try {
  ({ detectMaliciousSearch, defang } = require("./search-guard"));
} catch (err) {
  console.error("search-guard module missing — searches will not be flagged", err);
  detectMaliciousSearch = () => ({ flagged: false, categories: [] });
  defang = (value) => String(value ?? "");
}

// Live search-session grouping, shared with the build-time history pass
// (scripts/content/refresh-search-history.mjs). A missing module just disables
// the session notifier — searches are still logged as usual.
let isTypingReset;
let headlineOf;
let SESSION_MIN_HEADLINE_LEN;
let sessionGroupingReady = true;
try {
  ({ isTypingReset, headlineOf, MIN_HEADLINE_LEN: SESSION_MIN_HEADLINE_LEN } = require("./search-sessions"));
} catch (err) {
  console.error("search-sessions module missing — session notifications disabled", err);
  sessionGroupingReady = false;
}

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_QUERY_LOG_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 64;
const QUERY_DEDUP_WINDOW_MS = 1500;
const MAX_TRACKED_QUERIES = 5000;
const recentlyLoggedQueries = new Map();
const MAX_TRACKED_SESSIONS = 5000;
const sessionLastLogAt = new Map();
const MAX_DELTA_MS = 30 * 1000;
const MAX_INPUT_DELTA_MS = 5 * 60 * 1000;

// --- live search-session notifier -----------------------------------------
// Records land here one keystroke-change at a time. We buffer them per browser
// session and, once a session goes quiet for SESSION_IDLE_MS (or a "typing
// reset" starts a new thought), POST a summary to whatever SEARCH_NOTIFY_KIND
// points at. Everything here is best-effort: a failure logs and is dropped, it
// never affects logging or the response.
const SESSION_IDLE_MS = Math.max(
  1000,
  Number.parseInt(process.env.SEARCH_SESSION_IDLE_MS || "", 10) || 180 * 1000
);
const NOTIFY_KIND = (process.env.SEARCH_NOTIFY_KIND || "").trim().toLowerCase();
const NOTIFY_TIMEOUT_MS = 5000;
const pendingSessions = new Map();

const OUT_DIR = path.join(__dirname, ".");

// Durable, append-only archive of recorded searches. stdout still gets each
// record for operational visibility, but journald rotates and silently drops
// old entries (issue #55) — this file is the source of truth. In prod the
// systemd unit points SEARCH_LOG_FILE at a path OUTSIDE the release dir so it
// survives release swaps and pruning.
const SEARCH_LOG_FILE = process.env.SEARCH_LOG_FILE || path.join(__dirname, "search-log.ndjson");
const SEARCH_LOG_MAX_BYTES = 8 * 1024 * 1024;

try {
  fs.mkdirSync(path.dirname(SEARCH_LOG_FILE), { recursive: true });
} catch (err) {
  console.error("search-log dir create failed", err);
}

// Best-effort single-generation rotation so an archive can't grow unbounded.
function rotateIfLarge(file) {
  fs.stat(file, (statErr, stats) => {
    if (statErr || stats.size <= SEARCH_LOG_MAX_BYTES) return;
    fs.rename(file, `${file}.1`, (renameErr) => {
      if (renameErr) console.error(`${path.basename(file)} rotate failed`, renameErr);
    });
  });
}

function appendNdjson(file, record) {
  rotateIfLarge(file);
  fs.appendFile(file, `${JSON.stringify(record)}\n`, (err) => {
    if (err) console.error(`${path.basename(file)} append failed`, err);
  });
}

function appendSearchRecord(record) {
  appendNdjson(SEARCH_LOG_FILE, record);
}

// --- session notifier ---------------------------------------------------------

function notifyText(payload) {
  const head = payload.flagged
    ? `⚠ flagged search session${payload.categories.length ? ` (${payload.categories.join(", ")})` : ""}`
    : `New search session · ${payload.entryCount} edit${payload.entryCount === 1 ? "" : "s"}`;
  const entries = payload.entries.map((e, i) => `${i + 1}. ${e.query}`).join("\n");
  return `${head}\n${payload.headline}\n\n${entries}`;
}

async function postNotify(kind, url, headers, body, signal) {
  const res = await fetch(url, { method: "POST", headers, body, signal });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore — the status code is the useful part
    }
    console.error(`search-notify: ${kind} responded ${res.status}`, detail);
  }
}

// Sends one message through whatever SEARCH_NOTIFY_KIND points at. `ntfy` is
// the Title/Tags/Priority headers for ntfy; `payload` is the webhook's JSON
// body (it gets `message: text` added). Best-effort: failures log and drop.
async function sendNotification({ text, ntfy, payload }) {
  if (!NOTIFY_KIND) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

  try {
    if (NOTIFY_KIND === "telegram") {
      const token = process.env.TG_BOT_TOKEN;
      const chatId = process.env.TG_CHAT_ID;
      if (!token || !chatId) {
        console.error("search-notify: SEARCH_NOTIFY_KIND=telegram needs TG_BOT_TOKEN and TG_CHAT_ID");
        return;
      }
      const esc = (s) =>
        String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await postNotify(
        "telegram",
        `https://api.telegram.org/bot${token}/sendMessage`,
        { "content-type": "application/json" },
        JSON.stringify({
          chat_id: chatId,
          text: `<pre>${esc(text)}</pre>`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        controller.signal
      );
      return;
    }

    if (NOTIFY_KIND === "ntfy") {
      const url = process.env.NTFY_URL;
      if (!url) {
        console.error("search-notify: SEARCH_NOTIFY_KIND=ntfy needs NTFY_URL");
        return;
      }
      const headers = { ...ntfy };
      if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
      await postNotify("ntfy", url, headers, text, controller.signal);
      return;
    }

    if (NOTIFY_KIND === "webhook") {
      const url = process.env.SEARCH_NOTIFY_URL;
      if (!url) {
        console.error("search-notify: SEARCH_NOTIFY_KIND=webhook needs SEARCH_NOTIFY_URL");
        return;
      }
      const headers = { "content-type": "application/json" };
      if (process.env.SEARCH_NOTIFY_TOKEN) {
        headers.Authorization = `Bearer ${process.env.SEARCH_NOTIFY_TOKEN}`;
      }
      await postNotify(
        "webhook",
        url,
        headers,
        JSON.stringify({ ...payload, message: text }),
        controller.signal
      );
      return;
    }

    console.error(
      `search-notify: unknown SEARCH_NOTIFY_KIND=${NOTIFY_KIND} (want telegram | ntfy | webhook)`
    );
  } catch (err) {
    console.error("search-notify failed", err);
  } finally {
    clearTimeout(timer);
  }
}

function notifySearchSession(payload) {
  return sendNotification({
    text: notifyText(payload),
    ntfy: {
      Title: payload.flagged ? "Flagged search session" : "New search session",
      Tags: payload.flagged ? "warning" : "mag",
      Priority: payload.flagged ? "high" : "default",
    },
    payload,
  });
}

function flushSession(key) {
  const buf = pendingSessions.get(key);
  if (!buf) return;
  if (buf.timer) clearTimeout(buf.timer);
  pendingSessions.delete(key);

  const headline = headlineOf(buf.entries);
  if (headline.length <= SESSION_MIN_HEADLINE_LEN) return; // noise — same rule as the build-time pass

  const first = buf.entries[0];
  const last = buf.entries[buf.entries.length - 1];
  const startedMs = Date.parse(first.at);
  const endedMs = Date.parse(last.at);
  const spanMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0;
  const flagged = buf.entries.some((e) => e.flagged);
  const categories = Array.from(new Set(buf.entries.flatMap((e) => e.categories || [])));

  notifySearchSession({
    type: "search-session",
    headline: flagged ? defang(headline) : headline,
    startedAt: first.at,
    endedAt: last.at,
    spanMs,
    entryCount: buf.entries.length,
    session: key === "anon" ? undefined : key,
    flagged,
    categories,
    entries: buf.entries.map((e) => ({ query: e.flagged ? defang(e.query) : e.query, at: e.at })),
  });
}

function bufferSearchEntry(sessionId, entry) {
  if (!sessionGroupingReady || !NOTIFY_KIND) return;

  const key = sessionId || "anon";
  let buf = pendingSessions.get(key);

  if (buf && isTypingReset(buf.entries[buf.entries.length - 1], entry)) {
    flushSession(key); // the buffered run was a finished thought
    buf = undefined;
  }

  if (!buf) {
    buf = { entries: [], timer: null };
    pendingSessions.set(key, buf);
    if (pendingSessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = pendingSessions.keys().next().value;
      if (oldest && oldest !== key) flushSession(oldest);
    }
  }

  buf.entries.push(entry);
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushSession(key), SESSION_IDLE_MS);
  if (typeof buf.timer.unref === "function") buf.timer.unref();
}

// --- tripwire ---------------------------------------------------------------
// Scanners ask every server for the same handful of paths — /.env, /.git/,
// /wp-login.php, /phpmyadmin — none of which this site has or will ever have,
// so any request for one is a bot, not a visitor. Those requests are recorded
// to their own archive (never mixed into the search log), answered with a
// plain 404, and summed up once a day through the search notifier. The archive
// is also what scripts/content/refresh-probes.sh reads at build time.
//
// The one exception is .env, answered with DOTENV_FILE when that exists. The
// file lives only on prod, never in the repo.
const TRIPWIRE_LOG_FILE =
  process.env.TRIPWIRE_LOG_FILE || path.join(__dirname, "tripwire.ndjson");
const DOTENV_FILE = process.env.DOTENV_FILE || "";
const TRIPWIRE_DIGEST_HOUR_UTC = (() => {
  const hour = Number.parseInt(process.env.TRIPWIRE_DIGEST_HOUR_UTC || "", 10);
  return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 16; // 9am Pacific (PDT)
})();
const MAX_TRIPWIRE_FIELD_LENGTH = 300;

// [trap, pattern], tested against the lowercased request path, both as sent and
// percent-decoded. First match names the trap.
const TRAPS = [
  ["env", /(^|\/)\.env(\.[\w-]+)?$/],
  ["git", /(^|\/)\.(git|svn|hg)(\/|$)/],
  ["wordpress", /(^|\/)(wp-(admin|login|content|includes|config|json)|xmlrpc\.php|wordpress|wp)(\/|\.|$)/],
  ["php", /\.php\d?$/],
  [
    "secrets",
    /(^|\/)(\.aws|\.ssh|\.docker|\.kube|\.npmrc|\.pypirc|\.htpasswd|\.htaccess|id_(rsa|ed25519)|credentials|secrets?\.(json|ya?ml)|sftp-config\.json|docker-compose\.ya?ml)(\/|$)/,
  ],
  [
    "admin-panel",
    /(^|\/)(phpmyadmin|pma|myadmin|adminer|server-status|server-info|actuator|jmx-console|manager\/html|solr|cgi-bin|boaform|hnap1|owa|ecp|autodiscover|geoserver|telescope|_ignition|vendor\/phpunit|druid|console|webui|login\.action)(\/|$)/,
  ],
  ["backup", /\.(sql|bak|old|orig|save|swp|tar|tgz|gz|zip|7z|rar|dump)$/],
  ["dotfile", /(^|\/)\.(vscode|idea|ds_store|bash_history|travis\.yml|gitlab-ci\.yml|circleci)(\/|$)/],
  ["traversal", /\.\.(\/|\\)|\/etc\/passwd|\/proc\/self|win\.ini/],
];

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trapFor(rawPath) {
  const raw = rawPath.toLowerCase();
  const decoded = safeDecode(raw);
  for (const [trap, pattern] of TRAPS) {
    if (pattern.test(raw) || pattern.test(decoded)) return trap;
  }
  return null;
}

function clip(value) {
  return String(value ?? "").slice(0, MAX_TRIPWIRE_FIELD_LENGTH);
}

try {
  fs.mkdirSync(path.dirname(TRIPWIRE_LOG_FILE), { recursive: true });
} catch (err) {
  console.error("tripwire dir create failed", err);
}

function tripwire(req, res, next) {
  const rawPath = (req.originalUrl || req.url || "").split("?")[0];
  const trap = trapFor(rawPath);
  if (!trap) return next();

  const record = {
    at: new Date().toISOString(),
    ip: req.ip,
    method: req.method,
    path: clip(req.originalUrl),
    ua: clip(req.get("user-agent")),
    trap,
  };

  const notFound = () => {
    appendNdjson(TRIPWIRE_LOG_FILE, record);
    res.status(404).type("text/plain").send("Not Found");
  };

  if (trap !== "env" || !DOTENV_FILE || (req.method !== "GET" && req.method !== "HEAD")) {
    return notFound();
  }
  fs.readFile(DOTENV_FILE, "utf8", (err, bait) => {
    if (err) return notFound();
    record.bait = true;
    appendNdjson(TRIPWIRE_LOG_FILE, record);
    res.status(200).type("text/plain").set("Cache-Control", "no-store").send(bait);
  });
}

// --- daily probe digest -----------------------------------------------------

async function readNdjsonSince(file, sinceMs) {
  const records = [];
  // .1 first so records stay in chronological order; either may be absent.
  for (const candidate of [`${file}.1`, file]) {
    let text;
    try {
      text = await fs.promises.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (Date.parse(record.at) >= sinceMs) records.push(record);
      } catch {
        // a torn line from a crash mid-append — skip it
      }
    }
  }
  return records;
}

// endlessh logs one CLOSE line per client it let go, with how long it held it. Missing endlessh or journalctl ⇒ null, not an error.
function readTarpitSince(sinceMs) {
  return new Promise((resolve) => {
    execFile(
      "journalctl",
      ["-u", "endlessh", "-o", "cat", "--no-pager", "--since", `@${Math.floor(sinceMs / 1000)}`],
      { timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        let held = 0;
        let seconds = 0;
        let longest = 0;
        const hosts = new Set();
        for (const line of stdout.split("\n")) {
          const m = / CLOSE host=(\S+) .*\btime=([\d.]+)/.exec(line);
          if (!m) continue;
          const t = Number.parseFloat(m[2]) || 0;
          held += 1;
          seconds += t;
          longest = Math.max(longest, t);
          hosts.add(m[1]);
        }
        resolve({ held, sources: hosts.size, seconds, longest });
      }
    );
  });
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) || 0) + 1);
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function hours(seconds) {
  return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
}

async function sendProbeDigest() {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const probes = await readNdjsonSince(TRIPWIRE_LOG_FILE, sinceMs);
  const tarpit = await readTarpitSince(sinceMs);
  if (!probes.length && !tarpit?.held) return;

  const sources = new Set(probes.map((p) => p.ip)).size;
  const bait = probes.filter((p) => p.bait).length;
  const byTrap = countBy(probes, "trap");
  const topPaths = countBy(probes, "path").slice(0, 5);

  const lines = [`Caught probes · last 24h`, ""];
  lines.push(`web: ${probes.length} probe${probes.length === 1 ? "" : "s"} from ${sources} source${sources === 1 ? "" : "s"}`);
  if (bait) lines.push(`  .env bait handed out: ${bait}`);
  if (byTrap.length) lines.push(`  ${byTrap.map((t) => `${t.value} ${t.count}`).join(" · ")}`);
  for (const p of topPaths) lines.push(`  ${String(p.count).padStart(4)}  ${p.value}`);
  if (tarpit?.held) {
    lines.push(
      "",
      `ssh tarpit: ${tarpit.held} bot${tarpit.held === 1 ? "" : "s"} held, ` +
        `${hours(tarpit.seconds)} wasted (longest ${hours(tarpit.longest)})`
    );
  }

  await sendNotification({
    text: lines.join("\n"),
    ntfy: { Title: "Caught probes", Tags: "shield", Priority: "low" },
    payload: {
      type: "probe-digest",
      since: new Date(sinceMs).toISOString(),
      probes: probes.length,
      sources,
      bait,
      byTrap,
      topPaths,
      tarpit,
    },
  });
}

function scheduleProbeDigest() {
  if (!NOTIFY_KIND) return;
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), TRIPWIRE_DIGEST_HOUR_UTC)
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => {
    sendProbeDigest()
      .catch((err) => console.error("probe digest failed", err))
      .finally(scheduleProbeDigest);
  }, next - now);
}

// Caddy, on this same box, is the only thing that should talk to us — trust
// its X-Forwarded-For so req.ip is the visitor, not 127.0.0.1.
app.set("trust proxy", "loopback");

// Real files win over the tripwire: trees.exe's /trees/*.bin.gz would trip
// the "backup" trap otherwise. Misses (and dotfiles, which static ignores)
// fall through to it.
app.use(express.static(OUT_DIR, {
  extensions: ["html"],
  etag: true,
  maxAge: "1h",
})
);
app.use(tripwire);

app.use(express.json());

// Fallback to index.html for “routes” (not real files)
app.get(/^(?!.*\.).*$/, (req, res) => {
  res.sendFile(path.join(OUT_DIR, "index.html"));
});

function sanitizeForLog(value) {
  const normalized = String(value ?? "").normalize("NFKC");

  return normalized
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LOG_LENGTH);
}

function sanitizeSessionId(value) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  if (!normalized) return "";
  return normalized
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, MAX_SESSION_ID_LENGTH);
}

function sanitizeClientTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function sanitizeInputDeltaMs(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(MAX_INPUT_DELTA_MS, parsed));
}

function getPlaybackDeltaMs(sessionId, nowMs) {
  if (!sessionId) return null;
  const previous = sessionLastLogAt.get(sessionId);
  sessionLastLogAt.set(sessionId, nowMs);

  if (sessionLastLogAt.size > MAX_TRACKED_SESSIONS) {
    const oldestKey = sessionLastLogAt.keys().next().value;
    if (oldestKey) sessionLastLogAt.delete(oldestKey);
  }

  if (typeof previous !== "number") return 0;
  return Math.max(0, Math.min(MAX_DELTA_MS, nowMs - previous));
}

function shouldLogQuery(sessionId, query, nowMs) {
  const key = `${sessionId || "anon"}:${query}`;
  const lastLoggedAt = recentlyLoggedQueries.get(key);

  if (typeof lastLoggedAt === "number" && nowMs - lastLoggedAt < QUERY_DEDUP_WINDOW_MS) {
    return false;
  }

  recentlyLoggedQueries.set(key, nowMs);

  // Opportunistic cleanup to avoid unbounded growth.
  if (recentlyLoggedQueries.size > MAX_TRACKED_QUERIES) {
    for (const [entry, loggedAt] of recentlyLoggedQueries) {
      if (nowMs - loggedAt >= QUERY_DEDUP_WINDOW_MS) {
        recentlyLoggedQueries.delete(entry);
      }
    }
  }

  return true;
}

app.post("/log-search", (req, res) => {
  const query = sanitizeForLog(req.body?.query);
  const sessionId = sanitizeSessionId(req.body?.sessionId);
  const clientAt = sanitizeClientTimestamp(req.body?.at);
  const inputDeltaMs = sanitizeInputDeltaMs(req.body?.inputDeltaMs);

  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  const now = Date.now();
  if (shouldLogQuery(sessionId, query, now)) {
    const deltaMs = getPlaybackDeltaMs(sessionId, now);
    const { flagged, categories } = detectMaliciousSearch(query);
    const record = {
      query,
      at: clientAt || new Date(now).toISOString(),
      session: sessionId || undefined,
      delta_ms: deltaMs,
      input_delta_ms: inputDeltaMs,
    };
    // A hostile query is still recorded verbatim (sanitized) and still played
    // back in the History window — it's just tagged so the UI can render it
    // inert and labelled, and so triage never suggests it as an issue title.
    if (flagged) {
      record.flagged = true;
      record.categories = categories;
    }
    console.log(record);
    if (flagged) {
      console.warn("flagged-search", { categories, session: sessionId || undefined });
    }
    appendSearchRecord(record);
    bufferSearchEntry(sessionId, {
      query,
      at: record.at,
      atMs: Date.parse(record.at) || now,
      flagged,
      categories,
    });
  }

  res.sendStatus(204); // No Content
});

app.listen(PORT, () => {
  console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
  console.log(
    `tripwire armed (log=${TRIPWIRE_LOG_FILE}, dotenv=${DOTENV_FILE || "none"}` +
      (NOTIFY_KIND ? `, digest=${TRIPWIRE_DIGEST_HOUR_UTC}:00 UTC)` : ")")
  );
  scheduleProbeDigest();
  if (NOTIFY_KIND) {
    const known = ["telegram", "ntfy", "webhook"].includes(NOTIFY_KIND);
    console.log(
      known
        ? `search-session notifier armed (kind=${NOTIFY_KIND}, idle=${Math.round(SESSION_IDLE_MS / 1000)}s)`
        : `search-notify: unknown SEARCH_NOTIFY_KIND=${NOTIFY_KIND} (want telegram | ntfy | webhook) — notifier disabled`
    );
  }
});
