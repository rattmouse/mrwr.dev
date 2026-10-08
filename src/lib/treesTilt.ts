/**
 * trees.exe's Tilt view: the city as a diorama, seen from an angle the
 * window's slider sets and facing any way round its other slider turns it.
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
import { Overlay, OVERLAY_PARK, OVERLAY_RESTORATION, overlayAt } from "@/lib/places";
import type { Light } from "@/lib/sun";

/** Degrees above the horizon the view looks down from: the slider's range and where it starts. */
export const PITCH_MIN = 15;
export const PITCH_MAX = 75;
export const PITCH_DEFAULT = PITCH_MAX;
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
  /** A packed color per cell: land lit from the north-west (or by the sun), or exactly WATER. */
  color: Uint32Array;
  /** The Tilt view's wireframe line over each land cell, lit the same way. */
  wire: Uint32Array;
  /** What WATER cells are drawn as: WATER itself, or darker, by night. */
  waterColor: number;
  /** What the land between the wireframe's lines is drawn as. */
  fillColor: number;
  /** Parks, and the restoration zones in them, drawn solid in their own greens. */
  parkColor: number;
  restorationColor: number;
  /** Cells the hills shade from the sun, when it's the sun lighting them; else null. */
  shadow: Uint8Array | null;
  zMax: number;
  /** World metres → fractional grid cell (centres at whole numbers). */
  ax: number;
  bx: number;
  ay: number;
  by: number;
};

export const WATER = pack(26, 50, 84);
const SIDE = pack(9, 14, 10);
/** The land is a wireframe: dark green lines over near-black ground, so it still hides what's behind a hill. */
const WIRE: [number, number, number] = [22, 76, 34];
const FILL: [number, number, number] = [9, 14, 10];
const PARK: [number, number, number] = [46, 98, 44];
const RESTORATION: [number, number, number] = [74, 104, 34];
/** A slope's light, squeezed for the wireframe: a line on a slope facing away still has to show. */
const wireShade = (shade: number) => 0.55 + 0.45 * shade;
/** The fewest device pixels between the wireframe's lines: closer, and it skips to every other one; further, and it splits each cell. */
const WIRE_GAP = 3;
const SIDE_WATER = pack(18, 32, 52);
const FLAT_LAND = pack(60, 68, 52);

/** Night's color, which the land and water sink toward as the sun goes down. */
const NIGHT: [number, number, number] = [16, 22, 40];

/**
 * Lay the terrain grid under the trees' world (metres east and north of their
 * bbox's south-west corner). Lit from the north-west the way maps are, or,
 * given a `light`, by the sun: each slope by how squarely it faces it, the
 * cells the hills hide from it in shade, and everything dimmed and blued
 * toward night as it sets.
 */
