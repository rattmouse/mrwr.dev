/**
 * The walk's Pipes layer (cubicles.exe's way out to trees.exe's city), which
 * trees.exe shows too while the walk has it on: Seattle Public Utilities'
 * sewers and storm drains
 * — mains, stubs, force mains, detention pipes and the abandoned ones still in
 * the ground — and King County's trunks and interceptors under them, about
 * 60k pipes, each with how deep it runs at either end. One static, gzipped
 * file written by scripts/content/refresh-trees.mjs (the format is written up
 * at refreshPipes there), fetched only once the layer's switched on, and laid
 * out here on the trees' own metres.
 *
 * Kept as columns, not a Place apiece: a picked pipe, or the one under the
 * walk's crosshair, is turned into a Place (pipePlace), and only then.
 */

import type { Place } from "@/lib/places";
import { dataUrl, fetchGzip, Progress, readHeader, Trees } from "@/lib/trees";

export const PIPES_URL = dataUrl("/trees/pipes.bin.gz");

export type PipeKind = "main" | "stub" | "force" | "detention" | "abandoned" | "county";

export type Pipes = {
  n: number;
  /** Every pipe's points, metres east and north, upstream first; pipe i's run from start[i] to start[i + 1]. */
  x: Float32Array;
  y: Float32Array;
  /** How deep each point is, metres, between its pipe's two ends by the way along. */
  z: Float32Array;
  start: Uint32Array;
  /** West, south, east, north of each pipe, four to a pipe. */
  box: Float32Array;
  kind: Uint8Array;
  /** 0 not recorded, 1 storm drain, 2 sanitary sewer, 3 combined sewer. */
  flow: Uint8Array;
  material: Uint8Array;
  owner: Uint8Array;
  flags: Uint8Array;
  width: Uint16Array;
  year: Uint16Array;
  inspected: Uint16Array;
  /** Feet at the upstream and downstream ends, 0 for not recorded. */
  up: Float32Array;
  down: Float32Array;
  name: Uint16Array;
  kinds: PipeKind[];
  flows: string[];
  materials: string[];
  owners: string[];
  names: string[];
  /** The pipes by GRID-metre square, for finding the ones near a point. */
  grid: { w: number; h: number; start: Uint32Array; items: Uint32Array };
};

const FT = 0.3048;
const GRID = 50;

type Meta = {
  fetched: string;
  bbox: Trees["bbox"];
  count: number;
  points: number;
  kinds: PipeKind[];
  flows: string[];
  materials: string[];
  owners: string[];
  names: string[];
};

export async function loadPipes(
  trees: Trees,
  widthM: number,
  heightM: number,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<Pipes> {
  const buf = await fetchGzip(PIPES_URL, "PIP1", signal, onProgress);
  const { meta, body } = readHeader<Meta>(buf, "PIP1");
  const b = new Uint8Array(buf);
  const n = meta.count;
  let at = body;
  const u8 = () => {
    const out = b.slice(at, at + n);
    at += n;
    return out;
  };
  const u16 = () => {
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = b[at + i] | (b[at + n + i] << 8);
    at += 2 * n;
    return out;
  };
  const count = u16();
  const kind = u8();
  const flow = u8();
  const material = u8();
  const owner = u8();
  const flags = u8();
  const width = u16();
  const year = u16();
  const inspected = u16();
  const up10 = u16();
  const down10 = u16();
  const name = u16();

  // Back from steps to 16-bit positions across the pipes' bbox, then onto the trees' metres.
  const total = meta.points;
  const pb = meta.bbox;
  const tb = trees.bbox;
  const kx = ((pb.east - pb.west) / 65535 / (tb.east - tb.west)) * widthM;
  const bx = ((pb.west - tb.west) / (tb.east - tb.west)) * widthM;
  const ky = ((pb.north - pb.south) / 65535 / (tb.north - tb.south)) * heightM;
  const by = ((pb.south - tb.south) / (tb.north - tb.south)) * heightM;
  const x = new Float32Array(total);
  const y = new Float32Array(total);
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < total; i++) {
    qx = (qx + (b[at + i] | (b[at + total + i] << 8))) & 0xffff;
    qy = (qy + (b[at + total * 2 + i] | (b[at + total * 3 + i] << 8))) & 0xffff;
    x[i] = qx * kx + bx;
    y[i] = qy * ky + by;
  }

  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + count[i];
  const up = new Float32Array(n);
  const down = new Float32Array(n);
  const z = new Float32Array(total);
  const box = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    up[i] = up10[i] / 10;
    down[i] = down10[i] / 10;
    const from = start[i];
    const to = start[i + 1];
    // The depth from one end to the other by the way along it; one end will do for both
    // (every pipe has at least one: the ones with neither are left out of the file).
    const a = up[i] || down[i];
    const c = down[i] || up[i];
    let length = 0;
    for (let k = from + 1; k < to; k++) length += Math.hypot(x[k] - x[k - 1], y[k] - y[k - 1]);
    let along = 0;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let nn = -Infinity;
    for (let k = from; k < to; k++) {
      if (k > from) along += Math.hypot(x[k] - x[k - 1], y[k] - y[k - 1]);
      const t = length ? along / length : 0;
      z[k] = (a + (c - a) * t) * FT;
      if (x[k] < w) w = x[k];
      if (x[k] > e) e = x[k];
      if (y[k] < s) s = y[k];
      if (y[k] > nn) nn = y[k];
    }
    box.set([w, s, e, nn], i * 4);
  }

  return {
    n,
    x,
    y,
    z,
    start,
    box,
    kind,
    flow,
    material,
    owner,
    flags,
    width,
    year,
    inspected,
    up,
    down,
    name,
    kinds: meta.kinds,
    flows: meta.flows,
    materials: meta.materials,
    owners: meta.owners,
    names: meta.names,
    grid: makeGrid(box, n, widthM, heightM),
  };
}

