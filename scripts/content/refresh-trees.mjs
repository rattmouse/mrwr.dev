#!/usr/bin/env node
// Refresh public/trees/trees.bin.gz — every street tree in Seattle, and every
// tree Seattle Parks has inventoried in its parks, for trees.exe. Pulled from
// the City of Seattle's "SDOT Trees (Active)" and "SPR Trees" layers on ArcGIS
// Online (about 215k and 22k points, 2,000 per request) and packed into one
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
//   "TRE3"  u32 metaLength  meta (UTF-8 JSON: count, parkCount, bbox, species, posShift)
//   then n-byte planes:
//     dx lo, dx hi, dy lo, dy hi   position, quantized across meta.bbox to
//                                  16 − posShift bits (x = east), as the
//                                  difference from the tree before — trees
//                                  are sorted street by street, so it's small
//     species lo, species hi       index into meta.species: [common, scientific, genus]
//     year                         year planted − 1900, 0 = unknown
//     diam                         trunk diameter, inches, capped at 255
//     flags                        bits 0–1 owner (0 private, 1 SDOT, 2 parks,
//                                  3 other), bit 2 heritage, bit 3 exceptional,
//                                  bit 4 from Parks' inventory (its "street"
//                                  is then the park's name, and house is 0)
//
// addresses.bin.gz — only the tree card and hover line need it, so the window
// fetches it after the map is up, about 170KB:
//   "TRA1"  u32 metaLength  meta (JSON: count, streets)
//   street lo, street hi, house lo, house hi   meta.streets[street], house 0 = none
//
// sidewalk.bin.gz — what SDOT's sidewalk inspectors found at each street tree
// they blamed for something (roots lifting a slab, branches hanging low, the
// trunk in the way), for the tree card, about 60KB. Its rows are indexes into
// trees.bin.gz's order, so it's only ever written alongside it:
//   "SDW1"  u32 metaLength  meta (JSON: count, ...)
//   tree b0, b1, b2       the tree's index, 24 bits, as the step from the row before
//   uplift                the worst slab its roots lifted, tenths of an inch
//   uplifts               how many places they did, capped at 255
//   flags                 bit 0 branches low over the sidewalk, bit 1 trunk or
//                         pit narrowing it, bit 2 in the way (no more said),
//                         bit 3 slabs cracked, bit 4 slab tilted, bit 5 all of
//                         it repaired since, bit 6 matched by nearness, not id
//   year                  latest inspection − 1900
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
// And public/trees/places.bin.gz — the parks, Green Seattle Partnership
// restoration zones, P-Patch gardens, creeks, the areaways under the
// sidewalks and Link light rail, drawn under the trees (format at
// packPlaces). Also separate, also best-effort.
//
// Needs Node 18+ (global fetch). No credentials.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(ROOT, "public/trees/trees.bin.gz");
const ADDR_PATH = resolve(ROOT, "public/trees/addresses.bin.gz");
const REMOVED_PATH = resolve(ROOT, "public/trees/removed.bin.gz");
const CROWNS_PATH = resolve(ROOT, "public/trees/crowns.bin.gz");
const PLACES_PATH = resolve(ROOT, "public/trees/places.bin.gz");
const SIDEWALK_PATH = resolve(ROOT, "public/trees/sidewalk.bin.gz");
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
  "UNITID",
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
  return (await fetchFeatures(layer, where, fields)).map((f) => f.attributes);
}

/**
 * Every feature of a layer, attributes and — when `geometry` is set — shapes
 * in plain longitude and latitude, `geometry` being any extra query string
 * (simplification, precision). Paged by offset, PAGE at a time.
 */
