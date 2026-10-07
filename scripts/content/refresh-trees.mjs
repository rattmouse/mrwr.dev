#!/usr/bin/env node
// Refresh public/trees/trees.bin.gz — every street tree in Seattle, for
// trees.exe. Pulled from the City of Seattle's "SDOT Trees (Active)" layer on
// ArcGIS Online (about 215k points, 2,000 per request) and packed into one
// small binary, so the window loads a single static file from this site and
// never calls ArcGIS itself.
//
// The output is gitignored. scripts/deploy/deploy.sh runs this before every
// build (best-effort), but the street-tree inventory moves slowly, so a file
// younger than a week is left alone unless you pass --force. On any failure
// the existing file is kept.
//
// Two files, both gzipped, read back by src/lib/trees.ts. Every column is
// split into byte planes (all the low bytes, then all the high bytes), which
// is what lets gzip find the pattern in them.
//
// trees.bin.gz — what the map needs, about 830KB:
//   "TRE2"  u32 metaLength  meta (UTF-8 JSON: count, bbox, species, posShift)
//   then n-byte planes:
//     dx lo, dx hi, dy lo, dy hi   position, quantized across meta.bbox to
//                                  16 − posShift bits (x = east), as the
//                                  difference from the tree before — trees
//                                  are sorted street by street, so it's small
//     species lo, species hi       index into meta.species: [common, scientific, genus]
//     year                         year planted − 1900, 0 = unknown
//     diam                         trunk diameter, inches, capped at 255
//     flags                        bits 0–1 owner (0 private, 1 SDOT, 2 parks,
//                                  3 other), bit 2 heritage, bit 3 exceptional
//
// addresses.bin.gz — only the tree card and hover line need it, so the window
// fetches it after the map is up, about 170KB:
//   "TRA1"  u32 metaLength  meta (JSON: count, streets)
//   street lo, street hi, house lo, house hi   meta.streets[street], house 0 = none
//
// It also writes public/trees/terrain.bin.gz — the ground under them, for
// trees.exe's Tilt view: USGS 3DEP elevation on square-degree cells across
// the same bbox, with the open water marked, about 310KB. A separate file, and
// a failure there is a warning, not a failed refresh.
//
//   "TER2"  u32 metaLength  meta (JSON: bbox, w, h, zStep; space-padded to 4)
//   dz lo, dz hi (w*h each)  elevation in steps of meta.zStep metres, row 0 =
//                            north, as the difference from the cell to the
//                            west (or, starting a row, the one above)
//   water u8[w*h]            1 = open water (lake or Sound)
//
// Needs Node 18+ (global fetch). No credentials.

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(ROOT, "public/trees/trees.bin.gz");
const ADDR_PATH = resolve(ROOT, "public/trees/addresses.bin.gz");
const REMOVED_PATH = resolve(ROOT, "public/trees/removed.bin.gz");
const CROWNS_PATH = resolve(ROOT, "public/trees/crowns.bin.gz");
/** Bits of position dropped: 0.4 m east–west, 0.8 m north–south — finer than the city's own placement. */
const POS_SHIFT = 1;
/** Terrain heights in half metres: plenty under 2.5× exaggeration, and half the file of decimetres. */
const Z_STEP = 0.5;
const TERRAIN_PATH = resolve(ROOT, "public/trees/terrain.bin.gz");
const DEM =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
/**
 * Degrees to a terrain cell, both ways: the service keeps its pixels square in
 * degrees and quietly stretches the bbox to make them so. About 16 m across and
 * 24 m north–south at Seattle's latitude.
 */
const CELL_DEG = 0.00022;
/**
 * Somewhere in the middle of each water body. 3DEP is hydro-flattened — a lake
 * is one exact height edge to edge — so a lake is whatever joins its seed at
 * the seed's own height. The Sound isn't one height from end to end, so it is
 * whatever joins its seeds at or below sea level. A seed that isn't sitting on
 * flat water is skipped rather than allowed to flood a contour line.
 */
