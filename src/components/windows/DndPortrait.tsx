"use client";

import React from "react";
import type { Character } from "@/lib/dnd";

/**
 * A 24×31 pixel "loadout" tile in the spirit of a 1995 inventory screen — no
 * person, just what they wear, laid out like an armour stand: head, chest,
 * hands, legs, feet, with their held item beside it, all standing on a ground
 * line. Class picks what's in each slot (plate, robe, hood, sandals…), race
 * picks the colours it's all made in (steel and blue, bronze and rust…) and
 * how tall the stand is — a short race's pieces sit closer together and the
 * whole kit is drawn smaller, a tall race's spread out and fill the tile — and
 * alignment picks the backdrop: good/neutral/evil is the hue,
 * lawful/neutral/chaotic is the pattern (bricks / dither / diagonals).
 */

const W = 24;
const H = 31;

// The kit is composed at full size on its own sheet, with a gap between the
// pieces that grows with height (0–MAX_GAP rows), then shrunk by race height
// onto the tile. The shortest race still gets well over half size so the
// pieces stay legible.
const MAX_GAP = 2;
const SHEET = 24 + 3 * MAX_GAP;
const GROUND_Y = H - 1;
const SHORTEST_IN = 36;
const TALLEST_IN = 76;
const MIN_SCALE = 0.6;

// Where each slot sits on the stand, and how big it is. `gap` is the number
// of empty rows between pieces — more for a tall race, none for a short one.
type Slot = "head" | "chest" | "hands" | "legs" | "feet";
type Box = { x: number; y: number; w: number; h: number };
function slotBoxes(gap: number): Record<Slot, Box[]> & { item: Box } {
  const chestY = 6 + gap;
  const legsY = chestY + 8 + gap;
  const feetY = legsY + 6 + gap;
  return {
    head: [{ x: 4, y: 0, w: 8, h: 6 }],
    chest: [{ x: 3, y: chestY, w: 10, h: 8 }],
    hands: [
      { x: 0, y: chestY + 2, w: 3, h: 5 },
      { x: 13, y: chestY + 2, w: 3, h: 5 },
    ],
    legs: [{ x: 4, y: legsY, w: 8, h: 6 }],
    feet: [
      { x: 3, y: feetY, w: 4, h: 3 },
      { x: 9, y: feetY, w: 4, h: 3 },
    ],
    item: { x: 17, y: chestY + 1, w: 7, h: 7 },
  };
}
const KIT_W = 24; // stand (16) + gap (1) + item (7)

// Race sets the palette everything is made in: the metal and the cloth.
type Material = { metal: string; metalShade: string; cloth: string; clothShade: string; name: string };
const MATERIALS: Record<string, Material> = {
  Human: { metal: "#a8a8a8", metalShade: "#606060", cloth: "#3858b8", clothShade: "#203070", name: "steel" },
  Elf: { metal: "#b8e0c8", metalShade: "#5a9a78", cloth: "#2e8b57", clothShade: "#1a5a38", name: "mithril" },
  Dwarf: { metal: "#c88040", metalShade: "#7a4a20", cloth: "#a03020", clothShade: "#601810", name: "bronze" },
  Halfling: { metal: "#c87838", metalShade: "#804818", cloth: "#9ab030", clothShade: "#5a6818", name: "copper" },
  Gnome: { metal: "#e0c050", metalShade: "#907820", cloth: "#8040a0", clothShade: "#502068", name: "brass" },
  "Half-Elf": { metal: "#d0d8e0", metalShade: "#788088", cloth: "#209090", clothShade: "#105858", name: "silver" },
  "Half-Orc": { metal: "#686868", metalShade: "#303030", cloth: "#586028", clothShade: "#303818", name: "iron" },
  Tiefling: { metal: "#c02838", metalShade: "#701018", cloth: "#401020", clothShade: "#200810", name: "crimson steel" },
  Dragonborn: { metal: "#3868c8", metalShade: "#203878", cloth: "#d0a020", clothShade: "#806010", name: "cobalt" },
};
const DEFAULT_MATERIAL = MATERIALS.Human;

// Typical adult height per race, in inches, for the gauge and the caption.
const HEIGHTS: Record<string, number> = {
  Human: 68,
  Elf: 70,
  Dwarf: 54,
  Halfling: 36,
  Gnome: 40,
  "Half-Elf": 67,
  "Half-Orc": 74,
  Tiefling: 69,
  Dragonborn: 76,
};

// Glyph legend: # metal, + metal shade, c cloth, d cloth shade, b leather,
// w highlight, . nothing. Hands and feet are drawn for the left side and
// mirrored for the right.
type Piece = { name: string; glyph: string[] };

