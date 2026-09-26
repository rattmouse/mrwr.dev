import { WindowId } from "@/components/windows/windowTypes";

/**
 * What every window calls itself, and the icon it wears. The window's own title
 * bar and its button down on the taskbar read from the same place, so the two
 * can never drift apart.
 */
export const WINDOW_TITLES: Record<WindowId, string> = {
  welcome: "mrwr.dev",
  about: "about.txt",
  projects: "projects.txt",
  demos: "demos.txt",
  contact: "contact.txt",
  collections: "collections.exe",
  notepad: "notepad.exe",
  issues: "issues.exe",
  changes: "changes.exe",
  music: "strudel.cc",
  midi: "midi.exe",
  paint: "paint.exe",
  party: "party.webp",
  player: "player.exe",
  marbles: "marbles.exe",
  tasks: "tasks.exe",
  cubicles: "cubicles.exe",
  bash: "cmd.exe",
};

export const WINDOW_ICONS: Record<WindowId, string> = {
  welcome: "../w95_desktop.ico",
  about: "../w95_default.ico",
  projects: "../w95_default.ico",
  demos: "../w95_default.ico",
  contact: "../w95_default.ico",
  collections: "../w98_collections_cards.ico",
  notepad: "../w95_notepad.ico",
  issues: "../w98_issues.ico",
  changes: "../w95_changes.ico",
  music: "../w98_repl.ico",
  midi: "../w98_music.ico",
  paint: "../w95_paint.ico",
  party: "../w98_regedit.ico",
  player: "../w95_player.ico",
  marbles: "../w98_world_star.ico",
  tasks: "../w98_installer_file_gear.ico",
  cubicles: "../w98_joystick.ico",
  bash: "../w98_console_prompt.ico",
};