const WATER_SEEDS = [
  { lon: -122.415, lat: 47.62, sea: true }, // Puget Sound
  { lon: -122.41, lat: 47.51, sea: true }, // off Fauntleroy
  { lon: -122.415, lat: 47.73, sea: true }, // off Carkeek
  { lon: -122.36, lat: 47.6, sea: true }, // Elliott Bay
  { lon: -122.26, lat: 47.62 }, // Lake Washington
  { lon: -122.333, lat: 47.639 }, // Lake Union
  { lon: -122.34, lat: 47.68 }, // Green Lake
];
const LAYER =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Trees_(Active)/FeatureServer/0/query";
const FIELDS = [
  "OBJECTID",
  "UNITDESC",
  "OWNERSHIP",
  "PLANTED_DATE",
  "SCIENTIFIC_NAME",
  "COMMON_NAME",
  "GENUS",
  "HERITAGE",
  "EXCEPTIONAL",
  "DIAM",
  "SHAPE_LAT",
  "SHAPE_LNG",
].join(",");
const PAGE = 2000;
const WORKERS = 6;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const force = process.argv.includes("--force");

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function fetchAll(layer = LAYER, where = "1=1", fields = FIELDS) {
  const w = encodeURIComponent(where);
  const { count } = await getJson(`${layer}?where=${w}&returnCountOnly=true&f=json`);
  if (!count) throw new Error("layer reported no trees");
  const pages = Math.ceil(count / PAGE);
  const out = new Array(pages);
  let next = 0;
  const worker = async () => {
    while (next < pages) {
      const page = next++;
      const url =
        `${layer}?where=${w}&outFields=${fields}&returnGeometry=false&orderByFields=OBJECTID` +
        `&resultOffset=${page * PAGE}&resultRecordCount=${PAGE}&f=json`;
      const body = await getJson(url);
      out[page] = body.features.map((f) => f.attributes);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  const rows = out.flat();
  // Paging by offset on a live layer can drift by a few rows if the city edits
  // it mid-pull; anything more than that is a broken pull, not a refresh.
  if (Math.abs(rows.length - count) > 50) throw new Error(`expected ${count} trees, got ${rows.length}`);
  return rows;
}

/** The layer's scientific names are cut off at 30 characters and use backticks for cultivar quotes. */
function cleanScientific(name) {
  let s = String(name ?? "").replace(/`/g, "'").replace(/\s+/g, " ").trim();
  if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) s = s.replace(/\s*\([^)]*$/, "");
  if ((s.match(/'/g) || []).length % 2 === 1) s += "'";
  return s;
}

function owner(code) {
  if (code === "PRIV") return 0;
  if (code === "SDOT") return 1;
  if (code === "PARK") return 2;
  return 3;
}

function pack(rows) {
  rows = rows.filter((r) => Number.isFinite(r.SHAPE_LAT) && Number.isFinite(r.SHAPE_LNG));
  const n = rows.length;

  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const r of rows) {
    south = Math.min(south, r.SHAPE_LAT);
    north = Math.max(north, r.SHAPE_LAT);
    west = Math.min(west, r.SHAPE_LNG);
    east = Math.max(east, r.SHAPE_LNG);
  }

  const speciesIndex = new Map();
  const species = [];
  const streetIndex = new Map();
  const streets = [];
  const intern = (map, list, key, value) => {
    let i = map.get(key);
    if (i === undefined) {
      i = list.length;
      map.set(key, i);
      list.push(value);
    }
    return i;
  };

  const parsed = rows.map((r) => {
    const common = String(r.COMMON_NAME ?? "Unknown").trim() || "Unknown";
    const scientific = cleanScientific(r.SCIENTIFIC_NAME);
    const genus = String(r.GENUS ?? "").trim() || "Unknown";
    const sp = intern(speciesIndex, species, `${scientific}|${common}`, [common, scientific, genus]);

    // "2033 1ST AV" splits into a house number and a street the next tree on
    // the block shares; "31ST AVE AND E JEFFERSON ST" stays whole.
    const desc = String(r.UNITDESC ?? "").replace(/\s+/g, " ").trim();
    const m = desc.match(/^(\d{1,5}) (.+)$/);
    let house = 0;
    let street = desc;
    if (m && Number(m[1]) > 0 && Number(m[1]) < 65536) {
      house = Number(m[1]);
      street = m[2];
    }
    const st = intern(streetIndex, streets, street, street);

    let year = 0;
    if (r.PLANTED_DATE != null) {
      const y = new Date(r.PLANTED_DATE).getUTCFullYear();
      if (y > 1900 && y < 2156) year = y - 1900;
    }
    const diam = Math.max(0, Math.min(255, Math.round(Number(r.DIAM) || 0)));
    const flags = owner(r.OWNERSHIP) | (r.HERITAGE === "Y" ? 4 : 0) | (r.EXCEPTIONAL === "Y" ? 8 : 0);
    const x = Math.round(((r.SHAPE_LNG - west) / (east - west)) * 65535);
    const y = Math.round(((r.SHAPE_LAT - south) / (north - south)) * 65535);
    return { x, y, sp, st, house, year, diam, flags };
  });

  // Block by block: neighbours share a street and run on in house numbers,
  // which is most of what gzip finds to squeeze.
  parsed.sort((a, b) => a.st - b.st || a.house - b.house || a.x - b.x);

  const delta = (key) => deltas(parsed, key);

  const meta = {
    source: "City of Seattle, SDOT Trees (Active)",
    fetched: new Date().toISOString(),
    count: n,
    bbox: { south, north, west, east },
    posShift: POS_SHIFT,
    species,
  };
  const map = Buffer.concat([
    planes16(delta("x")),
    planes16(delta("y")),
    planes16(parsed.map((t) => t.sp)),
    Buffer.from(parsed.map((t) => t.year)),
    Buffer.from(parsed.map((t) => t.diam)),
    Buffer.from(parsed.map((t) => t.flags)),
  ]);
  const addresses = Buffer.concat([planes16(parsed.map((t) => t.st)), planes16(parsed.map((t) => t.house))]);

  return {
    map: withHeader("TRE2", meta, map),
    addresses: withHeader("TRA1", { count: n, streets }, addresses),
    n,
    species: species.length,
    streets: streets.length,
    bbox: meta.bbox,
    parsed,
  };
}

// --- removed street trees --------------------------------------------------

/** The full SDOT layer, which keeps the trees that have come down. */
const ALL_LAYER =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Trees_CDL/FeatureServer/0/query";
const REMOVED_FIELDS = [
  "OBJECTID",
  "UNITDESC",
  "PLANTED_DATE",
  "CURRENT_STATUS_DATE",
  "MODDATE",
  "SCIENTIFIC_NAME",
  "COMMON_NAME",
  "GENUS",
  "DIAM",
  "SHAPE_LAT",
  "SHAPE_LNG",
].join(",");

/**
 * removed.bin.gz — street trees the city has taken down, for the Planted
 * view's timeline, about 0.1MB:
 *   "RMV1"  u32 metaLength  meta (JSON: count, posShift, species, streets),
 *   positions on the trees' own bbox, then n-byte planes:
 *     dx lo, dx hi, dy lo, dy hi, species lo, species hi,
 *     planted (year − 1900, 0 unknown), removed (year − 1900),
 *     flags (bit 0: removal year is only the record's last edit, so "by"),
 *     diam, street lo, street hi, house lo, house hi
 */
function packRemoved(rows, bbox) {
  const { south, north, west, east } = bbox;
  const speciesIndex = new Map();
  const species = [];
  const streetIndex = new Map();
  const streets = [];
  const intern = (map, list, key, value) => {
    let i = map.get(key);
    if (i === undefined) {
      i = list.length;
      map.set(key, i);
      list.push(value);
    }
    return i;
  };
  const yearOf = (ms) => (ms == null ? 0 : new Date(ms).getUTCFullYear() - 1900);
  const parsed = [];
  let approx = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.SHAPE_LAT) || !Number.isFinite(r.SHAPE_LNG)) continue;
    if (r.SHAPE_LAT < south || r.SHAPE_LAT > north || r.SHAPE_LNG < west || r.SHAPE_LNG > east) continue;
    // A removal date when the city recorded one; otherwise the record's last
    // edit, which is when it was removed at the latest.
    let removed = yearOf(r.CURRENT_STATUS_DATE);
    let flags = 0;
    if (!removed) {
      removed = yearOf(r.MODDATE);
      flags |= 1;
    }
    if (removed <= 0 || removed > 255) continue;
    if (flags & 1) approx++;
    let planted = yearOf(r.PLANTED_DATE);
    if (planted < 1 || planted > removed) planted = 0;
    const common = String(r.COMMON_NAME ?? "Unknown").trim() || "Unknown";
    const scientific = cleanScientific(r.SCIENTIFIC_NAME);
    const genus = String(r.GENUS ?? "").trim() || "Unknown";
    const sp = intern(speciesIndex, species, `${scientific}|${common}`, [common, scientific, genus]);
    const desc = String(r.UNITDESC ?? "").replace(/\s+/g, " ").trim();
    const m = desc.match(/^(\d{1,5}) (.+)$/);
    let house = 0;
    let street = desc;
    if (m && Number(m[1]) > 0 && Number(m[1]) < 65536) {
      house = Number(m[1]);
      street = m[2];
    }
    parsed.push({
      x: Math.round(((r.SHAPE_LNG - west) / (east - west)) * 65535),
      y: Math.round(((r.SHAPE_LAT - south) / (north - south)) * 65535),
      sp,
      st: intern(streetIndex, streets, street, street),
      house,
      planted,
      removed,
      flags,
      diam: Math.max(0, Math.min(255, Math.round(Number(r.DIAM) || 0))),
    });
  }
  parsed.sort((a, b) => a.st - b.st || a.house - b.house || a.x - b.x);
  const body = Buffer.concat([
    planes16(deltas(parsed, "x")),
    planes16(deltas(parsed, "y")),
    planes16(parsed.map((t) => t.sp)),
    Buffer.from(parsed.map((t) => t.planted)),
    Buffer.from(parsed.map((t) => t.removed)),
    Buffer.from(parsed.map((t) => t.flags)),
    Buffer.from(parsed.map((t) => t.diam)),
    planes16(parsed.map((t) => t.st)),
    planes16(parsed.map((t) => t.house)),
  ]);
  const meta = {
    source: "City of Seattle, SDOT Trees (CDL), status REMOVED",
    fetched: new Date().toISOString(),
    count: parsed.length,
    posShift: POS_SHIFT,
    approxRemoved: approx,
    species,
    streets,
  };
  return { bytes: withHeader("RMV1", meta, body), n: parsed.length, approx };
}

// --- LiDAR tree crowns -------------------------------------------------------

const CROWNS_LAYER =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/TreeCrowns_2021_Seattle/FeatureServer/0/query";
const FT = 0.3048;

/**
 * Every tree crown the 2021 LiDAR found — parks, yards and greenbelts as well
 * as streets — as its centre, height and spread. Paged by OBJECTID range:
 * offsets this deep into a million rows take the service seconds a page.
 */
async function fetchCrowns() {
  const stats = await getJson(
    `${CROWNS_LAYER}?where=1%3D1&outStatistics=${encodeURIComponent(
      JSON.stringify([
        { statisticType: "min", onStatisticField: "OBJECTID", outStatisticFieldName: "lo" },
        { statisticType: "max", onStatisticField: "OBJECTID", outStatisticFieldName: "hi" },
      ]),
    )}&f=json`,
  );
  const { lo, hi } = stats.features[0].attributes;
  const pages = Math.ceil((hi - lo + 1) / PAGE);
  const out = new Array(pages);
  let next = 0;
  const worker = async () => {
    while (next < pages) {
      const page = next++;
      const from = lo + page * PAGE;
      const where = encodeURIComponent(`OBJECTID>=${from} AND OBJECTID<${from + PAGE}`);
      const body = await getJson(
        `${CROWNS_LAYER}?where=${where}&outFields=Hgt_Q99,Radius,Type&returnGeometry=false` +
          `&returnCentroid=true&outSR=4326&f=json`,
      );
      out[page] = body.features.map((f) => ({ ...f.attributes, lon: f.centroid?.x, lat: f.centroid?.y }));
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  return out.flat();
}

/**
 * crowns.bin.gz — the LiDAR crowns that aren't already street trees:
 *   "CRW1"  u32 metaLength  meta (JSON: count, streetCount, posShift),
 *   positions on the trees' bbox, sorted in rows for small steps, then:
 *     dx lo, dx hi, dy lo, dy hi       (n each)
 *     height (0.5 m steps), radius (0.25 m steps), type (1 = conifer)
 *     street heights (streetCount): the measured height, in 0.5 m steps, of
 *       each street tree a crown landed on, in trees.bin.gz's order; 0 = none
 *
 * A crown whose centre is within a few metres of a street tree is that tree
 * seen from the air: it gives the tree its height and isn't kept twice.
 */
function packCrowns(rows, bbox, street) {
  const { south, north, west, east } = bbox;
  const lat = ((south + north) / 2) * (Math.PI / 180);
  const mPerX = ((east - west) * 111320 * Math.cos(lat)) / 65535;
  const mPerY = ((north - south) * 110574) / 65535;

  // Street trees in 10 m buckets, to find the one under a crown.
  const CELL = 10;
  const grid = new Map();
  street.forEach((t, i) => {
    const key = `${Math.floor((t.x * mPerX) / CELL)},${Math.floor((t.y * mPerY) / CELL)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  });
  const streetHeight = new Uint8Array(street.length);

  const kept = [];
  let junk = 0;
  let matched = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
    if (r.lat < south || r.lat > north || r.lon < west || r.lon > east) continue;
    const h = Number(r.Hgt_Q99) * FT;
    const radius = Number(r.Radius) * FT;
    // LiDAR returns off towers and cranes land in here too; Seattle's tallest
    // trees are under 80 m.
    if (!(h >= 2 && h <= 80) || !(radius > 0.5 && radius < 40)) {
      junk++;
      continue;
    }
    const x = Math.round(((r.lon - west) / (east - west)) * 65535);
    const y = Math.round(((r.lat - south) / (north - south)) * 65535);
    const mx = x * mPerX;
    const my = y * mPerY;
    const reach = Math.min(5, Math.max(2.5, radius * 0.6));
    let best = -1;
    let bestD = reach * reach;
    const gx = Math.floor(mx / CELL);
    const gy = Math.floor(my / CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const ex = street[i].x * mPerX - mx;
          const ey = street[i].y * mPerY - my;
          const d = ex * ex + ey * ey;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    const hq = Math.min(255, Math.round(h / 0.5));
    if (best >= 0) {
      streetHeight[best] = Math.max(streetHeight[best], hq);
      matched++;
      continue;
    }
    kept.push({ x, y, h: hq, r: Math.min(255, Math.round(radius / 0.25)), conifer: r.Type === "Coniferous" ? 1 : 0 });
  }
  // Rows about 25 m deep, west to east along each: neighbours sit next to each other.
  kept.sort((a, b) => (a.y >> 7) - (b.y >> 7) || a.x - b.x);
  const body = Buffer.concat([
    planes16(deltas(kept, "x")),
    planes16(deltas(kept, "y")),
    Buffer.from(kept.map((c) => c.h)),
    Buffer.from(kept.map((c) => c.r)),
    Buffer.from(kept.map((c) => c.conifer)),
    Buffer.from(streetHeight),
  ]);
  const meta = {
    source: "City of Seattle, Tree Canopy 2021 Tree Crowns (LiDAR; University of Vermont Spatial Analysis Lab)",
    fetched: new Date().toISOString(),
    count: kept.length,
    streetCount: street.length,
    posShift: POS_SHIFT,
  };
  return { bytes: withHeader("CRW1", meta, body), n: kept.length, matched, junk };
}

/** A u16 column as byte planes: every low byte, then every high byte. */
function planes16(values) {
  const out = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    out[i] = values[i] & 255;
    out[values.length + i] = (values[i] >>> 8) & 255;
  }
  return out;
}

/** A position column, POS_SHIFT bits coarser, as the step from the point before. */
function deltas(list, key) {
  let prev = 0;
  return list.map((t) => {
    const q = t[key] >>> POS_SHIFT;
    const d = (q - prev) & 0xffff;
    prev = q;
    return d;
  });
}

/** Magic, metadata length, the metadata (space-padded to 4), then the body. */
function withHeader(magic, meta, body) {
  let metaBytes = Buffer.from(JSON.stringify(meta), "utf8");
  metaBytes = Buffer.concat([metaBytes, Buffer.alloc((4 - (metaBytes.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(8);
  head.write(magic, 0, "ascii");
  head.writeUInt32LE(metaBytes.length, 4);
  return Buffer.concat([head, metaBytes, body]);
}

/** Under a week old and in the current format; anything else is fetched again. */
async function isFresh(path, magic) {
  if (force) return false;
  try {
    if (Date.now() - (await stat(path)).mtimeMs >= MAX_AGE_MS) return false;
    return gunzipSync(await readFile(path)).subarray(0, 4).toString("ascii") === magic;
  } catch {
    return false;
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

/** The bbox out of a trees file already on disk, for a terrain-only refresh. */
async function readBbox() {
  const buf = gunzipSync(await readFile(OUT_PATH));
  const metaLength = buf.readUInt32LE(4);
  return JSON.parse(buf.subarray(8, 8 + metaLength).toString("utf8")).bbox;
}

async function refreshTerrain(trees) {
  // Cover the trees' bbox in whole square cells, centred on it.
  const w = Math.ceil((trees.east - trees.west) / CELL_DEG);
  const h = Math.ceil((trees.north - trees.south) / CELL_DEG);
  const midX = (trees.west + trees.east) / 2;
  const midY = (trees.south + trees.north) / 2;
  const west = midX - (w * CELL_DEG) / 2;
  const east = midX + (w * CELL_DEG) / 2;
  const south = midY - (h * CELL_DEG) / 2;
  const north = midY + (h * CELL_DEG) / 2;
  const url =
    `${DEM}?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=4326&size=${w},${h}` +
    `&format=bsq&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation`;
  // Ask where it will actually put the grid before taking it, and refuse a
  // stretched one rather than ship ground that's out of register with the trees.
  const extent = (await getJson(`${url}&f=json`)).extent;
  if (Math.abs(extent.ymax - north) > CELL_DEG / 4 || Math.abs(extent.xmin - west) > CELL_DEG / 4) {
    throw new Error(`service moved the grid to ${JSON.stringify(extent)}`);
  }
  let raw;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${url}&f=image`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = Buffer.from(await res.arrayBuffer());
      // bsq is the floats, row by row from the north, then a validity bitmask.
      if (raw.length < w * h * 4) throw new Error(`short raster: ${raw.length} bytes for ${w}x${h}`);
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  const z = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = raw.readFloatLE(i * 4);
    z[i] = Number.isFinite(v) && v > -500 ? v : 0;
  }

  const water = new Uint8Array(w * h);
  const stack = [];
  for (const seed of WATER_SEEDS) {
    const x = Math.floor(((seed.lon - west) / (east - west)) * w);
    const y = Math.floor(((north - seed.lat) / (north - south)) * h);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || water[y * w + x]) continue;
    const level = z[y * w + x];
    let lo = Infinity;
    let hi = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        lo = Math.min(lo, z[(y + dy) * w + x + dx]);
        hi = Math.max(hi, z[(y + dy) * w + x + dx]);
      }
    }
    if (hi - lo > 0.05) {
      console.warn(`[trees] water seed ${seed.lon},${seed.lat} isn't on flat water; skipped`);
      continue;
    }
    const wet = seed.sea ? (v) => v <= 0.05 : (v) => Math.abs(v - level) <= 0.08;
    stack.push(y * w + x);
    while (stack.length) {
      const i = stack.pop();
      if (water[i] || !wet(z[i])) continue;
      water[i] = 1;
      const cx = i % w;
      if (cx > 0) stack.push(i - 1);
      if (cx < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
  }

  // Heights in steps, then each as the change from its neighbour to the west
  // (or above, at the start of a row): hills change slowly, so the differences
  // are small, and gzip does far better on them.
  const q = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) q[i] = Math.round(z[i] / Z_STEP);
  const lo = Buffer.alloc(w * h);
  const hi = Buffer.alloc(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const d = (q[i] - (c ? q[i - 1] : r ? q[i - w] : 0)) & 0xffff;
      lo[i] = d & 255;
      hi[i] = d >>> 8;
    }
  }
  const gz = gzipSync(
    withHeader(
      "TER2",
      {
        source: "USGS 3D Elevation Program (3DEP)",
        fetched: new Date().toISOString(),
        bbox: { south, north, west, east },
        w,
        h,
        zStep: Z_STEP,
      },
      Buffer.concat([lo, hi, Buffer.from(water)]),
    ),
    { level: 9 },
  );
  await writeAtomic(TERRAIN_PATH, gz);
  const wet = water.reduce((a, b) => a + b, 0);
  console.log(
    `[trees] wrote terrain ${w}x${h}, ${Math.round((wet / (w * h)) * 100)}% water — ` +
      `${(gz.length / 1e6).toFixed(2)}MB gzipped`,
  );
}

async function main() {
  let bbox;
  const fresh =
    (await isFresh(OUT_PATH, "TRE2")) &&
    (await isFresh(ADDR_PATH, "TRA1")) &&
    (await isFresh(REMOVED_PATH, "RMV1")) &&
    (await isFresh(CROWNS_PATH, "CRW1"));
  if (fresh) {
    console.log(`[trees] ${OUT_PATH} and the rest are under a week old; keeping them (--force to refetch).`);
  } else {
    console.log("[trees] fetching SDOT Trees (Active) from ArcGIS Online...");
    const rows = await fetchAll();
    const packed = pack(rows);
    const mapGz = gzipSync(packed.map, { level: 9 });
    const addrGz = gzipSync(packed.addresses, { level: 9 });
    await writeAtomic(OUT_PATH, mapGz);
    await writeAtomic(ADDR_PATH, addrGz);
    bbox = packed.bbox;
    console.log(
      `[trees] wrote ${packed.n} trees, ${packed.species} species, ${packed.streets} streets — ` +
        `map ${(mapGz.length / 1e6).toFixed(2)}MB, addresses ${(addrGz.length / 1e6).toFixed(2)}MB gzipped`,
    );

    // The extras are best-effort: trees.exe draws without either.
    try {
      console.log("[trees] fetching removed street trees...");
      const removed = packRemoved(
        await fetchAll(ALL_LAYER, "CURRENT_STATUS='REMOVED'", REMOVED_FIELDS),
        packed.bbox,
      );
      const gz = gzipSync(removed.bytes, { level: 9 });
      await writeAtomic(REMOVED_PATH, gz);
      console.log(
        `[trees] wrote ${removed.n} removed trees (${removed.approx} dated by their last edit) — ` +
          `${(gz.length / 1e6).toFixed(2)}MB gzipped`,
      );
    } catch (err) {
      console.warn(`[trees] warning: removed-tree refresh failed (${err.message}); keeping the old file, or none.`);
    }
    try {
      console.log("[trees] fetching LiDAR tree crowns (about a million, a minute or two)...");
      const crowns = packCrowns(await fetchCrowns(), packed.bbox, packed.parsed);
      const gz = gzipSync(crowns.bytes, { level: 9 });
      await writeAtomic(CROWNS_PATH, gz);
      console.log(
        `[trees] wrote ${crowns.n} crowns (${crowns.matched} matched to street trees, ${crowns.junk} discarded) — ` +
          `${(gz.length / 1e6).toFixed(2)}MB gzipped`,
      );
    } catch (err) {
      console.warn(`[trees] warning: crown refresh failed (${err.message}); keeping the old file, or none.`);
    }
  }

  // The terrain is cut to the trees' bbox, so a new trees file means new terrain.
  if (bbox || !(await isFresh(TERRAIN_PATH, "TER2"))) {
    try {
      console.log("[trees] fetching elevation from USGS 3DEP...");
      await refreshTerrain(bbox ?? (await readBbox()));
    } catch (err) {
      console.warn(`[trees] warning: terrain refresh failed (${err.message}); trees.exe's Tilt view keeps the old ground, or none.`);
    }
  } else {
    console.log(`[trees] ${TERRAIN_PATH} is under a week old; keeping it.`);
  }
}

main().catch((err) => {
  console.error(`[trees] refresh failed: ${err.message}`);
  process.exit(1);
});
