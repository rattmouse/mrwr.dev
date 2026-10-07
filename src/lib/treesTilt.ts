/**
 * trees.exe's Tilt view: the city as a diorama, seen from an angle the
 * window's slider sets and facing any of the eight compass points.
 * Orthographic, so pan and zoom work just as they do on the flat map, and
 * which tree is in front of which depends only on the facing — a quick bucket
 * sort each time it turns.
 *
 * The ground is drawn the way the old voxel flight games drew theirs: each
 * screen column walked from the front, filling up from the bottom and keeping
 * only what rises above everything already in front of it, so every pixel is
 * written once. It also leaves a depth for each pixel, which is how a tree
 * behind a hill gets hidden. The trees are little sprites — a round crown, a
 * cone, or a column, on a trunk — sized from trunk diameter and genus, because
 * the city measured the height of only a few hundred of them.
 *
 * Everything here works in device pixels on a raw Uint32 ImageData buffer.
 */

import type { Terrain } from "@/lib/terrain";
import type { TreeSpecies, Trees } from "@/lib/trees";
import { isConifer } from "@/lib/treeSeasons";

/** Degrees above the horizon the view looks down from: the slider's range and where it starts. */
export const PITCH_MIN = 15;
export const PITCH_MAX = 75;
export const PITCH_DEFAULT = 30;
/** Seattle's hills are 150 m over 26 km: flat as a plate unless they're stretched. */
export const EXAG = 2.5;
/** Trees are stretched less than the hills, or a block of them turns into a forest of poles. */
const TREE_EXAG = 1.4;
/** How much bigger than life every tree is drawn: a knob, left at true size. */
export const TREE_SCALE = 1;
/** How deep the diorama's slab goes below sea level, in (stretched) metres. */
const SLAB = 30;
/** How far behind the ground in front of it a tree can stand and still show. */
export const DEPTH_SLACK = 40;

const pack = (r: number, g: number, b: number) =>
  ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

export function shadeColor(c: number, k: number): number {
  const r = Math.min(255, (c & 255) * k);
  const g = Math.min(255, ((c >>> 8) & 255) * k);
  const b = Math.min(255, ((c >>> 16) & 255) * k);
  return pack(r, g, b);
}

// --- the ground ----------------------------------------------------------------

export type Ground = {
  w: number;
  h: number;
  z: Float32Array;
  /** A packed color per cell: land lit from the north-west, or water. */
  color: Uint32Array;
  zMax: number;
  /** World metres → fractional grid cell (centres at whole numbers). */
  ax: number;
  bx: number;
  ay: number;
  by: number;
};

const WATER = pack(26, 50, 84);
const SIDE = pack(46, 37, 30);
const SIDE_WATER = pack(18, 32, 52);
const FLAT_LAND = pack(60, 68, 52);

/** Lay the terrain grid under the trees' world (metres east and north of their bbox's south-west corner). */
export function makeGround(
  t: Terrain,
  trees: Trees["bbox"],
  widthM: number,
  heightM: number,
): Ground {
  const { w, h, z, water } = t;
  const tb = t.bbox;
  // mx → lon → grid x; my → lat → grid y (row 0 north).
  const lonPerM = (trees.east - trees.west) / widthM;
  const latPerM = (trees.north - trees.south) / heightM;
  const ax = (lonPerM / (tb.east - tb.west)) * w;
  const bx = ((trees.west - tb.west) / (tb.east - tb.west)) * w - 0.5;
  const ay = (-latPerM / (tb.north - tb.south)) * h;
  const by = ((tb.north - trees.south) / (tb.north - tb.south)) * h - 0.5;

  const cellW = widthM / ((trees.east - trees.west) / ((tb.east - tb.west) / w));
  const cellH = heightM / ((trees.north - trees.south) / ((tb.north - tb.south) / h));
  const color = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (water[i]) {
        color[i] = WATER;
        continue;
      }
      const e = z[i];
      const dzdx = (z[y * w + Math.min(w - 1, x + 1)] - z[y * w + Math.max(0, x - 1)]) / (2 * cellW);
      // Grid rows run south, so north is the row above.
      const dzdy = (z[Math.max(0, y - 1) * w + x] - z[Math.min(h - 1, y + 1) * w + x]) / (2 * cellH);
      // Lit from the north-west, as maps always are.
      const shade = Math.max(0.5, Math.min(1.45, 0.92 + (dzdx - dzdy) * EXAG * 1.6));
      const k = Math.min(1, Math.max(0, e / 140));
      color[i] = pack((52 + k * 30) * shade, (62 + k * 18) * shade, (44 + k * 6) * shade);
    }
  }
  return { w, h, z, color, zMax: t.zMax, ax, bx, ay, by };
}