async function fetchFeatures(layer, where, fields, geometry = null) {
  const w = encodeURIComponent(where);
  const { count } = await getJson(`${layer}?where=${w}&returnCountOnly=true&f=json`);
  if (!count) throw new Error(`${layer.split("/services/")[1]} reported nothing`);
  const pages = Math.ceil(count / PAGE);
  const out = new Array(pages);
  let next = 0;
  const shapes = geometry === null ? "&returnGeometry=false" : `&returnGeometry=true&outSR=4326${geometry}`;
  const worker = async () => {
    while (next < pages) {
      const page = next++;
      const url =
        `${layer}?where=${w}&outFields=${fields}${shapes}&orderByFields=OBJECTID` +
        `&resultOffset=${page * PAGE}&resultRecordCount=${PAGE}&f=json`;
      const body = await getJson(url);
      out[page] = body.features;
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  const rows = out.flat();
  // Paging by offset on a live layer can drift by a few rows if the city edits
  // it mid-pull; anything more than that is a broken pull, not a refresh.
  if (Math.abs(rows.length - count) > 50) throw new Error(`expected ${count} rows, got ${rows.length}`);
  return rows;
}

// --- Seattle Parks' own tree inventory --------------------------------------------

/** The trees Parks looks after inside its parks, which the street-tree layer mostly doesn't have. */
const PARK_TREES_LAYER =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SPR_Tree_View/FeatureServer/0/query";

/** A real binomial (or at least a genus), not blank, "Unknown" or an error message. */
function isSpecies(name) {
  return /^[A-Z][a-z]+(\s|$)/.test(name) && !/error|unknown|null/i.test(name);
}

/** A species for a common name: exactly, or the one whose longer name starts with it ("Deodar" → "Deodar cedar"). */
function speciesForCommon(byCommon, common) {
  if (!common) return "";
  if (byCommon.has(common)) return byCommon.get(common);
  for (const [name, sci] of byCommon) if (name.startsWith(`${common} `)) return sci;
  return "";
}

/** The inventory's one-word common names that name a genus, for trees with no species. */
const GENUS_OF_COMMON = {
  maple: "Acer",
  pine: "Pinus",
  hawthorn: "Crataegus",
  oak: "Quercus",
  cherry: "Prunus",
  plum: "Prunus",
  birch: "Betula",
  spruce: "Picea",
  fir: "Abies",
  cedar: "Cedrus",
  larch: "Larix",
  larix: "Larix",
  redwood: "Sequoia",
  sumac: "Rhus",
  willow: "Salix",
  poplar: "Populus",
  ash: "Fraxinus",
  elm: "Ulmus",
  magnolia: "Magnolia",
  dogwood: "Cornus",
  apple: "Malus",
  crabapple: "Malus",
  pear: "Pyrus",
  holly: "Ilex",
  hemlock: "Tsuga",
  juniper: "Juniperus",
  cypress: "Cupressus",
  linden: "Tilia",
  alder: "Alnus",
};

/**
 * Parks' trees in the street-tree layer's shape, so pack() takes both. A
 * species the street layer already has keeps the street layer's names, so the
 * two don't count it as two kinds; the address is the park. Snags — standing
 * dead trees — are left out, and so is any tree within a couple of metres of a
 * street tree of the same genus, which is the same tree inventoried twice.
 */
async function fetchParkTrees(street) {
  const features = await fetchFeatures(
    PARK_TREES_LAYER,
    "STATUS IS NULL OR STATUS <> 'Snag'",
    "OBJECTID,PARK,COMMON,SPECIES,DBH_WL,EXCEPTIONAL_WL",
    "",
  );
  const known = new Map();
  for (const r of street) {
    const key = cleanScientific(r.SCIENTIFIC_NAME).toLowerCase();
    if (key && !known.has(key)) known.set(key, r);
  }
  // Common names to species, for the rows whose species is missing or garbled:
  // the street layer's names first, then the inventory's own good rows.
  const byCommon = new Map();
  for (const r of street) {
    const sci = cleanScientific(r.SCIENTIFIC_NAME);
    const key = String(r.COMMON_NAME ?? "").trim().toLowerCase();
    if (key && isSpecies(sci) && !byCommon.has(key)) byCommon.set(key, sci);
  }
  for (const f of features) {
    const sci = cleanScientific(f.attributes.SPECIES);
    const key = String(f.attributes.COMMON ?? "").trim().toLowerCase();
    if (key && isSpecies(sci) && !byCommon.has(key)) byCommon.set(key, sci);
  }

  // Street trees in 10 m buckets, by genus, to find a double.
  const CELL = 10 / 111320;
  const grid = new Map();
  const cellOf = (lon, lat) => `${Math.floor(lon / (CELL * 1.48))},${Math.floor(lat / CELL)}`;
  for (const r of street) {
    if (!Number.isFinite(r.SHAPE_LAT) || !Number.isFinite(r.SHAPE_LNG)) continue;
    const key = cellOf(r.SHAPE_LNG, r.SHAPE_LAT);
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(r);
  }
  const lat0 = Math.cos(47.6 * (Math.PI / 180));
  const near = (lon, lat, genus) => {
    const [gx, gy] = cellOf(lon, lat).split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const r of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const ex = (r.SHAPE_LNG - lon) * 111320 * lat0;
          const ey = (r.SHAPE_LAT - lat) * 110574;
          if (ex * ex + ey * ey < 4 && String(r.GENUS ?? "").trim() === genus) return true;
        }
      }
    }
    return false;
  };

  const rows = [];
  let doubles = 0;
  for (const f of features) {
    const a = f.attributes;
    const lon = f.geometry?.x;
    const lat = f.geometry?.y;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const common = String(a.COMMON ?? "").trim();
    let scientific = cleanScientific(a.SPECIES);
    // Some of the inventory's species are the text of a database error. Its
    // common name usually still says what the tree is: the street layer's (or
    // another park tree's) species of that name, or for "Maple" or "Pine"
    // just the genus.
    if (!isSpecies(scientific)) scientific = speciesForCommon(byCommon, common.toLowerCase());
    const same = known.get(scientific.toLowerCase());
    const genus = same
      ? String(same.GENUS ?? "").trim()
      : scientific
        ? scientific.split(" ")[0]
        : (GENUS_OF_COMMON[common.toLowerCase()] ?? "Unknown");
    if (near(lon, lat, genus)) {
      doubles++;
      continue;
    }
    rows.push({
      park: true,
      UNITDESC: String(a.PARK ?? "").trim() || "Seattle park",
      OWNERSHIP: "PARK",
      PLANTED_DATE: null,
      SCIENTIFIC_NAME: same ? same.SCIENTIFIC_NAME : scientific,
      COMMON_NAME: same ? same.COMMON_NAME : common || "Unknown",
      GENUS: genus,
      HERITAGE: "N",
      EXCEPTIONAL: a.EXCEPTIONAL_WL === "Exceptional" || a.EXCEPTIONAL_WL === "Yes" ? "Y" : "N",
      DIAM: a.DBH_WL,
      SHAPE_LAT: lat,
      SHAPE_LNG: lon,
    });
  }
  return { rows, doubles };
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
    const m = r.park ? null : desc.match(/^(\d{1,5}) (.+)$/);
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
    const flags =
      owner(r.OWNERSHIP) | (r.HERITAGE === "Y" ? 4 : 0) | (r.EXCEPTIONAL === "Y" ? 8 : 0) | (r.park ? 16 : 0);
    const x = Math.round(((r.SHAPE_LNG - west) / (east - west)) * 65535);
    const y = Math.round(((r.SHAPE_LAT - south) / (north - south)) * 65535);
    return { x, y, sp, st, house, year, diam, flags, unit: r.park ? null : r.UNITID };
  });

  // Block by block: neighbours share a street and run on in house numbers,
  // which is most of what gzip finds to squeeze.
  parsed.sort((a, b) => a.st - b.st || a.house - b.house || a.x - b.x);

  const delta = (key) => deltas(parsed, key);

  const meta = {
    source: "City of Seattle, SDOT Trees (Active) and Seattle Parks and Recreation Trees",
    fetched: new Date().toISOString(),
    count: n,
    parkCount: rows.filter((r) => r.park).length,
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
    map: withHeader("TRE3", meta, map),
    addresses: withHeader("TRA1", { count: n, streets }, addresses),
    n,
    species: species.length,
    streets: streets.length,
    bbox: meta.bbox,
    parsed,
  };
}

