/**
 * The world behind cubicles.exe's hallway doors: trees.exe's diorama with you standing in it. The same
 * ground grid and the same little trees, but seen from eye height through a
 * perspective camera instead of from above at an angle.
 *
 * The ground is the old voxel flight games' trick done properly this time —
 * the Tilt view's column walk with the depth divided through: each screen
 * column marched out from the eye, near to far, keeping only what rises above
 * everything already drawn in front of it. Looking up and down shears the
 * picture rather than turning it, which keeps every tree trunk upright.
 *
 * The trees are the Tilt view's sprites, sized by distance, each tested
 * against a depth buffer: against the ground with a little slack (a trunk
 * stands on the ground, not behind it) and against the other trees exactly,
 * so they can go in any order. Only the ones within REACH are drawn, out of a
 * coarse grid; the fog has nearly swallowed them by then.
 *
 * The ground is Tilt's: its dark fill, its green elevation rings (a tidy
 * height a few pixels' worth at that distance apart, every fifth brighter),
 * the parks solid green, and the creeks, gardens, track and areaways draped
 * over it (placesDraw.ts).
 *
 * Off the edge of the city's rectangle are the mountains round it, coarser,
 * out to the Olympics and the Cascades, sunk by the curve of the Earth; past
 * those, the table the diorama stands on. The ground is ringed with its
 * elevation rather than gridded: a ring every metre or two underfoot, every
 * few hundred on Rainier.
 *
 * Everything here works on a raw Uint32 ImageData buffer, like treesTilt.ts.
 */

import type { Ground } from "@/lib/treesTilt";
import { crownBall, groundZ, placeTint, ringInterval, WATER } from "@/lib/treesTilt";
import { OVERLAY_PARK, OVERLAY_RESTORATION, overlayAt, Places } from "@/lib/places";
import { drapeWalkPlaces, PlacesShown, ratTurn, spinRat } from "@/lib/placesDraw";
import type { Pipes } from "@/lib/pipes";

/** Metres from the ground to the eye: the same 6 ft 2 in walker as cubicles.exe. */
export const EYE = 1.77;
/** How far up and down you can look, radians. */
export const PITCH_LIMIT = 0.6;
/** Vertical field of view, radians. */
const FOV = 1.05;
const NEAR = 0.4;
/** The furthest ground drawn — far enough for Baker and St. Helens — and the furthest trees, in metres. */
const FAR = 260000;
const REACH = 3000;
/** Metres of air to take about two thirds of a colour into the haze: none to speak of in the city, a blue cast on Rainier. */
const FOG = 300000;
/** The Earth's radius, stretched by a sixth for the air bending light over the horizon: what the mountains sink behind. */
const EARTH_R = 6371000 * (7 / 6);
/** The tree grid's cell, metres. */
const CELL = 64;
/** How far below sea level the table under the diorama is. */
const TABLE_DEPTH = 30;

const pack = (r: number, g: number, b: number) =>
  ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

/** A grey Seattle sky: pale at the horizon, a little bluer overhead. The fog is the horizon's colour. */
const HAZE = [182, 192, 194] as const;
const ZENITH = [104, 128, 152] as const;
const TABLE = pack(20, 26, 22);
const FLAT_LAND = pack(60, 68, 52);
const TRUNK = pack(70, 52, 40);
/** Stood on it, Tilt's wireframe wants to be a little lighter than seen from up high. */
const GROUND_LIGHT = 1.35;
/** Above this a park's green tint is left off: snow is snow, whoever's park it's in. */
const SNOWLINE = 1800;
/** About how many pixels of height apart the elevation rings are, at any distance. */
const RING_PX = 3;
/** How much brighter than the ground's own lighting the rings are drawn, and the fifth ones brighter again. */
const RING_LIGHT = 2.1;
const INDEX_LIGHT = 1.5;
/** Within this many metres the rings are two pixels thick. */
const RING_THICK = 400;
/** The most rings one step of a column draws. */
const RING_CROSSINGS = 4;
/** Places further than this aren't draped: past it they're under a pixel. */
const PLACE_REACH = 1200;
/** The map's water is a dark navy for under the trees' dots; stood on the shore it's a lake, and blue. */
const LAKE = [58, 112, 172] as const;
/** Water keeps its colour further out than land does: only this much of the fog. */
const LAKE_FOG = 0.6;

