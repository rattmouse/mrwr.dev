/**
 * Where the walker is: TreesWalk (out through cubicles.exe's hallway doors)
 * says, every so often, and trees.exe draws a little figure there on its map;
 * drag the figure and trees.exe says back where to put them. A
 * BroadcastChannel, so it reaches every trees.exe on the origin — the one on
 * the desktop, the one in the computer on the cubicle's desk, another tab.
 */

const CHANNEL = "trees:walker";

/** Where the walker stands: degrees, and metres above sea level — feet, and the ground under them. */
export type WalkerAt = { type: "at"; lat: number; lon: number; z: number; ground: number; yaw: number };
/** The other way: trees.exe, with the figure dragged across its map, putting the walker down somewhere else. */
export type WalkerMove = { type: "move"; lat: number; lon: number };
export type WalkerMessage = WalkerAt | WalkerMove | { type: "gone" };

/** How long a position is believed without another, in case the walk ended without saying so. */
export const WALKER_STALE_MS = 3000;

export function walkerChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}
