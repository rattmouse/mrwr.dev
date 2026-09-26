/**
 * Every window the desktop can open, in one place. Adding a program is one
 * entry here plus its component, registered in `ProgramWindow.tsx` — the
 * window ids, the title bar, the taskbar button, the Start menu and bash.exe's
 * home dir all read from this list, so none of them can be forgotten or drift
 * apart.
 *
 * This file is metadata only. The components are mapped in `ProgramWindow.tsx`,
 * so a program can import its own entry from here without a loop.
 */

/** Where a window is listed in the Start menu. The folders are StartMenu's. */
export type MenuFolder = "documents" | "programs" | "app" | "tools" | "toys";

export type ProgramDef = {
  /**
   * "program" windows are drawn by their own component (see ProgramWindow.tsx);
   * "document" windows are the read-only pages DocumentWindow draws.
   */
  kind: "program" | "document";
  /** What the window calls itself — its title bar and its taskbar button. */
  title: string;
  /** The icon it wears everywhere: title bar, taskbar, Start menu. */
  icon: string;
  /** Its size when it first opens, before it's been dragged or resized. */
  size: { width?: number; height: number };
  /** Its Start menu entry, listed in the order this file gives. */
  menu?: { label: string; folder: MenuFolder };
  /** bash.exe lists it in the guest's home dir, by its title, with this blurb. */
  shell?: { blurb: string };
};

export const PROGRAMS = {
  welcome: {
    kind: "program",
    title: "mrwr.dev",
    icon: "../w95_desktop.ico",
    size: { height: 160 },
    menu: { label: "Welcome", folder: "programs" },
  },
  issues: {
    kind: "program",
    title: "issues.exe",
    icon: "../w98_issues.ico",
    size: { height: 300 },
    menu: { label: "Issues", folder: "app" },
    shell: { blurb: "every issue this site has ever had." },
  },
  changes: {
    kind: "program",
    title: "changes.exe",
    icon: "../w95_changes.ico",
    size: { width: 420, height: 420 },
    menu: { label: "Changes", folder: "app" },
    shell: { blurb: "the version history." },
  },
  notepad: {
    kind: "program",
    title: "notepad.exe",
    icon: "../w95_notepad.ico",
    size: { height: 300 },
    menu: { label: "Notepad", folder: "tools" },
    shell: { blurb: "a blank page, the way it used to be." },
  },
  paint: {
    kind: "program",
    title: "paint.exe",
    icon: "../w95_paint.ico",
    size: { width: 410, height: 320 },
    menu: { label: "Paint", folder: "tools" },
    shell: { blurb: "a little painting program." },
  },
  player: {
    kind: "program",
    title: "player.exe",
    icon: "../w95_player.ico",
    size: { width: 440, height: 420 },
    menu: { label: "Media", folder: "tools" },
    shell: { blurb: "plays whatever you give it." },
  },
  bash: {
    kind: "program",
    title: "cmd.exe",
    icon: "../w98_console_prompt.ico",
    size: { width: 560, height: 360 },
    menu: { label: "Terminal", folder: "tools" },
  },
  collections: {
    kind: "document",
    title: "collections.exe",
    icon: "../w98_collections_cards.ico",
    size: { width: 340, height: 356 },
    menu: { label: "Collections", folder: "toys" },
  },
  music: {
    kind: "program",
    title: "strudel.cc",
    icon: "../w98_repl.ico",
    size: { height: 220 },
    menu: { label: "Sounds", folder: "toys" },
    shell: { blurb: "live-code some music." },
  },
  midi: {
    kind: "program",
    title: "midi.exe",
    icon: "../w98_music.ico",
    size: { width: 560, height: 480 },
    menu: { label: "Keys", folder: "toys" },
    shell: { blurb: "a MIDI keyboard, no piano required." },
  },
  party: {
    kind: "program",
    title: "party.webp",
    icon: "../w98_regedit.ico",
    size: { width: 560, height: 460 },
    menu: { label: "Party", folder: "toys" },
    shell: { blurb: "a party that broke out of its picture frame." },
  },
  marbles: {
    kind: "program",
    title: "marbles.exe",
    icon: "../w98_world_star.ico",
    size: { width: 560, height: 420 },
    menu: { label: "Marbles", folder: "toys" },
    shell: { blurb: "a physics toy: marbles on a course." },
  },
  tasks: {
    kind: "program",
    title: "tasks.exe",
    icon: "../w98_installer_file_gear.ico",
    size: { width: 620, height: 480 },
    menu: { label: "Tasks", folder: "toys" },
    shell: { blurb: "survive the workday." },
  },
  cubicles: {
    kind: "program",
    title: "cubicles.exe",
    icon: "../w98_joystick.ico",
    size: { width: 640, height: 460 },
    menu: { label: "Cubicles", folder: "toys" },
    shell: { blurb: "a first-person office you can walk around." },
  },
  about: {
    kind: "document",
    title: "about.txt",
    icon: "../w95_default.ico",
    size: { height: 200 },
    menu: { label: "About", folder: "documents" },
  },
  projects: {
    kind: "document",
    title: "projects.txt",
    icon: "../w95_default.ico",
    size: { width: 340, height: 360 },
    menu: { label: "Projects", folder: "documents" },
  },
  demos: {
    kind: "document",
    title: "demos.txt",
    icon: "../w95_default.ico",
    size: { width: 340, height: 360 },
    menu: { label: "Demos", folder: "documents" },
  },
  contact: {
    kind: "document",
    title: "contact.txt",
    icon: "../w95_default.ico",
    size: { height: 200 },
    menu: { label: "Contact", folder: "documents" },
  },
} as const satisfies Record<string, ProgramDef>;

type Programs = typeof PROGRAMS;

export type WindowId = keyof Programs;
export type ProgramWindowId = { [K in WindowId]: Programs[K]["kind"] extends "program" ? K : never }[WindowId];
export type DocumentWindowId = Exclude<WindowId, ProgramWindowId>;

export const WINDOW_IDS = Object.keys(PROGRAMS) as WindowId[];

export function programDef(id: WindowId): ProgramDef {
  return PROGRAMS[id];
}

export function isWindowId(value: unknown): value is WindowId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROGRAMS, value);
}

export function isProgramWindow(id: WindowId): id is ProgramWindowId {
  return PROGRAMS[id].kind === "program";
}

export function isDocumentWindow(id: WindowId): id is DocumentWindowId {
  return PROGRAMS[id].kind === "document";
}