/** Every column steps out through the same distances, so they're worked out once. */
const STEPS = (() => {
  const zs: number[] = [];
  for (let z = NEAR; z < FAR; z += Math.max(0.08, z * 0.016)) zs.push(z);
  const z = Float32Array.from(zs);
  const fog = Float32Array.from(zs, (d) => 1 - Math.exp(-d / FOG));
  // How far the ground has dropped away round the curve of the Earth by then.
  const drop = Float32Array.from(zs, (d) => (d * d) / (2 * EARTH_R));
  return { z, fog, drop, n: zs.length };
})();

function fogged(c: number, k: number): number {
  const r = c & 255;
  const g = (c >>> 8) & 255;
  const b = (c >>> 16) & 255;
  return pack(r + (HAZE[0] - r) * k, g + (HAZE[1] - g) * k, b + (HAZE[2] - b) * k);
}

/**
 * Down in the ground (Dive): the dark of the earth everything fades into, a
 * few dozen metres off; the surface overhead seen from under it, dim and
 * gridded every CEILING_GRID metres; and how far off places are still drawn.
 */
const EARTH = [16, 12, 9] as const;
const UNDER_FOG = 45;
const CEILING = pack(58, 46, 34);
const CEILING_LINE = pack(104, 86, 62);
const CEILING_GRID = 8;
const UNDER_REACH = 250;

function earthed(c: number, d: number): number {
  const k = 1 - Math.exp(-d / UNDER_FOG);
  const r = c & 255;
  const g = (c >>> 8) & 255;
  const b = (c >>> 16) & 255;
  return pack(r + (EARTH[0] - r) * k, g + (EARTH[1] - g) * k, b + (EARTH[2] - b) * k);
}

/**
 * The ground as seen from under it: for each column, the surface overhead
 * from the top of the screen down — the nearest stretch first, as from below
 * it's the near ground that hides what's beyond — and the dark of the earth
 * under that, as far off as anything down here is drawn: the pipes and pits
 * draw over it, and no tree from further off shows through.
 */
function drawCeiling(frame: WalkFrame, cam: WalkCamera, w: WalkWorld, f: number, horizon: number) {
  const { W, H, buf, depth } = frame;
  const g = w.ground!;
  const fx = Math.sin(cam.yaw);
  const fy = Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw);
  const ry = -Math.sin(cam.yaw);
  const dark = pack(EARTH[0], EARTH[1], EARTH[2]);
  const zs = STEPS.z;
  for (let x = 0; x < W; x++) {
    const t = (x + 0.5 - W / 2) / f;
    const dx = fx + rx * t;
    const dy = fy + ry * t;
    let yt = 0;
    let lastCx = NaN;
    let lastCy = NaN;
    for (let k = 0; k < STEPS.n && yt < H; k++) {
      const z = zs[k];
      if (z > UNDER_REACH) break;
      const wx = cam.x + dx * z;
      const wy = cam.y + dy * z;
      if (wx < 0 || wy < 0 || wx > w.widthM || wy > w.heightM) break;
      const h = groundZ(g, wx, wy);
      if (h <= cam.z) continue;
      const ys = horizon - (h - cam.z) * (f / z);
      const y1 = Math.min(H, Math.floor(ys));
      const cx = Math.floor(wx / CEILING_GRID);
      const cy = Math.floor(wy / CEILING_GRID);
      const line = cx !== lastCx || cy !== lastCy;
      lastCx = cx;
      lastCy = cy;
      if (y1 <= yt) continue;
      const c = earthed(line && k > 0 ? CEILING_LINE : CEILING, z);
      for (let y = Math.max(0, yt); y < y1; y++) {
        const p = y * W + x;
        buf[p] = c;
        depth[p] = z;
      }
      yt = y1;
    }
    for (let y = Math.max(0, yt); y < H; y++) {
      const p = y * W + x;
      buf[p] = dark;
      depth[p] = UNDER_REACH;
    }
  }
}

