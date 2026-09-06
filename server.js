const express = require("express");
const path = require("path");
const fs = require("fs");

// Malicious-search classifier. A missing module (e.g. a deploy that forgot to
// ship search-guard.js) must not 500 every search — degrade to "nothing is
// flagged" and say so once, loudly.
let detectMaliciousSearch;
try {
  ({ detectMaliciousSearch } = require("./search-guard"));
} catch (err) {
  console.error("search-guard module missing — searches will not be flagged", err);
  detectMaliciousSearch = () => ({ flagged: false, categories: [] });
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

// Best-effort single-generation rotation so the archive can't grow unbounded.
function rotateSearchLogIfLarge() {
  fs.stat(SEARCH_LOG_FILE, (statErr, stats) => {
    if (statErr || stats.size <= SEARCH_LOG_MAX_BYTES) return;
    fs.rename(SEARCH_LOG_FILE, `${SEARCH_LOG_FILE}.1`, (renameErr) => {
      if (renameErr) console.error("search-log rotate failed", renameErr);
    });
  });
}

function appendSearchRecord(record) {
  rotateSearchLogIfLarge();
  fs.appendFile(SEARCH_LOG_FILE, `${JSON.stringify(record)}\n`, (err) => {
    if (err) console.error("search-log append failed", err);
  });
}

app.use(express.json());
app.use(express.static(OUT_DIR, {
  extensions: ["html"],
  etag: true,
  maxAge: "1h",
})
);

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
  }

  res.sendStatus(204); // No Content
});

app.listen(PORT, () => {
  console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
});
