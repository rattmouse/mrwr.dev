/**
 * The ground under Seattle's street trees, for trees.exe's Tilt view: USGS
 * 3DEP elevation on a grid of square-degree cells (about 16 × 24 m) with the
 * open water marked. Written by scripts/content/refresh-trees.mjs alongside
 * the trees (the format is written up there).
 */

import { dataUrl, fetchGzip, Progress, readHeader } from "@/lib/trees";

export const TERRAIN_URL = dataUrl("/trees/terrain.bin.gz");
/** The mountains around the city, coast to Cascade crest, on coarse cells: same layout, its own magic. */
export const REGION_URL = dataUrl("/trees/region.bin.gz");

export type Terrain = {
  w: number;
  h: number;
  /** The grid's own bbox, cell edges, row 0 at the north. */
  bbox: { south: number; north: number; west: number; east: number };
  /** Metres above sea level, cell centres. */
  z: Float32Array;
  water: Uint8Array;
  zMax: number;
};

export function loadTerrain(signal?: AbortSignal, onProgress?: Progress): Promise<Terrain> {
  return loadHeights(TERRAIN_URL, "TER2", signal, onProgress);
}

export function loadRegion(signal?: AbortSignal, onProgress?: Progress): Promise<Terrain> {
  return loadHeights(REGION_URL, "RGN1", signal, onProgress);
}

async function loadHeights(url: string, magic: string, signal?: AbortSignal, onProgress?: Progress): Promise<Terrain> {
  const buf = await fetchGzip(url, magic, signal, onProgress);
  const { meta, body } = readHeader<{ w: number; h: number; bbox: Terrain["bbox"]; zStep: number }>(buf, magic);
  const { w, h, zStep } = meta;
  const n = w * h;
  const bytes = new Uint8Array(buf);
  // Each height is stored as the change from the cell to its west — or, at the
  // start of a row, the cell above — so add them back up in the same order.
  const q = new Int32Array(n);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const raw = bytes[body + i] | (bytes[body + n + i] << 8);
      const d = raw >= 0x8000 ? raw - 0x10000 : raw;
      q[i] = d + (c ? q[i - 1] : r ? q[i - w] : 0);
    }
  }
  const z = new Float32Array(n);
  let zMax = 0;
  for (let i = 0; i < n; i++) {
    z[i] = q[i] * zStep;
    if (z[i] > zMax) zMax = z[i];
  }
  const water = bytes.slice(body + n * 2, body + n * 3);
  return { w, h, bbox: meta.bbox, z, water, zMax };
}