const HEADS: Record<string, Piece> = {
  helm: { name: "helm", glyph: ["..####..", ".######.", "########", "#+####+#", "#+.##.+#", ".++..++."] },
  cap: { name: "cap", glyph: ["..bbbb..", ".bbbbbb.", "bbbbbbbb", ".b....b.", "........", "........"] },
  hood: { name: "hood", glyph: ["..cccc..", ".cccccc.", "cccddccc", "ccd..dcc", "cd....dc", "cc....cc"] },
  hat: { name: "pointy hat", glyph: ["....c...", "...cc...", "...ccc..", "..cccc..", ".cccccd.", "cccccccc"] },
};
const CHESTS: Record<string, Piece> = {
  plate: {
    name: "plate",
    glyph: [".##....##.", ".###..###.", ".########.", ".#w######.", ".########.", ".#+####+#.", "..######..", "..++++++.."],
  },
  mail: {
    name: "mail",
    glyph: [".##....##.", ".#+#..#+#.", ".#+#+#+#+.", ".##+#+#+#.", ".#+#+#+#+.", ".##+#+#+#.", "..#+#+#+..", "..######.."],
  },
  jerkin: {
    name: "leathers",
    glyph: [".bb....bb.", ".bbb..bbb.", ".bbbbbbbb.", ".bbbwbbbb.", ".bbbbbbbb.", ".bbb..bbb.", "..bbbbbb..", "..bbbbbb.."],
  },
  robe: {
    name: "robes",
    glyph: [".cc....cc.", ".ccc..ccc.", ".cccddccc.", ".cccddccc.", ".cccddccc.", ".cccddccc.", "..ccddcc..", "..cccccc.."],
  },
  tunic: {
    name: "tunic",
    glyph: [".cc....cc.", ".ccc..ccc.", ".cccccccc.", ".cccccccc.", ".cccccccc.", ".ccbbbbcc.", "..cccccc..", "..cccccc.."],
  },
};
const HANDS: Record<string, Piece> = {
  gauntlets: { name: "gauntlets", glyph: ["###", "#+#", "###", "##.", "+#."] },
  gloves: { name: "gloves", glyph: ["bbb", "bbb", "bbb", "bb.", "bb."] },
  wraps: { name: "wraps", glyph: ["ccc", "cdc", "ccc", "cc.", "dc."] },
};
const LEGS: Record<string, Piece> = {
  greaves: { name: "greaves", glyph: [".##..##.", ".##..##.", ".#+..+#.", ".##..##.", ".#+..+#.", ".##..##."] },
  trousers: { name: "trousers", glyph: [".cc..cc.", ".cc..cc.", ".cd..dc.", ".cc..cc.", ".cd..dc.", ".cc..cc."] },
  skirt: { name: "robe skirt", glyph: [".cccccc.", ".ccddcc.", ".ccddcc.", "cccddccc", "cccddccc", "cccccccc"] },
  kilt: { name: "hide kilt", glyph: [".bbbbbb.", ".bbbbbb.", ".bb.bbb.", ".bb..bb.", "........", "........"] },
};
const FEET: Record<string, Piece> = {
  sabatons: { name: "sabatons", glyph: [".##.", "###.", "####"] },
  boots: { name: "boots", glyph: [".bb.", ".bb.", "bbbb"] },
  sandals: { name: "sandals", glyph: ["....", ".c..", "bbbb"] },
};
const ITEMS: Record<string, Piece> = {
  greataxe: { name: "greataxe", glyph: ["...##..", "..###+.", ".b###+.", "..b##+.", "..b....", ".b.....", "b......"] },
  lute: { name: "lute", glyph: [".....b.", "....b..", "...b...", ".###...", "#+w+#..", "#+++#..", ".###..."] },
  symbol: { name: "holy symbol", glyph: ["..#....", "..#....", "#####..", "..#+...", "..#+...", "..#+...", "..#+..."] },
  sprig: { name: "sprig", glyph: ["....cc.", "...cdcc", "..ccdcc", ".cccdc.", ".ccd...", "bc.....", "b......"] },
  longsword: { name: "longsword", glyph: ["......#", ".....#w", "....#w.", ".b.#w..", "..bb...", ".bb.b..", "b......"] },
  staff: { name: "staff", glyph: ["......#", ".....b.", "....b..", "...b...", "..b....", ".b.....", "b......"] },
  shield: { name: "shield", glyph: ["#######", "#w###w#", "##w#w##", "###w##+", ".####+.", "..##+..", "...#..."] },
  longbow: { name: "longbow", glyph: ["#......", "##.....", "#.#....", "#..#...", "#.#....", "##.....", "#......"] },
  dagger: { name: "dagger", glyph: ["....#..", "...#w..", "..#w...", ".#w....", "b#.....", "bb.....", "......."] },
  spark: { name: "spark", glyph: ["...#...", ".#.#.#.", "..#w#..", "##www##", "..#w#..", ".#.#.#.", "...#..."] },
  eye: { name: "patron's eye", glyph: [".......", ".#####.", "#..+..#", "#.+w+.#", "#..+..#", ".#####.", "......."] },
  book: { name: "spellbook", glyph: ["bbbbbbb", "bwwwwwb", "bw#w#wb", "bwwwwwb", "bw#w#wb", "bwwwwwb", "bbbbbbb"] },
};

