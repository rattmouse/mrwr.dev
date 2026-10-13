"use client";

import { WindowId, isWindowId } from "@/components/windows/programs";

/**
 * Ghost cursors: the other visitors' pointers, from server.js's /ghosts socket
 * (ghosts.js). This end sends where our pointer is — as a fraction of the
 * screen, and of the window it's over — and keeps the latest of everyone
 * else's for GhostCursors to draw and the taskbar's GhostTray to count.
 *
 * `next dev` has no such socket, so it isn't tried there. Anywhere else a
 * failure just means no ghosts: it retries quietly, backing off to a minute.
 */

export type Ghost = {
  /** Where it is on its owner's screen, 0–1. */
  x: number;
  y: number;
  /** The window it's over, and where in that window, 0–1. */
  window?: WindowId;
  wx?: number;
  wy?: number;
  /** performance.now() when it last moved. */
  movedAt: number;
};

export type GhostStatus = {
  /** Whether this visitor wants to see (and be) a ghost. */
  enabled: boolean;
  /** Everyone else connected right now, or null while not connected. */
  others: number | null;
  /** Ghosts out on the desktop right now — drawn, or there to draw once enabled. */
  visible: number;
};

const SCALE = 10000;
const SEND_EVERY_MS = 80;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 60 * 1000;
const STORAGE_KEY = "mrwr:ghosts";

const ghosts = new Map<string, Ghost>();
const ghostListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
let status: GhostStatus = { enabled: true, others: null, visible: 0 };
let statusLoaded = false;

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function setStatus(next: Partial<GhostStatus>) {
  status = { ...status, ...next };
  statusListeners.forEach((fn) => fn());
}

function ghostsChanged() {
  ghostListeners.forEach((fn) => fn());
  if (status.visible !== ghosts.size) setStatus({ visible: ghosts.size });
}

export const ghostStatusStore = {
  subscribe(fn: () => void) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
  get(): GhostStatus {
    if (!statusLoaded && typeof window !== "undefined") {
      statusLoaded = true;
      status = { ...status, enabled: loadEnabled() };
    }
    return status;
  },
  onServer(): GhostStatus {
    return { enabled: false, others: null, visible: 0 };
  },
};

/** Every ghost on screen right now, by id. Read it when `subscribeGhosts` fires. */
export function currentGhosts(): ReadonlyMap<string, Ghost> {
  return ghosts;
}

export function subscribeGhosts(fn: () => void) {
  ghostListeners.add(fn);
  return () => {
    ghostListeners.delete(fn);
  };
}

export function setGhostsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private mode — the choice lasts until the tab closes.
  }
  setStatus({ enabled });
}

function frac(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value / SCALE)) : null;
}

type Message = { you?: string; c?: unknown[]; g?: unknown[]; n?: number };

function applyMessage(message: Message, me: { id: string | null }) {
  if (typeof message.you === "string") me.id = message.you;
  const now = performance.now();
  let changed = false;
  for (const entry of message.c ?? []) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0] === me.id) continue;
    const x = frac(entry[1]);
    const y = frac(entry[2]);
    if (x === null || y === null) continue;
    const ghost: Ghost = { x, y, movedAt: now };
    const wx = frac(entry[4]);
    const wy = frac(entry[5]);
    if (isWindowId(entry[3]) && wx !== null && wy !== null) {
      ghost.window = entry[3];
      ghost.wx = wx;
      ghost.wy = wy;
    }
    ghosts.set(entry[0], ghost);
    changed = true;
  }
  for (const id of message.g ?? []) {
    if (typeof id === "string" && ghosts.delete(id)) changed = true;
  }
  if (changed) ghostsChanged();
  if (typeof message.n === "number") setStatus({ others: Math.max(0, message.n - 1) });
}

function clearGhosts() {
  if (ghosts.size) {
    ghosts.clear();
    ghostsChanged();
  }
}

/** Where the pointer is, in the form the socket takes; null when it's nowhere we can say. */
function cursorOf(event: PointerEvent): string | null {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return null;
  const scaled = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * SCALE);
  const x = scaled(event.clientX / w);
  const y = scaled(event.clientY / h);
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-window-id]") : null;
  const id = target?.dataset.windowId;
  if (target && id && isWindowId(id)) {
    const rect = target.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const wx = scaled((event.clientX - rect.left) / rect.width);
      const wy = scaled((event.clientY - rect.top) / rect.height);
      return JSON.stringify([x, y, id, wx, wy]);
    }
  }
  return JSON.stringify([x, y]);
}

/**
 * Opens the socket and returns the stop. Owned by GhostCursors. It stays open
 * with ghosts turned off, so the tray still knows when there are any to turn
 * back on for; only our own pointer stops going out.
 */
export function connectGhosts(): () => void {
  if (process.env.NODE_ENV === "development") return () => {};

  let socket: WebSocket | null = null;
  let stopped = false;
  let retryMs = RETRY_MIN_MS;
  let retryTimer = 0;
  let sendTimer = 0;
  let pending: string | null = null;
  let lastSent: string | null = null;
  const me: { id: string | null } = { id: null };

  const send = (data: string) => {
    if (socket?.readyState !== WebSocket.OPEN || data === lastSent) return;
    socket.send(data);
    lastSent = data;
  };

  const flush = () => {
    sendTimer = 0;
    if (pending !== null) send(pending);
    pending = null;
  };

  const onPointerMove = (event: PointerEvent) => {
    // A finger on glass isn't a pointer anyone else needs to watch.
    if (event.pointerType === "touch" || !status.enabled) return;
    const cursor = cursorOf(event);
    if (!cursor) return;
    pending = cursor;
    if (!sendTimer) sendTimer = window.setTimeout(flush, SEND_EVERY_MS);
  };

  const hide = () => {
    pending = null;
    send("0");
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!event.relatedTarget) hide();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hide();
  };
  // Turning ghosts off takes ours off everyone else's desktop too.
  const onStatus = () => {
    if (!status.enabled) hide();
  };

  const open = () => {
    if (stopped) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ghosts`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      retryMs = RETRY_MIN_MS;
      lastSent = null;
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        applyMessage(JSON.parse(event.data) as Message, me);
      } catch {
        // A message we can't read is one ghost frame missed.
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      me.id = null;
      clearGhosts();
      setStatus({ others: null });
      if (stopped) return;
      retryTimer = window.setTimeout(open, retryMs);
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    };
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("visibilitychange", onVisibility);
  statusListeners.add(onStatus);
  open();

  return () => {
    stopped = true;
    window.clearTimeout(retryTimer);
    window.clearTimeout(sendTimer);
    window.removeEventListener("pointermove", onPointerMove, { capture: true });
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("visibilitychange", onVisibility);
    statusListeners.delete(onStatus);
    const ws = socket;
    socket = null;
    ws?.close();
    clearGhosts();
    setStatus({ others: null });
  };
}