// --- sidewalk inspections ---------------------------------------------------

const SIDEWALK_LAYER =
  "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Sidewalk_Observation/FeatureServer/0/query";
/** Anything an inspector put down to a street tree, and every tree obstruction, named or not. */
const SIDEWALK_WHERE =
  "(AFFECTING_SDOT_ASSETID LIKE 'TRE-%' OR OBSTRUCTION_TYPE IN ('TREE','TREEPIT')) AND " +
  "(OBSERVATION_STATUS IS NULL OR OBSERVATION_STATUS <> 'EXPIRED')";
const SIDEWALK_FIELDS = [
  "OBJECTID",
  "AFFECTING_SDOT_ASSETID",
  "OBSERVATION_TYPE",
  "OBSTRUCTION_TYPE",
  "CLEARANCE_IMPACTED",
  "HEIGHT_DIFFERENCE_TYPE",
  "UPLIFT_HEIGHT",
  "OBSERVATION_STATUS",
  "INSPECTION_DATE",
].join(",");
/** How far an obstruction with no tree id can be from a street tree and still be put down to it, metres. */
const SIDEWALK_NEAR = 4;

/**
 * Each inspection onto the street tree it names, or — for a tree obstruction
 * that names none — the nearest street tree within SIDEWALK_NEAR metres. One
 * naming a tree no longer in the inventory is dropped.
 */