type Loadout = {
  head: Piece | null;
  chest: Piece;
  hands: Piece | null;
  legs: Piece;
  feet: Piece | null;
  item: Piece;
};
const LOADOUTS: Record<string, Loadout> = {
  Barbarian: { head: null, chest: CHESTS.jerkin, hands: null, legs: LEGS.kilt, feet: FEET.boots, item: ITEMS.greataxe },
  Bard: { head: HEADS.cap, chest: CHESTS.tunic, hands: HANDS.gloves, legs: LEGS.trousers, feet: FEET.boots, item: ITEMS.lute },
  Cleric: { head: null, chest: CHESTS.mail, hands: HANDS.gauntlets, legs: LEGS.greaves, feet: FEET.sabatons, item: ITEMS.symbol },
  Druid: { head: HEADS.hood, chest: CHESTS.tunic, hands: null, legs: LEGS.trousers, feet: FEET.sandals, item: ITEMS.sprig },
  Fighter: { head: HEADS.helm, chest: CHESTS.plate, hands: HANDS.gauntlets, legs: LEGS.greaves, feet: FEET.sabatons, item: ITEMS.longsword },
  Monk: { head: null, chest: CHESTS.tunic, hands: HANDS.wraps, legs: LEGS.trousers, feet: null, item: ITEMS.staff },
  Paladin: { head: HEADS.helm, chest: CHESTS.plate, hands: HANDS.gauntlets, legs: LEGS.greaves, feet: FEET.sabatons, item: ITEMS.shield },
  Ranger: { head: HEADS.cap, chest: CHESTS.jerkin, hands: HANDS.gloves, legs: LEGS.trousers, feet: FEET.boots, item: ITEMS.longbow },
  Rogue: { head: HEADS.hood, chest: CHESTS.jerkin, hands: HANDS.gloves, legs: LEGS.trousers, feet: FEET.boots, item: ITEMS.dagger },
  Sorcerer: { head: null, chest: CHESTS.robe, hands: null, legs: LEGS.skirt, feet: FEET.sandals, item: ITEMS.spark },
  Warlock: { head: HEADS.hood, chest: CHESTS.robe, hands: HANDS.gloves, legs: LEGS.skirt, feet: FEET.boots, item: ITEMS.eye },
  Wizard: { head: HEADS.hat, chest: CHESTS.robe, hands: null, legs: LEGS.skirt, feet: FEET.sandals, item: ITEMS.book },
};
const DEFAULT_LOADOUT = LOADOUTS.Fighter;

const MOOD_COLOURS: Record<"good" | "neutral" | "evil", [string, string]> = {
  good: ["#87ceeb", "#b8e4ff"],
  neutral: ["#a0a0a0", "#c0c0c0"],
  evil: ["#301040", "#501860"],
};

function backdropAt(alignment: string, x: number, y: number): string {
  const mood = alignment.endsWith("Good") ? "good" : alignment.endsWith("Evil") ? "evil" : "neutral";
  const [a, b] = MOOD_COLOURS[mood];
  if (alignment.startsWith("Lawful")) {
    // Bricks: mortar every fourth row, joints staggered.
    if (y % 4 === 0) return a;
    return (x + (y >> 2) * 2) % 4 === 0 ? a : b;
  }
  if (alignment.startsWith("Chaotic")) {
    return (x + y) % 4 < 2 ? a : b;
  }
  return (x + y) % 2 === 0 ? a : b;
}

function inkFor(ch: string, m: Material): string | null {
  switch (ch) {
    case "#":
      return m.metal;
    case "+":
      return m.metalShade;
    case "c":
      return m.cloth;
    case "d":
      return m.clothShade;
    case "b":
      return "#8a5a2a";
    case "w":
      return "#ffffff";
    default:
      return null;
  }
}

export function heightOf(race: string): number {
  return HEIGHTS[race] ?? 68;
}

