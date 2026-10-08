#!/usr/bin/env node
// Write src/data/phenology-npn.json — what volunteers for the USA National
// Phenology Network (Nature's Notebook) have actually seen trees around Puget
// Sound do, and when: leaf buds breaking, flowers open, leaves colouring and
// falling. src/lib/treeSeasons.ts pulls its hand-made almanac toward these
// dates, by how many observations stand behind each.
//
// Committed, not gitignored, and no deploy step runs it: the observations
// barely move from one year to the next, so the tuning is done once, read
// over, and kept. Run it again (`npm run trees:phenology`) when a few more
// seasons have been recorded.
//
// The record for each plant each year is its first "yes" (with a "no" no more
// than a fortnight before, so the onset is pinned down) and last "yes" (with a
// "no" a fortnight after), and the median of those across plants and years is
// the date. Converted here into treeSeasons.ts's own terms:
//
//   leafOut     breaking leaf buds, first + 16 days (the almanac's leafOut is
//               leaves fully out; its flush starts a fortnight or so before)
//   turn        colored leaves, first + 24 days (its turn is full colour;
//               colouring starts 24 days before)
//   drop        falling leaves, last
//   bloomStart  open flowers, first
//   bloomEnd    open flowers, last
//
// Days are 0-based, as treeSeasons.ts counts them. Genus entries carry only
// the leaf dates: a genus's observations around here are mostly its wild
// species — the network's Prunus is mostly chokecherry — and flowering varies
// too much within a genus to lend a cherry's date to a plum. Species entries
// carry everything, and apply only to that species.
//
// Data: USA National Phenology Network, www.usanpn.org — public, no key.
// Needs Node 18+ (global fetch).

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(ROOT, "src/data/phenology-npn.json");
const API = "https://services.usanpn.org/npn_portal/observations/getSummarizedData.json";
/** The Puget Sound lowlands, Olympia to Everett: Seattle's weather, near enough. */
const BOX = { south: 46.9, west: -123.1, north: 48.3, east: -121.9 };
/** Higher than this and spring comes weeks later than it does in the city. */
const MAX_ELEVATION = 300;
const FIRST_YEAR = 2010;
const PHASES = {
  371: "bud",
  501: "flower",
  498: "colour",
  471: "fall",
};
/** Plausible days (1-based, as the network counts) for each, so a stray autumn bud break isn't spring's. */
const WINDOW = { bud: [30, 170], flower: [1, 250], colour: [200, 340], fall: [230, 366] };
/** Fewer plant-years than this and a median isn't worth having. */
const MIN_N = 4;

async function main() {
  const lastYear = new Date().getFullYear() - 1;
  const params = new URLSearchParams({
    request_src: "mrwr-dev-trees",
    start_date: `${FIRST_YEAR}-01-01`,
    end_date: `${lastYear}-12-31`,
    bottom_left_x1: String(BOX.south),
    bottom_left_y1: String(BOX.west),
    upper_right_x2: String(BOX.north),
    upper_right_y2: String(BOX.east),
  });
  Object.keys(PHASES).forEach((id, k) => params.append(`phenophase_id[${k}]`, id));
  console.log(`[phenology] fetching USA-NPN observations, ${FIRST_YEAR}–${lastYear}...`);
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`unexpected reply: ${JSON.stringify(rows).slice(0, 200)}`);

  // One record per plant per year per phase: its earliest pinned-down onset
  // and latest pinned-down end.
  const plantYears = new Map();
  for (const r of rows) {
    const phase = PHASES[r.phenophase_id];
    if (!phase || r.kingdom !== "Plantae") continue;
    if (Number(r.elevation_in_meters) > MAX_ELEVATION) continue;
    const key = `${r.genus}|${r.species}|${r.individual_id}|${r.first_yes_year}|${phase}`;
    let e = plantYears.get(key);
    if (!e) plantYears.set(key, (e = { genus: r.genus, species: `${r.genus} ${r.species}`, phase, first: null, last: null }));
    const [lo, hi] = WINDOW[phase];
    if (r.numdays_since_prior_no != null && r.numdays_since_prior_no <= 14 && r.first_yes_doy >= lo && r.first_yes_doy <= hi) {
      e.first = e.first === null ? r.first_yes_doy : Math.min(e.first, r.first_yes_doy);
    }
    if (r.numdays_until_next_no != null && r.numdays_until_next_no <= 14 && r.last_yes_doy >= lo && r.last_yes_doy <= hi) {
      e.last = e.last === null ? r.last_yes_doy : Math.max(e.last, r.last_yes_doy);
    }
  }

  const samples = new Map();
  const add = (who, what, doy) => {
    let m = samples.get(who);
    if (!m) samples.set(who, (m = new Map()));
    let list = m.get(what);
    if (!list) m.set(what, (list = []));
    list.push(doy);
  };
  for (const e of plantYears.values()) {
    for (const end of ["first", "last"]) {
      if (e[end] === null) continue;
      add(`g:${e.genus}`, `${e.phase}.${end}`, e[end]);
      add(`s:${e.species.toLowerCase()}`, `${e.phase}.${end}`, e[end]);
    }
  }

  const median = (list) => {
    const s = [...list].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };
  // [day, plant-years], 0-based, or nothing.
  const date = (m, what, shift) => {
    const list = m.get(what);
    if (!list || list.length < MIN_N) return undefined;
    return [Math.max(0, Math.min(364, median(list) - 1 + shift)), list.length];
  };
  const leafDates = (m) => ({
    leafOut: date(m, "bud.first", 16),
    turn: date(m, "colour.first", 24),
    drop: date(m, "fall.last", 0),
  });
  const clean = (o) => {
    const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length ? kept : null;
  };

  const genus = {};
  const species = {};
  for (const [who, m] of [...samples].sort(([a], [b]) => a.localeCompare(b))) {
    if (who.startsWith("g:")) {
      const entry = clean(leafDates(m));
      if (entry) genus[who.slice(2)] = entry;
    } else {
      const name = who.slice(2);
      // "spp." and the like say which genus, not which species.
      if (/ (spp?\.?|sp\.?|x|hybrid)$/i.test(name) || name.split(" ").length < 2) continue;
      const entry = clean({
        ...leafDates(m),
        bloomStart: date(m, "flower.first", 0),
        bloomEnd: date(m, "flower.last", 0),
      });
      if (entry) species[name] = entry;
    }
  }

  const out = {
    source: "USA National Phenology Network (www.usanpn.org), Nature's Notebook observations",
    fetched: new Date().toISOString(),
    region: `Puget Sound lowlands (${BOX.south}–${BOX.north}°N, ${-BOX.east}–${-BOX.west}°W, under ${MAX_ELEVATION} m)`,
    years: [FIRST_YEAR, lastYear],
    note: "Days of the year, 0-based, each [day, plant-years observed]. Written by scripts/content/tune-phenology.mjs.",
    genus,
    species,
  };
  // One genus or species a line, so a re-tune reads as a diff of the dates that moved.
  const block = (o) =>
    `{\n${Object.entries(o)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(",\n")}\n }`;
  const head = JSON.stringify({ ...out, genus: undefined, species: undefined }, null, 1).replace(/\n}$/, "");
  await writeFile(OUT_PATH, `${head},\n "genus": ${block(genus)},\n "species": ${block(species)}\n}\n`);
  console.log(
    `[phenology] ${rows.length} records → ${Object.keys(genus).length} genera, ${Object.keys(species).length} species; ` +
      `wrote ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(`[phenology] failed: ${err.message}`);
  process.exit(1);
});