/** A rat caught down in its pipe and now following you: where it is, and which rat in the places (its index) it is. */
export type RatFollower = { x: number; y: number; z: number; k: number };

function shade(c: number, k: number): number {
  return pack(Math.min(255, (c & 255) * k), Math.min(255, ((c >>> 8) & 255) * k), Math.min(255, ((c >>> 16) & 255) * k));
}


// --- the world --------------------------------------------------------------------

/** Every tree in one run, the street trees first, with a grid to find the ones near you. */
export type WalkWorld = {
  widthM: number;
  heightM: number;
  ground: Ground | null;
  n: number;
  mx: Float32Array;
  my: Float32Array;
  /** Ground height under each tree, metres. */
  gz: Float32Array;
  height: Float32Array;
  crown: Float32Array;
  /** 0 round, 1 cone, 2 column — treesTilt's shapes. */
  shape: Uint8Array;
  /** Packed colour; 0 is not drawn. */
  color: Uint32Array;
  /** 1 where the crown is bare today, and drawn see-through. */
  bare: Uint8Array;
  gridW: number;
  gridH: number;
  /** Cell c's trees are items[start[c]] … items[start[c + 1]]. */
  start: Uint32Array;
  items: Uint32Array;
};

/** Sorts the trees into CELL-metre squares, one counting pass. */
export function gridTrees(w: Omit<WalkWorld, "gridW" | "gridH" | "start" | "items">): WalkWorld {
  const gridW = Math.max(1, Math.ceil(w.widthM / CELL));
  const gridH = Math.max(1, Math.ceil(w.heightM / CELL));
  const cellOf = new Uint32Array(w.n);
  const start = new Uint32Array(gridW * gridH + 1);
  for (let i = 0; i < w.n; i++) {
    const cx = Math.min(gridW - 1, Math.max(0, Math.floor(w.mx[i] / CELL)));
    const cy = Math.min(gridH - 1, Math.max(0, Math.floor(w.my[i] / CELL)));
    const c = cy * gridW + cx;
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < gridW * gridH; c++) start[c + 1] += start[c];
  const fill = start.slice(0, gridW * gridH);
  const items = new Uint32Array(w.n);
  for (let i = 0; i < w.n; i++) items[fill[cellOf[i]]++] = i;
  return { ...w, gridW, gridH, start, items };
}

/** Whether a point is in the water: most of the four cells round it are. */
export function isWet(g: Ground | null, mx: number, my: number): boolean {
  if (!g) return false;
  let fx = g.ax * mx + g.bx;
  let fy = g.ay * my + g.by;
  fx = Math.max(0, Math.min(g.w - 1.001, fx));
  fy = Math.max(0, Math.min(g.h - 1.001, fy));
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * g.w + x0;
  const c = g.color;
  const wet =
    (c[i] === WATER ? (1 - tx) * (1 - ty) : 0) +
    (c[i + 1] === WATER ? tx * (1 - ty) : 0) +
    (c[i + g.w] === WATER ? (1 - tx) * ty : 0) +
    (c[i + g.w + 1] === WATER ? tx * ty : 0);
  return wet > 0.5;
}

// --- the camera -------------------------------------------------------------------

export type WalkCamera = {
  /** Metres east and north of the city's south-west corner. */
  x: number;
  y: number;
  /** Eye height, metres above sea level. */
  z: number;
  /** Radians clockwise from north. */
  yaw: number;
  /** Radians above level; negative looks down. */
  pitch: number;
};

/** Device-pixel buffers for one size of view. Ground depth and tree depth are kept apart. */
export type WalkFrame = {
  W: number;
  H: number;
  buf: Uint32Array;
  depth: Float32Array;
  treeDepth: Float32Array;
  /** Which tree each pixel shows, -1 for none: the crosshair reads it. */
  id: Int32Array;
  /** Which vault, drain, outfall, structure or rat (its index in places.list) each pixel shows under the trees, -1 for none. */
  place: Int32Array;
  /** Which pipe (its index in pipes) each pixel shows, -1 for none. */
  pipe: Int32Array;
};

