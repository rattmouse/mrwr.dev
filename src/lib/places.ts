/**
 * Everything trees.exe draws under the trees that isn't a tree: Seattle's
 * parks, Green Seattle Partnership's forest-restoration zones inside them,
 * P-Patch community gardens and creeks. One static, gzipped
 * file written by scripts/content/refresh-trees.mjs (the format is written up
 * at packPlaces there), laid out here on the trees' own metres.
 *
 * The parks and restoration zones are drawn as tints on the ground, which both
 * views look up a pixel at a time — so they're also rasterized, once, into a
 * grid of OVERLAY_CELL squares with a bit per kind. Sampled with the four
 * nearest cells weighted by nearness, the way the Tilt view's shoreline is, the
 * edges come out curved rather than stepped. The creeks and park
 * edges are drawn as lines on top, sharp at any zoom.
 */

import { fetchGzip, Progress, readHeader, Trees } from "@/lib/trees";

export const PLACES_URL = "/trees/places.bin.gz";

export type PlaceKind = "park" | "restoration" | "garden" | "creek";

export type Place = {
  kind: PlaceKind;
  /** Metres east and north of the trees' bbox's south-west corner, every part one after another. */
  x: Float32Array;
  y: Float32Array;
  /** Where each part starts in x and y, with the end on the end. */
  parts: Uint32Array;
  /** Its extent: west, south, east, north, in the same metres. */
  box: [number, number, number, number];
  name?: string;
  acres?: number;
  /** Restoration: the zone's own name, the phase it was at when last checked (0–4), and the year. */
  zone?: string;
  phase?: number;
  visited?: number;
  /** Garden. */
  address?: string;
  plots?: number;
  since?: number;
  sqft?: number;
  /** Creek: 1 where it runs through a pipe. */
  piped?: number;
};

export type Overlay = {
  /** Cells across and up, from the south-west corner, OVERLAY_CELL metres square. */
  w: number;
  h: number;
  /** OVERLAY_PARK | OVERLAY_RESTORATION per cell, row 0 at the south. */
  bits: Uint8Array;
};

export type Places = {
  fetched: string;
  list: Place[];
  overlay: Overlay;
};

export const OVERLAY_CELL = 5;
export const OVERLAY_PARK = 1;
export const OVERLAY_RESTORATION = 2;

/** What Green Seattle Partnership's phases mean. */
export const RESTORATION_PHASES = [
  "Not yet started",
  "Invasive plants cleared",
  "Secondary clearing",
  "Native plants in",
  "Planted and maintained",
];

type Meta = {
  fetched: string;
  bbox: Trees["bbox"];
  kinds: PlaceKind[];
  features: ({ k: number; parts: number[] } & Partial<Place>)[];
};

export async function loadPlaces(
  trees: Trees,
  widthM: number,
  heightM: number,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<Places> {
  const buf = await fetchGzip(PLACES_URL, "PLC1", signal, onProgress);
  const { meta, body } = readHeader<Meta>(buf, "PLC1");
  const bytes = new Uint8Array(buf);
  const total = meta.features.reduce((n, f) => n + f.parts.reduce((a, b) => a + b, 0), 0);
  // Back from steps to 16-bit positions across the places' own bbox, then
  // through longitude and latitude onto the trees' metres.
  const pb = meta.bbox;
  const tb = trees.bbox;
  const kx = ((pb.east - pb.west) / 65535 / (tb.east - tb.west)) * widthM;
  const bx = ((pb.west - tb.west) / (tb.east - tb.west)) * widthM;
  const ky = ((pb.north - pb.south) / 65535 / (tb.north - tb.south)) * heightM;
  const by = ((pb.south - tb.south) / (tb.north - tb.south)) * heightM;
  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < total; i++) {
    qx = (qx + (bytes[body + i] | (bytes[body + total + i] << 8))) & 0xffff;
    qy = (qy + (bytes[body + total * 2 + i] | (bytes[body + total * 3 + i] << 8))) & 0xffff;
    xs[i] = qx * kx + bx;
    ys[i] = qy * ky + by;
  }

  const list: Place[] = [];
  let at = 0;
  for (const { k, parts: counts, ...attrs } of meta.features) {
    const n = counts.reduce((a, b) => a + b, 0);
    const parts = new Uint32Array(counts.length + 1);
    for (let p = 0; p < counts.length; p++) parts[p + 1] = parts[p] + counts[p];
    const x = xs.subarray(at, at + n);
    const y = ys.subarray(at, at + n);
    at += n;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let nn = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < w) w = x[i];
      if (x[i] > e) e = x[i];
      if (y[i] < s) s = y[i];
      if (y[i] > nn) nn = y[i];
    }
    list.push({ ...attrs, kind: meta.kinds[k], x, y, parts, box: [w, s, e, nn] });
  }
  return { fetched: meta.fetched, list, overlay: rasterize(list, widthM, heightM) };
}

