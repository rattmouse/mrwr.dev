"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Anchor, Button, GroupBox, Hourglass, ScrollView, TextInput } from "react95";
import ContextMenu, { ContextMenuItem } from "@/components/ContextMenu";
import DesktopWindow from "@/components/windows/DesktopWindow";
import MockupList from "@/components/projects/MockupList";
import ProjectList from "@/components/projects/ProjectList";
import { DocumentWindowId, Layout, WindowBox } from "@/components/windows/windowTypes";
import { programDef } from "@/components/windows/programs";

type DocumentWindowProps = {
  id: DocumentWindowId;
  layout: Layout;
  stackIndex?: number;
  active?: boolean;
  onFocus?: () => void;
  cascadeX?: number;
  cascadeY?: number;
  box?: WindowBox | null;
  onBoxChange?: (box: WindowBox) => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
};

type CollectionCategory = "albums" | "paintings" | "songs" | "cards";

type AlbumCover = {
  title: string;
  artist: string;
  image: string | null;
  // width / height of the source image, when known (Bluesky reports it). Album
  // covers are square, so this is left undefined for them.
  aspect?: number;
  // Where it sat in the list it came from: the album shelf's order, the
  // picklist's, or — for cards — most valuable first.
  rank?: number;
  card?: CardInfo;
};

// What a card tile knows about itself beyond its caption, for sorting,
// filtering and the tooltip.
type CardInfo = {
  name: string;
  number: string;
  set: string;
  // The set's release date, "YYYY/MM/DD", when the binder knows it.
  released: string;
  rarity: string;
  quantity: number;
};

type AlbumTilePosition = {
  x: number;
  y: number;
  rot: number;
};

const ALBUM_COVERS: AlbumCover[] = [
  // Fallback when /public/collections/content.json is missing.
];
const EMPTY_ALBUM: AlbumCover = { title: "no albums found", artist: "collections/content.json", image: null };
const EMPTY_PAINTING: AlbumCover = { title: "no paintings found", artist: "collections/paintings.json", image: null };
const EMPTY_SONG: AlbumCover = { title: "no songs found", artist: "collections/songs.json", image: null };
const EMPTY_CARD: AlbumCover = { title: "no cards found", artist: "collections/cards.json", image: null };
const BLUESKY_ACTOR = "mrwr.dev";
// Hand-picked Bluesky post lists (gitignored, like content.json). Each is a JSON
// array of post links — https://bsky.app/profile/<handle>/post/<rkey> — in the
// order they should appear. The window pulls the images out of those posts.
const PAINTINGS_PICKLIST = "/collections/paintings.json";
const SONGS_PICKLIST = "/collections/songs.json";
// Pokémon cards, scraped off artofpkm.com and copied into public/collections/
// by scripts/content/refresh-pokemon-cards.sh. Gitignored and local, like the
// album covers — no runtime call goes out for these.
const CARDS_FILE = "/collections/cards.json";
const CARDS_IMAGE_DIR = "/collections/cards";
const MAX_PICKED = 72;
const FEED_PAGES = 4;
// Pointer travel (px) before a press on a tile counts as a drag rather than a tap.
const DRAG_THRESHOLD = 4;
// Height of the desktop taskbar; desktop-scattered tiles stay below it.
const TASKBAR_H = 50;
// The desktop tile portal floats above windows (Z.WINDOW) but below the taskbar
// and Start menu.
const DESKTOP_TILE_Z = 500;

function shuffleAlbums(input: AlbumCover[]): AlbumCover[] {
  const next = [...input];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function getSizedCover(image: string | null, size: "low" | "normal" | "high"): string | null {
  if (!image) return null;
  // Card scans are downloaded in two sizes side by side: a thumbnail for the
  // scattered tiles and the full scan for the frame.
  if (image.includes(`${CARDS_IMAGE_DIR}/`)) {
    return size === "low" ? image.replace(/-large\.(\w+)$/, "-small.$1") : image;
  }
  if (image.includes("/feed_fullsize/")) {
    return size === "low" ? image.replace("/feed_fullsize/", "/feed_thumbnail/") : image;
  }
  if (!image.includes("/front-500")) return image;
  if (size === "high") return image.replace("/front-500", "/front-1200");
  if (size === "low") return image.replace("/front-500", "/front-250");
  return image;
}

function normalizeAlbumsPayload(payload: unknown): AlbumCover[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      artist: typeof entry.artist === "string" ? entry.artist.trim() : "",
      image: typeof entry.image === "string" && entry.image.trim() ? entry.image.trim() : null,
    }))
    .filter((entry) => entry.title.length > 0 && entry.artist.length > 0)
    .map((entry, rank) => ({ ...entry, rank }));
}

function readString(entry: Record<string, unknown>, key: string): string {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
}

// Newer cards.json files spell out each card's name, number, set and rarity;
// older ones only have the caption, "Name · 001/100" over "Set · Rarity · ×2",
// so pull it back apart from that.
function readCardInfo(entry: Record<string, unknown>, title: string, artist: string): CardInfo {
  const [captionName = "", captionNumber = ""] = title.split(" · ");
  const credit = artist.split(" · ");
  const qtyPart = credit.find((part) => /^×\d+$/.test(part));
  const [captionSet = "", captionRarity = ""] = credit.filter((part) => part !== qtyPart);
  const quantity = typeof entry.quantity === "number" && entry.quantity > 0 ? entry.quantity : Number(qtyPart?.slice(1) ?? 1);
  return {
    name: readString(entry, "name") || captionName,
    number: readString(entry, "number") || captionNumber,
    set: readString(entry, "set") || captionSet.replace(/…$/, ""),
    released: readString(entry, "released"),
    rarity: readString(entry, "rarity") || captionRarity.replace(/…$/, ""),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
  };
}

// Card tiles are written by scripts/content/refresh-pokemon-cards.mjs: a title,
// a credit line, a local image path and the scan's own aspect ratio. Unlike an
// album, a card with no credit still belongs on the shelf.
function normalizeCardsPayload(payload: unknown): AlbumCover[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      artist: typeof entry.artist === "string" ? entry.artist.trim() : "",
      image: typeof entry.image === "string" && entry.image.trim() ? entry.image.trim() : null,
      aspect: typeof entry.aspect === "number" && entry.aspect > 0 ? entry.aspect : undefined,
      card: entry,
    }))
    .filter((entry) => entry.title.length > 0 && entry.image !== null)
    .map(({ card, ...entry }, rank) => ({ ...entry, rank, card: readCardInfo(card, entry.title, entry.artist) }));
}

type BlueskyImage = { thumb?: unknown; thumbnail?: unknown; fullsize?: unknown; alt?: unknown; aspectRatio?: unknown };

function readAspectRatio(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { width, height } = value as { width?: unknown; height?: unknown };
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return width / height;
  }
  return undefined;
}

// A feed item's reply.root is the post that started the thread; return its text.
function readRootPostText(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const root = (item as { reply?: { root?: unknown } }).reply?.root;
  if (!root || typeof root !== "object") return "";
  const rootRecord = (root as { record?: unknown }).record;
  if (!rootRecord || typeof rootRecord !== "object") return "";
  const t = (rootRecord as { text?: unknown }).text;
  return typeof t === "string" ? t.trim() : "";
}

function collectBlueskyEmbedImages(embed: unknown): BlueskyImage[] {
  if (!embed || typeof embed !== "object") return [];
  const record = embed as Record<string, unknown>;
  // Classic image embeds, and the newer multi-image "gallery" embed.
  if (Array.isArray(record.images)) return record.images as BlueskyImage[];
  if (Array.isArray(record.items)) return record.items as BlueskyImage[];
  const media = record.media;
  if (media && typeof media === "object") {
    const inner = media as Record<string, unknown>;
    if (Array.isArray(inner.images)) return inner.images as BlueskyImage[];
    if (Array.isArray(inner.items)) return inner.items as BlueskyImage[];
  }
  return [];
}

type BlueskyPost = { rkey: string; images: AlbumCover[] };

