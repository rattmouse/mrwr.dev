export type WindowId = "welcome" | "about" | "projects" | "demos" | "contact" | "collections" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint" | "dnd";

export type ProgramWindowId = "welcome" | "notepad" | "issues" | "changes" | "music" | "midi" | "paint" | "dnd";
export type DocumentWindowId = "about" | "projects" | "demos" | "contact" | "collections";

export type Layout = "normal" | "docked" | "maximized";

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return (
    id === "welcome" ||
    id === "notepad" ||
    id === "issues" ||
    id === "changes" ||
    id === "music" ||
    id === "midi" ||
    id === "paint" ||
    id === "dnd"
  );
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return id === "about" || id === "projects" || id === "demos" || id === "contact" || id === "collections";
}
