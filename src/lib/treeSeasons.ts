/**
 * What a Seattle street tree looks like on a given day of the year: bare,
 * coming into leaf, in flower, green, turning, or evergreen all through. The
 * city's data says what each tree is, not when it flowers, so this is a
 * hand-made almanac — rough Seattle dates for the genera that line its
 * streets, with the commoner species and cultivars that differ called out on
 * their own. Good to a week or two, which is all a map of 215k dots needs.
 */

import type { TreeSpecies } from "@/lib/trees";

export type RGB = [number, number, number];

type Bloom = { start: number; peak: number; end: number; color: RGB; strength?: number };

type Phenology = {
  evergreen?: boolean;
  /** Summer leaf. */
  leaf?: RGB;
  /** Autumn color, at its height on `turn`. */
  fall?: RGB;
  /** Fully out by this day; the flush starts a fortnight before. */
  leafOut?: number;
  turn?: number;
  /** Bare by this day. */
  drop?: number;
  bloom?: Bloom;
};

/** Day of the year, 0-based, for a non-leap year. */
export function doy(month: number, day: number): number {
  const starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return starts[month - 1] + day - 1;
}

export function dayLabel(day: number): string {
  const d = new Date(Date.UTC(2025, 0, 1 + day));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function todayDoy(): number {
  const now = new Date();
  return Math.min(364, doy(now.getMonth() + 1, now.getDate()));
}

const BARE: RGB = [104, 84, 70];
const FLUSH: RGB = [158, 212, 96];
const GREEN: RGB = [70, 134, 58];
const CONIFER: RGB = [38, 98, 72];
const BROADLEAF_EVERGREEN: RGB = [52, 110, 50];
const PURPLE_LEAF: RGB = [118, 44, 70];

const WHITE: RGB = [246, 246, 236];
const CREAM: RGB = [244, 238, 206];
const PINK: RGB = [248, 176, 204];
const PALE_PINK: RGB = [250, 212, 226];
const DEEP_PINK: RGB = [242, 128, 180];
const MAGENTA: RGB = [214, 84, 170];
const LILAC: RGB = [196, 156, 226];
const YELLOW_BLOOM: RGB = [244, 218, 48];

const RED: RGB = [218, 42, 38];
const SCARLET: RGB = [228, 30, 48];
const ORANGE: RGB = [232, 124, 38];
const ORANGE_RED: RGB = [222, 84, 38];
const YELLOW: RGB = [238, 198, 48];
const GOLD: RGB = [252, 214, 0];
const APRICOT: RGB = [240, 152, 84];
const RUST: RGB = [196, 100, 42];
const BROWN: RGB = [160, 112, 54];
const COPPER: RGB = [194, 118, 52];
const WINE: RGB = [170, 36, 72];

const bloom = (start: number, peak: number, end: number, color: RGB, strength = 1): Bloom => ({
  start,
  peak,
  end,
  color,
  strength,
});

const D = {
  leaf: GREEN,
  fall: [214, 158, 56] as RGB,
  leafOut: doy(4, 15),
  turn: doy(10, 28),
  drop: doy(11, 22),
};

const evergreen = (leaf: RGB = CONIFER, extra: Partial<Phenology> = {}): Phenology => ({
  evergreen: true,
  leaf,
  ...extra,
});

const CONIFER_GENERA = [
  "Abies",
  "Araucaria",
  "Calocedrus",
  "Cedrus",
  "Chamaecyparis",
  "Cryptomeria",
  "Cupressocyparis",
  "Cupressus",
  "Juniperus",
  "Picea",
  "Pinus",
  "Pseudotsuga",
  "Sequoia",
  "Sequoiadendron",
  "Taxus",
  "Thuja",
  "Tsuga",
  "Metasequoia",
  "Taxodium",
  "Larix",
  "Ginkgo",
];

/** Conifers for the Species view's legend — Ginkgo goes with them, as it does botanically. */
export function isConifer(genus: string): boolean {
  return CONIFER_GENERA.includes(genus.replace(/^x\s*|^×\s*/i, ""));
}

const GENUS: Record<string, Phenology> = {
  Acer: { fall: ORANGE, leafOut: doy(4, 5), turn: doy(10, 24), drop: doy(11, 18) },
  Prunus: {
    fall: ORANGE_RED,
    leafOut: doy(4, 20),
    turn: doy(10, 15),
    drop: doy(11, 8),
    bloom: bloom(doy(3, 18), doy(4, 2), doy(4, 20), PINK),
  },
  Malus: { fall: YELLOW, leafOut: doy(4, 20), bloom: bloom(doy(4, 6), doy(4, 20), doy(5, 6), PALE_PINK) },
  Cornus: {
    fall: WINE,
    turn: doy(10, 18),
    drop: doy(11, 12),
    bloom: bloom(doy(4, 25), doy(5, 8), doy(5, 25), WHITE),
  },
  Quercus: { fall: BROWN, leafOut: doy(5, 1), turn: doy(11, 8), drop: doy(12, 5) },
  Pyrus: {
    fall: WINE,
    leafOut: doy(4, 5),
    turn: doy(11, 15),
    drop: doy(12, 8),
    bloom: bloom(doy(3, 8), doy(3, 24), doy(4, 10), WHITE),
  },
  Crataegus: { fall: ORANGE, leafOut: doy(4, 15), bloom: bloom(doy(5, 4), doy(5, 15), doy(6, 1), WHITE) },
  Betula: { fall: YELLOW, leafOut: doy(4, 1), turn: doy(10, 15), drop: doy(11, 10) },
  Magnolia: { fall: BROWN, leafOut: doy(4, 25), bloom: bloom(doy(3, 5), doy(3, 25), doy(4, 15), PALE_PINK) },
  Fraxinus: { fall: YELLOW, leafOut: doy(5, 5), turn: doy(10, 10), drop: doy(11, 1) },
  Carpinus: { fall: YELLOW, leafOut: doy(4, 10), turn: doy(10, 28) },
  Tilia: { fall: YELLOW, leafOut: doy(4, 25), bloom: bloom(doy(6, 28), doy(7, 10), doy(7, 25), CREAM, 0.5) },
  Amelanchier: {
    fall: ORANGE_RED,
    leafOut: doy(4, 15),
    turn: doy(10, 15),
    drop: doy(11, 8),
    bloom: bloom(doy(3, 25), doy(4, 5), doy(4, 18), WHITE),
  },
  Liquidambar: { fall: WINE, leafOut: doy(4, 25), turn: doy(11, 5), drop: doy(12, 5) },
  Styrax: { fall: YELLOW, leafOut: doy(4, 20), bloom: bloom(doy(5, 22), doy(6, 2), doy(6, 15), WHITE) },
  Ulmus: { fall: YELLOW, turn: doy(10, 25) },
  Cercidiphyllum: { fall: APRICOT, leafOut: doy(4, 5), turn: doy(10, 12), drop: doy(11, 2) },
  Zelkova: { fall: RUST, turn: doy(10, 30) },
  Cercis: { fall: YELLOW, leafOut: doy(5, 1), bloom: bloom(doy(4, 1), doy(4, 15), doy(5, 1), MAGENTA) },
  Platanus: { fall: BROWN, leafOut: doy(5, 1), turn: doy(11, 5), drop: doy(12, 5) },
  Parrotia: { fall: ORANGE_RED, turn: doy(10, 25) },
  Nyssa: { fall: SCARLET, leafOut: doy(5, 1), turn: doy(10, 5), drop: doy(11, 1) },
  Ginkgo: { fall: GOLD, leafOut: doy(4, 25), turn: doy(11, 5), drop: doy(11, 20) },
  Sorbus: { fall: ORANGE_RED, turn: doy(10, 10), bloom: bloom(doy(5, 5), doy(5, 15), doy(5, 30), WHITE) },
  Gleditsia: { fall: GOLD, leafOut: doy(5, 8), turn: doy(10, 5), drop: doy(10, 30) },
  Liriodendron: { fall: YELLOW, leafOut: doy(4, 25), turn: doy(10, 20) },
  Lagerstroemia: { fall: ORANGE_RED, leafOut: doy(5, 15), bloom: bloom(doy(8, 1), doy(8, 25), doy(9, 25), MAGENTA) },
  Fagus: { fall: COPPER, leafOut: doy(4, 25), turn: doy(11, 5), drop: doy(12, 1) },
  Populus: { fall: GOLD, leafOut: doy(4, 5), turn: doy(10, 15), drop: doy(11, 5) },
  Aesculus: {
    fall: BROWN,
    leafOut: doy(4, 15),
    turn: doy(10, 10),
    drop: doy(11, 1),
    bloom: bloom(doy(5, 1), doy(5, 12), doy(5, 26), WHITE),
  },
  Syringa: { fall: BROWN, bloom: bloom(doy(5, 1), doy(5, 10), doy(5, 22), LILAC) },
  Robinia: { fall: YELLOW, leafOut: doy(5, 5), bloom: bloom(doy(5, 20), doy(6, 1), doy(6, 12), WHITE) },
  Stewartia: { fall: ORANGE_RED, bloom: bloom(doy(6, 25), doy(7, 10), doy(7, 28), WHITE) },
  Koelreuteria: { fall: YELLOW, leafOut: doy(5, 1), bloom: bloom(doy(7, 1), doy(7, 15), doy(8, 5), YELLOW_BLOOM) },
  Halesia: { fall: YELLOW, bloom: bloom(doy(4, 10), doy(4, 20), doy(5, 1), WHITE) },
  Oxydendrum: { fall: SCARLET, turn: doy(10, 10), bloom: bloom(doy(7, 15), doy(8, 1), doy(8, 20), WHITE) },
  Laburnum: { fall: YELLOW, bloom: bloom(doy(5, 10), doy(5, 20), doy(6, 1), YELLOW_BLOOM) },
  Albizia: { fall: YELLOW, leafOut: doy(5, 20), bloom: bloom(doy(7, 5), doy(7, 20), doy(8, 10), PINK) },
  Catalpa: { fall: YELLOW, leafOut: doy(5, 10), bloom: bloom(doy(6, 10), doy(6, 20), doy(7, 1), WHITE) },
  Cladrastis: { fall: YELLOW, bloom: bloom(doy(5, 25), doy(6, 5), doy(6, 15), WHITE) },
  Davidia: { fall: YELLOW, bloom: bloom(doy(4, 28), doy(5, 8), doy(5, 18), WHITE) },
  Chionanthus: { fall: YELLOW, bloom: bloom(doy(5, 25), doy(6, 5), doy(6, 18), WHITE) },
  Hamamelis: { fall: YELLOW, bloom: bloom(doy(1, 10), doy(1, 30), doy(2, 20), YELLOW_BLOOM) },
  Cotinus: { leaf: PURPLE_LEAF, fall: RED },
  Corylus: { fall: YELLOW, leafOut: doy(4, 5) },
  Alnus: { fall: BROWN, leafOut: doy(4, 1) },
  Salix: { fall: YELLOW, leafOut: doy(3, 25), turn: doy(11, 1) },
  Juglans: { fall: YELLOW, leafOut: doy(5, 5), turn: doy(10, 10), drop: doy(11, 1) },
  Castanea: { fall: BROWN, bloom: bloom(doy(6, 20), doy(7, 1), doy(7, 15), CREAM, 0.6) },
  Ostrya: { fall: YELLOW },
  Celtis: { fall: YELLOW, leafOut: doy(5, 1) },
  Morus: { fall: YELLOW },
  Ficus: { fall: YELLOW, leafOut: doy(5, 1) },
  Pistacia: { fall: SCARLET, turn: doy(10, 25) },
  Eucommia: { fall: BROWN },
  Phellodendron: { fall: YELLOW },
  Sophora: { fall: YELLOW, bloom: bloom(doy(8, 1), doy(8, 15), doy(9, 1), CREAM, 0.6) },
  Styphnolobium: { fall: YELLOW, bloom: bloom(doy(8, 1), doy(8, 15), doy(9, 1), CREAM, 0.6) },
  Metasequoia: { leaf: [86, 150, 82], fall: RUST, leafOut: doy(4, 10), turn: doy(11, 5), drop: doy(11, 30) },
  Taxodium: { leaf: [86, 150, 82], fall: RUST, leafOut: doy(4, 25), turn: doy(11, 5), drop: doy(11, 30) },
  Larix: { leaf: [110, 168, 90], fall: GOLD, leafOut: doy(4, 1), turn: doy(10, 28), drop: doy(11, 20) },

  Arbutus: evergreen(BROADLEAF_EVERGREEN, { bloom: bloom(doy(4, 1), doy(4, 15), doy(5, 1), CREAM, 0.6) }),
  Ilex: evergreen([34, 88, 44]),
  Laurus: evergreen(BROADLEAF_EVERGREEN),
  Umbellularia: evergreen(BROADLEAF_EVERGREEN),
  Pittosporum: evergreen(BROADLEAF_EVERGREEN),
  Photinia: evergreen([90, 96, 48], { bloom: bloom(doy(4, 20), doy(5, 1), doy(5, 15), WHITE, 0.6) }),
  Eucalyptus: evergreen([96, 140, 120]),
  Trachycarpus: evergreen(BROADLEAF_EVERGREEN),
  Olea: evergreen([110, 132, 96]),
  Osmanthus: evergreen(BROADLEAF_EVERGREEN),
  Myrica: evergreen(BROADLEAF_EVERGREEN),
  Rhododendron: evergreen(BROADLEAF_EVERGREEN, { bloom: bloom(doy(4, 15), doy(5, 1), doy(5, 20), DEEP_PINK) }),
  Ceanothus: evergreen(BROADLEAF_EVERGREEN, { bloom: bloom(doy(4, 10), doy(4, 25), doy(5, 12), [110, 130, 230]) }),
  Arctostaphylos: evergreen(BROADLEAF_EVERGREEN),
  Eriobotrya: evergreen(BROADLEAF_EVERGREEN),
  Lithocarpus: evergreen(BROADLEAF_EVERGREEN),
  Chrysolepis: evergreen(BROADLEAF_EVERGREEN),
  Embothrium: evergreen(BROADLEAF_EVERGREEN, { bloom: bloom(doy(5, 1), doy(5, 15), doy(6, 1), SCARLET) }),
};

for (const g of CONIFER_GENERA) if (!GENUS[g]) GENUS[g] = evergreen(g === "Cedrus" ? [70, 116, 108] : CONIFER);

/** Species and cultivars that don't behave like the rest of their genus, matched on "scientific | common". */
const SPECIES: [RegExp, Partial<Phenology>][] = [
  // Purpleleaf plums — the earliest flowers on the street, and purple all summer.
  [
    /cerasifera|blireiana|thundercloud|purpleleaf|newport|krauter/i,
    { leaf: PURPLE_LEAF, fall: WINE, leafOut: doy(4, 5), bloom: bloom(doy(2, 22), doy(3, 8), doy(3, 25), PALE_PINK) },
  ],
  [/subhirtella|autumnalis|higan/i, { bloom: bloom(doy(2, 25), doy(3, 15), doy(4, 1), PALE_PINK) }],
  [/yedoensis|akebono|yoshino/i, { bloom: bloom(doy(3, 18), doy(3, 28), doy(4, 10), PALE_PINK) }],
  [/serrulata|kwanzan|sato zakura|shirofugen|shirotae|amanogawa/i, { bloom: bloom(doy(4, 6), doy(4, 16), doy(4, 30), DEEP_PINK) }],
  [/prunus.*(avium|mazzard|sweet cherry)|bing/i, { bloom: bloom(doy(3, 30), doy(4, 10), doy(4, 22), WHITE) }],
  [/sargentii|sargent/i, { bloom: bloom(doy(3, 22), doy(4, 2), doy(4, 15), PINK), fall: RED }],
  [/padus|virginiana|canada red|chokecherry|bird cherry/i, { bloom: bloom(doy(4, 20), doy(5, 1), doy(5, 12), WHITE), leaf: [96, 66, 72] }],
  [/laurocerasus|lusitanica|laurel/i, { evergreen: true, leaf: BROADLEAF_EVERGREEN, bloom: bloom(doy(4, 22), doy(5, 8), doy(5, 25), WHITE, 0.7) }],

  [/acer.*rubrum|red maple|red sunset|armstrong|october glory|bowhall|freemanii|autumn blaze/i, { fall: RED, turn: doy(10, 14), drop: doy(11, 8) }],
  [/crimson king|royal red|faassen|schwedleri/i, { leaf: PURPLE_LEAF, fall: COPPER, turn: doy(10, 30) }],
  [/acer.*platanoides|norway maple/i, { fall: YELLOW, turn: doy(10, 30), drop: doy(11, 20) }],
  [/acer.*palmatum.*(bloodgood|atropurpureum|red)|bloodgood/i, { leaf: [124, 38, 44], fall: RED, turn: doy(11, 2) }],
  [/acer.*palmatum|japanese maple/i, { fall: RED, turn: doy(11, 2), drop: doy(11, 28) }],
  [/acer.*griseum|paperbark/i, { fall: ORANGE_RED, turn: doy(11, 1) }],
  [/acer.*macrophyllum|bigleaf/i, { fall: YELLOW, turn: doy(10, 15), drop: doy(11, 10) }],
  [/acer.*circinatum|vine maple/i, { fall: ORANGE_RED, turn: doy(10, 15) }],
  [/acer.*(truncatum|pacific sunset|norwegian sunset|warrenred|keithsform)/i, { fall: ORANGE, turn: doy(10, 20) }],
  [/acer.*(campestre|hedge)|acer.*pseudoplatanus|sycamore maple/i, { fall: YELLOW }],
  [/acer.*(saccharum|sugar)/i, { fall: ORANGE_RED, turn: doy(10, 18) }],

  [/quercus.*(rubra|coccinea|palustris|shumardii|phellos|red oak|scarlet|pin oak|willow oak)/i, { fall: RED }],
  [/quercus.*(ilex|agrifolia|chrysolepis|suber|virginiana|myrsinifolia|live oak)/i, { evergreen: true, leaf: BROADLEAF_EVERGREEN }],

  [/cornus.*kousa|kousa/i, { bloom: bloom(doy(5, 30), doy(6, 15), doy(7, 5), WHITE) }],
  [/cornus.*(florida|eastern).*(rubra|pink|cherokee)|pink.*dogwood/i, { bloom: bloom(doy(4, 18), doy(5, 2), doy(5, 18), PINK) }],
  [/cornus.*(florida|nuttallii|eddie|venus|starlight|eastern|pacific)/i, { bloom: bloom(doy(4, 18), doy(5, 2), doy(5, 18), WHITE) }],
  [/cornus.*(mas|cornelian)/i, { bloom: bloom(doy(2, 20), doy(3, 5), doy(3, 22), YELLOW_BLOOM) }],

  [/crataegus.*(laevigata|paul|crimson cloud|midland)/i, { bloom: bloom(doy(5, 1), doy(5, 12), doy(5, 28), DEEP_PINK) }],
  [/magnolia.*grandiflora|southern magnolia|evergreen.*magnolia/i, { evergreen: true, leaf: [40, 88, 46], bloom: bloom(doy(6, 1), doy(7, 1), doy(8, 15), WHITE, 0.55) }],
  [/magnolia.*(kobus|stellata|loebneri|merrill|star)/i, { bloom: bloom(doy(3, 1), doy(3, 18), doy(4, 5), WHITE) }],
  [/fraxinus.*(americana|autumn purple)/i, { fall: WINE }],
  [/cercis.*(forest pansy)/i, { leaf: PURPLE_LEAF }],
  [/fagus.*(purpurea|atropunicea|riversii|tricolor|dawyck purple|copper|purple)/i, { leaf: PURPLE_LEAF }],
  [/robinia.*frisia/i, { leaf: [196, 204, 70] }],
  [/gleditsia.*sunburst/i, { leaf: [170, 190, 70] }],
  [/aesculus.*(carnea|briotii|red)/i, { bloom: bloom(doy(5, 1), doy(5, 12), doy(5, 26), [236, 112, 120]) }],
  [/syringa.*(reticulata|japanese tree lilac|ivory silk)/i, { bloom: bloom(doy(6, 5), doy(6, 16), doy(6, 30), CREAM) }],
  [/lagerstroemia.*(white|natchez)/i, { bloom: bloom(doy(8, 1), doy(8, 25), doy(9, 25), WHITE) }],
  [/malus.*domestica|orchard/i, { bloom: bloom(doy(4, 10), doy(4, 22), doy(5, 5), WHITE) }],
  [/sorbus.*aucuparia|mountain ash/i, { fall: ORANGE_RED }],
];

/** A little variety in summer greens, so a block of lindens and a block of oaks don't read as one. */
function genusGreen(genus: string): RGB {
  let h = 0;
  for (let i = 0; i < genus.length; i++) h = (h * 31 + genus.charCodeAt(i)) | 0;
  const t = ((h >>> 0) % 1000) / 1000;
  return [Math.round(56 + t * 34), Math.round(122 + t * 30), Math.round(44 + (1 - t) * 22)];
}

export function phenology(sp: TreeSpecies): Phenology {
  const genus = sp.genus.replace(/^x\s*|^×\s*/i, "");
  const base: Phenology = { ...D, leaf: genusGreen(genus), ...(GENUS[genus] ?? {}) };
  const key = `${sp.scientific} | ${sp.common}`;
  for (const [match, patch] of SPECIES) {
    if (match.test(key)) return { ...base, ...patch };
  }
  return base;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const ramp = (day: number, from: number, to: number) => (to <= from ? (day >= to ? 1 : 0) : (day - from) / (to - from));

/** 0–1: how much of a bloom is out on `day`. Flat at the top for the middle third. */
export function bloomAmount(b: Bloom | undefined, day: number): number {
  if (!b || day < b.start || day > b.end) return 0;
  const rise = Math.max(1, b.peak - b.start);
  const fall = Math.max(1, b.end - b.peak);
  const t = day <= b.peak ? (day - b.start) / rise : 1 - (day - b.peak) / fall;
  return Math.min(1, t * 1.6) * (b.strength ?? 1);
}

/** How far through its autumn a tree is on `day`: 0 green, 1 at its color, 2 bare. */
function autumn(p: Phenology, day: number): number {
  const turn = p.turn ?? D.turn;
  const drop = p.drop ?? D.drop;
  if (day < turn - 24) return 0;
  if (day <= turn) return ramp(day, turn - 24, turn);
  const hold = turn + (drop - turn) * 0.45;
  if (day <= hold) return 1;
  return 1 + Math.min(1, ramp(day, hold, drop));
}

export type SeasonState = "bare" | "flush" | "leaf" | "bloom" | "turning" | "evergreen";

export function seasonColor(p: Phenology, day: number): { rgb: RGB; state: SeasonState; bloom: number } {
  const b = bloomAmount(p.bloom, day);
  const leaf = p.leaf ?? GREEN;
  if (p.evergreen) {
    return { rgb: mix(leaf, p.bloom?.color ?? leaf, b), state: b > 0.4 ? "bloom" : "evergreen", bloom: b };
  }
  const leafOut = p.leafOut ?? D.leafOut;
  let rgb: RGB;
  let state: SeasonState;
  const a = autumn(p, day);
  if (day < leafOut - 16) {
    rgb = BARE;
    state = "bare";
  } else if (day < leafOut) {
    rgb = mix(BARE, FLUSH, ramp(day, leafOut - 16, leafOut));
    state = "flush";
  } else if (day < leafOut + 30) {
    rgb = mix(FLUSH, leaf, ramp(day, leafOut, leafOut + 30));
    state = "flush";
  } else if (a === 0) {
    rgb = leaf;
    state = "leaf";
  } else if (a <= 1) {
    rgb = mix(leaf, p.fall ?? D.fall, a);
    state = a > 0.5 ? "turning" : "leaf";
  } else if (a < 2) {
    rgb = mix(p.fall ?? D.fall, BARE, a - 1);
    state = a < 1.6 ? "turning" : "bare";
  } else {
    rgb = BARE;
    state = "bare";
  }
  // A tree that flowers before it leafs is all flower; one in leaf shows it through the green.
  if (b > 0) {
    rgb = mix(rgb, p.bloom!.color, b);
    if (b > 0.4) state = "bloom";
  }
  return { rgb, state, bloom: b };
}