/** Each pipe filed under every GRID square its box touches. */
function makeGrid(box: Float32Array, n: number, widthM: number, heightM: number): Pipes["grid"] {
  const w = Math.ceil(widthM / GRID) + 1;
  const h = Math.ceil(heightM / GRID) + 1;
  const cell = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v / GRID)));
  const counts = new Uint32Array(w * h + 1);
  const each = (i: number, f: (c: number) => void) => {
    const c0 = cell(box[i * 4], w);
    const c1 = cell(box[i * 4 + 2], w);
    const r0 = cell(box[i * 4 + 1], h);
    const r1 = cell(box[i * 4 + 3], h);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r * w + c);
  };
  for (let i = 0; i < n; i++) each(i, (c) => counts[c + 1]++);
  for (let c = 0; c < w * h; c++) counts[c + 1] += counts[c];
  const items = new Uint32Array(counts[w * h]);
  const fill = counts.slice();
  for (let i = 0; i < n; i++) each(i, (c) => (items[fill[c]++] = i));
  return { w, h, start: counts, items };
}

/** Every pipe whose box comes within `r` metres of a point, each once. */
export function pipesNear(p: Pipes, mx: number, my: number, r: number, f: (i: number) => void) {
  const { w, h, start, items } = p.grid;
  const c0 = Math.max(0, Math.floor((mx - r) / GRID));
  const c1 = Math.min(w - 1, Math.floor((mx + r) / GRID));
  const r0 = Math.max(0, Math.floor((my - r) / GRID));
  const r1 = Math.min(h - 1, Math.floor((my + r) / GRID));
  const seen = new Set<number>();
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      const cell = row * w + c;
      for (let k = start[cell]; k < start[cell + 1]; k++) {
        const i = items[k];
        if (seen.has(i)) continue;
        seen.add(i);
        const b = i * 4;
        if (mx < p.box[b] - r || mx > p.box[b + 2] + r || my < p.box[b + 1] - r || my > p.box[b + 3] + r) continue;
        f(i);
      }
    }
  }
}

/** The pipe nearest a world point within `reach` metres, or -1. */
export function pipeAt(p: Pipes, mx: number, my: number, reach: number): number {
  let best = -1;
  let bestD = reach;
  pipesNear(p, mx, my, reach, (i) => {
    for (let k = p.start[i]; k + 1 < p.start[i + 1]; k++) {
      const dx = p.x[k + 1] - p.x[k];
      const dy = p.y[k + 1] - p.y[k];
      const t = Math.max(0, Math.min(1, ((mx - p.x[k]) * dx + (my - p.y[k]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p.x[k] + t * dx - mx, p.y[k] + t * dy - my);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

const placed = new WeakMap<Pipes, Map<number, Place>>();

/** Pipe i as a Place — the same object each time, so a picked one stays picked. */
export function pipePlace(p: Pipes, i: number): Place {
  let cache = placed.get(p);
  if (!cache) placed.set(p, (cache = new Map()));
  const had = cache.get(i);
  if (had) return had;
  const from = p.start[i];
  const to = p.start[i + 1];
  const b = i * 4;
  const place: Place = {
    kind: "pipe",
    x: p.x.subarray(from, to),
    y: p.y.subarray(from, to),
    z: p.z.subarray(from, to),
    parts: Uint32Array.of(0, to - from),
    box: [p.box[b], p.box[b + 1], p.box[b + 2], p.box[b + 3]],
    pipeKind: p.kinds[p.kind[i]],
    flow: p.flows[p.flow[i]] || undefined,
    material: p.material[i] ? p.materials[p.material[i] - 1] : undefined,
    ownedBy: p.owner[i] ? p.owners[p.owner[i] - 1] : undefined,
    inches: p.width[i] || undefined,
    since: p.year[i] || undefined,
    inspected: p.inspected[i] || undefined,
    upDeep: p.up[i] || undefined,
    downDeep: p.down[i] || undefined,
    lined: p.flags[i] & 1 ? 1 : undefined,
    name: p.name[i] ? p.names[p.name[i] - 1] : undefined,
  };
  cache.set(i, place);
  return place;
}
