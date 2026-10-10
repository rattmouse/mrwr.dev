/**
 * The mountains around the city, for trees.exe once it's zoomed out past
 * Seattle: contour rings on the flat map, worked out once from a height grid
 * (the region's coarse one, or the city's own finer one). The grid itself is
 * region.bin.gz, read by src/lib/terrain.ts.
 */

import type { Trees } from "@/lib/trees";
import type { Terrain } from "@/lib/terrain";

/** A rectangle in the trees' world: metres east and north of their bbox's south-west corner. */
export type WorldRect = { x0: number; y0: number; x1: number; y1: number };

/** Longitude and latitude to the trees' world, the same straight scaling the trees themselves get. */
function worldOf(trees: Trees["bbox"], widthM: number, heightM: number) {
  const kx = widthM / (trees.east - trees.west);
  const ky = heightM / (trees.north - trees.south);
  return (lon: number, lat: number): [number, number] => [(lon - trees.west) * kx, (lat - trees.south) * ky];
}

/** A height grid's own bbox, in the trees' world. */
export function terrainRect(t: Terrain, trees: Trees["bbox"], widthM: number, heightM: number): WorldRect {
  const at = worldOf(trees, widthM, heightM);
  const [x0, y0] = at(t.bbox.west, t.bbox.south);
  const [x1, y1] = at(t.bbox.east, t.bbox.north);
  return { x0, y0, x1, y1 };
}

/**
 * Contour lines at every multiple of `step` metres, as segments in world
 * metres: level k's run from starts[k] to starts[k + 1] in xy, four floats a
 * segment (x0, y0, x1, y1). Plus the shoreline, the edge of the water mask,
 * on its own. Marching squares between cell centres; each cell only tries the
 * levels between its lowest and highest corner.
 */
export type Contours = {
  step: number;
  /** Metres, one per level. */
  levels: number[];
  starts: Uint32Array;
  xy: Float32Array;
  shore: Float32Array;
};

export function contours(t: Terrain, trees: Trees["bbox"], widthM: number, heightM: number, step: number): Contours {
  const { w, h, z, water } = t;
  const rect = terrainRect(t, trees, widthM, heightM);
  // Cell centres: column c at x0 + (c + 0.5)·cw; row r (from the north) at y1 − (r + 0.5)·ch.
  const cw = (rect.x1 - rect.x0) / w;
  const ch = (rect.y1 - rect.y0) / h;
  const top = Math.floor(t.zMax / step);
  const byLevel: number[][] = Array.from({ length: top + 1 }, () => []);
  const shore: number[] = [];

  // The two points where a value crosses a cell's edges, by marching-squares
  // case: corners a (top left), b (top right), c (bottom right), d (bottom left).
  const cross = (out: number[], x: number, y: number, a: number, b: number, c: number, d: number, at: number) => {
    const ix = rect.x0 + (x + 0.5) * cw;
    const iy = rect.y1 - (y + 0.5) * ch;
    // Edge points: top (a→b), right (b→c), bottom (d→c), left (a→d).
    const T = () => [ix + ((at - a) / (b - a)) * cw, iy];
    const R = () => [ix + cw, iy - ((at - b) / (c - b)) * ch];
    const B = () => [ix + ((at - d) / (c - d)) * cw, iy - ch];
    const L = () => [ix, iy - ((at - a) / (d - a)) * ch];
    const k = (a > at ? 8 : 0) | (b > at ? 4 : 0) | (c > at ? 2 : 0) | (d > at ? 1 : 0);
    const seg = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);
    switch (k) {
      case 1:
      case 14:
        seg(L(), B());
        break;
      case 2:
      case 13:
        seg(B(), R());
        break;
      case 3:
      case 12:
        seg(L(), R());
        break;
      case 4:
      case 11:
        seg(T(), R());
        break;
      case 6:
      case 9:
        seg(T(), B());
        break;
      case 7:
      case 8:
        seg(L(), T());
        break;
      // The saddles, split by the middle's height.
      case 5:
      case 10: {
        const mid = (a + b + c + d) / 4 > at;
        if (mid === (k === 5)) {
          seg(L(), T());
          seg(B(), R());
        } else {
          seg(L(), B());
          seg(T(), R());
        }
        break;
      }
    }
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      // Over water the ground is the lake's or the sea's flat top: no rings in it.
      const wa = water[i];
      const wb = water[i + 1];
      const wc = water[i + w + 1];
      const wd = water[i + w];
      if (wa !== wb || wa !== wc || wa !== wd) cross(shore, x, y, wa, wb, wc, wd, 0.5);
      if (wa && wb && wc && wd) continue;
      const a = z[i];
      const b = z[i + 1];
      const c = z[i + w + 1];
      const d = z[i + w];
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      for (let k = Math.max(1, Math.floor(lo / step) + 1); k * step < hi && k <= top; k++) {
        cross(byLevel[k], x, y, a, b, c, d, k * step);
      }
    }
  }
  const starts = new Uint32Array(top + 2);
  for (let k = 0; k <= top; k++) starts[k + 1] = starts[k] + byLevel[k].length;
  const xy = new Float32Array(starts[top + 1]);
  for (let k = 0; k <= top; k++) xy.set(byLevel[k], starts[k]);
  return { step, levels: byLevel.map((_, k) => k * step), starts, xy, shore: Float32Array.from(shore) };
}

