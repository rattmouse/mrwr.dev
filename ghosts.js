// Ghost cursors: every visitor's pointer, drifting over everyone else's
// desktop. A WebSocket at /ghosts; nothing here is stored, and nothing a
// visitor sends is text — a cursor is a few numbers and, when it's over a
// window, which one — so there is nothing to moderate.
//
// Each cursor comes in as fractions of the sender's screen (0–10000), plus,
// over a window, fractions of that window. Whoever has the same window open
// draws the ghost inside it; everyone else falls back to the screen position.
// Ten times a second the server sends everyone one message with whatever
// moved and whoever left. Ids are per connection and random, so a ghost is
// nobody in particular, and nobody's address goes anywhere.

const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PATH = "/ghosts";
const TICK_MS = 100;
const PING_MS = 30 * 1000;
// A cursor that hasn't moved in this long stops being drawn for anyone until
// it moves again.
const STILL_MS = 60 * 1000;
const MAX_SOCKETS = 300;
const MAX_SOCKETS_PER_IP = 8;
// Cursors sent per tick at most; past this, the ones that moved longest ago wait.
const MAX_SHOWN = 40;
// Messages a socket may send per second before the extras are dropped, and
// the rate past which it's closed.
const MSG_PER_S = 25;
const MSG_PER_S_CLOSE = 120;
const SCALE = 10000;
const WINDOW_ID = /^[a-z]{1,24}$/;

// socket -> { id, cursor, dirty, movedAt, budget, budgetAt, alive }
const clients = new Map();
const socketsByIp = new Map();
// Ids whose cursor went away since the last tick.
const gone = new Set();
// Someone came or went, so everyone's visitor count is out of date.
let countChanged = false;

function onScreen() {
  return Array.from(clients.values())
    .filter((c) => c.cursor)
    .sort((a, b) => b.movedAt - a.movedAt)
    .slice(0, MAX_SHOWN);
}

function frac(value) {
  return Number.isInteger(value) && value >= 0 && value <= SCALE ? value : null;
}

// [x, y] or [x, y, windowId, wx, wy] in; null for anything else.
function parseCursor(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const x = frac(data[0]);
  const y = frac(data[1]);
  if (x === null || y === null) return null;
  if (data.length === 2) return [x, y];
  if (data.length !== 5 || typeof data[2] !== "string" || !WINDOW_ID.test(data[2])) return null;
  const wx = frac(data[3]);
  const wy = frac(data[4]);
  if (wx === null || wy === null) return null;
  return [x, y, data[2], wx, wy];
}

function hide(client) {
  if (!client.cursor) return;
  client.cursor = null;
  client.dirty = false;
  gone.add(client.id);
}

function onMessage(client, socket, raw) {
  const now = Date.now();
  if (now - client.budgetAt >= 1000) {
    client.budgetAt = now;
    client.budget = 0;
  }
  client.budget += 1;
  if (client.budget > MSG_PER_S_CLOSE) return socket.close(1008, "too fast");
  if (client.budget > MSG_PER_S) return;

  // "0" is the page saying its pointer left, or the tab went to the background.
  if (raw === "0") return hide(client);
  const cursor = parseCursor(raw);
  if (!cursor) return;
  client.cursor = cursor;
  client.dirty = true;
  client.movedAt = now;
  gone.delete(client.id);
}

function tick() {
  const now = Date.now();
  for (const client of clients.values()) {
    if (client.cursor && now - client.movedAt > STILL_MS) hide(client);
  }

  const moved = [];
  for (const client of clients.values()) {
    if (client.dirty) moved.push(client);
  }
  if (!moved.length && !gone.size && !countChanged) return;

  // Of the cursors on screen, only the MAX_SHOWN most recently moved are sent
  // at all — a crowd beyond that would just be noise over the windows.
  const shown = new Set(onScreen().map((c) => c.id));
  const cursors = [];
  for (const c of moved) {
    if (!shown.has(c.id)) continue;
    c.dirty = false;
    cursors.push([c.id, ...c.cursor]);
  }
  if (!cursors.length && !gone.size && !countChanged) return;

  const message = JSON.stringify({ c: cursors, g: Array.from(gone), n: clients.size });
  gone.clear();
  countChanged = false;
  for (const socket of clients.keys()) {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

// Same site only: the page that opens the socket must have come from the host
// it's talking to (Caddy passes the visitor's Host header through).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function mountGhosts(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256, perMessageDeflate: false });

  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url || "").split("?")[0];
    if (pathname !== PATH) return socket.destroy();
    // Express's "trust proxy" doesn't reach upgrades, so read Caddy's header
    // the same way: only when the connection itself is from this box.
    const peer = req.socket.remoteAddress || "";
    const local = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const ip = (local && forwarded) || peer || "unknown";
    const fromIp = socketsByIp.get(ip) || 0;
    if (!sameOrigin(req) || clients.size >= MAX_SOCKETS || fromIp >= MAX_SOCKETS_PER_IP) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, ip));
  });

  wss.on("connection", (socket, ip) => {
    const client = {
      id: crypto.randomBytes(4).toString("hex"),
      cursor: null,
      dirty: false,
      movedAt: 0,
      budget: 0,
      budgetAt: Date.now(),
      alive: true,
    };
    clients.set(socket, client);
    countChanged = true;
    socketsByIp.set(ip, (socketsByIp.get(ip) || 0) + 1);

    // Who you are (so your own cursor isn't drawn back at you), and everyone
    // already on screen.
    const here = onScreen().map((c) => [c.id, ...c.cursor]);
    socket.send(JSON.stringify({ you: client.id, c: here, g: [], n: clients.size }));

    socket.on("message", (data, isBinary) => {
      if (!isBinary) onMessage(client, socket, data.toString());
    });
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("close", () => {
      clients.delete(socket);
      const left = (socketsByIp.get(ip) || 1) - 1;
      if (left > 0) socketsByIp.set(ip, left);
      else socketsByIp.delete(ip);
      gone.add(client.id);
      countChanged = true;
    });
    socket.on("error", () => {});
  });

  setInterval(tick, TICK_MS).unref();
  setInterval(() => {
    for (const [socket, client] of clients) {
      if (!client.alive) {
        socket.terminate();
        continue;
      }
      client.alive = false;
      socket.ping();
    }
  }, PING_MS).unref();
}

module.exports = { mountGhosts };