/** Ground height in metres at a world point, smoothly between cells; sea level off the grid. */
export function groundZ(g: Ground, mx: number, my: number): number {
  const fx = g.ax * mx + g.bx;
  const fy = g.ay * my + g.by;
  const x0 = Math.max(0, Math.min(g.w - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(g.h - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i = y0 * g.w + x0;
  const z = g.z;
  const top = z[i] + (z[i + 1] - z[i]) * tx;
  const bottom = z[i + g.w] + (z[i + g.w + 1] - z[i + g.w]) * tx;
  return top + (bottom - top) * ty;
}

/** Which way the view faces, degrees clockwise from north: 0, 45 … 315. */
export type Heading = number;

export const HEADING_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function headingName(h: Heading): (typeof HEADING_NAMES)[number] {
  return HEADING_NAMES[(Math.round(h / 45) % 8 + 8) % 8];
}

/**
 * The turn as coefficients: view axes u (across the screen) and v (away from
 * the viewer) from world metres x (east) and y (north) — u = ux·x + uy·y,
 * v = vx·x + vy·y — and back with the transpose. The per-pixel and per-tree
 * loops use them directly; a tuple apiece would be most of their cost.
 */
export function axes(h: Heading) {
  const a = (h * Math.PI) / 180;
  const snap = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);
  const c = snap(Math.cos(a));
  const s = snap(Math.sin(a));
  return { ux: c, uy: -s, vx: s, vy: c };
}

/** World metres to view axes. */
export function rot(h: Heading, x: number, y: number): [number, number] {
  const { ux, uy, vx, vy } = axes(h);
  return [ux * x + uy * y, vx * x + vy * y];
}

/** View axes back to world metres. */
export function unrot(h: Heading, u: number, v: number): [number, number] {
  const { ux, uy, vx, vy } = axes(h);
  return [ux * u + vx * v, uy * u + vy * v];
}

export type TiltView = {
  W: number;
  H: number;
  /** Device pixels per metre across. */
  S: number;
  /** The view centre in view axes. */
  cu: number;
  cv: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** sin and cos of the angle the view looks down from. */
  sin: number;
  cos: number;
};

/** A view of size W×H device pixels at S px/m, centred on world (cx, cy), looking down `pitchDeg` and facing `heading`. */
export function tiltView(
  W: number,
  H: number,
  S: number,
  cx: number,
  cy: number,
  pitchDeg: number,
  heading: Heading,
): TiltView {
  const a = (pitchDeg * Math.PI) / 180;
  const ax = axes(heading);
  return {
    W,
    H,
    S,
    cu: ax.ux * cx + ax.uy * cy,
    cv: ax.vx * cx + ax.vy * cy,
    ...ax,
    sin: Math.sin(a),
    cos: Math.cos(a),
  };
}

/**
 * The ground layer: colors into `buf`, and into `depth` how far away (in v)
 * each pixel's ground is — Infinity where there's none. Without terrain it's a
 * flat slab at sea level. `stride` 2 walks every other column, doubled, two
 * pixels of depth at a time: a quarter of the work, for while the view is
 * being dragged about.
 */
export function renderGround(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  g: Ground | null,
  widthM: number,
  heightM: number,
  bg: number,
  stride: 1 | 2 = 1,
) {
  const { W, H, S, cu, cv, ux, uy, vx, vy } = view;
  buf.fill(bg);
  depth.fill(Infinity);
  const ss = S * view.sin;
  const sc = S * view.cos * EXAG;
  const vBottom = cv - H / 2 / ss;
  const vTop = cv + H / 2 / ss;
  // Hills in front of the bottom edge can rise into view; look that far
  // forward, but not so far that a close zoom walks kilometres per column.
  const reach = Math.min(((g ? g.zMax : 0) + SLAB) * sc, H * 1.5) / ss;
  const vStart = vBottom - reach;
  const dv = stride / ss;
  const slabPx = SLAB * sc;
  const steps = Math.ceil((vTop - vStart) / dv);
  const gw = g ? g.w : 0;
  const gh = g ? g.h : 0;
  const gz = g ? g.z : new Float32Array(0);
  const gc = g ? g.color : new Uint32Array(0);
  const zCeil = g ? g.zMax : 0;

  for (let x = 0; x < W; x += stride) {
    const u = cu + (x + 0.5 - W / 2) / S;
    const twin = stride === 2 && x + 1 < W;
    let yb = H;
    let inside = false;
    // Down the column the world point moves in a straight line, away from the viewer.
    let mx = ux * u + vx * vStart;
    let my = uy * u + vy * vStart;
    const stepX = vx * dv;
    const stepY = vy * dv;
    for (let k = 0; k <= steps; k++, mx += stepX, my += stepY) {
      if (mx < 0 || my < 0 || mx > widthM || my > heightM) {
        inside = false;
        continue;
      }
      const v = vStart + k * dv;
      const yGround = H / 2 - (v - cv) * ss;
      // Nothing here can rise above what's already drawn in front of it.
      if (yGround - zCeil * sc >= yb) {
        inside = true;
        continue;
      }
      // Inlined groundZ and blend: this loop runs for every pixel of depth in
      // every column, and the calls were most of its cost.
      let z = 0;
      let color = FLAT_LAND;
      let wet = false;
      let ci = 0;
      let tx = 0;
      let ty = 0;
      if (g) {
        let fx = g.ax * mx + g.bx;
        let fy = g.ay * my + g.by;
        if (fx < 0) fx = 0;
        else if (fx > gw - 1.001) fx = gw - 1.001;
        if (fy < 0) fy = 0;
        else if (fy > gh - 1.001) fy = gh - 1.001;
        const x0 = fx | 0;
        const y0g = fy | 0;
        tx = fx - x0;
        ty = fy - y0g;
        ci = y0g * gw + x0;
        // Water where the four cells around are mostly water, weighted by
        // nearness — a shoreline that curves instead of stepping cell by cell.
        const wetness =
          (gc[ci] === WATER ? (1 - tx) * (1 - ty) : 0) +
          (gc[ci + 1] === WATER ? tx * (1 - ty) : 0) +
          (gc[ci + gw] === WATER ? (1 - tx) * ty : 0) +
          (gc[ci + gw + 1] === WATER ? tx * ty : 0);
        wet = wetness > 0.5;
        if (wet) {
          const near = ci + (tx > 0.5 ? 1 : 0) + (ty > 0.5 ? gw : 0);
          z = gc[near] === WATER ? gz[near] : Math.min(gz[ci], gz[ci + 1], gz[ci + gw], gz[ci + gw + 1]);
        } else {
          const top = gz[ci] + (gz[ci + 1] - gz[ci]) * tx;
          const bottom = gz[ci + gw] + (gz[ci + gw + 1] - gz[ci + gw]) * tx;
          z = top + (bottom - top) * ty;
        }
      }
      const yTop = yGround - z * sc;
      if (yTop >= yb) {
        inside = true;
        continue;
      }
      if (g) {
        if (wet) color = WATER;
        else {
          const a = gc[ci];
          const b = gc[ci + 1];
          const c = gc[ci + gw];
          const d = gc[ci + gw + 1];
          const wa = (1 - tx) * (1 - ty);
          const wb = tx * (1 - ty);
          const wc = (1 - tx) * ty;
          const wd = tx * ty;
          const r = (a & 255) * wa + (b & 255) * wb + (c & 255) * wc + (d & 255) * wd;
          const gg = ((a >>> 8) & 255) * wa + ((b >>> 8) & 255) * wb + ((c >>> 8) & 255) * wc + ((d >>> 8) & 255) * wd;
          const bb = ((a >>> 16) & 255) * wa + ((b >>> 16) & 255) * wb + ((c >>> 16) & 255) * wc + ((d >>> 16) & 255) * wd;
          color = ((255 << 24) | ((bb + 0.5) << 16) | ((gg + 0.5) << 8) | (r + 0.5)) >>> 0;
        }
      }
      // The front edge of the slab shows its side, down to the slab's base.
      const yEnd = inside ? yb : Math.min(yb, Math.ceil(yGround + slabPx));
      const y0 = Math.max(0, Math.floor(yTop));
      const faceFrom = inside ? yEnd : Math.min(yEnd, y0 + 2);
      for (let y = y0; y < yEnd; y++) {
        const p = y * W + x;
        const c = y < faceFrom ? color : wet ? SIDE_WATER : SIDE;
        buf[p] = c;
        depth[p] = v;
        if (twin) {
          buf[p + 1] = c;
          depth[p + 1] = v;
        }
      }
      yb = y0;
      inside = true;
      if (yb <= 0) break;
    }
  }
}

// --- the trees -----------------------------------------------------------------

export type TreeForms = {
  /** Metres. */
  height: Float32Array;
  /** Crown radius, metres. */
  crown: Float32Array;
  /** 0 round, 1 cone, 2 column. */
  shape: Uint8Array;
};

const SMALL = new Set([
  "Prunus",
  "Malus",
  "Cornus",
  "Styrax",
  "Cercis",
  "Crataegus",
  "Amelanchier",
  "Lagerstroemia",
  "Syringa",
  "Magnolia",
  "Parrotia",
  "Stewartia",
  "Halesia",
  "Cotinus",
  "Laburnum",
  "Koelreuteria",
  "Ostrya",
  "Hamamelis",
  "Oxydendrum",
  "Arbutus",
  "Ilex",
  "Photinia",
  "Albizia",
  "Chionanthus",
  "Davidia",
  "Sorbus",
]);
const SMALL_MAPLES = /palmatum|circinatum|griseum|japanese maple|vine maple|paperbark/i;
const COLUMNAR =
  /fastigiat|columnar|italica|armstrong|crimson spire|dawyck|chanticleer|capital|frans fontaine|upright|pyramidal|bowhall|scarlet sentinel|slender silhouette|princeton sentry|ivory pillar|sentry|skyrocket/i;

/**
 * Height and crown from trunk diameter: a saturating curve per kind of tree.
 * For any list of trees with a species table — the standing ones, or the ones
 * the city has taken down.
 */
export function treeForms(species: TreeSpecies[], species16: Uint16Array, diam: Uint8Array): TreeForms {
  const n = species16.length;
  const height = new Float32Array(n);
  const crown = new Float32Array(n);
  const shape = new Uint8Array(n);
  const kinds = species.map((sp) => {
    const key = `${sp.scientific} | ${sp.common}`;
    const conifer = isConifer(sp.genus) && sp.genus !== "Ginkgo";
    const columnar = COLUMNAR.test(key);
    const small =
      (SMALL.has(sp.genus) && !/grandiflora|avium|mazzard/i.test(key)) || (sp.genus === "Acer" && SMALL_MAPLES.test(key));
    const narrowConifer = /Thuja|Chamaecyparis|Taxus|Juniperus|Cupressus|Calocedrus/.test(sp.genus);
    if (conifer) return { maxH: narrowConifer ? 18 : 36, k: 26, shape: 1, narrowConifer };
    if (columnar) return { maxH: small ? 10 : 16, k: 16, shape: 2, narrowConifer: false };
    if (small) return { maxH: 9, k: 10, shape: 0, narrowConifer: false };
    return { maxH: 22, k: 20, shape: 0, narrowConifer: false };
  });
  for (let i = 0; i < n; i++) {
    const kind = kinds[species16[i]];
    const d = diam[i] || 3;
    const ht = 1.8 + (kind.maxH - 1.8) * (1 - Math.exp(-d / kind.k));
    height[i] = ht;
    shape[i] = kind.shape;
    crown[i] =
      kind.shape === 1
        ? Math.min(6, ht * (kind.narrowConifer ? 0.17 : 0.24))
        : kind.shape === 2
          ? ht * 0.16
          : Math.min(9, 1.2 + d * 0.2, ht * 0.5);
  }
  return { height, crown, shape };
}

const ORDER_BUCKETS = 1 << 15;

/**
 * Back to front for a facing: the furthest tree first. A counting sort on
 * depth, in buckets under a metre deep — a few milliseconds for the city.
 */
export type TiltOrder = {
  order: Uint32Array;
  /** Each ordered tree's depth (v), biggest first: a slice of it is the band a view can see. */
  depth: Float32Array;
};

export function tiltOrder(h: Heading, mx: Float32Array, my: Float32Array): TiltOrder {
  const n = my.length;
  const { vx, vy } = axes(h);
  const depthOf = new Float32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = vx * mx[i] + vy * my[i];
    depthOf[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const key = new Uint16Array(n);
  const count = new Uint32Array(ORDER_BUCKETS + 1);
  const k = (ORDER_BUCKETS - 1) / Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) {
    const b = ((hi - depthOf[i]) * k) | 0;
    key[i] = b;
    count[b + 1]++;
  }
  for (let b = 0; b < ORDER_BUCKETS; b++) count[b + 1] += count[b];
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[count[key[i]]++] = i;
  const depth = new Float32Array(n);
  for (let k = 0; k < n; k++) depth[k] = depthOf[order[k]];
  return { order, depth };
}

/** The first k in a depth-descending list whose depth is at most v. */
export function firstAtMost(depth: Float32Array, v: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depth[mid] > v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Everything the tree pass reads, laid out in draw order for one facing, so
 * the loop walks memory front to back instead of jumping about a million
 * entries — which was most of its cost. `v` doubles as the depths to slice by.
 */
export type Packed = {
  n: number;
  u: Float32Array;
  v: Float32Array;
  gz: Float32Array;
  height: Float32Array;
  crown: Float32Array;
  shape: Uint8Array;
  /** Which tree each slot is, for colors, picking and the rest. */
  index: Uint32Array;
};

export function packOrder(
  sorted: TiltOrder,
  h: Heading,
  mx: Float32Array,
  my: Float32Array,
  gz: Float32Array,
  forms: TreeForms,
): Packed {
  const { order } = sorted;
  const n = order.length;
  const { ux, uy, vx, vy } = axes(h);
  const p: Packed = {
    n,
    u: new Float32Array(n),
    v: new Float32Array(n),
    gz: new Float32Array(n),
    height: new Float32Array(n),
    crown: new Float32Array(n),
    shape: new Uint8Array(n),
    index: order,
  };
  for (let k = 0; k < n; k++) {
    const i = order[k];
    p.u[k] = ux * mx[i] + uy * my[i];
    p.v[k] = vx * mx[i] + vy * my[i];
    p.gz[k] = gz[i];
    p.height[k] = forms.height[i];
    p.crown[k] = forms.crown[i];
    p.shape[k] = forms.shape[i];
  }
  return p;
}

/**
 * The slots to draw when the canopy is sampled: every street tree, and every
 * `thin`-th tree from `thinFrom` on. In draw order, so walking it still moves
 * forward through memory.
 */
export function thinPacked(p: Packed, thinFrom: number, thin: number): Uint32Array {
  let n = 0;
  for (let k = 0; k < p.n; k++) if (p.index[k] < thinFrom || p.index[k] % thin === 0) n++;
  const out = new Uint32Array(n);
  let j = 0;
  for (let k = 0; k < p.n; k++) if (p.index[k] < thinFrom || p.index[k] % thin === 0) out[j++] = k;
  return out;
}

/** The first j with list[j] >= k, in an ascending list. */
function lowerBound(list: Uint32Array, k: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The slots a view can see, as [from, to) — in `sub` if it's given, in the
 * packed arrays if not. Trees further than the top of the screen are above
 * it, and trees nearer than the bottom (allowing for the tallest hill and
 * tree rising into view) are below it.
 */
export function visibleSlice(
  view: TiltView,
  p: Packed,
  zMax: number,
  tallest: number,
  sub: Uint32Array | null,
): [number, number] {
  const ss = view.S * view.sin;
  const rise = (zMax * EXAG + tallest * TREE_EXAG * TREE_SCALE) * view.S * view.cos;
  const kFrom = firstAtMost(p.v, view.cv + (view.H / 2 + 4) / ss);
  const kTo = firstAtMost(p.v, view.cv - (view.H / 2 + rise + 4) / ss);
  return sub ? [lowerBound(sub, kFrom), lowerBound(sub, kTo)] : [kFrom, kTo];
}

const TRUNK = pack(70, 52, 40);

/**
 * Where a broadleaf crown's centre sits on screen: its top at the top of the
 * tree, or for a tree wider than it is tall, resting just above the ground.
 */
function crownCentre(base: number, hp: number, r: number): number {
  return base - Math.max(hp - r, r * 0.8);
}

/** Where a tree's crown sits on screen, in device pixels, and how far away it is. */
export function treeScreen(
  view: TiltView,
  mx: number,
  my: number,
  gz: number,
  height: number,
  crown: number,
): { x: number; y: number; base: number; v: number } {
  const u = view.ux * mx + view.uy * my;
  const v = view.vx * mx + view.vy * my;
  const x = view.W / 2 + (u - view.cu) * view.S;
  const base = view.H / 2 - (v - view.cv) * view.S * view.sin - gz * view.S * view.cos * EXAG;
  const y = crownCentre(base, height * TREE_SCALE * TREE_EXAG * view.S * view.cos, crown * TREE_SCALE * view.S);
  return { x, y, base, v };
}

/**
 * The trees, back to front, over the ground layer. `color` and `bare` are in
 * the packed (draw) order; 0 color means not drawn. `sub`, when given, is the
 * thinned list of slots to draw, and [from, to) is the visible band of it.
 */
export function drawTiltTrees(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  p: Packed,
  color: Uint32Array,
  /** 1 where the tree is bare this day: its crown is drawn as a see-through dither. */
  bare: Uint8Array | null,
  ghost: number,
  sub: Uint32Array | null,
  from: number,
  to: number,
) {
  const { W, H, S, cu, cv } = view;
  const ss = S * view.sin;
  const gc = S * view.cos * EXAG;
  const tc = S * view.cos * TREE_EXAG * TREE_SCALE;
  const cs = S * TREE_SCALE;
  const halfW = W / 2;
  const halfH = H / 2;
  const { u: pu, v: pv, gz, height, crown, shape: shapes } = p;

  const plot = (x: number, y: number, c: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const q = y * W + x;
    if (v - DEPTH_SLACK <= depth[q]) buf[q] = c;
  };

  for (let j = from; j < to; j++) {
    const k = sub ? sub[j] : j;
    const c = color[k];
    if (!c) continue;
    const sx = halfW + (pu[k] - cu) * S;
    const r = crown[k] * cs;
    if (sx + r + 2 < 0 || sx - r - 2 > W) continue;
    const v = pv[k];
    const base = halfH - (v - cv) * ss - gz[k] * gc;
    const hp = height[k] * tc;
    if (base - hp - r > H || base + 2 < 0) continue;
    // Far out, nearly every tree is one pixel: the quick way, inline.
    if (c === ghost || (hp < 3 && r < 1.5)) {
      const x = (sx + 0.5) | 0;
      const y = (c === ghost ? base + 0.5 : base - hp * 0.6 + 0.5) | 0;
      if (x >= 0 && y >= 0 && x < W && y < H) {
        const q = y * W + x;
        if (v - DEPTH_SLACK <= depth[q]) buf[q] = c;
      }
      continue;
    }
    const ix = Math.round(sx);
    const shape = shapes[k];
    const see = bare !== null && bare[k] === 1;
    const light = shadeColor(c, 1.22);
    const dark = shadeColor(c, 0.7);

    // A broadleaf crown is a ball sitting at the top of the tree; the trunk
    // runs up into its middle, however tall the tree and small the crown.
    const ballY = crownCentre(base, hp, r);
    const trunkTop = Math.round(shape === 1 ? base - hp * 0.15 : ballY);
    const tw = r < 4 ? 1 : Math.max(1, Math.round(r * 0.14));
    for (let y = Math.round(base); y >= trunkTop; y--) {
      for (let dx = 0; dx < tw; dx++) plot(ix - (tw >> 1) + dx, y, TRUNK, v);
    }

    if (shape === 1) {
      const top = base - hp;
      const bottom = base - hp * 0.12;
      const y0 = Math.ceil(top);
      const y1 = Math.floor(bottom);
      for (let y = y0; y <= y1; y++) {
        const half = Math.max(0.5, (r * (y - top)) / Math.max(1, bottom - top));
        const x0 = Math.ceil(sx - half);
        const x1 = Math.floor(sx + half);
        for (let x = x0; x <= x1; x++) {
          if (see && (x + y) & 1) continue;
          const t = (x - sx) / half;
          plot(x, y, t < -0.3 ? light : t > 0.35 ? dark : c, v);
        }
      }
      continue;
    }

    // Round (and upright cultivars, at their narrower spread): a circle — a
    // ball looks round from any angle.
    const cy = ballY;
    const y0 = Math.ceil(cy - r);
    const y1 = Math.floor(cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / Math.max(0.5, r);
      const half = r * Math.sqrt(Math.max(0, 1 - dy * dy));
      const x0 = Math.ceil(sx - half);
      const x1 = Math.floor(sx + half);
      for (let x = x0; x <= x1; x++) {
        if (see && (x + y) & 1) continue;
        const t = ((x - sx) / Math.max(0.5, r)) * 0.7 + dy * 0.9;
        plot(x, y, t < -0.4 ? light : t > 0.45 ? dark : c, v);
      }
    }
  }
}
