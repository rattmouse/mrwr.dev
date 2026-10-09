/**
 * trees.exe's Type and Age colors, shared with the walk out through
 * cubicles.exe's hallway doors (TreesWalk) so the city looks the same from
 * the ground as from above.
 */

import type { Trees } from "@/lib/trees";
import { isConifer, RGB } from "@/lib/treeSeasons";

/** Where Age's timeline starts. */
export const YEAR_MIN = 1950;

/** Type's commonest genera, in order, then the conifers and everything else. */
export const GROUP_COLORS = [
  "#ff6b3d",
  "#ff8fc0",
  "#c86ae0",
  "#f2f2e6",
  "#c99a4a",
  "#7fd6e8",
  "#e84a5f",
  "#f5e663",
  "#a98cff",
  "#5fa8ff",
  "#8fe36b",
];
export const CONIFER_COLOR = "#2fa86b";
export const OTHER_COLOR = "#7d8a80";

/** The LiDAR trees in Type: they have no species, so they stay in the background. */
export const CROWN_BROADLEAF: RGB = [84, 98, 82];
export const CROWN_CONIFER: RGB = [40, 104, 74];

const GENUS_NAMES: Record<string, string> = {
  Acer: "Maples",
  Prunus: "Cherries & plums",
  Malus: "Apples",
  Cornus: "Dogwoods",
  Quercus: "Oaks",
  Pyrus: "Pears",
  Crataegus: "Hawthorns",
  Betula: "Birches",
  Magnolia: "Magnolias",
  Fraxinus: "Ashes",
  Carpinus: "Hornbeams",
  Tilia: "Lindens",
  Amelanchier: "Serviceberries",
  Liquidambar: "Sweetgums",
  Styrax: "Snowbells",
  Ulmus: "Elms",
};

export const hexRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** A whole-number year's trees: newest near-white, a few years on bright green, settling to dark. */
export function plantedColor(age: number): RGB {
  if (age <= 0) return [255, 248, 196];
  if (age < 3) return mixRgb([170, 240, 110], [120, 200, 90], (age - 1) / 2);
  return mixRgb([120, 200, 90], [56, 112, 64], Math.min(1, (age - 3) / 12));
}

export type TreeGroup = { key: string; label: string; color: string; count: number };

/**
 * Type's legend: the commonest broadleaf genera, a color each, then the
 * conifers and everything else; and which of them each species falls in.
 */
export function speciesGroups(trees: Trees, speciesCount: Int32Array): { groups: TreeGroup[]; groupOf: Uint8Array } {
  const genusCount = new Map<string, number>();
  trees.species.forEach((sp, s) => {
    if (isConifer(sp.genus) || sp.genus === "Unknown") return;
    genusCount.set(sp.genus, (genusCount.get(sp.genus) ?? 0) + speciesCount[s]);
  });
  const top = [...genusCount].sort((a, b) => b[1] - a[1]).slice(0, GROUP_COLORS.length);
  const groups: TreeGroup[] = top.map(([genus, count], k) => ({
    key: genus,
    label: GENUS_NAMES[genus] ?? genus,
    color: GROUP_COLORS[k],
    count,
  }));
  const coniferIdx = groups.length;
  groups.push({ key: "conifers", label: "Conifers", color: CONIFER_COLOR, count: 0 });
  const otherIdx = groups.length;
  groups.push({ key: "other", label: "Everything else", color: OTHER_COLOR, count: 0 });
  const groupOf = new Uint8Array(trees.species.length);
  trees.species.forEach((sp, s) => {
    const k = groups.findIndex((g) => g.key === sp.genus);
    const idx = k >= 0 ? k : isConifer(sp.genus) ? coniferIdx : otherIdx;
    groupOf[s] = idx;
    if (k < 0) groups[idx].count += speciesCount[s];
  });
  return { groups, groupOf };
}
