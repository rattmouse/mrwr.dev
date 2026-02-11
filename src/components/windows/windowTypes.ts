export type WindowId = "welcome" | "about" | "projects" | "contact" | "notepad" | "issues" | "changes" | "osci";

export type ProgramWindowId = "welcome" | "notepad" | "issues" | "changes" | "osci";
export type DocumentWindowId = "about" | "projects" | "contact";

export type Layout = "normal" | "docked" | "maximized";

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return id === "welcome" || id === "notepad" || id === "issues" || id === "changes" || id === "osci";
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return id === "about" || id === "projects" || id === "contact";
}
