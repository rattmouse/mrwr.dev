"use client";

import React, { useId } from "react";
import type { Character } from "@/lib/dnd";
import { GUYS_SHEET, guyBounds, tintGuys, type GuySheet } from "@/lib/guys";

/**
 * A 24×31 pixel tile in the spirit of a 1995 inventory screen — and the same
 * tile the party walks around party.webp's canvas wearing. One of the little
 * painted figures from that canvas' crowd stands on it, dressed head to toe in
 * pixel gear: head, chest, hands, legs, feet, with their held item beside them.
 *
 * Class picks what's in each slot (plate, robe, hood, sandals…) and an empty
 * slot simply leaves the figure bare there. Race picks the colours the gear is
 * made in (steel and blue, bronze and rust…) and how tall the figure stands —
 * a short race's pieces sit closer together and the whole kit is drawn smaller,
 * a tall race's spread out and fill the tile. Alignment lights a glow behind
 * them: good/neutral/evil is the hue, lawful/neutral/chaotic is the shape — a
 * tight steady halo, a soft one, or a ragged restless aura.
 *
 * The figure itself is not coloured here. It is tinted with whatever the
 * Palette is set to, exactly like the rest of the crowd, so a party member is
 * one more guy on the canvas rather than a species of their own.
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
const STAND_W = 16; // the figure and what it wears; the held item sits to its right
const KIT_W = STAND_W + 1 + 7; // stand + gap + item

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

// Alignment is a light behind the figure rather than wallpaper behind a stand.
// Good/neutral/evil is the hue; these are saturated enough to read on a pale
// canvas surface as well as a dark one, since the tile is drawn on both.
const GLOW_COLOURS: Record<"good" | "neutral" | "evil", [number, number, number]> = {
  good: [127, 212, 255],
  neutral: [168, 174, 192],
  evil: [194, 75, 224],
};

type Order = "lawful" | "neutral" | "chaotic";

/**
 * Lawful keeps its light close, bright and even; chaotic throws it wide and
 * lets the edge wander. The further a glow reaches the fainter it burns, or the
 * chaotic ones would swamp the figure standing in them.
 */
const GLOW_SHAPE: Record<Order, { radius: number; falloff: number; peak: number }> = {
  lawful: { radius: 0.8, falloff: 2.4, peak: 0.86 },
  neutral: { radius: 1, falloff: 1.7, peak: 0.72 },
  chaotic: { radius: 1.2, falloff: 1.5, peak: 0.6 },
};

function moodOf(alignment: string): "good" | "neutral" | "evil" {
  return alignment.endsWith("Good") ? "good" : alignment.endsWith("Evil") ? "evil" : "neutral";
}

function orderOf(alignment: string): Order {
  return alignment.startsWith("Lawful") ? "lawful" : alignment.startsWith("Chaotic") ? "chaotic" : "neutral";
}

/**
 * How brightly the glow burns at one pixel: 0 for bare tile, up to GLOW_PEAK
 * at its heart. The glow is squashed vertically so it hugs a standing figure,
 * and brightens along the ground line, where the light pools at their feet.
 */
function glowAt(
  alignment: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  spread: number,
): number {
  const order = orderOf(alignment);
  const dx = x - cx;
  const dy = (y - cy) * 1.25;
  let dist = Math.sqrt(dx * dx + dy * dy);
  const { radius, falloff, peak } = GLOW_SHAPE[order];
  if (order === "chaotic") {
    // Two harmonics of the angle alone: the edge comes out lobed and frayed
    // rather than striped, which is what mixing x and y into it would give.
    const angle = Math.atan2(dy, dx);
    dist += Math.sin(angle * 5) * 1.3 + Math.sin(angle * 9 + 1.7) * 0.9;
  }
  const reach = Math.max(1, spread * radius);
  const lit = Math.pow(Math.max(0, 1 - dist / reach), falloff) * peak;
  return Math.min(peak, y === GROUND_Y ? lit * 1.5 : lit);
}

