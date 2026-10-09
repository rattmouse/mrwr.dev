/**
 * The pieces of trees.exe's right-click ring menu (TreesRingMenu) that more
 * than one place builds it from: trees.exe itself, and the walk out through
 * cubicles.exe's hallway doors (TreesWalk), which has fewer settings but the
 * same Trees ring and the same Layers.
 */

import { PAUSE_PATH, PLAY_PATH } from "@/components/common/MediaGlyphs";
import type { Ring, RingNode } from "@/components/windows/TreesRingMenu";
import type { TreesMode } from "@/components/windows/TreesWindow";
import { dayLabel, doy } from "@/lib/treeSeasons";

/** Pixel rectangles [x, y, w, h] on the 12px glyph grid, as one path. */
export const rects = (list: [number, number, number, number][]) =>
  list.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join("");

/**
 * The layer buttons' icons, for when trees.exe's panel is too narrow for
 * their names, and on the menu's Layers ring: a street tree by the curb, a
 * clump of canopy, a park bench, water, a pit under the pavement, a warp
 * pipe, and a rat.
 */
export const LAYER_ICONS: Record<string, string> = {
  Street: "M4 1h4v1h1v1h1v3H9v1H3V6H2V3h1V2h1z" + rects([[5, 7, 2, 3], [0, 10, 12, 1]]),
  Canopy:
    "M1 4h4v1h1v3H0V5h1zM7 4h4v1h1v3H6V5h1zM4 1h4v1h1v3H3V2h1z" + rects([[2, 8, 1, 3], [9, 8, 1, 3], [5, 5, 2, 6]]),
  Parks: rects([[1, 2, 10, 2], [0, 5, 12, 2], [1, 7, 1, 4], [10, 7, 1, 4], [2, 4, 1, 1], [9, 4, 1, 1]]),
  Water: rects(
    [1, 5, 9].flatMap((y): [number, number, number, number][] => [
      [0, y + 1, 2, 1],
      [2, y, 3, 1],
      [5, y + 1, 3, 1],
      [8, y, 3, 1],
      [11, y + 1, 1, 1],
    ]),
  ),
  Underground: rects([[0, 2, 12, 1], [2, 3, 1, 8], [9, 3, 1, 8], [3, 10, 6, 1], [4, 5, 1, 1], [7, 7, 1, 1], [5, 8, 1, 1]]),
  // A warp pipe, as in the first Super Mario Bros.: the wide lip, the narrower
  // pipe under it, and the shine down the left of both.
  Pipes: rects([
    [0, 1, 1, 4],
    [2, 1, 10, 4],
    [1, 6, 1, 6],
    [3, 6, 8, 6],
  ]),
  // Side on, facing right: ear, back, body and snout, a tail curling off behind, feet.
  Rats: rects([
    [7, 3, 1, 1],
    [4, 4, 6, 1],
    [3, 5, 9, 1],
    [2, 6, 8, 1],
    [3, 7, 7, 1],
    [1, 7, 1, 1],
    [0, 6, 1, 1],
    [0, 4, 1, 2],
    [4, 8, 1, 1],
    [8, 8, 1, 1],
  ]),
};

/** How the trees are colored, each marked by its own coloring of the tree icon. */
export const COLORINGS: { id: TreesMode; label: string; title: string; icon: string }[] = (
  [
    ["season", "Season", "Every tree as it looks on a day of the year", "../w95_tree_season.ico"],
    ["species", "Type", "The commonest kinds of tree, by color", "../w95_tree_type.ico"],
    ["planted", "Age", "The trees standing by a given year, newest lit up", "../w95_tree_age.ico"],
  ] as const
).map(([id, label, title, icon]) => ({ id, label, title: `${label}: ${title}`, icon }));

/** The Day slider's ticks: each month's first day of the year. */
export const MONTH_STARTS = Array.from({ length: 12 }, (_, k) => doy(k + 1, 1));

/** The colorings as the Trees ring's icons. One that `can` refuses is grayed, with `why` as its tooltip. */
export function coloringItems(
  mode: TreesMode,
  setMode: (mode: TreesMode) => void,
  can: (mode: TreesMode) => boolean = () => true,
  why = "",
): RingNode[] {
  return COLORINGS.map((m) => ({
    label: m.label,
    title: can(m.id) ? m.title : `${m.label}: ${why}`,
    image: m.icon,
    role: "menuitemradio",
    on: m.id === mode,
    disabled: !can(m.id),
    // The menu stays open, its timeline and Types swapping round to suit.
    keepOpen: true,
    onSelect: () => setMode(m.id),
  }));
}

export function playItem(playing: boolean, toggle: () => void, can = true, title = playing ? "Pause" : "Play the year"): RingNode {
  return {
    label: playing ? "Pause" : "Play",
    title,
    glyph: playing ? PAUSE_PATH : PLAY_PATH,
    role: "menuitemcheckbox",
    on: playing,
    disabled: !can,
    keepOpen: true,
    onSelect: toggle,
  };
}

/** Season's timeline as a slider bent round the ring, ticked by month. */
export function dayItem(day: number, setDay: (day: number) => void, can = true): RingNode {
  return {
    label: "Day",
    value: dayLabel(day),
    title: "Drag along the arc to move through the year",
    disabled: !can,
    keepOpen: true,
    scrub: { value: day, min: 0, max: 364, step: 7, ticks: MONTH_STARTS, onChange: setDay },
  };
}

/**
 * The Trees ring, 36° a slot: the colorings up the left to the top, then Play
 * starting right at 12 o'clock. With a timeline, its slider takes the whole
 * rest of the ring after Play, clockwise like a clock's hand; without one
 * (Type), `when` is a plain slot below the colorings instead.
 */
export function treesRing(colorings: RingNode[], play: RingNode, when: RingNode): Ring {
  return when.scrub
    ? { step: 360 / 5, start: 270 - 3 * 36, weights: [36, 36, 36, 36, 360 - 4 * 36], items: [...colorings, play, when] }
    : { step: 36, start: 270 - 4 * 36, items: [when, ...colorings, play] };
}

/** The Layers ring: each layer's icon, pressed in while it's showing, flipped without closing the menu. */
export function layerItems(layers: { label: string; title: string; on: boolean; disabled?: boolean; toggle: () => void }[]): RingNode[] {
  return layers.map((l) => ({
    label: l.label,
    title: `${l.label}: ${l.title}`,
    glyph: LAYER_ICONS[l.label],
    role: "menuitemcheckbox",
    on: l.on,
    disabled: l.disabled,
    keepOpen: true,
    onSelect: l.toggle,
  }));
}
