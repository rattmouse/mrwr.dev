import { Layout, WindowBox, WindowId } from "@/components/windows/windowTypes";
import { isWindowId } from "@/components/windows/programs";

/**
 * The desktop as it was left: which windows were open, in what stacking order,
 * which had the focus, and where each was put and how big it was made. Kept in
 * localStorage so a return visit picks up where the last one stopped; Shut Down
 * wipes it, so powering back on is a clean start.
 */
export type SavedWindow = {
  id: WindowId;
  layout: Layout;
  cascade: number;
  box: WindowBox | null;
};

export type SavedDesktop = {
  windows: SavedWindow[];
  focused: WindowId | null;
};

const STORAGE_KEY = "mrwr:desktop";
// Bumped if the shape changes, so an old save is ignored rather than misread.
const VERSION = 4;

// Mirrors DesktopWindow's smallest window.
const MIN_W = 220;
const MIN_H = 130;

/**
 * The desktop inside cubicles.exe's in-world browser is this same site on this
 * same origin — same storage. Left alone it would open with your windows and
 * then write its own over them, so a framed copy neither reads nor saves.
 */
export function canPersistDesktop(): boolean {
  return typeof window !== "undefined" && window.self === window.top;
}

const LAYOUTS: Layout[] = ["normal", "minimized", "maximized"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Only the shape is checked here. Keeping a window reachable on whatever size
// the browser is now is DesktopWindow's job, so a save made on a big monitor
// still comes back usable on a small one.
function readBox(raw: unknown): WindowBox | null {
  if (!raw || typeof raw !== "object") return null;
  const { left, top, width, height } = raw as Record<string, unknown>;
  if (!isFiniteNumber(left) || !isFiniteNumber(top) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return { left, top, width: Math.max(MIN_W, width), height: Math.max(MIN_H, height) };
}

export function loadDesktop(): SavedDesktop | null {
  if (!canPersistDesktop()) return null;
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { v, windows, focused } = parsed as Record<string, unknown>;
  if (v !== VERSION || !Array.isArray(windows)) return null;

  const seen = new Set<WindowId>();
  const restored: SavedWindow[] = [];
  for (const entry of windows) {
    if (!entry || typeof entry !== "object") continue;
    const { id, layout, cascade, box } = entry as Record<string, unknown>;
    if (!isWindowId(id) || seen.has(id)) continue;
    if (!LAYOUTS.includes(layout as Layout) || !isFiniteNumber(cascade)) continue;
    seen.add(id);
    restored.push({ id, layout: layout as Layout, cascade, box: readBox(box) });
  }

  // The focus only goes back to a window that's open and not on the taskbar,
  // and the focused window is always the one on top.
  const front = restored.find((w) => w.id === focused && w.layout !== "minimized");
  if (!front) return { windows: restored, focused: null };
  return { windows: [...restored.filter((w) => w !== front), front], focused: front.id };
}

export function saveDesktop(desktop: SavedDesktop): void {
  if (!canPersistDesktop()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, ...desktop }));
  } catch {
    // Storage full or blocked — the desktop just won't be remembered.
  }
}

export function clearDesktop(): void {
  if (!canPersistDesktop()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