/** How far apart the flat map's rings are at `mpp` metres to a CSS pixel: tens of metres in the city, a kilometre across the state. */
export function ringStep(mpp: number): number {
  if (mpp < 12) return 20;
  if (mpp < 60) return 100;
  if (mpp < 150) return 200;
  if (mpp < 400) return 500;
  return 1000;
}

/** Every fifth ring of a kind, drawn brighter, the way a topographic map does. */
export function isIndexRing(level: number, step: number): boolean {
  return level % (step * 5) === 0;
}

/**
 * A ring's color by its height: forest green low down, then rock, then snow
 * from about where the glaciers start. `index` rings are brighter.
 */
export function ringColor(level: number, index: boolean): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [38, 74, 44]],
    [600, [62, 96, 50]],
    [1300, [112, 104, 70]],
    [2000, [128, 124, 116]],
    [2600, [196, 204, 214]],
  ];
  let c = stops[stops.length - 1][1];
  for (let k = 1; k < stops.length; k++) {
    if (level <= stops[k][0]) {
      const [l0, c0] = stops[k - 1];
      const [l1, c1] = stops[k];
      const t = (level - l0) / (l1 - l0);
      c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
      break;
    }
  }
  const lift = index ? 1.45 : 1;
  return [Math.min(255, c[0] * lift), Math.min(255, c[1] * lift), Math.min(255, c[2] * lift)];
}

/** The shoreline's color on the flat map. */
export const SHORE: [number, number, number] = [52, 92, 132];

/**
 * A one-pixel line from (x0, y0) to (x1, y1), device pixels, into a W×H
 * buffer: a plain DDA, clipped to the buffer a pixel at a time.
 */
export function plotLine(buf: Uint32Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, color: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  if (n === 0) {
    if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < H) buf[(y0 | 0) * W + (x0 | 0)] = color;
    return;
  }
  const sx = dx / n;
  const sy = dy / n;
  let x = x0;
  let y = y0;
  for (let k = 0; k <= n; k++, x += sx, y += sy) {
    if (x >= 0 && y >= 0 && x < W && y < H) buf[(y | 0) * W + (x | 0)] = color;
  }
}

const packRgb = ([r, g, b]: [number, number, number]) =>
  ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

/**
 * The flat map's rings into a W×H buffer at `s` device pixels a metre, world
 * origin at (ox, oy) (y up): the region's outside the city once the city's
 * own finer rings are in, the city's inside it, both at the spacing `cssS`
 * (CSS pixels a metre) calls for, and the shorelines.
 */
export function drawRings(
  buf: Uint32Array,
  W: number,
  H: number,
  s: number,
  ox: number,
  oy: number,
  cssS: number,
  region: Contours | null,
  city: Contours | null,
  /** The city's width and height in metres: where its own rings take over from the region's. */
  cityWH: [number, number] | null,
) {
  const step = ringStep(1 / cssS);
  // What's on screen, in world metres.
  const xMin = -ox / s;
  const xMax = (W - ox) / s;
  const yMin = (oy - H) / s;
  const yMax = oy / s;
  const hole = city && cityWH ? cityWH : null;
  const run = (xy: Float32Array, from: number, to: number, color: number, skipCity: boolean) => {
    for (let j = from; j < to; j += 4) {
      const x0 = xy[j];
      const y0 = xy[j + 1];
      const x1 = xy[j + 2];
      const y1 = xy[j + 3];
      if ((x0 < xMin && x1 < xMin) || (x0 > xMax && x1 > xMax) || (y0 < yMin && y1 < yMin) || (y0 > yMax && y1 > yMax)) continue;
      if (skipCity && hole) {
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        if (mx >= 0 && my >= 0 && mx <= hole[0] && my <= hole[1]) continue;
      }
      plotLine(buf, W, H, x0 * s + ox, oy - y0 * s, x1 * s + ox, oy - y1 * s, color);
    }
  };
  for (const [c, skipCity] of [
    [region, true],
    [city, false],
  ] as const) {
    if (!c) continue;
    for (let k = 1; k < c.levels.length; k++) {
      const level = c.levels[k];
      if (level % step) continue;
      run(c.xy, c.starts[k], c.starts[k + 1], packRgb(ringColor(level, isIndexRing(level, step))), skipCity);
    }
    run(c.shore, 0, c.shore.length, packRgb(SHORE), skipCity);
  }
}