/** The parks and restoration zones, filled into the overlay grid even-odd, a row of cell centres at a time. */
function rasterize(list: Place[], widthM: number, heightM: number): Overlay {
  const w = Math.ceil(widthM / OVERLAY_CELL);
  const h = Math.ceil(heightM / OVERLAY_CELL);
  const bits = new Uint8Array(w * h);
  const xs: number[] = [];
  for (const place of list) {
    const bit = place.kind === "park" ? OVERLAY_PARK : place.kind === "restoration" ? OVERLAY_RESTORATION : 0;
    if (!bit) continue;
    const { x, y, parts, box } = place;
    const r0 = Math.max(0, Math.floor(box[1] / OVERLAY_CELL - 0.5));
    const r1 = Math.min(h - 1, Math.ceil(box[3] / OVERLAY_CELL - 0.5));
    for (let r = r0; r <= r1; r++) {
      const cy = (r + 0.5) * OVERLAY_CELL;
      xs.length = 0;
      for (let p = 0; p + 1 < parts.length; p++) {
        const from = parts[p];
        const to = parts[p + 1];
        for (let i = from; i < to; i++) {
          const j = i + 1 < to ? i + 1 : from;
          const ya = y[i];
          const yb = y[j];
          if (ya <= cy === yb <= cy) continue;
          xs.push(x[i] + ((cy - ya) / (yb - ya)) * (x[j] - x[i]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] / OVERLAY_CELL - 0.5));
        const c1 = Math.min(w - 1, Math.floor(xs[k + 1] / OVERLAY_CELL - 0.5));
        for (let c = c0; c <= c1; c++) bits[r * w + c] |= bit;
      }
    }
  }
  return { w, h, bits };
}

/**
 * Which tints a world point is under: each bit set where the cells around it,
 * weighted by nearness, mostly have it.
 */
export function overlayAt(o: Overlay, mx: number, my: number): number {
  let fx = mx / OVERLAY_CELL - 0.5;
  let fy = my / OVERLAY_CELL - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > o.w - 1.001) fx = o.w - 1.001;
  if (fy < 0) fy = 0;
  else if (fy > o.h - 1.001) fy = o.h - 1.001;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * o.w + x0;
  const a = o.bits[i];
  const b = o.bits[i + 1];
  const c = o.bits[i + o.w];
  const d = o.bits[i + o.w + 1];
  // Nothing near, or all the same: no weighing needed — most of the city.
  if ((a | b | c | d) === 0) return 0;
  if (a === b && a === c && a === d) return a;
  const wa = (1 - tx) * (1 - ty);
  const wb = tx * (1 - ty);
  const wc = (1 - tx) * ty;
  const wd = tx * ty;
  let out = 0;
  for (let bit = 1; bit <= 2; bit <<= 1) {
    const cover = (a & bit ? wa : 0) + (b & bit ? wb : 0) + (c & bit ? wc : 0) + (d & bit ? wd : 0);
    if (cover > 0.5) out |= bit;
  }
  return out;
}

function inside(place: Place, mx: number, my: number): boolean {
  const { x, y, parts, box } = place;
  if (mx < box[0] || mx > box[2] || my < box[1] || my > box[3]) return false;
  let hit = false;
  for (let p = 0; p + 1 < parts.length; p++) {
    const from = parts[p];
    const to = parts[p + 1];
    for (let i = from, j = to - 1; i < to; j = i++) {
      if (y[i] > my !== y[j] > my && mx < x[i] + ((my - y[i]) / (y[j] - y[i])) * (x[j] - x[i])) hit = !hit;
    }
  }
  return hit;
}

/** The park a world point is in, if any. */
export function parkAt(places: Places, mx: number, my: number): Place | null {
  for (const p of places.list) if (p.kind === "park" && inside(p, mx, my)) return p;
  return null;
}

/** How far a world point is from a line's nearest stretch, metres. */
function distanceToLine(place: Place, mx: number, my: number, within: number): number {
  const { x, y, parts, box } = place;
  if (mx < box[0] - within || mx > box[2] + within || my < box[1] - within || my > box[3] + within) return Infinity;
  let best = Infinity;
  for (let p = 0; p + 1 < parts.length; p++) {
    for (let i = parts[p]; i + 1 < parts[p + 1]; i++) {
      const dx = x[i + 1] - x[i];
      const dy = y[i + 1] - y[i];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((mx - x[i]) * dx + (my - y[i]) * dy) / len2));
      const ex = x[i] + t * dx - mx;
      const ey = y[i] + t * dy - my;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * The place under a world point, `reach` metres being a few pixels at the
 * current zoom: a garden or a creek near enough first, as they're small, then
 * the restoration zone, then the park.
 */
export function placeAt(
  places: Places,
  show: { parks: boolean; water: boolean },
  mx: number,
  my: number,
  reach: number,
): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places.list) {
    if (p.kind === "garden" && show.parks) {
      const d = Math.hypot(p.x[0] - mx, p.y[0] - my);
      if (d <= Math.max(reach * 1.5, gardenSide(p) / 2) && d < bestD) {
        best = p;
        bestD = d;
      }
    } else if (p.kind === "creek" && show.water) {
      const d = distanceToLine(p, mx, my, reach);
      if (d <= reach && d < bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  if (best || !show.parks) return best;
  let park: Place | null = null;
  for (const p of places.list) {
    if (p.kind === "restoration" && inside(p, mx, my)) return p;
    if (!park && p.kind === "park" && inside(p, mx, my)) park = p;
  }
  return park;
}

/** A garden's side, metres, from its size: they're drawn as squares of about their own area. */
export function gardenSide(p: Place): number {
  return p.sqft ? Math.max(8, Math.sqrt(p.sqft) * 0.3048) : 20;
}

/** How many of the trees stand inside a park or zone. */
export function treesInside(place: Place, mx: Float32Array, my: Float32Array, n: number): number {
  const [w, s, e, nn] = place.box;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = mx[i];
    const y = my[i];
    if (x < w || x > e || y < s || y > nn) continue;
    if (inside(place, x, y)) count++;
  }
  return count;
}