function glowInk(alignment: string, alpha: number): string {
  const [r, g, b] = GLOW_COLOURS[moodOf(alignment)];
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
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
    .map((p) => p?.name ?? "bare")
    .join(" · ");
}

/** The palette's own first accent, for a caller with nothing to say about it. */
const DEFAULT_TINT = "#5eead4";

/**
 * Which figure of the sheet a character is. Stable per race/class/alignment, so
 * the same kind of adventurer is always the same person, and two of them are
 * only twins if they really are the same build.
 */
function poseOf(character: Pick<Character, "race" | "cls" | "alignment">): number {
  const key = `${character.race}|${character.cls}|${character.alignment}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % GUYS_SHEET.count;
}

type Placed = { x: number; y: number; fill: string };

type Composition = {
  /** The alignment glow — only the pixels it actually lights. */
  glow: Placed[];
  /** Where the painted figure stands, and the patch of sheet it is cut from. */
  figure: {
    x: number;
    y: number;
    w: number;
    h: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  };
  /** The gear, scaled to the figure and laid over it. */
  gear: Placed[];
};

/**
 * The whole tile worked out once — glow behind, figure, gear in front — so the
 * SVG in the Party panel and the canvas sprite on party.webp draw the same
 * picture by the same numbers.
 */
function compose(character: Pick<Character, "race" | "cls" | "alignment">): Composition {
  const material = MATERIALS[character.race] ?? DEFAULT_MATERIAL;
  const kit = LOADOUTS[character.cls] ?? DEFAULT_LOADOUT;
  const t = tallness(character.race);
  const boxes = slotBoxes(Math.round(t * MAX_GAP));
  const kitRows = boxes.feet[0].y + boxes.feet[0].h;

  // Compose the gear at full size on a transparent sheet (null = see-through).
  // It is layered over the figure, so anything left null shows bare skin.
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

  // An empty slot is not drawn at all — a bare head, bare hands, bare feet.
  const place = (slot: Slot, piece: Piece | null) => {
    if (!piece) return;
    boxes[slot].forEach((box, i) => blit(piece, box, i === 1));
  };
  place("head", kit.head);
  place("chest", kit.chest);
  place("hands", kit.hands);
  place("legs", kit.legs);
  place("feet", kit.feet);
  blit(kit.item, boxes.item, false);

  // The kit is shrunk by race height (nearest neighbour, so it stays chunky),
  // centred and standing on the ground line.
  const scale = MIN_SCALE + (1 - MIN_SCALE) * t;
  const drawW = Math.max(1, Math.round(KIT_W * scale));
  const drawH = Math.max(1, Math.round(kitRows * scale));
  const ox = Math.floor((W - drawW) / 2);
  const oy = GROUND_Y - drawH;

  // The figure fills the stand; the held item hangs in the column to its right,
  // so the glow and the body both centre on the stand rather than on the tile.
  //
  // It is the figure's ink that is fitted to the stand, not its cell — crown of
  // the head at the top of the head slot, soles on the ground line — so the
  // boots land on his feet however much blank cell he was packed with. That
  // stretches a stooped pose to the same height as an upright one, which is the
  // point: how tall he stands is the race's business, set by drawH above.
  const standW = (drawW * STAND_W) / KIT_W;
  const ink = guyBounds(poseOf(character));
  const figureW = Math.max(1, (drawH * ink.w) / ink.h);
  const figure = {
    x: ox + standW / 2 - figureW / 2,
    y: oy,
    w: figureW,
    h: drawH,
    sx: ink.x,
    sy: ink.y,
    sw: ink.w,
    sh: ink.h,
  };

  const cx = ox + standW / 2;
  const cy = oy + drawH * 0.55;
  const spread = 6 + drawH * 0.18;
  const glow: Placed[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const alpha = glowAt(character.alignment, x, y, cx, cy, spread);
      if (alpha > 0.01) glow.push({ x, y, fill: glowInk(character.alignment, alpha) });
    }
  }

  const gear: Placed[] = [];
  for (let y = 0; y < drawH; y++) {
    const sy = Math.min(kitRows - 1, Math.floor(((y + 0.5) / drawH) * kitRows));
    for (let x = 0; x < drawW; x++) {
      const sx = Math.min(KIT_W - 1, Math.floor(((x + 0.5) / drawW) * KIT_W));
      const ink = sheet[sy][sx];
      if (ink) gear.push({ x: ox + x, y: oy + y, fill: ink });
    }
  }

  return { glow, figure, gear };
}

const sprites = new Map<string, HTMLCanvasElement>();

/**
 * The same tile as a one-pixel-per-pixel canvas, for the crowd on party.webp's
 * canvas — a party member is a drawImage a frame rather than a few hundred rects.
 * Cached per look, since two Human Fighters of the same alignment in the same
 * palette are the same picture. Without the sheet loaded yet the glow and the
 * gear are drawn anyway; the figure joins them the moment it arrives, under a
 * key of its own.
 */
export function portraitSprite(
  character: Pick<Character, "race" | "cls" | "alignment">,
  tint: string,
  sheet: GuySheet | null,
): HTMLCanvasElement | null {
  const key = `${character.race}|${character.cls}|${character.alignment}|${tint}|${sheet ? "guy" : "bare"}`;
  const cached = sprites.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { glow, figure, gear } = compose(character);
  for (const { x, y, fill } of glow) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, 1, 1);
  }
  if (sheet) {
    // The figure is a photograph of a painting, so it is allowed to resample
    // smoothly on the way down; the gear over it stays hard-edged.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      tintGuys(sheet, tint),
      figure.sx,
      figure.sy,
      figure.sw,
      figure.sh,
      figure.x,
      figure.y,
      figure.w,
      figure.h,
    );
  }
  for (const { x, y, fill } of gear) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, 1, 1);
  }

  sprites.set(key, canvas);
  return canvas;
}

/** How wide the tile is for a given height, so callers keep it in proportion. */
export const portraitWidth = (height: number) => Math.round((height * W) / H);

type PortraitProps = {
  character: Pick<Character, "race" | "cls" | "alignment">;
  /** Rendered size in CSS px; the art is square. */
  size?: number;
  /** What to paint the figure itself — the Palette's colour, as for the crowd. */
  tint?: string;
  style?: React.CSSProperties;
};

export default function DndPortrait({ character, size = 72, tint = DEFAULT_TINT, style }: PortraitProps) {
  // React's generated ids contain colons, which a url(#…) reference can't take.
  const tintId = `guy-tint-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const material = MATERIALS[character.race] ?? DEFAULT_MATERIAL;
  const { glow, figure, gear } = compose(character);
  const scaleX = figure.w / figure.sw;
  const scaleY = figure.h / figure.sh;

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
      <defs>
        {/* Recolour the painted ink by its alpha, the way tintGuys does on
            canvas. The region is the figure's own rectangle, which both keeps
            the filter cheap and crops the sheet down to the one cell. */}
        <filter
          id={tintId}
          filterUnits="userSpaceOnUse"
          x={figure.x}
          y={figure.y}
          width={figure.w}
          height={figure.h}
        >
          <feFlood floodColor={tint} result="ink" />
          <feComposite in="ink" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      {glow.map(({ x, y, fill }) => (
        <rect key={`g${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
      <image
        href={GUYS_SHEET.src}
        x={figure.x - figure.sx * scaleX}
        y={figure.y - figure.sy * scaleY}
        width={GUYS_SHEET.width * scaleX}
        height={GUYS_SHEET.height * scaleY}
        preserveAspectRatio="none"
        filter={`url(#${tintId})`}
      />
      {gear.map(({ x, y, fill }) => (
        <rect key={`k${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  );
}