export function walkFrame(W: number, H: number, buf: Uint32Array): WalkFrame {
  const n = W * H;
  return {
    W,
    H,
    buf,
    depth: new Float32Array(n),
    treeDepth: new Float32Array(n),
    id: new Int32Array(n),
    place: new Int32Array(n),
    pipe: new Int32Array(n),
  };
}

// --- drawing ----------------------------------------------------------------------

export function renderWalk(
  frame: WalkFrame,
  cam: WalkCamera,
  w: WalkWorld,
  /** The parks, creeks, gardens, track and areaways, once they're in, and which of them to show. */
  places: Places | null = null,
  show: PlacesShown = { parks: true, water: true, underground: true, rats: true, pipes: false },
  /** The Pipes layer's pipes, once they're in. */
  pipes: Pipes | null = null,
  /** The rats dived down to and caught, trailing after you; `caught` holds their places' indexes, not drawn in their pipes. */
  followers: RatFollower[] = [],
  caught?: Set<number>,
  /** The mountains round the city, and their grid's bbox in the city's metres, once they're in. */
  far: { g: Ground; rect: { x0: number; y0: number; x1: number; y1: number } } | null = null,
) {
  const { W, H, buf, depth, treeDepth, id, place, pipe } = frame;
  const f = H / 2 / Math.tan(FOV / 2);
  const horizon = H / 2 + f * Math.tan(cam.pitch);
  const fx = Math.sin(cam.yaw);
  const fy = Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw);
  const ry = -Math.sin(cam.yaw);
  const g = w.ground;
  const { widthM, heightM } = w;

  // The sky, row by row: haze at the horizon, bluer up to a screen's height above it.
  const sky = new Uint32Array(H);
  for (let y = 0; y < H; y++) {
    const t = Math.max(0, Math.min(1, (horizon - y) / H));
    sky[y] = pack(HAZE[0] + (ZENITH[0] - HAZE[0]) * t, HAZE[1] + (ZENITH[1] - HAZE[1]) * t, HAZE[2] + (ZENITH[2] - HAZE[2]) * t);
  }

  const zs = STEPS.z;
  const fogs = STEPS.fog;
  const drops = STEPS.drop;
  // Screen pixels per metre of height at each step's distance.
  const fz = new Float32Array(STEPS.n);
  for (let k = 0; k < STEPS.n; k++) fz[k] = f / zs[k];
  const nSteps = STEPS.n;
  const rg = far ? far.g : null;
  const rect = far ? far.rect : null;
  const zCeil = Math.max(g ? g.zMax : 0, rg ? rg.zMax : 0);

  // The fog colour, a channel apiece, for mixing each step into it inline.
  const hazeR = HAZE[0];
  const hazeG = HAZE[1];
  const hazeB = HAZE[2];

  // The rings' spacing at each step, metres of height, and half a column's
  // width there in metres: a ring running away up the screen is on the column
  // where the ground's within that much of it, by its slope across.
  const overlay = places && show.parks ? places.overlay : null;
  const ringAt = new Float32Array(nSteps);
  const halfCol = new Float32Array(nSteps);
  for (let k = 0; k < nSteps; k++) {
    // Underfoot, finer than the map ever goes: a quarter or half metre, or a gentle street would show none.
    const want = (zs[k] / f) * RING_PX;
    ringAt[k] = want <= 0.25 ? 0.25 : want <= 0.5 ? 0.5 : ringInterval(want);
    halfCol[k] = (zs[k] / f) * (zs[k] < RING_THICK ? 1 : 0.5);
  }
  const crossRow = new Int32Array(RING_CROSSINGS);
  const crossIndex = new Uint8Array(RING_CROSSINGS);

  // Down in the ground itself (Dive), the surface is overhead.
  const below = !!g && cam.z < groundZ(g, cam.x, cam.y);
  if (below) drawCeiling(frame, cam, w, f, horizon);
  else for (let x = 0; x < W; x++) {
    const t = (x + 0.5 - W / 2) / f;
    const dx = fx + rx * t;
    const dy = fy + ry * t;
    let yb = H;
    // The height and screen row of the step before: the rings are found between the two.
    let lastH = NaN;
    let lastTop = NaN;
    for (let k = 0; k < nSteps; k++) {
      const z = zs[k];
      const wx = cam.x + dx * z;
      const wy = cam.y + dy * z;
      const inCity = wx >= 0 && wy >= 0 && wx <= widthM && wy <= heightM;
      // Whose ground this step is on: the city's, the mountains' round it, or neither — the table.
      const G = inCity ? g : rg && rect && wx >= rect.x0 && wx <= rect.x1 && wy >= rect.y0 && wy <= rect.y1 ? rg : null;
      const off = !inCity && !G;
      // The height first, and the colour only if this step shows: far out,
      // dozens of steps share one row of pixels and only the first is seen.
      // Inlined like renderGround's: this runs for every step of every column.
      let h = 0;
      let ci = 0;
      let tx = 0;
      let ty = 0;
      let wet = false;
      if (off) h = -TABLE_DEPTH;
      else if (G) {
        const gz = G.z;
        const gc = G.color;
        const gw = G.w;
        let gx = G.ax * wx + G.bx;
        let gy = G.ay * wy + G.by;
        if (gx < 0) gx = 0;
        else if (gx > gw - 1.001) gx = gw - 1.001;
        if (gy < 0) gy = 0;
        else if (gy > G.h - 1.001) gy = G.h - 1.001;
        const x0 = gx | 0;
        const y0 = gy | 0;
        tx = gx - x0;
        ty = gy - y0;
        ci = y0 * gw + x0;
        const wetness =
          (gc[ci] === WATER ? (1 - tx) * (1 - ty) : 0) +
          (gc[ci + 1] === WATER ? tx * (1 - ty) : 0) +
          (gc[ci + gw] === WATER ? (1 - tx) * ty : 0) +
          (gc[ci + gw + 1] === WATER ? tx * ty : 0);
        wet = wetness > 0.5;
        if (wet) {
          const near = ci + (tx > 0.5 ? 1 : 0) + (ty > 0.5 ? gw : 0);
          h = gc[near] === WATER ? gz[near] : Math.min(gz[ci], gz[ci + 1], gz[ci + gw], gz[ci + gw + 1]);
        } else {
          const top = gz[ci] + (gz[ci + 1] - gz[ci]) * tx;
          const bottom = gz[ci + gw] + (gz[ci + gw + 1] - gz[ci + gw]) * tx;
          h = top + (bottom - top) * ty;
        }
      }
      const ys = horizon - (h - drops[k] - cam.z) * fz[k];
      const y0 = ys <= 0 ? 0 : Math.ceil(ys);
      const fromTop = lastTop;
      lastTop = ys;
      // On a ring running up the screen (the whole span), or crossing ones
      // that run across it since the step before (a row apiece, where they fell).
      let onLine = 0;
      let nCross = 0;
      if (G && !wet) {
        const r = ringAt[k];
        const q = h / r;
        const near = Math.round(q);
        if (near > 0) {
          const gz = G.z;
          const gw = G.w;
          const dzdx = ((gz[ci + 1] - gz[ci]) * (1 - ty) + (gz[ci + gw + 1] - gz[ci + gw]) * ty) * G.ax;
          const dzdy = ((gz[ci + gw] - gz[ci]) * (1 - tx) + (gz[ci + gw + 1] - gz[ci + 1]) * tx) * G.ay;
          const across = dzdx * rx + dzdy * ry;
          const offH = (q - near) * r;
          if ((offH < 0 ? -offH : offH) < (across < 0 ? -across : across) * halfCol[k]) onLine = near % 5 === 0 ? 2 : 1;
        }
        if (!onLine && lastH === lastH) {
          const qa = lastH / r;
          const hi = Math.floor(qa > q ? qa : q);
          for (let m = Math.max(1, Math.floor(qa < q ? qa : q) + 1); m <= hi && nCross < RING_CROSSINGS; m++) {
            crossRow[nCross] = Math.round(fromTop + (ys - fromTop) * ((m - qa) / (q - qa)));
            crossIndex[nCross++] = m % 5 === 0 ? 1 : 0;
          }
        }
        lastH = h;
      } else lastH = NaN;
      if (y0 < yb) {
        let r: number;
        let gg: number;
        let bb: number;
        if (off || !G) {
          const c = off ? TABLE : FLAT_LAND;
          r = c & 255;
          gg = (c >>> 8) & 255;
          bb = (c >>> 16) & 255;
        } else if (wet) {
          r = LAKE[0];
          gg = LAKE[1];
          bb = LAKE[2];
        } else {
          let fill: number;
          let line: number;
          const nearest = ci + (tx > 0.5 ? 1 : 0) + (ty > 0.5 ? G.w : 0);
          if (G === rg) {
            // The mountains: their rings rock and snow up high, and between
            // them the same a shade darker, so a peak stands white on the sky.
            line = G.wire[nearest];
            if (G.parkMask && G.parkMask[nearest] && h < SNOWLINE) line = placeTint(line, OVERLAY_PARK);
            fill = shade(line, 0.85);
          } else {
            // The ring's colour from the land cells round it, leaving the water
            // out, or the parks' own green; the fill between, dark.
            fill = G.fillColor;
            const o = overlay ? overlayAt(overlay, wx, wy) : 0;
            if (o) {
              fill = o & OVERLAY_RESTORATION ? G.restorationColor : G.parkColor;
              line = shade(fill, 1.3);
            } else {
              const gc = G.color;
              const gw = G.w;
              const gw2 = G.wire;
              const wa = gc[ci] === WATER ? 0 : (1 - tx) * (1 - ty);
              const wb = gc[ci + 1] === WATER ? 0 : tx * (1 - ty);
              const wc = gc[ci + gw] === WATER ? 0 : (1 - tx) * ty;
              const wd = gc[ci + gw + 1] === WATER ? 0 : tx * ty;
              const sum = wa + wb + wc + wd || 1;
              const a = gw2[ci];
              const b = gw2[ci + 1];
              const c = gw2[ci + gw];
              const d = gw2[ci + gw + 1];
              line = pack(
                ((a & 255) * wa + (b & 255) * wb + (c & 255) * wc + (d & 255) * wd) / sum,
                (((a >>> 8) & 255) * wa + ((b >>> 8) & 255) * wb + ((c >>> 8) & 255) * wc + ((d >>> 8) & 255) * wd) / sum,
                (((a >>> 16) & 255) * wa + ((b >>> 16) & 255) * wb + ((c >>> 16) & 255) * wc + ((d >>> 16) & 255) * wd) / sum,
              );
            }
          }
          const fog = fogs[k];
          const lineOut = fogged(shade(line, GROUND_LIGHT * RING_LIGHT), fog);
          const brightOut = fogged(shade(line, GROUND_LIGHT * RING_LIGHT * INDEX_LIGHT), fog);
          const fillOut = onLine ? (onLine === 2 ? brightOut : lineOut) : fogged(shade(fill, GROUND_LIGHT), fog);
          for (let y = y0; y < yb; y++) {
            const p = y * W + x;
            buf[p] = fillOut;
            depth[p] = z;
          }
          const thick = z < RING_THICK;
          for (let n = 0; n < nCross; n++) {
            const y = Math.max(y0, Math.min(yb - 1, crossRow[n]));
            const c = crossIndex[n] ? brightOut : lineOut;
            buf[y * W + x] = c;
            if (thick && y + 1 < yb) buf[(y + 1) * W + x] = c;
          }
          yb = y0;
          if (yb <= 0) break;
          if (zCeil - drops[k] >= cam.z ? horizon - (zCeil - drops[k] - cam.z) * fz[k] >= yb : horizon >= yb) break;
          continue;
        }
        const fog = wet && !off ? fogs[k] * LAKE_FOG : fogs[k];
        const out =
          ((255 << 24) |
            (((bb + (hazeB - bb) * fog) | 0) << 16) |
            (((gg + (hazeG - gg) * fog) | 0) << 8) |
            ((r + (hazeR - r) * fog) | 0)) >>>
          0;
        for (let y = y0; y < yb; y++) {
          const p = y * W + x;
          buf[p] = out;
          depth[p] = z;
        }
        yb = y0;
        if (yb <= 0) break;
      }
      // Nothing further out can climb above what's drawn: stop.
      if (zCeil - drops[k] >= cam.z ? horizon - (zCeil - drops[k] - cam.z) * fz[k] >= yb : horizon >= yb) break;
    }
    for (let y = 0; y < yb; y++) {
      const p = y * W + x;
      buf[p] = sky[y];
      depth[p] = Infinity;
    }
  }

  const project = (mx: number, my: number, z: number) => {
    const ox = mx - cam.x;
    const oy = my - cam.y;
    const d = ox * fx + oy * fy;
    const s = f / d;
    return { x: W / 2 + (ox * rx + oy * ry) * s, y: horizon - (z - cam.z) * s, d };
  };
  place.fill(-1);
  pipe.fill(-1);
  if (places) {
    drapeWalkPlaces(
      buf,
      depth,
      {
        W,
        H,
        near: NEAR,
        f,
        cx: cam.x,
        cy: cam.y,
        reach: below ? UNDER_REACH : PLACE_REACH,
        project,
        tint: below ? earthed : (c, d) => fogged(c, 1 - Math.exp(-d / FOG)),
        below,
      },
      g,
      places,
      show,
      place,
      pipes,
      pipe,
      caught,
    );
  }

  treeDepth.fill(Infinity);
  id.fill(-1);
  drawTrees(frame, cam, w, f, horizon);

  // The rats following you, spinning as they did in their pipes; behind a tree, hidden.
  const tint = below ? earthed : (c: number, d: number) => fogged(c, 1 - Math.exp(-d / FOG));
  for (const rat of followers) {
    const at = project(rat.x, rat.y, rat.z);
    if (at.d < NEAR || at.d > 120) continue;
    const qx = Math.round(at.x);
    const qy = Math.round(at.y);
    if (qx >= 0 && qy >= 0 && qx < W && qy < H && treeDepth[qy * W + qx] < at.d) continue;
    spinRat(buf, W, H, at.x, at.y, Math.max(6, (0.5 * f) / at.d), ratTurn(rat.k), (c) => tint(c, at.d));
  }
}

