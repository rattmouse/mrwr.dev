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
 * The ground is Tilt's wireframe: its dark fill, its green lines along the
 * terrain grid (every cell, or every other, or halved, whichever keeps them a
 * few pixels apart at that distance), the parks solid green, and the creeks,
 * gardens, track and areaways draped over it (placesDraw.ts).
 *
 * Off the edge of the city's rectangle is the table the diorama stands on.
 *
 * Everything here works on a raw Uint32 ImageData buffer, like treesTilt.ts.
 */

import type { Ground } from "@/lib/treesTilt";
import { crownBall, groundZ, WATER } from "@/lib/treesTilt";
import { OVERLAY_RESTORATION, overlayAt, Places } from "@/lib/places";
import { drapeWalkPlaces, PlacesShown } from "@/lib/placesDraw";

/** Metres from the ground to the eye. */
export const EYE = 1.7;
/** How far up and down you can look, radians. */
export const PITCH_LIMIT = 0.6;
/** Vertical field of view, radians. */
const FOV = 1.05;
const NEAR = 0.4;
/** The furthest ground drawn, and the furthest trees, in metres. */
const FAR = 3200;
const REACH = 1500;
/** Metres for the fog to take about two thirds of a colour. */
const FOG = 700;
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
/** The fewest pixels between the wireframe's lines. */
const WIRE_GAP = 9;
/** The most wireframe lines one step of a column can cross. */
const RUNS = 6;
/** Places further than this aren't draped: past it they're under a pixel and fogged out. */
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
  return { z, fog, n: zs.length };
})();

function fogged(c: number, k: number): number {
  const r = c & 255;
  const g = (c >>> 8) & 255;
  const b = (c >>> 16) & 255;
  return pack(r + (HAZE[0] - r) * k, g + (HAZE[1] - g) * k, b + (HAZE[2] - b) * k);
}

function shade(c: number, k: number): number {
  return pack(Math.min(255, (c & 255) * k), Math.min(255, ((c >>> 8) & 255) * k), Math.min(255, ((c >>> 16) & 255) * k));
}

/**
 * Where a column passes over lines of the wireframe between two steps: a
 * grid coordinate going from `a` to `b`, in lines, and the column's half
 * width in the same, `hw`. Each stretch within `hw` of a whole number goes
 * into `runs` as fractions of the way from `a` to `b`, after the `n` already
 * there; returns how many there are now.
 */
function lineRuns(a: number, b: number, hw: number, runs: Float32Array, n: number): number {
  const d = b - a;
  const lo = Math.ceil((a < b ? a : b) - hw);
  const hi = Math.floor((a < b ? b : a) + hw);
  for (let m = lo; m <= hi && n < RUNS; m++) {
    let t0: number;
    let t1: number;
    if (d > -1e-9 && d < 1e-9) {
      if (Math.abs(m - b) >= hw) continue;
      t0 = 0;
      t1 = 1;
    } else {
      t0 = (m - hw - a) / d;
      t1 = (m + hw - a) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (t1 < 0 || t0 > 1) continue;
      if (t0 < 0) t0 = 0;
      if (t1 > 1) t1 = 1;
    }
    runs[n * 2] = t0;
    runs[n * 2 + 1] = t1;
    n++;
  }
  return n;
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
};

export function walkFrame(W: number, H: number, buf: Uint32Array): WalkFrame {
  return { W, H, buf, depth: new Float32Array(W * H), treeDepth: new Float32Array(W * H), id: new Int32Array(W * H) };
}

// --- drawing ----------------------------------------------------------------------

