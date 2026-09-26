import type { NotepadIncoming } from "@/components/windows/NotepadWindow";
import { Layout, ProgramWindowId, WindowBox, WindowId } from "@/components/windows/windowTypes";
import { programDef } from "@/components/windows/programs";
import type { VersionEntry } from "@/lib/versions.types";
import type { SearchIssueLink } from "@/lib/searchHistory.types";

/**
 * What the desktop hands every program. The first half is the window itself —
 * where it sits and what its title bar buttons do — and goes straight on to
 * DesktopWindow through `windowFrame`. The rest is for the few programs that
 * need something from outside; the others just ignore it.
 */
export type ProgramProps = {
  layout: Layout;
  stackIndex?: number;
  /** The focused window. Only it takes the keyboard, so the games don't fight over it. */
  active?: boolean;
  onFocus?: () => void;
  cascadeX?: number;
  cascadeY?: number;
  box?: WindowBox | null;
  onBoxChange?: (box: WindowBox) => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;

  versions: VersionEntry[];
  notepadDoc?: NotepadIncoming | null;
  onNotepadDocApplied?: () => void;
  issueReveal?: SearchIssueLink | null;
  onIssueRevealed?: () => void;
  onOpenWindow?: (id: WindowId) => void;
};

/**
 * The DesktopWindow props every program starts from: its title, icon and
 * opening size out of programs.ts, and the window's place and buttons from
 * the desktop. Spread it first, then add whatever the program does to its
 * own frame (a toolbar, a shake, a melt).
 */
export function windowFrame(id: ProgramWindowId, props: ProgramProps) {
  const def = programDef(id);
  return {
    title: def.title,
    titleIcon: def.icon,
    normalWidth: def.size.width,
    normalHeight: def.size.height,
    layout: props.layout,
    stackIndex: props.stackIndex,
    active: props.active,
    onFocus: props.onFocus,
    cascadeX: props.cascadeX,
    cascadeY: props.cascadeY,
    box: props.box,
    onBoxChange: props.onBoxChange,
    onClose: props.onClose,
    onMinimize: props.onMinimize,
    onToggleMaximize: props.onToggleMaximize,
  };
}

// Hand the browser a file to save — midi.exe's, Notepad's and Paint's Save all
// land here. Nothing touches the network.
export function downloadBlob(data: string | Uint8Array | Blob, filename: string, mime?: string) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Where a submenu opens beside the row that asked for it, in px from the top
// of the menu the row sits in.
export function submenuTopForRow(target: EventTarget & Element) {
  const row = target as HTMLElement;
  const parent = row.parentElement as HTMLElement | null;
  if (!parent) return 0;
  const rowRect = row.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return Math.max(0, Math.round(rowRect.top - parentRect.top) - 1);
}