export function makeGround(
  t: Terrain,
  trees: Trees["bbox"],
  widthM: number,
  heightM: number,
  light: Light | null = null,
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
  const slopes = slopesOf(t, cellW, cellH);
  const { nx, ny, inv, k: height } = slopes;
  const wire = new Uint32Array(w * h);
  if (!light) {
    for (let i = 0; i < w * h; i++) {
      if (water[i]) {
        color[i] = WATER;
        continue;
      }
      // Lit from the north-west, as maps always are.
      const shade = Math.max(0.5, Math.min(1.45, 0.92 + (ny[i] - nx[i]) * 1.6));
      const k = height[i];
      color[i] = pack((52 + k * 30) * shade, (62 + k * 18) * shade, (44 + k * 6) * shade);
      const lit = wireShade(shade);
      wire[i] = pack(WIRE[0] * lit, WIRE[1] * lit, WIRE[2] * lit);
    }
    return {
      w,
      h,
      z,
      color,
      wire,
      waterColor: WATER,
      fillColor: pack(...FILL),
      parkColor: pack(...PARK),
      restorationColor: pack(...RESTORATION),
      shadow: null,
      zMax: t.zMax,
      ax,
      bx,
      ay,
      by,
    };
  }

  const shadow = light.altitude > 0 ? castShadows(z, w, h, cellW, cellH, light) : null;
  // How far toward night: none in daylight, most of the way once it's dark.
  const dusk = (1 - light.day) * 0.72;
  const dim = 0.3 + 0.7 * light.day;
  const keep = 1 - dusk;
  const [nr, ng, nb] = [NIGHT[0] * dusk, NIGHT[1] * dusk, NIGHT[2] * dusk];
  // Measured against a little more than the flat ground gets, so a low winter sun still reads.
  const toShade = 0.62 / (0.3 + 0.7 * light.z);
  const { x: lx, y: ly, z: lz } = light;
  for (let i = 0; i < w * h; i++) {
    if (water[i]) {
      color[i] = WATER;
      continue;
    }
    // The slope as drawn — stretched — facing the sun, or in a hill's shade.
    const dot = (nx[i] * lx + ny[i] * ly + lz) * inv[i];
    const lambert = (shadow && shadow[i]) || dot < 0 ? 0 : dot;
    const shade = Math.min(1.5, 0.48 + lambert * toShade) * dim;
    const k = height[i];
    const r = (52 + k * 30) * shade * keep + nr;
    const g = (62 + k * 18) * shade * keep + ng;
    const b = (44 + k * 6) * shade * keep + nb;
    color[i] = ((255 << 24) | ((b + 0.5) << 16) | ((g + 0.5) << 8) | (r + 0.5)) >>> 0;
    const lit = wireShade(shade) * keep;
    wire[i] = pack(WIRE[0] * lit + nr, WIRE[1] * lit + ng, WIRE[2] * lit + nb);
  }
  const waterColor = pack(26 * dim * keep + nr, 50 * dim * keep + ng, 84 * dim * keep + nb);
  const toned = (c: [number, number, number]) => pack(c[0] * dim * keep + nr, c[1] * dim * keep + ng, c[2] * dim * keep + nb);
  const fillColor = toned(FILL);
  const parkColor = toned(PARK);
  const restorationColor = toned(RESTORATION);
  return { w, h, z, color, wire, waterColor, fillColor, parkColor, restorationColor, shadow, zMax: t.zMax, ax, bx, ay, by };
}

type Slopes = { cellW: number; cellH: number; nx: Float32Array; ny: Float32Array; inv: Float32Array; k: Float32Array };
const slopeCache = new WeakMap<Terrain, Slopes>();

/**
 * Each cell's slope, as drawn (stretched by EXAG), as the x and y of its
 * surface normal and one over its length, with how high it is (0–1 of
 * 140 m): everything the light needs that doesn't change with the light,
 * worked out once a terrain so moving the sun only has a dot product to do.
 */
function slopesOf(t: Terrain, cellW: number, cellH: number): Slopes {
  const cached = slopeCache.get(t);
  if (cached && cached.cellW === cellW && cached.cellH === cellH) return cached;
  const { w, h, z } = t;
  const nx = new Float32Array(w * h);
  const ny = new Float32Array(w * h);
  const inv = new Float32Array(w * h);
  const k = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dzdx = (z[y * w + Math.min(w - 1, x + 1)] - z[y * w + Math.max(0, x - 1)]) / (2 * cellW);
      // Grid rows run south, so north is the row above.
      const dzdy = (z[Math.max(0, y - 1) * w + x] - z[Math.min(h - 1, y + 1) * w + x]) / (2 * cellH);
      nx[i] = -dzdx * EXAG;
      ny[i] = -dzdy * EXAG;
      inv[i] = 1 / Math.hypot(nx[i], ny[i], 1);
      k[i] = Math.min(1, Math.max(0, z[i] / 140));
    }
  }
  const slopes = { cellW, cellH, nx, ny, inv, k };
  slopeCache.set(t, slopes);
  return slopes;
}

/**
 * Which cells the hills hide from the sun — at their real height, not the
 * stretched one. One sweep, starting from the side the sun is on: each cell
 * takes the horizon from the cell (or two cells, between them) one step
 * nearer the sun, lowered by how far the sun's rays drop over that step, and
 * is in shade if that horizon stands above it.
 */
