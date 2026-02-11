export type WindowId = "welcome" | "about" | "projects" | "contact" | "notepad" | "issues";

export type ProgramWindowId = "welcome" | "notepad" | "issues";
export type DocumentWindowId = "about" | "projects" | "contact";

export type Layout = "normal" | "docked" | "maximized";

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return id === "welcome" || id === "notepad" || id === "issues";
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return id === "about" || id === "projects" || id === "contact";
}
