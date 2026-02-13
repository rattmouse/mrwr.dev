const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_QUERY_LOG_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 64;
const QUERY_DEDUP_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_QUERIES = 5000;
const recentlyLoggedQueries = new Map();
const MAX_TRACKED_SESSIONS = 5000;
const sessionLastLogAt = new Map();
const MAX_DELTA_MS = 30 * 1000;

const OUT_DIR = path.join(__dirname, ".");

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

function shouldLogQuery(query, nowMs) {
  const lastLoggedAt = recentlyLoggedQueries.get(query);

  if (typeof lastLoggedAt === "number" && nowMs - lastLoggedAt < QUERY_DEDUP_WINDOW_MS) {
    return false;
  }

  recentlyLoggedQueries.set(query, nowMs);

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

  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  const now = Date.now();
  if (shouldLogQuery(query, now)) {
    const deltaMs = getPlaybackDeltaMs(sessionId, now);
    console.log({
      query,
      session: sessionId || undefined,
      delta_ms: deltaMs,
    });
  }

  res.sendStatus(204); // No Content
});

app.listen(PORT, () => {
  console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}`);
});