function castShadows(z: Float32Array, w: number, h: number, cellW: number, cellH: number, light: Light): Uint8Array {
  // Toward the sun, in cells: x east, rows south.
  const sx = light.x / cellW;
  const sy = -light.y / cellH;
  const drop = Math.tan(Math.max(1, light.altitude) * (Math.PI / 180));
  const horizon = new Float32Array(w * h).fill(-Infinity);
  const out = new Uint8Array(w * h);
  const along = Math.abs(sx) >= Math.abs(sy);
  // A step of one cell along the main axis, and the fraction of one across.
  const across = along ? sy / Math.abs(sx) : sx / Math.abs(sy);
  const stepM = along ? Math.hypot(cellW, across * cellH) : Math.hypot(across * cellW, cellH);
  const fall = stepM * drop;
  const outer = along ? w : h;
  const inner = along ? h : w;
  const forward = along ? sx > 0 : sy > 0;
  for (let a = 0; a < outer; a++) {
    // The line nearest the sun first.
    const line = forward ? outer - 1 - a : a;
    const prev = forward ? line + 1 : line - 1;
    if (prev < 0 || prev >= outer) continue;
    for (let b = 0; b < inner; b++) {
      const f = b + across;
      const b0 = Math.floor(f);
      const t = f - b0;
      if (b0 < 0 || b0 + 1 >= inner) continue;
      const i0 = along ? b0 * w + prev : prev * w + b0;
      const i1 = along ? (b0 + 1) * w + prev : prev * w + b0 + 1;
      const up0 = Math.max(z[i0], horizon[i0]);
      const up1 = Math.max(z[i1], horizon[i1]);
      const i = along ? b * w + line : line * w + b;
      const hz = up0 + (up1 - up0) * t - fall;
      horizon[i] = hz;
      if (hz > z[i] + 0.5) out[i] = 1;
    }
  }
  return out;
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

/** Which way the view faces, degrees clockwise from north. */
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
  /** Parks and restoration zones, tinted into the ground. */
  overlay: Overlay | null = null,
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
  const gwire = g ? g.wire : new Uint32Array(0);
  const zCeil = g ? g.zMax : 0;
  // The wireframe runs along the grid's cell lines — every one, or every
  // other, every fourth… far out, or halving and quartering the cells close
  // in — whichever keeps them about WIRE_GAP to twice that apart at this zoom,
  // foreshortened as they are by the angle.
  let every = 1;
  if (g) {
    const cellPx = (S / Math.max(Math.abs(g.ax), Math.abs(g.ay))) * view.sin;
    while (every * cellPx < WIRE_GAP && every < 1 << 12) every *= 2;
    while (every * cellPx >= WIRE_GAP * 2 && every > 1 / 64) every /= 2;
  }
  // How far, in lines, a column spans across: a line running up the screen is
  // on a column when it falls within half of that.
  const halfX = g ? (Math.abs(g.ax * ux) / S / every) * stride * 0.5 : 0;
  const halfY = g ? (Math.abs(g.ay * uy) / S / every) * stride * 0.5 : 0;

  for (let x = 0; x < W; x += stride) {
    const u = cu + (x + 0.5 - W / 2) / S;
    const twin = stride === 2 && x + 1 < W;
    let yb = H;
    let inside = false;
    // Where the step before sat in lines and on screen, to catch a line crossed between the two.
    let lastX = NaN;
    let lastY = NaN;
    let lastTop = NaN;
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
        lastX = NaN;
        continue;
      }
      // Inlined groundZ and blend: this loop runs for every pixel of depth in
      // every column, and the calls were most of its cost.
      let z = 0;
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
      // On a line running up the screen (the whole span), or crossing one
      // that runs across it since the step before (one pixel, where it fell).
      let onLine = false;
      let yLine = -1;
      if (g && !wet) {
        const lx = (g.ax * mx + g.bx) / every;
        const ly = (g.ay * my + g.by) / every;
        const ex = lx - Math.round(lx);
        const ey = ly - Math.round(ly);
        onLine = (ex < 0 ? -ex : ex) < halfX || (ey < 0 ? -ey : ey) < halfY;
        if (!onLine && lastX === lastX) {
          let t = -1;
          const fx = Math.floor(lx);
          const fy = Math.floor(ly);
          // The line crossed is the higher of the two floors, whichever way the step went.
          const px = Math.floor(lastX);
          const py = Math.floor(lastY);
          if (fx !== px) t = (Math.max(fx, px) - lastX) / (lx - lastX);
          if (fy !== py) t = Math.max(t, (Math.max(fy, py) - lastY) / (ly - lastY));
          if (t >= 0) yLine = Math.round(lastTop + (yTop - lastTop) * Math.min(1, t));
        }
        lastX = lx;
        lastY = ly;
        lastTop = yTop;
      } else lastX = NaN;
      if (yTop >= yb) {
        inside = true;
        continue;
      }
      let color = FLAT_LAND;
      let fill = FLAT_LAND;
      if (g) {
        if (wet) color = fill = g.waterColor;
        else {
          // The line's color blended from the land cells around, leaving the water out.
          const wa = gc[ci] === WATER ? 0 : (1 - tx) * (1 - ty);
          const wb = gc[ci + 1] === WATER ? 0 : tx * (1 - ty);
          const wc = gc[ci + gw] === WATER ? 0 : (1 - tx) * ty;
          const wd = gc[ci + gw + 1] === WATER ? 0 : tx * ty;
          const sum = wa + wb + wc + wd || 1;
          const a = gwire[ci];
          const b = gwire[ci + 1];
          const c = gwire[ci + gw];
          const d = gwire[ci + gw + 1];
          const r = ((a & 255) * wa + (b & 255) * wb + (c & 255) * wc + (d & 255) * wd) / sum;
          const gg = (((a >>> 8) & 255) * wa + ((b >>> 8) & 255) * wb + ((c >>> 8) & 255) * wc + ((d >>> 8) & 255) * wd) / sum;
          const bb = (((a >>> 16) & 255) * wa + ((b >>> 16) & 255) * wb + ((c >>> 16) & 255) * wc + ((d >>> 16) & 255) * wd) / sum;
          color = ((255 << 24) | ((bb + 0.5) << 16) | ((gg + 0.5) << 8) | (r + 0.5)) >>> 0;
          fill = g.fillColor;
        }
      }
      if (overlay && !wet) {
        const o = overlayAt(overlay, mx, my);
        if (o && g) {
          // Solid park green, its wireframe a lighter line of the same so the hills still read.
          fill = o & OVERLAY_RESTORATION ? g.restorationColor : g.parkColor;
          color = shadeColor(fill, 1.3);
        } else if (o) {
          color = placeTint(color, o);
          fill = placeTint(fill, o);
        }
      }
      // The front edge of the slab shows its side, down to the slab's base.
      const yEnd = inside ? yb : Math.min(yb, Math.ceil(yGround + slabPx));
      const y0 = Math.max(0, Math.floor(yTop));
      const faceFrom = inside ? yEnd : Math.min(yEnd, y0 + 2);
      if (yLine >= 0) yLine = Math.max(y0, Math.min(yEnd - 1, yLine));
      for (let y = y0; y < yEnd; y++) {
        const p = y * W + x;
        const c = y < faceFrom ? (onLine || y === yLine ? color : fill) : wet ? SIDE_WATER : SIDE;
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

/** Ground under a park, greener; under a forest-restoration zone, greener and yellower still. */
export function placeTint(c: number, bits: number): number {
  const r = c & 255;
  const g = (c >>> 8) & 255;
  const b = (c >>> 16) & 255;
  // Scaled, not added to, so a park darkens with the rest of the ground at night.
  if (bits & OVERLAY_RESTORATION) return pack(Math.min(255, r * 1.06), Math.min(255, g * 1.36), b * 0.6);
  if (bits & OVERLAY_PARK) return pack(r * 0.84, Math.min(255, g * 1.22), b * 0.84);
  return c;
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
 * A broadleaf crown on screen: an oval stretched up to fill the tree, from
 * the treetop down to where a cone's crown would end, leaving the same bit of
 * trunk showing; or, for a tree wider than that, a ball resting just above
 * the ground. Its centre and its half-height, in device pixels.
 */
export function crownBall(base: number, hp: number, r: number): { y: number; ry: number } {
  const ry = Math.max(r, hp * 0.44);
  return { y: base - Math.max(hp - ry, ry * 0.8), ry };
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
  const { y } = crownBall(base, height * TREE_SCALE * TREE_EXAG * view.S * view.cos, crown * TREE_SCALE * view.S);
  return { x, y, base, v };
}

/**
 * The outline of a tree's crown on screen, in device pixels, as the tree pass
 * draws it: a cone's triangle, or a ball's (or a column's) oval.
 */
export type CrownOutline =
  | { shape: "oval"; x: number; y: number; r: number; ry: number }
  | { shape: "cone"; x: number; top: number; bottom: number; half: number };

export function crownOutline(
  view: TiltView,
  mx: number,
  my: number,
  gz: number,
  height: number,
  crown: number,
  shape: number,
): CrownOutline {
  const at = treeScreen(view, mx, my, gz, height, crown);
  const hp = height * TREE_SCALE * TREE_EXAG * view.S * view.cos;
  const r = crown * TREE_SCALE * view.S;
  if (shape === 1 && hp >= 3) return { shape: "cone", x: at.x, top: at.base - hp, bottom: at.base - hp * 0.12, half: r };
  return { shape: "oval", x: at.x, y: at.y, r, ry: crownBall(at.base, hp, r).ry };
}

/**
 * How the trees are lit. Without the sun, the bright side of every crown is
 * up and to the left, as the ground's light comes from the north-west; with
 * it, the side facing the sun, the whole tree dimmed by dusk, and a shadow
 * thrown across the ground away from it.
 */
export type TreeLight = {
  /** Which way a crown's lit side faces on screen: x right, y up. */
  lx: number;
  ly: number;
  /** How bright the trees are: 1 by day. */
  k: number;
  /**
   * Where a crown's shadow falls, per metre of height it stands above the
   * ground: screen pixels, and depth. `px`, `py` is a metre across the
   * shadow, on the ground, in screen pixels — for a cone's wedge.
   */
  shadow: { dx: number; dy: number; dv: number; px: number; py: number } | null;
  /** Per pixel: 1 bare ground, 0 a tree, 2 ground already in a tree's shadow. From `resetShadowMask`. */
  mask: Uint8Array | null;
};

export const MAP_LIGHT: TreeLight = { lx: -0.7, ly: 0.9, k: 1, shadow: null, mask: null };

/** The trees' light for this view, from the sun. */
export function treeLight(view: TiltView, light: Light, mask: Uint8Array | null): TreeLight {
  const lu = view.ux * light.x + view.uy * light.y;
  const lv = view.vx * light.x + view.vy * light.y;
  const up = lv * view.sin + light.z * view.cos;
  // As long as the map's own light, so crowns shade as deeply.
  const len = Math.hypot(lu, up) || 1;
  const k = 0.35 + 0.65 * light.day;
  let shadow: TreeLight["shadow"] = null;
  if (light.altitude > 1 && mask) {
    // Away from the sun along the ground, as far as a tree is tall over the tan of its height — capped,
    // or the last minutes before sunset throw shadows across half the city.
    const flat = Math.hypot(light.x, light.y) || 1;
    const reach = Math.min(6, 1 / Math.tan(light.altitude * (Math.PI / 180)));
    const ox = (-light.x / flat) * reach;
    const oy = (-light.y / flat) * reach;
    const du = view.ux * ox + view.uy * oy;
    const dv = view.vx * ox + view.vy * oy;
    // Square to the shadow, along the ground.
    const qx = light.y / flat;
    const qy = -light.x / flat;
    const pu = view.ux * qx + view.uy * qy;
    const pv = view.vx * qx + view.vy * qy;
    shadow = { dx: du * view.S, dy: -dv * view.S * view.sin, dv, px: pu * view.S, py: -pv * view.S * view.sin };
  }
  return { lx: (lu / len) * 1.14, ly: (up / len) * 1.14, k, shadow, mask };
}

/**
 * A triangle of shadow on whatever bare ground it covers, row by row; `v` is
 * its depth for the test against the hills, `see` thins it to a dither.
 */
function fillShadow(
  buf: Uint32Array,
  depth: Float32Array,
  mask: Uint8Array,
  W: number,
  H: number,
  v: number,
  see: boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
  const y1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy)));
  const edges: [number, number, number, number][] = [
    [ax, ay, bx, by],
    [bx, by, cx, cy],
    [cx, cy, ax, ay],
  ];
  for (let y = y0; y <= y1; y++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x1, y1e, x2, y2] of edges) {
      if ((y < y1e && y < y2) || (y > y1e && y > y2) || y1e === y2) continue;
      const x = x1 + ((y - y1e) / (y2 - y1e)) * (x2 - x1);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (lo > hi) continue;
    const x0 = Math.max(0, Math.ceil(lo));
    const x1 = Math.min(W - 1, Math.floor(hi));
    for (let x = x0; x <= x1; x++) {
      if (see && (x + y) & 1) continue;
      const q = y * W + x;
      if (mask[q] !== 1 || v - DEPTH_SLACK > depth[q]) continue;
      buf[q] = inShadow(buf[q]);
      mask[q] = 2;
    }
  }
}