function packSidewalk(features, bbox, street) {
  const { south, north, west, east } = bbox;
  const lat = ((south + north) / 2) * (Math.PI / 180);
  const mPerX = ((east - west) * 111320 * Math.cos(lat)) / 65535;
  const mPerY = ((north - south) * 110574) / 65535;
  const byUnit = new Map();
  const CELL = 10;
  const grid = new Map();
  street.forEach((t, i) => {
    if (!t.unit) return;
    byUnit.set(t.unit, i);
    const key = `${Math.floor((t.x * mPerX) / CELL)},${Math.floor((t.y * mPerY) / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  const nearest = (lon, lat) => {
    const mx = ((lon - west) / (east - west)) * 65535 * mPerX;
    const my = ((lat - south) / (north - south)) * 65535 * mPerY;
    const gx = Math.floor(mx / CELL);
    const gy = Math.floor(my / CELL);
    let best = -1;
    let bestD = SIDEWALK_NEAR * SIDEWALK_NEAR;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
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
    return best;
  };

  const byTree = new Map();
  let named = 0;
  let near = 0;
  let unmatched = 0;
  for (const { attributes: a, geometry: g } of features) {
    let i = byUnit.get(a.AFFECTING_SDOT_ASSETID);
    let byNearness = false;
    // A tree it names that isn't standing any more (taken down, mostly) isn't the one next to it.
    const names = String(a.AFFECTING_SDOT_ASSETID ?? "").startsWith("TRE-");
    if (i === undefined && !names && g && Number.isFinite(g.x)) {
      const k = nearest(g.x, g.y);
      if (k >= 0) {
        i = k;
        byNearness = true;
      }
    }
    if (i === undefined) {
      unmatched++;
      continue;
    }
    if (byNearness) near++;
    else named++;
    let t = byTree.get(i);
    if (!t) {
      // Bit 5 (all repaired) starts set and is cleared by anything still open.
      t = { i, uplift: 0, uplifts: 0, flags: 32, year: 0 };
      byTree.set(i, t);
    }
    if (byNearness) t.flags |= 64;
    if (a.OBSERVATION_STATUS !== "CLOSED") t.flags &= ~32;
    if (a.INSPECTION_DATE) t.year = Math.max(t.year, new Date(a.INSPECTION_DATE).getUTCFullYear() - 1900);
    switch (a.OBSERVATION_TYPE) {
      case "HEIGHTDIFF":
        if (a.HEIGHT_DIFFERENCE_TYPE === "UPLIFT" || a.HEIGHT_DIFFERENCE_TYPE == null) {
          t.uplifts = Math.min(255, t.uplifts + 1);
          t.uplift = Math.max(t.uplift, Math.min(255, Math.round((Number(a.UPLIFT_HEIGHT) || 0) * 10)));
        }
        break;
      case "OBSTRUCT": {
        const c = a.CLEARANCE_IMPACTED;
        if (c === "VERTICAL" || c === "BOTH") t.flags |= 1;
        if (c === "HORIZONTAL" || c === "BOTH" || a.OBSTRUCTION_TYPE === "TREEPIT") t.flags |= 2;
        if (!(t.flags & 3)) t.flags |= 4;
        break;
      }
      case "SURFCOND":
        t.flags |= 8;
        break;
      case "XSLOPE":
        t.flags |= 16;
        break;
    }
  }
  const rows = [...byTree.values()].sort((a, b) => a.i - b.i);
  const n = rows.length;
  const idx = Buffer.alloc(n * 3);
  let prev = 0;
  rows.forEach((t, k) => {
    const d = t.i - prev;
    prev = t.i;
    idx[k] = d & 255;
    idx[n + k] = (d >>> 8) & 255;
    idx[n * 2 + k] = (d >>> 16) & 255;
  });
  const body = Buffer.concat([
    idx,
    Buffer.from(rows.map((t) => t.uplift)),
    Buffer.from(rows.map((t) => t.uplifts)),
    Buffer.from(rows.map((t) => t.flags)),
    Buffer.from(rows.map((t) => t.year)),
  ]);
  const meta = { source: "City of Seattle, SDOT Sidewalk Observations", fetched: new Date().toISOString(), count: n };
  return { bytes: withHeader("SDW1", meta, body), n, named, near, unmatched };
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

// --- places: parks, restoration sites, gardens, creeks, areaways, light rail ---------

const ORG = "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services";
/** Shapes simplified to about a metre and a half, which none of the views can tell apart. */
const SIMPLIFY = "&maxAllowableOffset=0.000015&geometryPrecision=6";
/**
 * Creek reaches by what SPU calls them. Piped stretches are kept (drawn faint);
 * side sewers, detention tanks and stubs aren't creek.
 */
const CREEK_KEEP = new Set(["Open Stream Channel", "Mainline", "Lateral", "Bridge", "Ditch", "Surface Drainage", "Culvert"]);

const PLACE_LAYERS = [
  {
    kind: "park",
    // The generalized outline, one shape per park, rather than its 2,800 parcels.
    url: `${ORG}/Park_Boundaries/FeatureServer/1/query`,
    // Parks owns tidelands too, out under the Sound in survey-grid squares; they aren't park you can stand in.
    where: "NAME NOT LIKE '%TIDELAND%'",
    fields: "OBJECTID,NAME,PARKSBND_AREA",
    attrs: (a) => ({ name: parkName(a.NAME), acres: round(Number(a.PARKSBND_AREA) / 43560, 1) }),
  },
  {
    kind: "restoration",
    // Green Seattle Partnership's forest restoration zones, at the phase last seen:
    // 0 not yet started, 1 invasives cleared, 2 secondary clearing, 3 planted, 4 maintained.
    url: `${ORG}/GSP_Sites_By_Phase/FeatureServer/0/query`,
    where: "MOSTRECENT='Y'",
    fields: "OBJECTID,PARKNAME,ZONENAME,PHASE,DATEVISIT,AREA_ACRES",
    attrs: (a) => ({
      name: a.PARKNAME,
      zone: a.ZONENAME,
      phase: Number(a.PHASE) || 0,
      visited: a.DATEVISIT ? new Date(a.DATEVISIT).getUTCFullYear() : null,
      acres: round(Number(a.AREA_ACRES), 1),
    }),
  },
  {
    kind: "garden",
    url: `${ORG}/P_Patch/FeatureServer/0/query`,
    where: "1=1",
    fields: "OBJECTID,NAME,ADDRESS,NUMPLOTS,DATE_ESTAB,SIZE_SQFT",
    attrs: (a) => ({
      name: a.NAME,
      address: a.ADDRESS,
      plots: Number(a.NUMPLOTS) || null,
      since: Number(a.DATE_ESTAB) || null,
      sqft: Number(a.SIZE_SQFT) || null,
    }),
  },
  {
    kind: "creek",
    url: `${ORG}/Urban_Watercourses/FeatureServer/0/query`,
    where: "1=1",
    fields: "OBJECTID,STRM_FULL_NAME_TEXT,STRM_FEATYPE_TEXT",
    keep: (a) => CREEK_KEEP.has(a.STRM_FEATYPE_TEXT),
    attrs: (a) => ({ name: a.STRM_FULL_NAME_TEXT || null, piped: a.STRM_FEATYPE_TEXT === "Culvert" ? 1 : 0 }),
  },
  {
    kind: "areaway",
    // SDOT's areaways: the hollow sidewalks, mostly Pioneer Square's, left when
    // the streets were raised over the old ground floors after the 1889 fire.
    // Filled-in ones are still on the books, as REMOVED; they're gone.
    url: `${ORG}/Areaways_CDL/FeatureServer/0/query`,
    where: "CURRENT_STATUS IS NULL OR CURRENT_STATUS <> 'REMOVED'",
    fields:
      "OBJECTID,UNITID,UNITDESC_ASSET,OWNERSHIP,CURRENT_STATUS,ARWFUNCTION,STRWALLTYPE,SDWSUPPORTTYPE," +
      "ARWWALLMAXHT,ARWWIDTH,ARWWALLLENGTH,STRWALLCONDITION,SDWCONDITION,INSPCOMPDATE,OVERRIDECOMMENT",
    attrs: (a) => ({
      id: a.UNITID || null,
      name: areawayName(a.UNITDESC_ASSET),
      owner: AREAWAY_OWNERS[a.OWNERSHIP] ?? null,
      status: a.CURRENT_STATUS === "OUTSVC" ? "out of service" : a.CURRENT_STATUS === "UNDERCONS" ? "under construction" : null,
      use: a.ARWFUNCTION && a.ARWFUNCTION !== "None" && a.ARWFUNCTION !== "Unknown" ? a.ARWFUNCTION : null,
      wall: knownMaterial(a.STRWALLTYPE),
      roof: knownMaterial(a.SDWSUPPORTTYPE),
      deep: round(Number(a.ARWWALLMAXHT), 1) || null,
      wide: round(Number(a.ARWWIDTH), 1) || null,
      long: round(Number(a.ARWWALLLENGTH), 1) || null,
      wallRating: rated(a.STRWALLCONDITION),
      roofRating: rated(a.SDWCONDITION),
      inspected: a.INSPCOMPDATE ? new Date(a.INSPCOMPDATE).getUTCFullYear() : null,
      filled: /PARTLY FILLED/i.test(a.OVERRIDECOMMENT ?? "") ? 1 : null,
    }),
  },
  {
    kind: "rail",
    // Sound Transit's Link track, a line per direction, cut to the city: it
    // runs on to Tacoma, Lynnwood and Redmond, which would stretch the
    // quantizing grid for everything else.
    url: `${ORG}/Sound_Transit_Link_Light_Rail_Alignment/FeatureServer/1/query`,
    where: "STATUS='COMPLETE'",
    fields: "OBJECTID,DESCRIPTION,PROFILE",
    clip: true,
    attrs: (a) => ({ name: a.DESCRIPTION || null, profile: RAIL_PROFILES[String(a.PROFILE ?? "").toUpperCase()] ?? null }),
  },
  {
    kind: "station",
    url: `${ORG}/Sound_Transit_Link_Light_Rail_Station_Platform/FeatureServer/2/query`,
    where: "STATUS='COMPLETE'",
    fields: "OBJECTID,NAME",
    clip: true,
    attrs: (a) => ({ name: a.NAME || null }),
  },
];

/** How the track runs, from Sound Transit's profile codes. */
const RAIL_PROFILES = {
  SUBWAY: "tunnel",
  PORTAL: "portal",
  "CUT-COVER": "cut and cover",
  RET_CUT: "cutting",
  "AT-GRADE": "street level",
  "AT GRADE": "street level",
  AERIAL: "elevated",
  ELEVATED: "elevated",
};

const AREAWAY_OWNERS = { PRIV: "private", SDOT: "sdot", CNTY: "county", SCL: "light" };

/** "122 S JACKSON ST BETWEEN OCCIDENTAL AND 1ST AVE" → "122 S Jackson St between Occidental and 1st Ave". */
function areawayName(desc) {
  const name = parkName(String(desc ?? "").replace(/\s+/g, " ")).replace(/\b(Between|And|At|Of)\b/g, (w) => w.toLowerCase());
  return name || null;
}

/** An inspector's material, unless they couldn't see it. */
function knownMaterial(s) {
  return s && !/unable to view|^other$/i.test(s) ? s.replace(/^RC /, "") : null;
}

/** Good, Fair or Poor; "Not Rated" and blanks aren't a rating. */
function rated(s) {
  return /^(good|fair|poor)$/i.test(s ?? "") ? s : null;
}

/** "MARTIN LUTHER KING JR MEMORIAL PARK" → "Martin Luther King Jr Memorial Park"; "NE", "NW" and the like stay capitals. */
function parkName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)\b/g, (word, first, rest) =>
      /^(n|s|e|w|ne|nw|se|sw|ii|iii)$/.test(word) ? word.toUpperCase() : first.toUpperCase() + rest,
    )
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n, suf) => n + suf.toLowerCase())
    .trim();
}

function round(n, places) {
  if (!Number.isFinite(n)) return null;
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

/** A feature's shape as a list of parts, each a list of [lon, lat]. */
function partsOf(geometry) {
  if (!geometry) return [];
  if (Number.isFinite(geometry.x)) return [[[geometry.x, geometry.y]]];
  return geometry.rings ?? geometry.paths ?? [];
}

/**
 * A feature cut to the trees' bbox: a line's points outside it dropped, the
 * line broken where it leaves and comes back; a shape kept whole if any of it
 * is inside. Null when none of it is.
 */
function clipToBbox(f, { south, north, west, east }) {
  const inside = ([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north;
  const g = f.geometry;
  if (!g) return null;
  if (g.rings) return g.rings.some((ring) => ring.some(inside)) ? f : null;
  const paths = [];
  for (const path of g.paths ?? []) {
    let run = [];
    for (const point of path) {
      if (inside(point)) run.push(point);
      else {
        if (run.length > 1) paths.push(run);
        run = [];
      }
    }
    if (run.length > 1) paths.push(run);
  }
  return paths.length ? { ...f, geometry: { paths } } : null;
}

/**
 * The platforms don't say which stations are underground; the track does.
 * A station whose middle is within 60 m of tunnel is a tunnel station.
 */
function markUndergroundStations(byKind) {
  const rail = byKind.find((k) => k.kind === "rail");
  const stations = byKind.find((k) => k.kind === "station");
  if (!rail || !stations) return;
  const segments = [];
  for (const f of rail.features) {
    if (f.attributes.PROFILE !== "SUBWAY") continue;
    for (const path of f.geometry.paths) for (let i = 0; i + 1 < path.length; i++) segments.push([path[i], path[i + 1]]);
  }
  const kx = 111320 * Math.cos((47.6 * Math.PI) / 180);
  const ky = 110574;
  for (const f of stations.features) {
    const ring = f.geometry.rings[0];
    const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length;
    const cy = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    let best = Infinity;
    for (const [a, b] of segments) {
      const ax = (a[0] - cx) * kx, ay = (a[1] - cy) * ky;
      const bx = (b[0] - cx) * kx, by = (b[1] - cy) * ky;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    f.attributes.UNDERGROUND = best <= 60 ? 1 : 0;
  }
  const attrs = stations.layer.attrs;
  stations.layer = { ...stations.layer, attrs: (a) => ({ ...attrs(a), underground: a.UNDERGROUND || null }) };
}

/**
 * places.bin.gz — everything trees.exe draws under the trees that isn't a
 * tree, about 0.3MB:
 *   "PLC1"  u32 metaLength  meta (JSON: bbox, kinds, features), then the
 *   points of every part of every feature in order, quantized to 16 bits
 *   across meta.bbox, as the step from the point before:
 *     dx lo, dx hi, dy lo, dy hi   (one per point)
 *   Each feature in meta is { k: index into kinds, parts: [point counts], ...attrs }.
 */
function packPlaces(byKind) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const { features } of byKind) {
    for (const f of features) {
      for (const part of partsOf(f.geometry)) {
        for (const [lon, lat] of part) {
          south = Math.min(south, lat);
          north = Math.max(north, lat);
          west = Math.min(west, lon);
          east = Math.max(east, lon);
        }
      }
    }
  }
  const kinds = byKind.map((l) => l.kind);
  const meta = { source: [], fetched: new Date().toISOString(), bbox: { south, north, west, east }, kinds, features: [] };
  const xs = [];
  const ys = [];
  byKind.forEach(({ layer, features }, k) => {
    for (const f of features) {
      if (layer.keep && !layer.keep(f.attributes)) continue;
      const parts = partsOf(f.geometry).filter((p) => p.length);
      if (!parts.length) continue;
      for (const part of parts) {
        for (const [lon, lat] of part) {
          xs.push(Math.round(((lon - west) / (east - west)) * 65535));
          ys.push(Math.round(((lat - south) / (north - south)) * 65535));
        }
      }
      // Attributes the city left empty are left out rather than written as null.
      const attrs = Object.fromEntries(Object.entries(layer.attrs(f.attributes)).filter(([, v]) => v !== null && v !== ""));
      meta.features.push({ k, parts: parts.map((p) => p.length), ...attrs });
    }
  });
  const step = (list) => {
    let prev = 0;
    return list.map((q) => {
      const d = (q - prev) & 0xffff;
      prev = q;
      return d;
    });
  };
  const counts = Object.fromEntries(kinds.map((kind, k) => [kind, meta.features.filter((f) => f.k === k).length]));
  return { bytes: withHeader("PLC1", meta, Buffer.concat([planes16(step(xs)), planes16(step(ys))])), counts, points: xs.length };
}

async function refreshPlaces() {
  const bbox = (await readMeta(OUT_PATH)).bbox;
  const byKind = [];
  for (const layer of PLACE_LAYERS) {
    let features = await fetchFeatures(layer.url, layer.where, layer.fields, SIMPLIFY);
    if (layer.clip) features = features.map((f) => clipToBbox(f, bbox)).filter(Boolean);
    byKind.push({ kind: layer.kind, layer, features });
  }
  markUndergroundStations(byKind);
  const packed = packPlaces(byKind);
  const gz = gzipSync(packed.bytes, { level: 9 });
  await writeAtomic(PLACES_PATH, gz);
  console.log(
    `[trees] wrote places (${Object.entries(packed.counts).map(([k, n]) => `${n} ${k}`).join(", ")}; ` +
      `${packed.points} points) — ${(gz.length / 1e6).toFixed(2)}MB gzipped`,
  );
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
  return (await readMeta(OUT_PATH)).bbox;
}

/**
 * Every tree's position (street, park and LiDAR crown) as lon/lat, out of the
 * files already on disk — the same planes src/lib/trees.ts reads back.
 */
async function treePoints() {
  const { bbox } = await readMeta(OUT_PATH);
  const points = [];
  for (const path of [OUT_PATH, CROWNS_PATH]) {
    let buf;
    try {
      buf = gunzipSync(await readFile(path));
    } catch {
      continue;
    }
    const metaLength = buf.readUInt32LE(4);
    const meta = JSON.parse(buf.subarray(8, 8 + metaLength).toString("utf8"));
    const n = meta.count;
    const at = 8 + metaLength;
    const shift = meta.posShift;
    const half = shift ? 1 << (shift - 1) : 0;
    const plane = (k, i) => buf[at + k * n * 2 + i] | (buf[at + k * n * 2 + n + i] << 8);
    let qx = 0;
    let qy = 0;
    for (let i = 0; i < n; i++) {
      qx = (qx + plane(0, i)) & 0xffff;
      qy = (qy + plane(1, i)) & 0xffff;
      const x = Math.min(65535, (qx << shift) + half) / 65535;
      const y = Math.min(65535, (qy << shift) + half) / 65535;
      points.push([bbox.west + x * (bbox.east - bbox.west), bbox.south + y * (bbox.north - bbox.south)]);
    }
  }
  return points;
}

/** A places file from before a kind was added is refetched, however new it is. */
async function hasEveryPlaceKind() {
  try {
    const { kinds } = await readMeta(PLACES_PATH);
    return PLACE_LAYERS.every((l) => kinds.includes(l.kind));
  } catch {
    return false;
  }
}

async function readMeta(path) {
  const buf = gunzipSync(await readFile(path));
  const metaLength = buf.readUInt32LE(4);
  return JSON.parse(buf.subarray(8, 8 + metaLength).toString("utf8"));
}

/**
 * Trees don't grow in lakes: a water cell with a tree in it is really the
 * bank, which the outlines' cell-sized steps (and the widened channels)
 * pushed out over the shore. Hand those back to the land at the ground's own
 * height, working in from the land a ring at a time, so a stray crown out in
 * the middle of a lake can't punch a hole in it. Returns how many cells.
 */
function dryShore(z, ground, water, w, h, origin, cell, points) {
  const treed = new Uint8Array(w * h);
  for (const [lon, lat] of points) {
    const c = Math.floor((lon - origin.west) / cell);
    const r = Math.floor((origin.north - lat) / cell);
    if (c >= 0 && r >= 0 && c < w && r < h) treed[r * w + c] = 1;
  }
  let dried = 0;
  for (let changed = true; changed; ) {
    changed = false;
    const ring = [];
    for (let i = 0; i < w * h; i++) {
      if (!water[i] || !treed[i]) continue;
      const x = i % w;
      if ((x > 0 && !water[i - 1]) || (x < w - 1 && !water[i + 1]) || (i >= w && !water[i - w]) || (i < w * (h - 1) && !water[i + w])) {
        ring.push(i);
      }
    }
    for (const i of ring) {
      water[i] = 0;
      z[i] = ground[i];
      dried++;
      changed = true;
    }
  }
  return dried;
}

/** Open water, as polygons: lakes, the bays and the channels (the layer's tideflats aren't water). */
const WATER_POLYGONS = `${ORG}/Waterlines_Channels_proj/FeatureServer/67/query`;
/** The shoreline, as lines; the ones that close on themselves ring a lake, a pond or an island. */
const SHORELINE = `${ORG}/Shoreline/FeatureServer/0/query`;

/**
 * Mark as water every cell the city's water outlines cover — the open-water
 * polygons, inside the closed shoreline rings (even-odd, so an island's
 * ring takes its island back out), and along the lakes' and the Ship Canal's
 * open shorelines — and lay each new stretch flat at its own
 * level: the low end of the ground under it, which is the water the
 * elevation did see, rather than the banks blurred over it. A channel is
 * widened by a cell either side, so a cut a cell wide still reads as water
 * when the view blends neighbouring cells. Returns how many cells it added.
 */
async function burnWater(z, water, w, h, origin, cell) {
  const polygons = (await fetchFeatures(WATER_POLYGONS, "CCAP LIKE '21%'", "OBJECTID,LC_SIMPLIF", SIMPLIFY)).map((f) => ({
    rings: f.geometry?.rings ?? [],
    channel: f.attributes.LC_SIMPLIF === "Channel",
  }));
  const rings = [];
  // The lakes' and the Ship Canal's open shorelines (the closed ones are
  // rings): drawn as water themselves, they carry the canal through the
  // Montlake Cut, which no polygon covers.
  const canal = [];
  for (const f of await fetchFeatures(SHORELINE, "1=1", "OBJECTID,TYPE", SIMPLIFY)) {
    for (const path of f.geometry?.paths ?? []) {
      const [a, b] = [path[0], path[path.length - 1]];
      if (path.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) rings.push(path);
      else if (/^(LAK|SLK)$/.test(String(f.attributes.TYPE ?? "").trim())) canal.push(path);
    }
  }

  // Cells with any of their four quarter-points inside, filled a half-cell row at a time.
  const cover = (shape) => {
    const mask = new Uint8Array(w * h);
    let lo = Infinity;
    let hi = -Infinity;
    for (const ring of shape) {
      for (const [, lat] of ring) {
        lo = Math.min(lo, lat);
        hi = Math.max(hi, lat);
      }
    }
    const r0 = Math.max(0, Math.floor(((origin.north - hi) / cell) * 2));
    const r1 = Math.min(h * 2 - 1, Math.ceil(((origin.north - lo) / cell) * 2));
    const xs = [];
    for (let sr = r0; sr <= r1; sr++) {
      const lat = origin.north - ((sr + 0.5) * cell) / 2;
      xs.length = 0;
      for (const ring of shape) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          if (y1 <= lat === y2 <= lat) continue;
          xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(((xs[k] - origin.west) / cell) * 2 - 0.5));
        const c1 = Math.min(w * 2 - 1, Math.floor(((xs[k + 1] - origin.west) / cell) * 2 - 0.5));
        for (let c = c0; c <= c1; c++) mask[(sr >> 1) * w + (c >> 1)] = 1;
      }
    }
    return mask;
  };
  const widen = (mask) => {
    const out = Uint8Array.from(mask);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const x = i % w;
      if (x > 0) out[i - 1] = 1;
      if (x < w - 1) out[i + 1] = 1;
      if (i >= w) out[i - w] = 1;
      if (i < w * (h - 1)) out[i + w] = 1;
    }
    return out;
  };
  const neighbours = (i) => {
    const x = i % w;
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1];
  };
  /**
   * The level a stretch of new water lies at: the one water it opens onto,
   * if it touches just one — a lake's fringe is the lake's height — or else
   * (a canal joining two levels, or water on its own) the tenth-percentile
   * height under it: the water's own level, not its banks'.
   */
  const levelOf = (cells) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of cells) {
      for (const k of neighbours(i)) {
        if (k < 0 || !water[k]) continue;
        lo = Math.min(lo, z[k]);
        hi = Math.max(hi, z[k]);
      }
    }
    // Touching no water at all, lo and hi are still the infinities, and their middle is NaN.
    if (lo <= hi && hi - lo <= 1) return (lo + hi) / 2;
    const zs = cells.map((i) => z[i]).sort((a, b) => a - b);
    return zs[Math.floor(zs.length * 0.1)];
  };
  let added = 0;
  /** Each connected stretch of `cells` at its own level, so Green Lake's rim isn't laid at Lake Union's. */
  const lay = (cells) => {
    const pending = new Set(cells);
    for (const start of cells) {
      if (!pending.has(start)) continue;
      pending.delete(start);
      const part = [start];
      for (let n = 0; n < part.length; n++) {
        for (const k of neighbours(part[n])) {
          if (pending.has(k)) {
            pending.delete(k);
            part.push(k);
          }
        }
      }
      const level = levelOf(part);
      for (const i of part) {
        z[i] = level;
        water[i] = 1;
      }
      added += part.length;
    }
  };
  const fresh = (mask) => {
    const cells = [];
    for (let i = 0; i < w * h; i++) if (mask[i] && !water[i]) cells.push(i);
    return cells;
  };

  for (const { rings: shape, channel } of polygons) {
    if (!shape.length) continue;
    const mask = cover(shape);
    lay(fresh(channel ? widen(mask) : mask));
  }
  if (canal.length) {
    // Every cell the lines pass through, a quarter-cell at a time, then a cell either side.
    const mask = new Uint8Array(w * h);
    for (const path of canal) {
      for (let i = 0; i + 1 < path.length; i++) {
        const [x1, y1] = path[i];
        const [x2, y2] = path[i + 1];
        const steps = Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / cell) * 4));
        for (let t = 0; t <= steps; t++) {
          const c = Math.floor((x1 + ((x2 - x1) * t) / steps - origin.west) / cell);
          const r = Math.floor((origin.north - (y1 + ((y2 - y1) * t) / steps)) / cell);
          if (c >= 0 && r >= 0 && c < w && r < h) mask[r * w + c] = 1;
        }
      }
    }
    lay(fresh(widen(mask)));
  }
  // The shoreline's rings all at once, even-odd; then each lake or pond they
  // enclose separately, since a pond up on a hill isn't at the Sound's level.
  if (rings.length) {
    const mask = cover(rings);
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i] || water[i]) continue;
      const cells = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        cells.push(j);
        const x = j % w;
        for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
          if (k < 0 || k >= w * h || seen[k] || !mask[k] || water[k]) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
      lay(cells);
    }
  }
  return added;
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

  const ground = Float32Array.from(z);
  // The elevation alone loses the narrow water: the Ship Canal, the Fremont
  // and Montlake Cuts, the Locks, the Duwamish's channels and the small lakes
  // are a cell or two wide and blur into their banks. The city's own water
  // outlines put them back.
  try {
    const burned = await burnWater(z, water, w, h, { west, north }, CELL_DEG);
    console.log(`[trees] water outlines added ${burned} cells of water the elevation missed`);
  } catch (err) {
    console.warn(`[trees] warning: water outlines failed (${err.message}); the water is the elevation's alone.`);
  }
  try {
    const dried = dryShore(z, ground, water, w, h, { west, north }, CELL_DEG, await treePoints());
    console.log(`[trees] gave ${dried} cells of shore with trees on them back to the land`);
  } catch (err) {
    console.warn(`[trees] warning: couldn't read the trees back (${err.message}); some may stand in the water.`);
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
    (await isFresh(OUT_PATH, "TRE3")) &&
    (await isFresh(ADDR_PATH, "TRA1")) &&
    (await isFresh(REMOVED_PATH, "RMV1")) &&
    (await isFresh(CROWNS_PATH, "CRW1")) &&
    (await isFresh(SIDEWALK_PATH, "SDW1"));
  if (fresh) {
    console.log(`[trees] ${OUT_PATH} and the rest are under a week old; keeping them (--force to refetch).`);
  } else {
    console.log("[trees] fetching SDOT Trees (Active) from ArcGIS Online...");
    const rows = await fetchAll();
    // Parks' own inventory rides along in the same file; without it the street trees still ship.
    let parkRows = [];
    try {
      console.log("[trees] fetching Seattle Parks' tree inventory...");
      const parks = await fetchParkTrees(rows);
      parkRows = parks.rows;
      console.log(`[trees] ${parkRows.length} park trees (${parks.doubles} already street trees, left out)`);
    } catch (err) {
      console.warn(`[trees] warning: park-tree fetch failed (${err.message}); street trees only.`);
    }
    const packed = pack(rows.concat(parkRows));
    const mapGz = gzipSync(packed.map, { level: 9 });
    const addrGz = gzipSync(packed.addresses, { level: 9 });
    await writeAtomic(OUT_PATH, mapGz);
    await writeAtomic(ADDR_PATH, addrGz);
    bbox = packed.bbox;
    console.log(
      `[trees] wrote ${packed.n} trees, ${packed.species} species, ${packed.streets} streets — ` +
        `map ${(mapGz.length / 1e6).toFixed(2)}MB, addresses ${(addrGz.length / 1e6).toFixed(2)}MB gzipped`,
    );

    // The extras are best-effort: trees.exe draws without any of them.
    try {
      console.log("[trees] fetching SDOT's sidewalk inspections...");
      const sidewalk = packSidewalk(
        await fetchFeatures(SIDEWALK_LAYER, SIDEWALK_WHERE, SIDEWALK_FIELDS, ""),
        packed.bbox,
        packed.parsed,
      );
      const gz = gzipSync(sidewalk.bytes, { level: 9 });
      await writeAtomic(SIDEWALK_PATH, gz);
      console.log(
        `[trees] wrote sidewalk notes for ${sidewalk.n} trees (${sidewalk.named} inspections by tree id, ` +
          `${sidewalk.near} by nearness, ${sidewalk.unmatched} matched to none) — ${(gz.length / 1e6).toFixed(2)}MB gzipped`,
      );
    } catch (err) {
      // Its rows are indexes into the trees just written: an old file would pin them on the wrong trees.
      await rm(SIDEWALK_PATH, { force: true });
      console.warn(`[trees] warning: sidewalk refresh failed (${err.message}); the tree cards go without.`);
    }
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

  if (!(await isFresh(PLACES_PATH, "PLC1")) || !(await hasEveryPlaceKind())) {
    try {
      console.log("[trees] fetching parks, restoration sites, P-Patches, creeks, areaways and light rail...");
      await refreshPlaces();
    } catch (err) {
      console.warn(`[trees] warning: places refresh failed (${err.message}); keeping the old file, or none.`);
    }
  } else {
    console.log(`[trees] ${PLACES_PATH} is under a week old; keeping it.`);
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