// Pull the trailing record key out of a bsky.app permalink, an at:// URI, or a
// bare rkey.
function extractPostRkey(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/([A-Za-z0-9]+)\/*$/);
  return match ? match[1] : "";
}

// A picklist is a JSON array of post links (or { post: "<link>" } objects, or
// bare rkeys). Returns the rkeys in the given order.
function parsePicklist(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).post === "string") {
        return (entry as Record<string, unknown>).post as string;
      }
      return "";
    })
    .map(extractPostRkey)
    .filter((rkey) => rkey.length > 0);
}

function extractBlueskyPosts(payload: unknown): BlueskyPost[] {
  if (!payload || typeof payload !== "object") return [];
  const feed = (payload as { feed?: unknown }).feed;
  if (!Array.isArray(feed)) return [];
  const posts: BlueskyPost[] = [];
  for (const item of feed) {
    // Skip reposts — only surface the account's own posts.
    if (item && typeof item === "object" && (item as { reason?: unknown }).reason) continue;
    const post = (item as { post?: unknown }).post;
    if (!post || typeof post !== "object") continue;
    const postRecord = post as Record<string, unknown>;
    const rkey = typeof postRecord.uri === "string" ? extractPostRkey(postRecord.uri) : "";
    if (!rkey) continue;
    const record = (postRecord.record ?? {}) as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    // Many paintings are posted as replies under a titled "teaser" post — name
    // the tile after that root post rather than the reply's own caption.
    const rootText = readRootPostText(item);
    const name = rootText || text;
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    const when = createdAt ? createdAt.slice(0, 10) : "@mrwr.dev";
    const images: AlbumCover[] = [];
    for (const img of collectBlueskyEmbedImages(postRecord.embed)) {
      const src =
        typeof img.fullsize === "string"
          ? img.fullsize
          : typeof img.thumbnail === "string"
            ? img.thumbnail
            : typeof img.thumb === "string"
              ? img.thumb
              : null;
      if (!src) continue;
      const alt = typeof img.alt === "string" ? img.alt.trim() : "";
      const label = name || alt || "untitled";
      images.push({
        title: label.length > 60 ? `${label.slice(0, 57)}…` : label,
        artist: when,
        image: src,
        aspect: readAspectRatio(img.aspectRatio),
      });
    }
    if (images.length > 0) posts.push({ rkey, images });
  }
  return posts;
}

type Rect = { x: number; y: number; w: number; h: number };

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Deal tiles onto open ground. Each tile tries a handful of random spots and
// keeps the one that covers the least of anything in `avoid` (the windows on
// the desktop, or the centre frame), with tiles already dealt counting for far
// less — so the pile prefers bare desktop, spreads out while there is room, and
// only ends up on a window when there is nowhere else left.
function scatterTiles(
  boxes: { w: number; h: number }[],
  field: { width: number; height: number; insetTop: number },
  avoid: Rect[],
  placed: Rect[] = []
): AlbumTilePosition[] {
  const minX = 6;
  const minY = 6 + field.insetTop;
  const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
  const occupied = placed.slice();
  return boxes.map((box) => {
    const maxX = Math.max(minX, field.width - box.w - 6);
    const maxY = Math.max(minY, field.height - box.h - 6);
    let best = { x: minX, y: minY };
    let bestScore = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const x = rand(minX, maxX);
      const y = rand(minY, maxY);
      const margin = { x: x - 4, y: y - 4, w: box.w + 8, h: box.h + 8 };
      let score = 0;
      for (const r of avoid) score += overlapArea(margin, r) * 8;
      for (const r of occupied) score += overlapArea(margin, r);
      if (score < bestScore) {
        best = { x, y };
        bestScore = score;
        if (score === 0) break;
      }
    }
    occupied.push({ x: best.x, y: best.y, w: box.w, h: box.h });
    return { x: best.x, y: best.y, rot: rand(-8, 8) };
  });
}

// Where every tile was left, per tab, so a reload — or a resize, a trip to
// another tab, or maximizing the window — puts them all back rather than
// dealing a fresh pile. A pile is only ever dealt the first time a tab is
// opened (or on Shuffle). Positions are kept as fractions of the screen, so a
// different screen size stretches the arrangement instead of scrambling it.
const TILE_LAYOUT_KEY = "mrwr:collections";

type SavedTile = { x: number; y: number; rot: number; z: number };
type SavedLayout = { tiles: Record<string, SavedTile>; active?: string };

// The parsed store, kept in memory too, so a browser that refuses localStorage
// still holds its tiles still for as long as the page is open.
let savedLayoutsCache: Record<string, SavedLayout> | null = null;

function readSavedLayouts(): Record<string, SavedLayout> {
  if (savedLayoutsCache) return savedLayoutsCache;
  const layouts: Record<string, SavedLayout> = {};
  try {
    const raw = window.localStorage.getItem(TILE_LAYOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [slot, value] of Object.entries(parsed as Record<string, unknown>)) {
        const rawTiles = (value as { tiles?: unknown } | null)?.tiles;
        if (!rawTiles || typeof rawTiles !== "object") continue;
        const tiles: Record<string, SavedTile> = {};
        for (const [key, tile] of Object.entries(rawTiles as Record<string, unknown>)) {
          const t = tile as Partial<SavedTile> | null;
          if (!t || ![t.x, t.y, t.rot, t.z].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
          tiles[key] = { x: t.x!, y: t.y!, rot: t.rot!, z: t.z! };
        }
        const active = (value as { active?: unknown }).active;
        layouts[slot] = { tiles, active: typeof active === "string" ? active : undefined };
      }
    }
  } catch {
    // Unreadable or blocked — start from an empty desktop.
  }
  savedLayoutsCache = layouts;
  return layouts;
}

function writeSavedLayout(slot: string, layout: SavedLayout | null) {
  const layouts = { ...readSavedLayouts() };
  if (layout) layouts[slot] = layout;
  else delete layouts[slot];
  savedLayoutsCache = layouts;
  try {
    window.localStorage.setItem(TILE_LAYOUT_KEY, JSON.stringify(layouts));
  } catch {
    // Full or blocked — the in-memory copy still holds for this visit.
  }
}

// Tiles are keyed by what they show, not by index: Albums comes back in a new
// order every load. An album goes by its name, since whether its cover is
// found (and where) can change from one load to the next; everything else by
// its picture, since one post can carry several.
function tileKey(entry: AlbumCover, category: CollectionCategory): string {
  return category === "albums" || !entry.image ? `${entry.artist}|${entry.title}` : entry.image;
}

// The deal: fresh tiles fly out from the middle of the collections window, one
// after another, to wherever they were dealt.
const DEAL_MS = 800;
const DEAL_STAGGER_MS = 22;

// Size a box of the given aspect ratio so its longest edge is `size`. Undefined
// aspect (album covers) stays square.
function fitBox(size: number, aspect: number | undefined): { w: number; h: number } {
  const a = aspect && aspect > 0 ? aspect : 1;
  return a >= 1 ? { w: size, h: Math.round(size / a) } : { w: Math.round(size * a), h: size };
}

// Largest box of the given aspect ratio that fits inside `room` — how the
// frame grows to whatever space the window actually has.
function fitWithin(room: { w: number; h: number }, aspect: number | undefined): { w: number; h: number } {
  const a = aspect && aspect > 0 ? aspect : 1;
  const w = Math.min(room.w, room.h * a);
  return { w: Math.round(w), h: Math.round(w / a) };
}

// Sorting. Picking a sort is Windows' "Arrange Icons by": the tiles slide into
// rows across the desktop in that order, and the window's ◀ ▶ step through
// them the same way. They can still be dragged anywhere afterwards; Shuffle
// throws them back into a heap.
type SortKey = "value" | "name" | "set" | "rarity" | "shelf" | "artist" | "title" | "newest" | "oldest";

const SORTS: Record<CollectionCategory, { key: SortKey; label: string }[]> = {
  cards: [
    { key: "value", label: "Value" },
    { key: "name", label: "Name" },
    { key: "set", label: "Set" },
    { key: "rarity", label: "Rarity" },
  ],
  albums: [
    { key: "shelf", label: "Shelf order" },
    { key: "artist", label: "Artist" },
    { key: "title", label: "Title" },
  ],
  paintings: [
    { key: "newest", label: "Newest" },
    { key: "oldest", label: "Oldest" },
    { key: "title", label: "Title" },
  ],
  songs: [
    { key: "newest", label: "Newest" },
    { key: "oldest", label: "Oldest" },
    { key: "title", label: "Title" },
  ],
};

// Rarest at the top. The binder's rarity names change from era to era, so
// match on the words that mean the same thing in every one of them; the first
// pattern that matches wins.
const RARITY_LADDER: [RegExp, number][] = [
  [/mega hyper/i, 11],
  [/hyper|secret|rainbow|gold/i, 10],
  [/special illustration/i, 9],
  [/illustration|pikachu/i, 8],
  [/ultra|shiny|full art|trainer gallery/i, 7],
  [/amazing|ace spec|radiant|prism/i, 6],
  [/double/i, 5],
  [/holo\s+\S+|\bex\b|\bgx\b|\bv(max|star)?\b/i, 4],
  [/holo|promo/i, 3],
  [/uncommon/i, 1],
  [/common/i, 0],
  [/rare/i, 2],
];

function rarityRank(rarity: string): number {
  for (const [pattern, rank] of RARITY_LADDER) if (pattern.test(rarity)) return rank;
  return 4;
}

// "094/088" and "TG05" alike: by the digits first, then as written.
function compareCardNumbers(a: string, b: string): number {
  const na = parseInt(a.replace(/^\D+/, ""), 10);
  const nb = parseInt(b.replace(/^\D+/, ""), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

// Paintings and songs carry the day they were posted as their second line.
function postedOn(entry: AlbumCover): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(entry.artist) ? entry.artist : "";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-08-10" → "August 2026".
function postedMonth(entry: AlbumCover): string {
  const date = postedOn(entry);
  return date ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : "";
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

function compareTiles(a: AlbumCover, b: AlbumCover, key: SortKey): number {
  const byRank = (a.rank ?? 0) - (b.rank ?? 0);
  switch (key) {
    case "name":
      return (
        byText(a.card?.name ?? a.title, b.card?.name ?? b.title) ||
        compareCardNumbers(a.card?.number ?? "", b.card?.number ?? "") ||
        byRank
      );
    case "set": {
      // Newest set first; a set with no release date on record goes last.
      const ra = a.card?.released ?? "";
      const rb = b.card?.released ?? "";
      if (ra !== rb) return !ra ? 1 : !rb ? -1 : rb.localeCompare(ra);
      return (
        byText(a.card?.set ?? "", b.card?.set ?? "") ||
        compareCardNumbers(a.card?.number ?? "", b.card?.number ?? "") ||
        byRank
      );
    }
    case "rarity":
      return rarityRank(b.card?.rarity ?? "") - rarityRank(a.card?.rarity ?? "") || byRank;
    case "artist":
      return byText(a.artist, b.artist) || byText(a.title, b.title);
    case "title":
      return byText(a.title, b.title) || byRank;
    case "newest":
    case "oldest": {
      const da = postedOn(a);
      const db = postedOn(b);
      if (da === db) return byRank;
      if (!da || !db) return !da ? 1 : -1;
      return key === "newest" ? db.localeCompare(da) : da.localeCompare(db);
    }
    default:
      return byRank;
  }
}

// Filtering: words typed into the box (every one has to turn up somewhere in
// the tile's caption), and one pick from the Filter menu, which offers
// whatever the tab's tiles can be grouped by.
type Facet = { kind: string; value: string };

const FACETS: Record<CollectionCategory, { kind: string; label: string; of: (entry: AlbumCover) => string }[]> = {
  cards: [
    { kind: "rarity", label: "Rarity", of: (entry) => entry.card?.rarity ?? "" },
    { kind: "set", label: "Set", of: (entry) => entry.card?.set ?? "" },
  ],
  albums: [{ kind: "artist", label: "Artist", of: (entry) => entry.artist }],
  paintings: [{ kind: "month", label: "Month", of: (entry) => postedMonth(entry) }],
  songs: [{ kind: "month", label: "Month", of: (entry) => postedMonth(entry) }],
};

type CollectionView = { sort?: SortKey; query?: string; facet?: Facet };

function matchesView(entry: AlbumCover, category: CollectionCategory, view: CollectionView): boolean {
  if (view.facet) {
    const facet = FACETS[category].find((f) => f.kind === view.facet!.kind);
    if (facet && facet.of(entry) !== view.facet.value) return false;
  }
  const words = (view.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const card = entry.card;
  const haystack = [entry.title, entry.artist, card?.set, card?.rarity, card?.released?.slice(0, 4)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// The sort and filter each tab was left with, kept apart from the tile layout.
const VIEW_KEY = "mrwr:collections:view";

function readSavedViews(): Partial<Record<CollectionCategory, CollectionView>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const views: Partial<Record<CollectionCategory, CollectionView>> = {};
    for (const category of Object.keys(SORTS) as CollectionCategory[]) {
      const raw = (parsed as Record<string, unknown>)[category] as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== "object") continue;
      const sort = SORTS[category].find((s) => s.key === raw.sort)?.key;
      const query = typeof raw.query === "string" ? raw.query : undefined;
      const f = raw.facet as Partial<Facet> | undefined;
      const facet =
        f && typeof f.kind === "string" && typeof f.value === "string" ? { kind: f.kind, value: f.value } : undefined;
      views[category] = { sort, query, facet };
    }
    return views;
  } catch {
    return {};
  }
}

function writeSavedViews(views: Partial<Record<CollectionCategory, CollectionView>>) {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(views));
  } catch {
    // Full or blocked — the view still holds for this visit.
  }
}

// Rows of tiles from the top left, in reading order, the way the desktop lines
// up its own icons — stepping around any window in the way while there is bare
// desktop left, and only then laying tiles over windows.
function gridTiles(
  boxes: { w: number; h: number }[],
  field: { width: number; height: number; insetTop: number },
  avoid: Rect[]
): AlbumTilePosition[] {
  if (boxes.length === 0) return [];
  const gap = 10;
  const pitch = Math.max(...boxes.map((b) => Math.max(b.w, b.h))) + gap;
  const left = 12;
  const top = field.insetTop + 12;
  const cols = Math.max(1, Math.floor((field.width - left * 2 + gap) / pitch));
  const rows = Math.max(1, Math.floor((field.height - top - 12 + gap) / pitch));
  const cells: { x: number; y: number; free: boolean; order: number }[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = { x: left + c * pitch, y: top + r * pitch, w: pitch - gap, h: pitch - gap };
      cells.push({ x: cell.x, y: cell.y, free: !avoid.some((a) => overlapArea(cell, a) > 0), order: cells.length });
    }
  }
  const free = cells.filter((cell) => cell.free);
  const chosen =
    free.length >= boxes.length
      ? free.slice(0, boxes.length)
      : [...free, ...cells.filter((cell) => !cell.free).slice(0, boxes.length - free.length)].sort(
          (a, b) => a.order - b.order
        );
  const span = pitch - gap;
  return boxes.map((box, i) => {
    // More tiles than the screen has room for: deal the rest onto the grid
    // again, nudged so the second layer still shows the first.
    const cell = chosen[i % chosen.length];
    const layer = Math.floor(i / chosen.length);
    return {
      x: cell.x + (span - box.w) / 2 + layer * 6,
      y: cell.y + (span - box.h) / 2 + layer * 6,
      rot: 0,
    };
  });
}

// The tooltip a desktop tile shows when the mouse rests on it: the caption,
// and for a card everything the binder says about it.
function tileDetails(entry: AlbumCover): string[] {
  const card = entry.card;
  if (!card) return [entry.title, entry.artist].filter(Boolean);
  const year = card.released.slice(0, 4);
  return [
    card.name,
    [card.number && `No. ${card.number}`, card.set, year && `(${year})`].filter(Boolean).join(" "),
    [card.rarity, card.quantity > 1 ? `×${card.quantity}` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

// Two crossed arrows, drawn on a 16px grid in the same flat black as the
// title-bar glyphs.
function ShuffleIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges" style={{ display: "block" }}>
      <path d="M1 4.5h3l6 7h2M1 11.5h3l6-7h2" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M12 1.5l3 3-3 3zM12 8.5l3 3-3 3z" fill="currentColor" />
    </svg>
  );
}

// Three rows of little tiles, short to long: icons arranged in order.
function SortIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges" style={{ display: "block" }}>
      <path d="M1 2h3v3H1zM1 7h3v3H1zM6 7h3v3H6zM1 12h3v3H1zM6 12h3v3H6zM11 12h3v3h-3z" fill="currentColor" />
    </svg>
  );
}

// The pale yellow balloon Windows hangs under a desktop icon: below the tile,
// or above it near the bottom of the screen, and nudged back on screen at the
// sides.
function TileTooltip({ anchor, lines }: { anchor: { x: number; y: number; w: number; h: number }; lines: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 4;
    const below = anchor.y + anchor.h + 6;
    setAt({
      left: Math.max(margin, Math.min(anchor.x + anchor.w / 2 - width / 2, window.innerWidth - width - margin)),
      top: below + height > window.innerHeight - margin ? Math.max(margin, anchor.y - height - 6) : below,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.x, anchor.y, anchor.w, anchor.h, lines.join("\n")]);

  return (
    <div
      ref={ref}
      role="tooltip"
      style={{
        position: "absolute",
        left: at?.left ?? anchor.x,
        top: at?.top ?? anchor.y + anchor.h + 6,
        visibility: at ? "visible" : "hidden",
        zIndex: 100000,
        maxWidth: 260,
        padding: "2px 5px",
        background: "#ffffe1",
        color: "#000",
        border: "1px solid #000",
        boxShadow: "1px 1px 0 #00000055",
        fontSize: 12,
        lineHeight: 1.35,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {lines.map((line, index) => (
        <div key={index} style={{ fontWeight: index === 0 ? 700 : undefined, overflow: "hidden", textOverflow: "ellipsis" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

// A small solid arrowhead, pointing right — or left, flipped.
function StepIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges" style={{ display: "block" }}>
      <path d={flip ? "M10 4v8L6 8z" : "M6 4v8l4-4z"} fill="currentColor" />
    </svg>
  );
}

// A funnel.
function FilterIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges" style={{ display: "block" }}>
      <path d="M1 2h14v2l-5 5v5l-4 1V9L1 4z" fill="currentColor" />
    </svg>
  );
}

export default function DocumentWindow({
  id,
  layout,
  stackIndex = 0,
  active = true,
  onFocus,
  cascadeX = 0,
  cascadeY = 0,
  box = null,
  onBoxChange,
  onClose,
  onMinimize,
  onToggleMaximize,
}: DocumentWindowProps) {
  const [activeAlbum, setActiveAlbum] = useState(0);
  const [category, setCategory] = useState<CollectionCategory>("cards");
  const [albums, setAlbums] = useState<AlbumCover[]>(ALBUM_COVERS);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  // Which tab the tiles in `albums` belong to. Switching tabs renders once with
  // the old tab's tiles still loaded; laying those out (and saving them) under
  // the new tab's name would overwrite where its own tiles were left.
  const [albumsCategory, setAlbumsCategory] = useState<CollectionCategory | null>(null);
  const title = programDef(id).title;
  const titleIcon = programDef(id).icon;
  const emptyEntry =
    category === "paintings"
      ? EMPTY_PAINTING
      : category === "songs"
        ? EMPTY_SONG
        : category === "cards"
          ? EMPTY_CARD
          : EMPTY_ALBUM;
  const dealTimerRef = useRef<number | null>(null);
  // Each tab's sort and filter. The tiles on screen are filtered by the view
  // of the tab they belong to, which for a moment after switching is not the
  // tab whose button is pressed.
  const [views, setViews] = useState<Partial<Record<CollectionCategory, CollectionView>>>({});
  const view = views[category] ?? {};
  const tilesCategory = albumsCategory ?? category;
  const tilesView = views[tilesCategory];
  const visible = useMemo(
    () => albums.map((entry) => matchesView(entry, tilesCategory, tilesView ?? {})),
    [albums, tilesCategory, tilesView]
  );
  const orderFor = (key: SortKey | undefined) =>
    albums
      .map((_, index) => index)
      .filter((index) => visible[index])
      .sort((a, b) => compareTiles(albums[a], albums[b], key ?? "shelf"));
  // The order ◀ ▶ step through: the tab's sort, or the list's own order.
  const listOrder = useMemo(
    () => orderFor(tilesView?.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [albums, visible, tilesView?.sort]
  );
  const filtered = !!(tilesView?.query?.trim() || tilesView?.facet);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[]; label: string } | null>(null);
  // The tile the mouse is resting on, once it has rested long enough.
  const [hoverTile, setHoverTile] = useState<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  // The frame keeps to what the filter lets through; with nothing let through
  // it says so rather than showing a tile that isn't on the desktop.
  const album: AlbumCover =
    albums.length > 0 && !visible.some(Boolean)
      ? { title: "nothing matches", artist: "clear the filter to see them all", image: null }
      : albums[activeAlbum] ?? emptyEntry;
  const iconSize = 42;
  // The tiles are flung across the whole desktop via a portal that floats above
  // the window chrome — maximized or not, they are the same tiles in the same
  // places. Minimized, they go away with the window.
  const scatterToDesktop = id === "collections" && layout !== "minimized";
  const albumsSceneRef = useRef<HTMLDivElement | null>(null);
  const [albumsSceneSize, setAlbumsSceneSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // The centre frame and the scattered tiles take each picture's own
  // proportions when we know them (cards, paintings), so nothing gets cropped.
  // Album covers have no aspect data and stay square.
  //
  // The tiles are out on the desktop, so the picture takes the whole scene and
  // grows and shrinks with the window. Until the scene has been measured it
  // falls back to the size the window opens at.
  const frameRoom =
    albumsSceneSize.width > 0 && albumsSceneSize.height > 0
      ? { w: Math.max(60, albumsSceneSize.width - 12), h: Math.max(60, albumsSceneSize.height - 12) }
      : { w: 144, h: 144 };
  const { w: frameWidth, h: frameHeight } = fitWithin(frameRoom, album.aspect);
  // The small scan is plenty for a small frame; a big one gets the full scan.
  const albumImage = getSizedCover(album.image, Math.max(frameWidth, frameHeight) > 300 ? "high" : "low");
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [albumTilePositions, setAlbumTilePositions] = useState<AlbumTilePosition[]>([]);
  // Stacking order, like windows on the desktop: whatever you touched last sits
  // on top of everything, and stays there once you let go.
  const [albumTileStack, setAlbumTileStack] = useState<number[]>([]);
  const albumTileStackTopRef = useRef(1);
  const draggingAlbumIndexRef = useRef<number | null>(null);
  const draggingOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  // Bumped by the Shuffle button: the one thing that deals a pile from scratch
  // once it has been laid out.
  const [shuffleCount, setShuffleCount] = useState(0);
  // What the tiles on screen were last laid out for, so a resize can tell it
  // only needs to stretch them back into place rather than deal them again.
  const placedForRef = useRef<{ albums: AlbumCover[]; slot: string; shuffle: number } | null>(null);
  const layoutSlot: string = category;
  // While a pile is being dealt: each fresh tile's place in the deal, and
  // whether they are still gathered in the middle or on their way out.
  const [deal, setDeal] = useState<{ order: Map<number, number>; phase: "gather" | "spread" } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setViews(readSavedViews());
    return () => {
      if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current);
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const updateView = (patch: Partial<CollectionView>) =>
    setViews((prev) => {
      const next = { ...prev, [category]: { ...prev[category], ...patch } };
      writeSavedViews(next);
      return next;
    });

  useEffect(() => {
    setPortalHost(document.body);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (id !== "collections") return;
    let cancelled = false;
    setAlbumsLoading(true);
    setActiveAlbum(0);

    async function resolveCover(entry: AlbumCover): Promise<AlbumCover> {
      const verifyImage = async (url: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const probe = new Image();
          const timeout = window.setTimeout(() => resolve(false), 7000);
          probe.onload = () => {
            window.clearTimeout(timeout);
            resolve(true);
          };
          probe.onerror = () => {
            window.clearTimeout(timeout);
            resolve(false);
          };
          probe.src = url;
        });
      };

      try {
        if (entry.image) {
          const preferred = getSizedCover(entry.image, "low") ?? entry.image;
          const ok = await verifyImage(preferred);
          return ok ? entry : { ...entry, image: null };
        }

        const query = `releasegroup:"${entry.title}" AND artist:"${entry.artist}"`;
        const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
        const response = await fetch(url);
        if (!response.ok) return entry;
        const payload = (await response.json()) as { "release-groups"?: Array<{ id?: string }> };
        const releaseGroupId = payload["release-groups"]?.[0]?.id;
        if (!releaseGroupId) return entry;
        const resolvedImage = `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`;
        const ok = await verifyImage(getSizedCover(resolvedImage, "low") ?? resolvedImage);
        if (!ok) return entry;
        return {
          ...entry,
          image: resolvedImage,
        };
      } catch {
        return entry;
      }
    }

    async function loadAlbumsSource(): Promise<AlbumCover[]> {
      let sourceAlbums = ALBUM_COVERS;
      try {
        const privateResponse = await fetch("/collections/content.json", { cache: "no-store" });
        if (privateResponse.ok) {
          const privatePayload = (await privateResponse.json()) as unknown;
          const parsedPrivate = normalizeAlbumsPayload(privatePayload);
          if (parsedPrivate.length > 0) {
            sourceAlbums = parsedPrivate;
          }
        }
      } catch {
        // fall through to bundled fallback list
      }
      const shuffled = shuffleAlbums(sourceAlbums);
      return Promise.all(shuffled.map(resolveCover));
    }

    // Cards are already resolved on disk — the refresh script did the scraping
    // and the downloading, so there is nothing to look up here.
    async function loadCards(): Promise<AlbumCover[]> {
      try {
        const response = await fetch(CARDS_FILE, { cache: "no-store" });
        if (!response.ok) return [];
        return normalizeCardsPayload((await response.json()) as unknown);
      } catch {
        return [];
      }
    }

    // Paintings and Songs both come from a hand-picked list of Bluesky posts.
    // Walk the author feed (a few pages if needed) collecting the picked posts,
    // then emit their images in picklist order.
    async function loadPickedPosts(picklistFile: string): Promise<AlbumCover[]> {
      try {
        const picklistResponse = await fetch(picklistFile, { cache: "no-store" });
        if (!picklistResponse.ok) return [];
        const rkeys = parsePicklist((await picklistResponse.json()) as unknown);
        if (rkeys.length === 0) return [];

        const wanted = new Set(rkeys);
        const imagesByRkey = new Map<string, AlbumCover[]>();
        let cursor: string | undefined;
        for (let page = 0; page < FEED_PAGES && imagesByRkey.size < wanted.size; page += 1) {
          const url =
            `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(BLUESKY_ACTOR)}` +
            `&limit=100&filter=posts_with_media${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const response = await fetch(url);
          if (!response.ok) break;
          const payload = (await response.json()) as { cursor?: unknown };
          for (const post of extractBlueskyPosts(payload)) {
            if (wanted.has(post.rkey) && !imagesByRkey.has(post.rkey)) {
              imagesByRkey.set(post.rkey, post.images);
            }
          }
          cursor = typeof payload.cursor === "string" ? payload.cursor : undefined;
          if (!cursor) break;
        }

        const tiles: AlbumCover[] = [];
        for (const rkey of rkeys) {
          const images = imagesByRkey.get(rkey);
          if (images) tiles.push(...images);
        }
        return tiles.slice(0, MAX_PICKED).map((tile, rank) => ({ ...tile, rank }));
      } catch {
        return [];
      }
    }

    async function load() {
      try {
        const next =
          category === "paintings"
            ? await loadPickedPosts(PAINTINGS_PICKLIST)
            : category === "songs"
              ? await loadPickedPosts(SONGS_PICKLIST)
              : category === "cards"
                ? await loadCards()
                : await loadAlbumsSource();
        if (!cancelled) {
          setAlbums(next);
          setAlbumsCategory(category);
        }
      } catch (error) {
        console.error("Failed to load collection tiles:", error);
      } finally {
        if (!cancelled) setAlbumsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, category]);

  useEffect(() => {
    if (id !== "collections") return;
    const node = albumsSceneRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setAlbumsSceneSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [id]);

  // Where the tiles live: a fixed portal pinned to the viewport origin, kept
  // below the taskbar.
  const getScatterField = () => ({
    originLeft: 0,
    originTop: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    insetTop: TASKBAR_H,
  });

  const clampTilePosition = (x: number, y: number, tileW: number, tileH: number) => {
    const field = getScatterField();
    const minX = 6;
    const minY = 6 + field.insetTop;
    const maxX = Math.max(minX, field.width - tileW - 6);
    const maxY = Math.max(minY, field.height - tileH - 6);
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  };

  const fieldWidth = viewportSize.width;
  const fieldHeight = viewportSize.height;

  // What a fresh deal has to keep off: every window on screen, this one
  // included, so the tiles land on bare desktop wherever there is any. (With
  // a window maximized there is none, and they fall where they fall.)
  const getAvoidRects = (): Rect[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-desktop-window="true"]')).map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.left - 12, y: r.top - 12, w: r.width + 24, h: r.height + 24 };
    });

  const saveLayout = (positions: AlbumTilePosition[], stack: number[], active: number) => {
    if (positions.length !== albums.length || placedForRef.current?.slot !== layoutSlot) return;
    const field = getScatterField();
    const width = Math.max(1, field.width);
    const height = Math.max(1, field.height);
    const round = (n: number) => Math.round(n * 10000) / 10000;
    const tiles: Record<string, SavedTile> = {};
    albums.forEach((entry, index) => {
      const pos = positions[index];
      if (!pos) return;
      tiles[tileKey(entry, category)] = {
        x: round(pos.x / width),
        y: round(pos.y / height),
        rot: round(pos.rot),
        z: stack[index] ?? 0,
      };
    });
    writeSavedLayout(layoutSlot, { tiles, active: albums[active] ? tileKey(albums[active], category) : undefined });
  };

  // Lay the tiles out. Tiles that have been placed before go back exactly where
  // they were left (stretched to the space they are in now); only tiles never
  // seen before — or all of them, after Shuffle — are dealt fresh. Resizing the
  // window or the browser, maximizing it, picking a tile, or switching tabs
  // never reshuffles. A layout effect, so a fresh deal is gathered in the
  // middle before the tiles are first painted anywhere else.
  useLayoutEffect(() => {
    // Minimized, the tiles go away with the window; leave the saved layout be.
    if (id !== "collections" || layout === "minimized" || albumsLoading || albums.length === 0) return;
    if (albumsCategory !== category) return;
    // Nothing to lay out into until the space has been measured; placing into
    // a 0×0 field would crush every saved position into the corner.
    if (fieldWidth < iconSize * 2 || fieldHeight < iconSize * 2) return;
    const field = getScatterField();
    const width = field.width;
    const height = field.height;

    const previous = placedForRef.current;
    const reshuffled = previous !== null && previous.shuffle !== shuffleCount;
    // Same tiles, same slot: only the space changed, so keep the selection and
    // the stacking order and just stretch everything back into place.
    const sameDeal = previous !== null && previous.albums === albums && previous.slot === layoutSlot && !reshuffled;
    placedForRef.current = { albums, slot: layoutSlot, shuffle: shuffleCount };

    if (reshuffled) writeSavedLayout(layoutSlot, null);
    const saved = readSavedLayouts()[layoutSlot];
    const boxes = albums.map((entry) => fitBox(iconSize, entry.aspect));

    const positions: (AlbumTilePosition | null)[] = albums.map((entry, index) => {
      const tile = saved?.tiles[tileKey(entry, category)];
      if (!tile) return null;
      const at = clampTilePosition(tile.x * width, tile.y * height, boxes[index].w, boxes[index].h);
      return { ...at, rot: tile.rot };
    });

    const missing = positions.flatMap((pos, index) => (pos ? [] : [index]));
    if (missing.length > 0) {
      const placed = positions.flatMap((pos, index) =>
        pos ? [{ x: pos.x, y: pos.y, w: boxes[index].w, h: boxes[index].h }] : []
      );
      const dealt = scatterTiles(
        missing.map((index) => boxes[index]),
        field,
        getAvoidRects(),
        placed
      );
      missing.forEach((index, i) => {
        positions[index] = dealt[i];
      });
    }
    const next = positions as AlbumTilePosition[];
    if (sameDeal) {
      setDeal(null);
      setAlbumTilePositions(next);
      return;
    }

    // A new deal picks what the frame shows: whatever it showed when this pile
    // was last left, or else the tile that landed nearest the middle.
    let active = saved?.active ? albums.findIndex((entry) => tileKey(entry, category) === saved.active) : -1;
    if (active < 0) {
      let nearestDist = Number.POSITIVE_INFINITY;
      next.forEach((pos, index) => {
        const dist = Math.hypot(pos.x + iconSize / 2 - width / 2, pos.y + iconSize / 2 - height / 2);
        if (dist < nearestDist) {
          nearestDist = dist;
          active = index;
        }
      });
    }
    // Saved stacking order where there is one; a fresh pile lies flat with the
    // one the window is showing on top.
    const stack = albums.map((entry, index) => saved?.tiles[tileKey(entry, category)]?.z ?? (index === active ? 1 : 0));
    albumTileStackTopRef.current = Math.max(1, ...stack);
    setActiveAlbum(active);
    setAlbumTileStack(stack);
    saveLayout(next, stack, active);

    if (missing.length === 0) {
      setDeal(null);
      setAlbumTilePositions(next);
      return;
    }

    // Deal the fresh tiles out of the middle of the collections window: gather
    // them there (no transition), then on the next frame send them off.
    const windowRect = frameRef.current?.closest('[data-desktop-window="true"]')?.getBoundingClientRect();
    const originX = windowRect ? windowRect.left + windowRect.width / 2 - field.originLeft : width / 2;
    const originY = windowRect ? windowRect.top + windowRect.height / 2 - field.originTop : height / 2;
    const order = new Map(missing.map((index, i) => [index, i]));
    setDeal({ order, phase: "gather" });
    setAlbumTilePositions(
      next.map((pos, index) =>
        order.has(index) ? { x: originX - boxes[index].w / 2, y: originY - boxes[index].h / 2, rot: 0 } : pos
      )
    );
    // A beat for the gathered pile to paint, then send it off. Timers rather
    // than animation frames: a tab in the background never gets a frame, and
    // its tiles would sit gathered in the middle until it was looked at.
    const spread = window.setTimeout(() => {
      setDeal({ order, phase: "spread" });
      setAlbumTilePositions(next);
    }, 30);
    const done = window.setTimeout(() => setDeal(null), 30 + DEAL_MS + missing.length * DEAL_STAGGER_MS + 100);
    return () => {
      // Interrupted (a resize, a tab switch): the rerun lays everything out
      // from the saved layout, which already holds where the deal was going.
      window.clearTimeout(spread);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albums, albumsCategory, albumsLoading, id, layout, iconSize, layoutSlot, fieldWidth, fieldHeight, shuffleCount]);

  const endDragBookkeeping = (pointerTarget: EventTarget & Element, pointerId: number) => {
    draggingAlbumIndexRef.current = null;
    draggingOffsetRef.current = null;
    dragStartRef.current = null;
    draggedRef.current = false;
    try {
      (pointerTarget as Element).releasePointerCapture(pointerId);
    } catch {
      // noop
    }
  };

  // Show a tile in the frame and lift it to the top of the pile.
  const selectTile = (index: number) => {
    setActiveAlbum(index);
    albumTileStackTopRef.current += 1;
    const stack = albumTileStack.length === albums.length ? albumTileStack.slice() : albums.map(() => 0);
    stack[index] = albumTileStackTopRef.current;
    setAlbumTileStack(stack);
    saveLayout(albumTilePositions, stack, index);
  };

  const stepTile = (by: 1 | -1) => {
    if (listOrder.length === 0) return;
    const at = listOrder.indexOf(activeAlbum);
    const next = at < 0 ? 0 : (at + by + listOrder.length) % listOrder.length;
    selectTile(listOrder[next]);
  };

  // Slide the given tiles, in order, into rows across the desktop.
  const arrangeTiles = (order: number[]) => {
    if (albumTilePositions.length !== albums.length || order.length === 0) return;
    const boxes = order.map((index) => fitBox(iconSize, albums[index].aspect));
    const spots = gridTiles(boxes, getScatterField(), getAvoidRects());
    const next = albumTilePositions.slice();
    order.forEach((index, i) => {
      next[index] = spots[i];
    });
    setDeal({ order: new Map(order.map((index, i) => [index, i])), phase: "spread" });
    setAlbumTilePositions(next);
    if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current);
    dealTimerRef.current = window.setTimeout(() => setDeal(null), DEAL_MS + order.length * DEAL_STAGGER_MS + 100);
    const active = order.includes(activeAlbum) ? activeAlbum : order[0];
    setActiveAlbum(active);
    saveLayout(next, albumTileStack, active);
  };

  const sortBy = (key: SortKey) => {
    updateView({ sort: key });
    arrangeTiles(orderFor(key));
  };

  const shuffle = () => {
    updateView({ sort: undefined });
    setShuffleCount((n) => n + 1);
  };

  // Whatever the filter hides goes from the frame too: if the tile it was
  // showing is filtered out, it moves on to the first one still shown.
  useEffect(() => {
    if (albumsCategory !== category || listOrder.length === 0 || visible[activeAlbum]) return;
    setActiveAlbum(listOrder[0]);
  }, [albumsCategory, category, listOrder, visible, activeAlbum]);

  // A sorted tab stays sorted as the filter changes: once the typing stops,
  // whatever is still showing closes up into rows again. Only a change of
  // filter does this — not a tab switch, nor the saved view arriving on load.
  const filterSignature = `${albumsCategory}|${tilesView?.query?.trim() ?? ""}|${tilesView?.facet?.kind ?? ""}:${tilesView?.facet?.value ?? ""}`;
  const filterSignatureRef = useRef(filterSignature);
  useEffect(() => {
    const previous = filterSignatureRef.current;
    filterSignatureRef.current = filterSignature;
    if (previous === filterSignature || previous.split("|")[0] !== String(albumsCategory)) return;
    if (!tilesView?.sort) return;
    const timer = window.setTimeout(() => arrangeTiles(listOrder), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  const clearHover = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverTile(null);
  };

  const onAlbumTilePointerEnter = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    // A mouse resting on a tile, the way a desktop icon shows its tooltip; a
    // finger has no hover, and a tile being dragged is already in hand.
    if (event.pointerType !== "mouse" || draggingAlbumIndexRef.current !== null) return;
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHoverTile(index), 450);
  };

  const onAlbumTilePointerDown = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    clearHover();
    if (event.button !== 0) return;
    const pos = albumTilePositions[index];
    if (!pos) return;
    const field = getScatterField();

    selectTile(index);

    draggingAlbumIndexRef.current = index;
    draggedRef.current = false;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    draggingOffsetRef.current = {
      x: event.clientX - field.originLeft - pos.x,
      y: event.clientY - field.originTop - pos.y,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // noop
    }
  };

  const onAlbumTilePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const draggingIndex = draggingAlbumIndexRef.current;
    const offset = draggingOffsetRef.current;
    const start = dragStartRef.current;
    if (draggingIndex === null || !offset || !start) return;

    if (!draggedRef.current) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
      draggedRef.current = true;
    }

    const field = getScatterField();
    const box = fitBox(iconSize, albums[draggingIndex]?.aspect);
    const next = clampTilePosition(
      event.clientX - field.originLeft - offset.x,
      event.clientY - field.originTop - offset.y,
      box.w,
      box.h
    );
    setAlbumTilePositions((prev) =>
      prev.map((pos, index) => (index === draggingIndex ? { ...pos, x: next.x, y: next.y } : pos))
    );
  };

  const onAlbumTilePointerUp = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingAlbumIndexRef.current !== index) return;
    const moved = draggedRef.current;
    endDragBookkeeping(event.currentTarget, event.pointerId);
    if (moved) saveLayout(albumTilePositions, albumTileStack, index);
  };

  const onAlbumTilePointerCancel = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingAlbumIndexRef.current !== index) return;
    const moved = draggedRef.current;
    endDragBookkeeping(event.currentTarget, event.pointerId);
    if (moved) saveLayout(albumTilePositions, albumTileStack, index);
  };

  const renderAlbumTile = (entry: AlbumCover, index: number) => {
    const miniImage = getSizedCover(entry.image, "low");
    const isActive = index === activeAlbum;
    const pos = albumTilePositions[index] ?? { x: 0, y: 0, rot: 0 };
    const tileBox = fitBox(iconSize, entry.aspect);
    const isDraggingThis = draggingAlbumIndexRef.current === index;
    const dealtAt = deal?.order.get(index);
    const dealEase = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const dealDelay = (dealtAt ?? 0) * DEAL_STAGGER_MS;
    return (
      <div
        key={`${index}-${entry.image ?? `${entry.artist}-${entry.title}`}`}
        data-collection-album-tile="true"
        onPointerDown={(event) => onAlbumTilePointerDown(index, event)}
        onPointerMove={onAlbumTilePointerMove}
        onPointerUp={(event) => onAlbumTilePointerUp(index, event)}
        onPointerCancel={(event) => onAlbumTilePointerCancel(index, event)}
        onPointerEnter={(event) => onAlbumTilePointerEnter(index, event)}
        onPointerLeave={clearHover}
        style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          width: tileBox.w,
          height: tileBox.h,
          borderTop: "1px solid #fff",
          borderLeft: "1px solid #fff",
          borderRight: "1px solid #808080",
          borderBottom: "1px solid #808080",
          boxShadow: "1px 1px 0 #00000055",
          background: miniImage ? "#111" : "#5a5a5a",
          overflow: "hidden",
          opacity: isActive ? 1 : 0.8,
          outline: isActive ? "1px solid #0b5ad4" : "none",
          transform: `rotate(${pos.rot}deg)`,
          zIndex: 2 + (albumTileStack[index] ?? 0),
          cursor: isDraggingThis ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
          pointerEvents: "auto",
          // Track the pointer 1:1 while dragging; ease back into place otherwise.
          transition:
            (isDraggingThis && draggedRef.current) || (dealtAt !== undefined && deal?.phase === "gather")
              ? "none"
              : dealtAt !== undefined
                ? ["left", "top", "transform"].map((p) => `${p} ${DEAL_MS}ms ${dealEase} ${dealDelay}ms`).join(", ")
                : "left 180ms ease-out, top 180ms ease-out, transform 180ms ease-out",
        }}
        aria-label={entry.title}
      >
        {miniImage && (
          <img
            src={miniImage}
            alt=""
            // A tile is an icon, not a picture to be carried off: without this
            // the browser hands you the card as a draggable image the moment
            // you pick it up, ghost and all, instead of just moving it.
            draggable={false}
            className="no-drag"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              // Tile box already matches the picture when we know its aspect, so
              // cover fills it exactly; fall back to contain when it is unknown.
              objectFit: entry.aspect ? "cover" : "contain",
              imageRendering: "pixelated",
            }}
          />
        )}
      </div>
    );
  };

  const closeMenu = () => setMenu(null);

  // Menus drop down from under the button that opened them.
  const openMenu = (
    event: React.MouseEvent<HTMLElement>,
    label: string,
    items: (at: { x: number; y: number }) => ContextMenuItem[]
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = { x: rect.left, y: rect.bottom + 2 };
    setMenu({ ...at, label, items: items(at) });
  };

  const checked = (on: boolean, label: React.ReactNode) => (
    <>
      <span style={{ display: "inline-block", width: 16 }}>{on ? "\u2713" : ""}</span>
      {label}
    </>
  );

  const sortItems = (): ContextMenuItem[] => [
    ...SORTS[category].map(({ key, label }) => ({
      label: checked(view.sort === key, label),
      onClick: () => sortBy(key),
    })),
    "separator",
    { label: checked(false, "Shuffle"), onClick: shuffle },
  ];

  // Every value a facet takes across this tab's tiles, with how many have it.
  // Artists only make the list when there's more than one of theirs, or it
  // would just be the whole shelf over again.
  const facetValues = (facet: (typeof FACETS)[CollectionCategory][number]) => {
    const counts = new Map<string, { count: number; sample: AlbumCover }>();
    for (const entry of albums) {
      const value = facet.of(entry);
      if (!value) continue;
      const seen = counts.get(value);
      counts.set(value, { count: (seen?.count ?? 0) + 1, sample: seen?.sample ?? entry });
    }
    const values = [...counts.entries()].filter(([, { count }]) => facet.kind !== "artist" || count > 1);
    const order: SortKey =
      facet.kind === "rarity" ? "rarity" : facet.kind === "set" ? "set" : facet.kind === "month" ? "newest" : "artist";
    return values.sort(([, a], [, b]) => compareTiles(a.sample, b.sample, order));
  };

  const facetItems = (facet: (typeof FACETS)[CollectionCategory][number]): ContextMenuItem[] =>
    facetValues(facet).map(([value, { count }]) => ({
      label: checked(view.facet?.kind === facet.kind && view.facet.value === value, value),
      shortcut: String(count),
      onClick: () => updateView({ facet: { kind: facet.kind, value } }),
    }));

  // A way of grouping is only worth offering if it splits the tiles: one
  // value across the whole tab would just be Show all again.
  const groupings =
    albumsCategory === category ? FACETS[category].filter((facet) => facetValues(facet).length > 1) : [];

  const filterItems = (at: { x: number; y: number }): ContextMenuItem[] => {
    const facets = groupings;
    const showAll: ContextMenuItem = {
      label: checked(!view.facet && !view.query?.trim(), "Show all"),
      shortcut: String(albums.length),
      onClick: () => updateView({ facet: undefined, query: "" }),
    };
    // One way to group: its values straight away. More than one: pick which
    // first, then its values, so no one list runs off the screen.
    if (facets.length === 1) return [showAll, "separator", ...facetItems(facets[0])];
    return [
      showAll,
      "separator",
      ...facets.map((facet) => ({
        label: checked(view.facet?.kind === facet.kind, `${facet.label} \u25b8`),
        // Picking an item closes the menu first, so this one opens in its place.
        onClick: () => setMenu({ ...at, label: facet.label, items: facetItems(facet) }),
      })),
    ];
  };

  return (
    <DesktopWindow
      title={title}
      titleIcon={titleIcon}
      layout={layout}
      stackIndex={stackIndex}
      active={active}
      onFocus={onFocus}
      cascadeX={cascadeX}
      cascadeY={cascadeY}
      box={box}
      onBoxChange={onBoxChange}
      normalHeight={programDef(id).size.height}
      normalWidth={programDef(id).size.width}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      {id === "projects" && <ProjectList layout={layout} />}
      {id === "demos" && <MockupList layout={layout} />}

      {id === "collections" && (
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <div style={{ alignSelf: "stretch", display: "flex", flexWrap: "wrap", gap: 4 }}>
            {([
              { value: "cards", label: "Cards" },
              { value: "albums", label: "Albums" },
              { value: "paintings", label: "Paintings" },
              { value: "songs", label: "Songs" },
            ] as const).map(({ value, label }) => (
              <Button
                key={value}
                size="sm"
                style={{ fontWeight: "bold", padding: "0 7px" }}
                active={category === value}
                onClick={() => setCategory(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div style={{ alignSelf: "stretch", display: "flex", gap: 4 }}>
            <TextInput
              value={view.query ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateView({ query: event.target.value })}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape") updateView({ query: "" });
              }}
              placeholder="Filter…"
              aria-label="Filter"
              spellCheck={false}
              fullWidth
              style={{ flex: "1 1 0", minWidth: 60, height: 28, minHeight: 28 }}
            />
            {(groupings.length > 0 || view.facet) && (
              <Button
                size="sm"
                style={{ flex: "0 0 auto", minWidth: 28, maxWidth: 130, padding: "0 5px", gap: 4 }}
                disabled={albumsLoading || albums.length === 0}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => openMenu(event, "Filter", filterItems)}
                aria-label={view.facet ? `Filter: ${view.facet.value}` : "Filter by"}
                title={view.facet ? `Showing only ${view.facet.value}` : "Filter by"}
                active={!!view.facet}
              >
                <FilterIcon />
                {view.facet && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{view.facet.value}</span>
                )}
              </Button>
            )}
            <Button
              size="sm"
              square
              style={{ flex: "0 0 auto" }}
              disabled={albumsLoading || albums.length === 0}
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => openMenu(event, "Sort by", sortItems)}
              aria-label="Sort"
              title="Sort"
              active={!!menu && menu.label === "Sort by"}
            >
              <SortIcon />
            </Button>
            <Button
              size="sm"
              square
              style={{ flex: "0 0 auto" }}
              disabled={albumsLoading || albums.length === 0}
              onClick={shuffle}
              aria-label="Shuffle"
              title="Shuffle"
            >
              <ShuffleIcon />
            </Button>
          </div>
          {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onDismiss={closeMenu} />}

          <GroupBox
            label={`${
              category === "paintings"
                ? "paints.gif"
                : category === "songs"
                  ? "songs.gif"
                  : category === "cards"
                    ? "cards.gif"
                    : "albums.gif"
            }${filtered && albumsCategory === category && !albumsLoading ? ` · ${listOrder.length} of ${albums.length}` : ""}`}
            style={{ width: "100%", flex: "1 1 auto", minHeight: 0, padding: 4 }}
          >
            <div
              ref={albumsSceneRef}
              style={{
                width: "100%",
                height: "100%",
                minHeight: 176,
                position: "relative",
                overflow: "hidden",
                touchAction: "none",
              }}
            >
              <div
                ref={frameRef}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: frameWidth,
                  height: frameHeight,
                  transform: "translate(-50%, -50%)",
                  boxSizing: "border-box",
                  borderTop: "2px solid #fff",
                  borderLeft: "2px solid #fff",
                  borderRight: "2px solid #808080",
                  borderBottom: "2px solid #808080",
                  background: "#111",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  zIndex: 1,
                }}
              >
                {albumsLoading ? (
                  <Hourglass size={38} />
                ) : (
                  <>
                    {albumImage && (
                      <img
                        src={albumImage}
                        alt={`${album.title} cover`}
                        draggable={false}
                        className="no-drag"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          display: "block",
                        }}
                      />
                    )}
                    {!album.image && (
                      <div style={{ color: "#cfcfcf", fontFamily: "monospace", fontSize: 12 }}>no cover</div>
                    )}
                  </>
                )}
              </div>

            </div>
          </GroupBox>

          {scatterToDesktop &&
            !albumsLoading &&
            portalHost &&
            createPortal(
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: DESKTOP_TILE_Z,
                  pointerEvents: "none",
                }}
              >
                {albums.map((entry, index) => (visible[index] ? renderAlbumTile(entry, index) : null))}
                {hoverTile !== null && visible[hoverTile] && albums[hoverTile] && albumTilePositions[hoverTile] && (
                  <TileTooltip
                    anchor={{ ...albumTilePositions[hoverTile], ...fitBox(iconSize, albums[hoverTile].aspect) }}
                    lines={tileDetails(albums[hoverTile])}
                  />
                )}
              </div>,
              portalHost
            )}
          {/* One line each, whatever the title: a caption that wrapped would
              change the size of the scene above it every time you picked a
              different tile. */}
          <div style={{ alignSelf: "stretch", display: "flex", flex: "0 0 auto", alignItems: "center", gap: 4 }}>
            <Button
              size="sm"
              square
              style={{ flex: "0 0 auto" }}
              disabled={albumsLoading || listOrder.length < 2}
              onClick={() => stepTile(-1)}
              aria-label="Previous"
              title="Previous"
            >
              <StepIcon flip />
            </Button>
            <div style={{ textAlign: "center", flex: "1 1 auto", minWidth: 0 }}>
              {[album.title, album.artist].map((line, index) => (
                <div
                  key={index}
                  title={line}
                  style={{
                    fontWeight: index === 0 ? 700 : undefined,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {line || "\u00a0"}
                </div>
              ))}
            </div>
            <Button
              size="sm"
              square
              style={{ flex: "0 0 auto" }}
              disabled={albumsLoading || listOrder.length < 2}
              onClick={() => stepTile(1)}
              aria-label="Next"
              title="Next"
            >
              <StepIcon />
            </Button>
          </div>
        </div>
      )}

      {(id === "about" || id === "contact") && (
        <div style={{ flex: "1 1 auto", minHeight: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            {id === "about" && (
              <>
                <h1>web app created by Matt Rouse</h1>
                <ul>
                  <li>
                    - built with{" "}
                    <Anchor href="https://nextjs.org/" target="_blank">
                      Next.js
                    </Anchor>{" "}
                    &{" "}
                    <Anchor href="https://react.dev/" target="_blank">
                      React
                    </Anchor>
                  </li>
                  <li>
                    - deployed on{" "}
                    <Anchor href="https://www.digitalocean.com/" target="_blank">
                      DigitalOcean
                    </Anchor>
                  </li>
                  <li>
                    - ui created with{" "}
                    <Anchor href="https://react95.io/" target="_blank">
                      react95
                    </Anchor>
                  </li>
                  <li>
                    - music from{" "}
                    <Anchor href="https://strudel.cc" target="_blank">
                      strudel.cc
                    </Anchor>
                  </li>
                  <li>
                    - fluid from{" "}
                    <Anchor href="https://github.com/PavelDoGreat/WebGL-Fluid-Simulation" target="_blank">
                      PavelDoGreat
                    </Anchor>
                  </li>
                  <li>
                    - trees from{" "}
                    <Anchor href="https://data-seattlecitygis.opendata.arcgis.com/" target="_blank">
                      Seattle GeoData
                    </Anchor>
                  </li>
                  <li>
                    - rats from{" "}
                    <Anchor href="https://www.arcgis.com/home/item.html?id=abb9584e58444baabfc03e269319167c" target="_blank">
                      Seattle Public Utilities
                    </Anchor>
                  </li>
                  <li>
                    - campus from{" "}
                    <Anchor href="https://facilities.uw.edu/services/space/gis-maps" target="_blank">
                      UW Facilities GIS
                    </Anchor>
                  </li>
                  <li>
                    - elevation from{" "}
                    <Anchor href="https://www.usgs.gov/3d-elevation-program" target="_blank">
                      USGS 3DEP
                    </Anchor>
                  </li>
                  <li>
                    - seasons tuned to{" "}
                    <Anchor href="https://www.usanpn.org/" target="_blank">
                      USA-NPN
                    </Anchor>
                  </li>
                  <li>
                    - some help from{" "}
                    <Anchor href="https://chatgpt.com/" target="_blank">
                      Chat GPT
                    </Anchor>
                  </li>
                  <li>
                    - and a lot of help from{" "}
                    <Anchor href="https://chatgpt.com/codex/" target="_blank">
                      Codex
                    </Anchor>
                  </li>
                  <li>
                    - and even more help from{" "}
                    <Anchor href="https://claude.ai/" target="_blank">
                      Claude
                    </Anchor>
                  </li>
                </ul>
              </>
            )}

            {id === "contact" && (
              <>
                <h1>contact links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://t.me/rattmouse" target="_blank">
                      Telegram
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://signal.me/#eu/rattmouse.113" target="_blank">
                      Signal
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="mailto:pm@mrwr.dev" target="_blank">
                      pm@mrwr.dev
                    </Anchor>
                  </li>
                </ul>
                <br />
                <h1>social links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://instagram.com/ratt.mouse" target="_blank">
                      Instagram
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://bsky.app/profile/mrwr.dev" target="_blank">
                      Bluesky
                    </Anchor>
                  </li>
                  <li>
                    -{" "}
                    <Anchor href="https://discord.com/channels/@rattmouse" target="_blank">
                      Discord
                    </Anchor>
                  </li>
                </ul>
                <br />
                <h1>other links:</h1>
                <ul>
                  <li>
                    -{" "}
                    <Anchor href="https://linktr.ee/ratt.mouse" target="_blank">
                      linktr.ee
                    </Anchor>
                  </li>
                </ul>
              </>
            )}
          </ScrollView>
        </div>
      )}
    </DesktopWindow>
  );
}