/** Ready the shadow mask for a frame: every pixel with ground under it is bare ground again. */
export function resetShadowMask(mask: Uint8Array, depth: Float32Array) {
  for (let q = 0; q < mask.length; q++) mask[q] = depth[q] < Infinity ? 1 : 0;
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
  light: TreeLight = MAP_LIGHT,
) {
  const { W, H, S, cu, cv } = view;
  const ss = S * view.sin;
  const gc = S * view.cos * EXAG;
  const tc = S * view.cos * TREE_EXAG * TREE_SCALE;
  const cs = S * TREE_SCALE;
  const halfW = W / 2;
  const halfH = H / 2;
  const { u: pu, v: pv, gz, height, crown, shape: shapes } = p;
  const { lx, ly, k: bright, shadow, mask } = light;
  // Screen pixels of height to metres of it, for where a shadow falls.
  const perMetre = S * view.cos;

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
        if (v - DEPTH_SLACK <= depth[q]) {
          buf[q] = bright === 1 || c === ghost ? c : shadeColor(c, bright);
          if (mask) mask[q] = 0;
        }
      }
      continue;
    }
    const ix = Math.round(sx);
    const shape = shapes[k];
    const see = bare !== null && bare[k] === 1;
    const lit = shadeColor(c, 1.22 * bright);
    const dark = shadeColor(c, 0.7 * bright);
    const mid = bright === 1 ? c : shadeColor(c, bright);

    // A broadleaf crown is an oval filling the tree above a stub of trunk;
    // the trunk runs up into its middle.
    const { y: ballY, ry: ballRy } = crownBall(base, hp, r);

    const trunkTop = Math.round(shape === 1 ? base - hp * 0.15 : ballY);
    const tw = r < 4 ? 1 : Math.max(1, Math.round(r * 0.14));

    // Its shadow first, on whatever bare ground it reaches: the trunk's, from
    // its foot to where its top falls, as wide as it's drawn.
    if (shadow && mask) {
      const lift = (base - trunkTop) / perMetre;
      const across = Math.hypot(shadow.px, shadow.py) || 1;
      const half = tw / 2;
      const ex = (shadow.px / across) * half;
      const ey = (shadow.py / across) * half;
      const tx = sx + shadow.dx * lift;
      const ty = base + shadow.dy * lift;
      const tv = v + shadow.dv * lift * 0.5;
      if (tw <= 1) {
        // A one-pixel trunk: a sliver either side of the line, so it doesn't vanish between pixels.
        fillShadow(buf, depth, mask, W, H, tv, see, sx - 0.5, base, sx + 0.5, base, tx, ty);
        fillShadow(buf, depth, mask, W, H, tv, see, sx, base - 0.5, sx, base + 0.5, tx, ty);
      } else {
        fillShadow(buf, depth, mask, W, H, tv, see, sx + ex, base + ey, sx - ex, base - ey, tx - ex, ty - ey);
        fillShadow(buf, depth, mask, W, H, tv, see, sx + ex, base + ey, tx - ex, ty - ey, tx + ex, ty + ey);
      }
    }
    // Then the crown's. A cone throws a wedge: as wide as its crown where the
    // crown starts, narrowing to the point its tip throws.
    if (shadow && mask && shape === 1) {
      const h = hp / perMetre;
      const low = h * 0.12;
      const bx = sx + shadow.dx * low;
      const by = base + shadow.dy * low;
      const wx = shadow.px * (r / cs);
      const wy = shadow.py * (r / cs);
      fillShadow(
        buf,
        depth,
        mask,
        W,
        H,
        v + shadow.dv * h * 0.5,
        see,
        bx + wx,
        by + wy,
        bx - wx,
        by - wy,
        sx + shadow.dx * h,
        base + shadow.dy * h,
      );
    } else if (shadow && mask) {
      // A ball (or column) throws an ellipse where its middle does, a bare tree's thinner.
      const lift = (base - ballY) / perMetre;
      const shx = sx + shadow.dx * lift;
      const shy = base + shadow.dy * lift;
      const shv = v + shadow.dv * lift;
      const rx = Math.max(1, r);
      const ry = Math.max(1, ballRy * view.sin);
      const y0 = Math.max(0, Math.ceil(shy - ry));
      const y1 = Math.min(H - 1, Math.floor(shy + ry));
      for (let y = y0; y <= y1; y++) {
        const dy = (y - shy) / ry;
        const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
        const x0 = Math.max(0, Math.ceil(shx - half));
        const x1 = Math.min(W - 1, Math.floor(shx + half));
        for (let x = x0; x <= x1; x++) {
          if (see && (x + y) & 1) continue;
          const q = y * W + x;
          if (mask[q] !== 1 || shv - DEPTH_SLACK > depth[q]) continue;
          buf[q] = inShadow(buf[q]);
          mask[q] = 2;
        }
      }
    }
    // The sprite's own pixels, rows clipped to the screen once rather than
    // every pixel tested: this loop is most of what a dense view costs.
    const vs = v - DEPTH_SLACK;
    const trunk = bright === 1 ? TRUNK : shadeColor(TRUNK, bright);
    const tx0 = Math.max(0, ix - (tw >> 1));
    const tx1 = Math.min(W - 1, ix - (tw >> 1) + tw - 1);
    for (let y = Math.min(H - 1, Math.round(base)); y >= Math.max(0, trunkTop); y--) {
      const row = y * W;
      for (let x = tx0; x <= tx1; x++) {
        const q = row + x;
        if (vs <= depth[q]) {
          buf[q] = trunk;
          if (mask) mask[q] = 0;
        }
      }
    }

    if (shape === 1) {
      const top = base - hp;
      const bottom = base - hp * 0.12;
      const y0 = Math.max(0, Math.ceil(top));
      const y1 = Math.min(H - 1, Math.floor(bottom));
      // A cone is lit on the side the light comes from, across.
      const side = (lx < 0 ? 1 : -1) * Math.min(1, Math.abs(lx) / 0.7);
      for (let y = y0; y <= y1; y++) {
        const half = Math.max(0.5, (r * (y - top)) / Math.max(1, bottom - top));
        const x0 = Math.max(0, Math.ceil(sx - half));
        const x1 = Math.min(W - 1, Math.floor(sx + half));
        const step = side / half;
        let t = (x0 - sx) * step;
        const row = y * W;
        for (let x = x0; x <= x1; x++, t += step) {
          if (see && (x + y) & 1) continue;
          const q = row + x;
          if (vs <= depth[q]) {
            buf[q] = t < -0.3 ? lit : t > 0.35 ? dark : mid;
            if (mask) mask[q] = 0;
          }
        }
      }
      continue;
    }

    // Round (and upright cultivars, at their narrower spread): an oval as
    // tall as the crown stands, as wide as it spreads.
    const cy = ballY;
    const rr = Math.max(0.5, r);
    const ry = Math.max(0.5, ballRy);
    const y0 = Math.max(0, Math.ceil(cy - ry));
    const y1 = Math.min(H - 1, Math.floor(cy + ry));
    const step = -lx / rr;
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry;
      const half = r * Math.sqrt(Math.max(0, 1 - dy * dy));
      const x0 = Math.max(0, Math.ceil(sx - half));
      const x1 = Math.min(W - 1, Math.floor(sx + half));
      let t = (x0 - sx) * step + dy * ly;
      const row = y * W;
      for (let x = x0; x <= x1; x++, t += step) {
        if (see && (x + y) & 1) continue;
        const q = row + x;
        if (vs <= depth[q]) {
          buf[q] = t < -0.4 ? lit : t > 0.45 ? dark : mid;
          if (mask) mask[q] = 0;
        }
      }
    }
  }
}

/** A pixel in a tree's shadow: each channel at five-eighths, by shifts rather than multiplies. */
const inShadow = (c: number) => ((((c >>> 1) & 0x7f7f7f) + ((c >>> 3) & 0x1f1f1f)) | 0xff000000) >>> 0;
