/**
 * Where the walker is: TreesWalk (out through cubicles.exe's hallway doors)
 * says, every so often, and trees.exe draws a little figure there on its map;
 * drag the figure and trees.exe says back where to put them. The walk's
 * right-click menu says when any of its settings change, and trees.exe
 * follows. A
 * BroadcastChannel, so it reaches every trees.exe on the origin — the one on
 * the desktop, the one in the computer on the cubicle's desk, another tab.
 */

const CHANNEL = "trees:walker";

/** Where the walker stands: degrees, and metres above sea level — feet, and the ground under them. */
export type WalkerAt = { type: "at"; lat: number; lon: number; z: number; ground: number; yaw: number };
/** The other way: trees.exe, with the figure dragged across its map, putting the walker down somewhere else. */
export type WalkerMove = { type: "move"; lat: number; lon: number };
/**
 * The walk's settings, changed from its right-click menu, for every trees.exe
 * to take up too: the map's layers and Sun, and the trees' coloring — the
 * kind picked out of Type (an index into its legend, which both work out
 * alike), the day or year, and whether it's playing.
 */
export type WalkerLayers = {
  street: boolean;
  canopy: boolean;
  parks: boolean;
  water: boolean;
  underground: boolean;
  rats: boolean;
  pipes: boolean;
};
export type WalkerTrees = {
  mode?: "season" | "species" | "planted";
  group?: number | null;
  day?: number;
  year?: number;
  playing?: boolean;
};
export type WalkerMap = { type: "map"; layers?: WalkerLayers; sunHour?: number; trees?: WalkerTrees };
export type WalkerMessage = WalkerAt | WalkerMove | WalkerMap | { type: "gone" };

/** How long a position is believed without another, in case the walk ended without saying so. */
export const WALKER_STALE_MS = 3000;

export function walkerChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}
