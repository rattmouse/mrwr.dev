export type WindowId = "welcome" | "about" | "projects" | "contact" | "collections" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint";

export type ProgramWindowId = "welcome" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint";
export type DocumentWindowId = "about" | "projects" | "contact" | "collections";

export type Layout = "normal" | "docked" | "maximized";

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return (
    id === "welcome" ||
    id === "notepad" ||
    id === "issues" ||
    id === "changes" ||
    id === "music" ||
    id === "midi" ||
    id === "paint"
  );
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return id === "about" || id === "projects" || id === "contact" || id === "collections";
}
