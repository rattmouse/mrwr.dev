export type WindowId = "welcome" | "about" | "projects" | "demos" | "contact" | "collections" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint" | "party" | "player" | "marbles" | "tasks" | "cubicles" | "bash";

export type ProgramWindowId = "welcome" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint" | "party" | "player" | "marbles" | "tasks" | "cubicles" | "bash";
export type DocumentWindowId = "about" | "projects" | "demos" | "contact" | "collections";

/**
 * How a window sits on the desktop. "minimized" is the taskbar state: the
 * window stays mounted and keeps running — music carries on playing, a game
 * keeps its run — but it is not painted and takes no clicks, and its taskbar
 * button is the way back.
 */
export type Layout = "normal" | "minimized" | "maximized";

/**
 * Where a window sits and how big it is, in viewport px from the top-left.
 * Every window gets one as soon as it first appears on the desktop, so from
 * then on it stays exactly where it is — resizing the browser doesn't move it.
 * Null only for a window that hasn't been laid out yet.
 */
/** What a taskbar button's right-click menu can do to its window. */
export type WindowAction = "restore" | "minimize" | "maximize" | "center" | "close";

export type WindowBox = { left: number; top: number; width: number; height: number };

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return (
    id === "welcome" ||
    id === "notepad" ||
    id === "issues" ||
    id === "changes" ||
    id === "music" ||
    id === "midi" ||
    id === "paint" ||
    id === "party" ||
    id === "marbles" ||
    id === "player" ||
    id === "tasks" ||
    id === "cubicles" ||
    id === "bash"
  );
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return id === "about" || id === "projects" || id === "demos" || id === "contact" || id === "collections";
}