export function renderWalk(
  frame: WalkFrame,
  cam: WalkCamera,
  w: WalkWorld,
  /** The parks, creeks, gardens, track and areaways, once they're in, and which of them to show. */
  places: Places | null = null,
  show: PlacesShown = { parks: true, water: true, underground: true },
) {
  const { W, H, buf, depth, treeDepth, id } = frame;
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
  // Screen pixels per metre of height at each step's distance.
  const fz = new Float32Array(STEPS.n);
  for (let k = 0; k < STEPS.n; k++) fz[k] = f / zs[k];
  const nSteps = STEPS.n;
  const zCeil = g ? g.zMax : 0;
  const gw = g ? g.w : 0;
  const gh = g ? g.h : 0;
  const gz = g ? g.z : null;
  const gc = g ? g.color : null;
  const ax = g ? g.ax : 0;
  const bx = g ? g.bx : 0;
  const ay = g ? g.ay : 0;
  const by = g ? g.by : 0;

  // The fog colour, a channel apiece, for mixing each step into it inline.
  const hazeR = HAZE[0];
  const hazeG = HAZE[1];
  const hazeB = HAZE[2];

  // The wireframe's spacing at each step, in grid cells: lines across the
  // screen a few pixels apart, and lines going away from you a few pixels
  // apart where they cross the ground, foreshortened by how high the eye is
  // above it. Powers of two, so the lines nearer in include the further ones'.
  const overlay = places && show.parks ? places.overlay : null;
  const every = new Float32Array(nSteps);
  const halfX = new Float32Array(nSteps);
  const halfY = new Float32Array(nSteps);
  if (g) {
    const perM = Math.max(Math.abs(ax), Math.abs(ay));
    const lift = Math.max(EYE, cam.z - groundZ(g, cam.x, cam.y));
    for (let k = 0; k < nSteps; k++) {
      const z = zs[k];
      // Pixels per cell across, and down the screen.
      const across = fz[k] / perM;
      const down = (fz[k] * lift) / z / perM;
      const px = Math.min(across, down);
      let e = 1;
      while (e * px < WIRE_GAP && e < 1 << 12) e *= 2;
      while (e * px >= WIRE_GAP * 2 && e > 1 / 64) e /= 2;
      every[k] = e;
      // Half a column's width, in lines: a line is on the column within it.
      halfX[k] = (Math.abs(ax * rx) / fz[k] / e) * 0.5;
      halfY[k] = (Math.abs(ay * ry) / fz[k] / e) * 0.5;
    }
  }
  // The rows each step's span crosses a line on, as fractions of the way from the step before.
  const runs = new Float32Array(RUNS * 2);

  for (let x = 0; x < W; x++) {
    const t = (x + 0.5 - W / 2) / f;
    const dx = fx + rx * t;
    const dy = fy + ry * t;
    let yb = H;
    // Where the step before sat on the grid and on screen: the wireframe's
    // lines are found between the two.
    let lastX = NaN;
    let lastY = NaN;
    let lastTop = NaN;
    for (let k = 0; k < nSteps; k++) {
      const z = zs[k];
      const wx = cam.x + dx * z;
      const wy = cam.y + dy * z;
      const off = wx < 0 || wy < 0 || wx > widthM || wy > heightM;
      // The height first, and the colour only if this step shows: far out,
      // dozens of steps share one row of pixels and only the first is seen.
      // Inlined like renderGround's: this runs for every step of every column.
      let h = 0;
      let ci = 0;
      let tx = 0;
      let ty = 0;
      let wet = false;
      if (off) h = -TABLE_DEPTH;
      else if (gz && gc) {
        let gx = ax * wx + bx;
        let gy = ay * wy + by;
        if (gx < 0) gx = 0;
        else if (gx > gw - 1.001) gx = gw - 1.001;
        if (gy < 0) gy = 0;
        else if (gy > gh - 1.001) gy = gh - 1.001;
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
      const ys = horizon - (h - cam.z) * fz[k];
      const y0 = ys <= 0 ? 0 : Math.ceil(ys);
      // Where the column, a pixel wide, passed over a line of the wireframe
      // since the step before: a line across the screen for a row, one running
      // away up it for as much of the span as it stays in the column.
      let nRuns = 0;
      if (gc && !off && !wet) {
        const gx = ax * wx + bx;
        const gy = ay * wy + by;
        if (lastX === lastX) {
          const e = every[k];
          nRuns = lineRuns(lastX / e, gx / e, halfX[k], runs, 0);
          nRuns = lineRuns(lastY / e, gy / e, halfY[k], runs, nRuns);
        }
        lastX = gx;
        lastY = gy;
      } else lastX = NaN;
      const fromTop = lastTop;
      lastTop = ys;
      if (y0 < yb) {
        let r: number;
        let gg: number;
        let bb: number;
        if (off || !gc) {
          const c = off ? TABLE : FLAT_LAND;
          r = c & 255;
          gg = (c >>> 8) & 255;
          bb = (c >>> 16) & 255;
        } else if (wet) {
          r = LAKE[0];
          gg = LAKE[1];
          bb = LAKE[2];
        } else {
          // The line's colour from the land cells round it, leaving the water
          // out, or the parks' own green; the fill between, dark.
          let fill = g!.fillColor;
          let line: number;
          const o = overlay ? overlayAt(overlay, wx, wy) : 0;
          if (o) {
            fill = o & OVERLAY_RESTORATION ? g!.restorationColor : g!.parkColor;
            line = shade(fill, 1.3);
          } else {
            const gw2 = g!.wire;
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
          const fog = fogs[k];
          const lineOut = fogged(shade(line, GROUND_LIGHT), fog);
          const fillOut = fogged(shade(fill, GROUND_LIGHT), fog);
          for (let y = y0; y < yb; y++) {
            const p = y * W + x;
            buf[p] = fillOut;
            depth[p] = z;
          }
          for (let n = 0; n < nRuns; n++) {
            const a = fromTop + (ys - fromTop) * runs[n * 2];
            const b = fromTop + (ys - fromTop) * runs[n * 2 + 1];
            const r0 = Math.max(y0, Math.floor(a < b ? a : b));
            const r1 = Math.min(yb - 1, Math.max(r0, Math.ceil(a < b ? b : a) - 1));
            for (let y = r0; y <= r1; y++) buf[y * W + x] = lineOut;
          }
          yb = y0;
          if (yb <= 0) break;
          if (zCeil >= cam.z ? horizon - (zCeil - cam.z) * fz[k] >= yb : horizon >= yb) break;
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
      if (zCeil >= cam.z ? horizon - (zCeil - cam.z) * fz[k] >= yb : horizon >= yb) break;
    }
    for (let y = 0; y < yb; y++) {
      const p = y * W + x;
      buf[p] = sky[y];
      depth[p] = Infinity;
    }
  }

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
        reach: PLACE_REACH,
        project: (mx, my, z) => {
          const ox = mx - cam.x;
          const oy = my - cam.y;
          const d = ox * fx + oy * fy;
          const s = f / d;
          return { x: W / 2 + (ox * rx + oy * ry) * s, y: horizon - (z - cam.z) * s, d };
        },
        tint: (c, d) => fogged(c, 1 - Math.exp(-d / FOG)),
      },
      g,
      places,
      show,
    );
  }

  treeDepth.fill(Infinity);
  id.fill(-1);
  drawTrees(frame, cam, w, f, horizon);
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