function drawTrees(frame: WalkFrame, cam: WalkCamera, w: WalkWorld, f: number, horizon: number) {
  const { W, H, buf, depth, treeDepth, id } = frame;
  const fx = Math.sin(cam.yaw);
  const fy = Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw);
  const ry = -Math.sin(cam.yaw);
  const tanHalf = W / 2 / f;
  const diag = CELL * 0.71;
  const { mx, my, gz, height, crown, shape: shapes, color, bare, start, items, gridW, gridH } = w;

  const cx0 = Math.max(0, Math.floor((cam.x - REACH) / CELL));
  const cx1 = Math.min(gridW - 1, Math.floor((cam.x + REACH) / CELL));
  const cy0 = Math.max(0, Math.floor((cam.y - REACH) / CELL));
  const cy1 = Math.min(gridH - 1, Math.floor((cam.y + REACH) / CELL));

  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * gridW + cx;
      const kFrom = start[c];
      const kTo = start[c + 1];
      if (kFrom === kTo) continue;
      // The whole cell behind you, or off to one side of the view: skip it.
      const ox = (cx + 0.5) * CELL - cam.x;
      const oy = (cy + 0.5) * CELL - cam.y;
      const cz = ox * fx + oy * fy;
      if (cz < -diag || cz > REACH + diag) continue;
      const across = ox * rx + oy * ry;
      if (Math.abs(across) - diag > (cz + diag) * tanHalf) continue;

      for (let k = kFrom; k < kTo; k++) {
        const i = items[k];
        const col = color[i];
        if (!col) continue;
        const dx = mx[i] - cam.x;
        const dy = my[i] - cam.y;
        const z = dx * fx + dy * fy;
        if (z < NEAR || z > REACH) continue;
        const s = f / z;
        const sx = W / 2 + (dx * rx + dy * ry) * s;
        const r = crown[i] * s;
        if (sx + r + 1 < 0 || sx - r - 1 > W) continue;
        const hp = height[i] * s;
        const base = horizon - (gz[i] - cam.z) * s;
        if (base - hp - r > H || base + r < 0) continue;

        const slack = 1.5 + z * 0.03;
        const fogK = 1 - Math.exp(-z / FOG);
        const plot = (x: number, y: number, c: number) => {
          const q = y * W + x;
          if (z - slack <= depth[q] && z <= treeDepth[q]) {
            buf[q] = c;
            treeDepth[q] = z;
            id[q] = i;
          }
        };
        const mid = fogged(col, fogK);

        if (hp < 2 && r < 1) {
          const x = (sx + 0.5) | 0;
          const y = (base - hp * 0.6 + 0.5) | 0;
          if (x >= 0 && y >= 0 && x < W && y < H) plot(x, y, mid);
          continue;
        }

        const shape = shapes[i];
        const see = bare[i] === 1;
        const light = fogged(shade(col, 1.22), fogK);
        const dark = fogged(shade(col, 0.7), fogK);

        // The trunk, up into the middle of the crown (or a little way up a cone).
        const { y: ballY, ry: ballRy } = crownBall(base, hp, r);
        const trunkTop = Math.round(shape === 1 ? base - hp * 0.15 : ballY);
        const tw = Math.max(1, Math.round(Math.max(0.25, crown[i] * 0.1) * s));
        const tx0 = Math.max(0, Math.round(sx) - (tw >> 1));
        const tx1 = Math.min(W - 1, Math.round(sx) - (tw >> 1) + tw - 1);
        const bark = fogged(TRUNK, fogK);
        for (let y = Math.min(H - 1, Math.round(base)); y >= Math.max(0, trunkTop); y--) {
          for (let x = tx0; x <= tx1; x++) plot(x, y, bark);
        }

        if (shape === 1) {
          const top = base - hp;
          const bottom = base - hp * 0.12;
          const y0 = Math.max(0, Math.ceil(top));
          const y1 = Math.min(H - 1, Math.floor(bottom));
          for (let y = y0; y <= y1; y++) {
            const half = Math.max(0.5, (r * (y - top)) / Math.max(1, bottom - top));
            const x0 = Math.max(0, Math.ceil(sx - half));
            const x1 = Math.min(W - 1, Math.floor(sx + half));
            for (let x = x0; x <= x1; x++) {
              if (see && (x + y) & 1) continue;
              const t = (x - sx) / half;
              plot(x, y, t < -0.3 ? light : t > 0.35 ? dark : mid);
            }
          }
          continue;
        }

        // A broadleaf crown: an oval as tall as the crown stands, as wide as it spreads.
        const y0 = Math.max(0, Math.ceil(ballY - ballRy));
        const y1 = Math.min(H - 1, Math.floor(ballY + ballRy));
        const rr = Math.max(0.5, r);
        const rv = Math.max(0.5, ballRy);
        for (let y = y0; y <= y1; y++) {
          const dyc = (y - ballY) / rv;
          const half = r * Math.sqrt(Math.max(0, 1 - dyc * dyc));
          const x0 = Math.max(0, Math.ceil(sx - half));
          const x1 = Math.min(W - 1, Math.floor(sx + half));
          for (let x = x0; x <= x1; x++) {
            if (see && (x + y) & 1) continue;
            const t = ((x - sx) / rr) * 0.7 + dyc * 0.9;
            plot(x, y, t < -0.4 ? light : t > 0.45 ? dark : mid);
          }
        }
      }
    }
  }
}