/** 0 for the shortest race, 1 for the tallest. */
function tallness(race: string): number {
  const t = (heightOf(race) - SHORTEST_IN) / (TALLEST_IN - SHORTEST_IN);
  return Math.max(0, Math.min(1, t));
}

export function describeHeight(race: string): string {
  const inches = heightOf(race);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** "steel plate, longsword" — what the tile is showing, for the caption. */
export function describeKit(character: Pick<Character, "race" | "cls">): string {
  const material = MATERIALS[character.race] ?? DEFAULT_MATERIAL;
  const kit = LOADOUTS[character.cls] ?? DEFAULT_LOADOUT;
  return `${material.name} ${kit.chest.name}, ${kit.item.name}`;
}

/** Everything worn, head to toe, for the tooltip / screen reader. */
export function listGear(character: Pick<Character, "race" | "cls">): string {
  const kit = LOADOUTS[character.cls] ?? DEFAULT_LOADOUT;
  return [kit.head, kit.chest, kit.hands, kit.legs, kit.feet, kit.item]
    .map((p) => p?.name ?? "—")
    .join(" · ");
}

type PortraitProps = {
  character: Pick<Character, "race" | "cls" | "alignment">;
  /** Rendered size in CSS px; the art is square. */
  size?: number;
  style?: React.CSSProperties;
};

export default function DndPortrait({ character, size = 72, style }: PortraitProps) {
  const material = MATERIALS[character.race] ?? DEFAULT_MATERIAL;
  const kit = LOADOUTS[character.cls] ?? DEFAULT_LOADOUT;
  const t = tallness(character.race);
  const boxes = slotBoxes(Math.round(t * MAX_GAP));
  const kitRows = boxes.feet[0].y + boxes.feet[0].h;

  // Compose the kit at full size on a transparent sheet (null = see-through).
  const sheet: (string | null)[][] = [];
  for (let y = 0; y < SHEET; y++) sheet.push(new Array<string | null>(KIT_W).fill(null));

  const blit = (piece: Piece, box: Box, mirror: boolean) => {
    for (let gy = 0; gy < box.h; gy++) {
      const row = piece.glyph[gy] ?? "";
      for (let gx = 0; gx < box.w; gx++) {
        const ink = inkFor(row[mirror ? box.w - 1 - gx : gx] ?? ".", material);
        if (ink) sheet[box.y + gy][box.x + gx] = ink;
      }
    }
  };

  // An empty slot gets a dotted outline, like an inventory screen's empty box.
  const outline = (box: Box) => {
    for (let gy = 0; gy < box.h; gy++) {
      for (let gx = 0; gx < box.w; gx++) {
        const edge = gy === 0 || gy === box.h - 1 || gx === 0 || gx === box.w - 1;
        if (edge && (gx + gy) % 2 === 0) sheet[box.y + gy][box.x + gx] = "#202020";
      }
    }
  };

  const place = (slot: Slot, piece: Piece | null) => {
    boxes[slot].forEach((box, i) => {
      if (piece) blit(piece, box, i === 1);
      else outline(box);
    });
  };
  place("head", kit.head);
  place("chest", kit.chest);
  place("hands", kit.hands);
  place("legs", kit.legs);
  place("feet", kit.feet);
  blit(kit.item, boxes.item, false);

  // Backdrop, then the kit shrunk by race height (nearest neighbour, so it
  // stays chunky), centred and standing on the ground line.
  const grid: string[][] = [];
  for (let y = 0; y < H; y++) {
    grid.push([]);
    for (let x = 0; x < W; x++) grid[y].push(y === GROUND_Y ? "#202020" : backdropAt(character.alignment, x, y));
  }
  const scale = MIN_SCALE + (1 - MIN_SCALE) * t;
  const drawW = Math.max(1, Math.round(KIT_W * scale));
  const drawH = Math.max(1, Math.round(kitRows * scale));
  const ox = Math.floor((W - drawW) / 2);
  const oy = GROUND_Y - drawH;
  for (let y = 0; y < drawH; y++) {
    const sy = Math.min(kitRows - 1, Math.floor(((y + 0.5) / drawH) * kitRows));
    for (let x = 0; x < drawW; x++) {
      const sx = Math.min(KIT_W - 1, Math.floor(((x + 0.5) / drawW) * KIT_W));
      const ink = sheet[sy][sx];
      if (ink) grid[oy + y][ox + x] = ink;
    }
  }

  const pixels: React.ReactNode[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      pixels.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={grid[y][x]} />);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={Math.round((size * W) / H)}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${material.name} kit: ${listGear(character)}; ${describeHeight(character.race)} tall; ${character.alignment}`}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      {pixels}
    </svg>
  );
}
