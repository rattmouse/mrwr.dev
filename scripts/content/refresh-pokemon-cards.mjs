#!/usr/bin/env node
// Refresh public/collections/cards.json (+ public/collections/cards/) — the
// Pokémon cards behind the Collections window's "Cards" tab.
//
// The collection itself lives in the card-binder app's SQLite file (see
// ../card-binder), which is the record of what's actually owned: one
// inventory_item row per card, finish and condition, pointing at a card_print
// with its name, set, number, rarity and scans. This reads that database
// read-only — it never writes to it — takes the most valuable cards, copies
// their scans into public/collections/cards/, and writes the tiles the window
// reads.
//
// Market prices decide the order but are deliberately never shown: the binder
// is a sell-side ledger and the site is not a price list.
//
// Both outputs are gitignored, like everything else under public/collections/,
// and the scans are copied locally so the site still calls nothing at runtime.
//
//   scripts/content/refresh-pokemon-cards.sh                  # top 48 cards
//   scripts/content/refresh-pokemon-cards.sh --limit 100
//   scripts/content/refresh-pokemon-cards.sh --all
//   scripts/content/refresh-pokemon-cards.sh --db /path/to/binder.db

import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_PATH = resolve(ROOT, "public/collections/cards.json");
const IMAGE_DIR = resolve(ROOT, "public/collections/cards");
const IMAGE_PUBLIC = "/collections/cards";
// The binder app sits beside this repo; CARD_BINDER_DB overrides.
const DEFAULT_DB = resolve(ROOT, "../card-binder/binder.db");

// Enough to fill a desktop without burying it — the Albums shelf is 26.
const DEFAULT_LIMIT = 48;
// Longest credit line the Collections caption shows before it gets clipped.
const CREDIT_MAX = 56;

function parseArgs(argv) {
  const opts = { db: process.env.CARD_BINDER_DB || DEFAULT_DB, limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") opts.limit = Number.POSITIVE_INFINITY;
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (arg === "--db") opts.db = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!(opts.limit > 0)) throw new Error("--limit wants a positive number");
  return opts;
}

/** Clip to `max` characters on a word boundary, so no line ends mid-word. */
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[\s\-·]+$/, "")}…`;
}

// "94" of 88 printed reads as 094/088 on the card itself. Promo and subset
// numbers (TG05, SWSH123) aren't digits and are left exactly as printed.
function formatNumber(collectorNumber, printedTotal) {
  const number = String(collectorNumber ?? "").trim();
  if (!number) return "";
  if (!/^\d+$/.test(number)) return number;
  const total = Number(printedTotal);
  if (!Number.isFinite(total) || total <= 0) return number;
  const width = Math.max(3, String(total).length);
  return `${number.padStart(width, "0")}/${String(total).padStart(width, "0")}`;
}

// One row per distinct card — a card owned in two finishes is one tile with the
// quantities added up. Price comes from the newest observation for the finish
// actually owned, falling back to any price on record for that print.
const QUERY = `
  SELECT
    p.id            AS print_id,
    p.name          AS name,
    p.set_name      AS set_name,
    p.collector_number,
    p.printed_total,
    p.rarity,
    p.image_small,
    p.image_large,
    SUM(i.quantity) AS quantity,
    MAX(COALESCE(
      (SELECT pp.market FROM price_point pp
        WHERE pp.print_id = i.print_id AND pp.finish = i.finish AND pp.market IS NOT NULL
        ORDER BY pp.observed_at DESC LIMIT 1),
      (SELECT MAX(pp.market) FROM price_point pp WHERE pp.print_id = i.print_id)
    )) AS market
  FROM inventory_item i
  JOIN card_print p ON p.id = i.print_id
  WHERE i.status = 'owned' AND p.game = 'pokemon'
  GROUP BY p.id
  ORDER BY market IS NULL ASC, market DESC, p.name ASC
`;

const EXT_BY_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Copy one scan into public/collections/cards/, named <print>-<size>.<ext>. */
async function download(url, printId, size) {
  const res = await fetch(url, { headers: { accept: "image/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type] ?? "png";
  const slug = printId.replace(/[^A-Za-z0-9._-]/g, "-");
  const name = `${slug}-${size}.${ext}`;
  await writeFile(resolve(IMAGE_DIR, name), buf);
  return `${IMAGE_PUBLIC}/${name}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let db;
  try {
    db = new DatabaseSync(opts.db, { readOnly: true });
  } catch (err) {
    console.warn(`can't read the binder at ${opts.db} (${err.message}) — nothing to refresh`);
    return;
  }

  let rows;
  try {
    rows = db.prepare(QUERY).all();
  } finally {
    db.close();
  }
  if (rows.length === 0) {
    console.warn(`${opts.db} holds no owned Pokémon cards — nothing to refresh`);
    return;
  }

  const picked = Number.isFinite(opts.limit) ? rows.slice(0, opts.limit) : rows;
  console.log(`${rows.length} cards in the binder; taking the top ${picked.length} by value`);

  await mkdir(IMAGE_DIR, { recursive: true });

  const tiles = [];
  const kept = new Set();
  for (const row of picked) {
    try {
      // The big scan is what the maximized window shows; the small one is the
      // desktop tile. Fall back to the one that exists if the other doesn't.
      const largeUrl = row.image_large || row.image_small;
      if (!largeUrl) throw new Error("no scan on record");
      const image = await download(largeUrl, row.print_id, "large");
      kept.add(image.split("/").pop());
      if (row.image_small) {
        kept.add((await download(row.image_small, row.print_id, "small")).split("/").pop());
      }

      const number = formatNumber(row.collector_number, row.printed_total);
      const credit = [row.set_name, row.rarity, row.quantity > 1 ? `×${row.quantity}` : ""]
        .filter(Boolean)
        .join(" · ");
      tiles.push({
        title: [row.name, number].filter(Boolean).join(" · "),
        artist: credit ? clip(credit, CREDIT_MAX) : "card-binder",
        image,
        // Every scan is a card, and a card is 63×88mm.
        aspect: 0.7162,
      });
      console.log(`  ${row.print_id}: ${row.name} ok`);
    } catch (err) {
      console.warn(`  ${row.print_id}: skipped (${err.message})`);
    }
  }

  // Drop scans left behind by a previous, longer run so the directory always
  // matches the shelf.
  for (const name of await readdir(IMAGE_DIR)) {
    if (!kept.has(name)) await rm(resolve(IMAGE_DIR, name), { force: true });
  }

  await writeFile(OUT_PATH, JSON.stringify(tiles, null, 2) + "\n");
  console.log(`wrote ${OUT_PATH} (${tiles.length} cards)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
