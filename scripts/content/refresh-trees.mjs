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
// Format (little-endian), read back by src/lib/trees.ts:
//   "TRE1"  u32 metaLength  meta (UTF-8 JSON, space-padded to a multiple of 4)
//   then n-length columns, each starting on a 4-byte boundary:
//     x u16, y u16          position, quantized across meta.bbox (x = east)
//     species u16           index into meta.species: [common, scientific, genus]
//     street u16, house u16 address: meta.streets[street], house 0 = none
//     year u8               year planted − 1900, 0 = unknown
//     diam u8               trunk diameter, inches, capped at 255
//     flags u8              bits 0–1 owner (0 private, 1 SDOT, 2 parks, 3 other),
//                           bit 2 heritage tree, bit 3 exceptional tree
//
// Needs Node 18+ (global fetch). No credentials.

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(ROOT, "public/trees/trees.bin.gz");
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

async function fetchAll() {
  const { count } = await getJson(`${LAYER}?where=1%3D1&returnCountOnly=true&f=json`);
  if (!count) throw new Error("layer reported no trees");
  const pages = Math.ceil(count / PAGE);
  const out = new Array(pages);
  let next = 0;
  const worker = async () => {
    while (next < pages) {
      const page = next++;
      const url =
        `${LAYER}?where=1%3D1&outFields=${FIELDS}&returnGeometry=false&orderByFields=OBJECTID` +
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

  const meta = {
    source: "City of Seattle, SDOT Trees (Active)",
    fetched: new Date().toISOString(),
    count: n,
    bbox: { south, north, west, east },
    species,
    streets,
  };
  let metaBytes = Buffer.from(JSON.stringify(meta), "utf8");
  const metaPad = (4 - (metaBytes.length % 4)) % 4;
  metaBytes = Buffer.concat([metaBytes, Buffer.alloc(metaPad, 0x20)]);

  const align = (bytes) => (bytes + 3) & ~3;
  const u16Bytes = align(n * 2);
  const u8Bytes = align(n);
  const body = Buffer.alloc(u16Bytes * 5 + u8Bytes * 3);
  const cols16 = ["x", "y", "sp", "st", "house"];
  cols16.forEach((key, c) => {
    const base = c * u16Bytes;
    parsed.forEach((t, i) => body.writeUInt16LE(t[key], base + i * 2));
  });
  const cols8 = ["year", "diam", "flags"];
  cols8.forEach((key, c) => {
    const base = u16Bytes * 5 + c * u8Bytes;
    parsed.forEach((t, i) => body.writeUInt8(t[key], base + i));
  });

  const head = Buffer.alloc(8);
  head.write("TRE1", 0, "ascii");
  head.writeUInt32LE(metaBytes.length, 4);
  return { bytes: Buffer.concat([head, metaBytes, body]), n, species: species.length, streets: streets.length };
}

async function main() {
  if (!force) {
    try {
      const age = Date.now() - (await stat(OUT_PATH)).mtimeMs;
      if (age < MAX_AGE_MS) {
        console.log(`[trees] ${OUT_PATH} is ${Math.round(age / 3600000)}h old; keeping it (--force to refetch).`);
        return;
      }
    } catch {
      // No file yet.
    }
  }

  console.log("[trees] fetching SDOT Trees (Active) from ArcGIS Online...");
  const rows = await fetchAll();
  const { bytes, n, species, streets } = pack(rows);
  const gz = gzipSync(bytes, { level: 9 });

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, gz);
  await rename(tmp, OUT_PATH);
  console.log(
    `[trees] wrote ${n} trees, ${species} species, ${streets} streets — ` +
      `${(bytes.length / 1e6).toFixed(2)}MB packed, ${(gz.length / 1e6).toFixed(2)}MB gzipped`,
  );
}

main().catch((err) => {
  console.error(`[trees] refresh failed: ${err.message}`);
  process.exit(1);
});
