"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Anchor, Button, GroupBox, Hourglass, ScrollView } from "react95";
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
    .filter((entry) => entry.title.length > 0 && entry.artist.length > 0);
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
    }))
    .filter((entry) => entry.title.length > 0 && entry.image !== null);
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
// opened (or on Shuffle). Positions are kept as fractions of the space they
// were dropped in: across the desktop, or inside the maximized window, which
// covers nearly the same stretch of screen — so a tile stays about where it
// was on screen either way, and a different screen size stretches the
// arrangement instead of scrambling it.
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
// maximized frame grows to whatever space the window actually has.
function fitWithin(room: { w: number; h: number }, aspect: number | undefined): { w: number; h: number } {
  const a = aspect && aspect > 0 ? aspect : 1;
  const w = Math.min(room.w, room.h * a);
  return { w: Math.round(w), h: Math.round(w / a) };
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
  const album = albums[activeAlbum] ?? emptyEntry;
  const albumImage = getSizedCover(album.image, layout === "maximized" ? "high" : "low");
  const iconSize = layout === "maximized" ? 58 : 42;
  // In the normal (small) window the tiles are flung across the whole desktop
  // via a portal that floats above the window chrome; maximized keeps them
  // inside the window scene.
  const scatterToDesktop = id === "collections" && layout === "normal";
  const albumsSceneRef = useRef<HTMLDivElement | null>(null);
  const [albumsSceneSize, setAlbumsSceneSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  // The centre frame and the scattered tiles take each picture's own
  // proportions when we know them (cards, paintings), so nothing gets cropped.
  // Album covers have no aspect data and stay square.
  //
  // Maximized, the frame takes all the room the scene has, less a band wide
  // enough for the tiles to scatter into — any tighter and the scatter's own
  // clamp would start dropping tiles on top of the picture. Until the scene has
  // been measured it falls back to the fixed size the window opens at.
  const framePadding = iconSize + 32;
  const frameRoom =
    layout === "maximized" && albumsSceneSize.width > 0 && albumsSceneSize.height > 0
      ? {
          w: Math.max(280, albumsSceneSize.width - framePadding * 2),
          h: Math.max(280, albumsSceneSize.height - framePadding),
        }
      : layout === "normal" && albumsSceneSize.width > 0 && albumsSceneSize.height > 0
        ? // The tiles are out on the desktop, so the picture can take the whole
          // scene and grow and shrink with the window.
          { w: Math.max(60, albumsSceneSize.width - 12), h: Math.max(60, albumsSceneSize.height - 12) }
        : { w: layout === "maximized" ? 280 : 144, h: layout === "maximized" ? 280 : 144 };
  const { w: frameWidth, h: frameHeight } = fitWithin(frameRoom, album.aspect);
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
        return tiles.slice(0, MAX_PICKED);
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

  // Where the tiles live, in the coordinate space of their container. Desktop
  // mode: a fixed portal pinned to the viewport origin. Window mode: the scene
  // div inside the maximized window.
  const getScatterField = () => {
    if (scatterToDesktop) {
      return {
        originLeft: 0,
        originTop: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        insetTop: TASKBAR_H,
      };
    }
    const rect = albumsSceneRef.current?.getBoundingClientRect();
    return {
      originLeft: rect?.left ?? 0,
      originTop: rect?.top ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      insetTop: 0,
    };
  };

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

  const fieldWidth = scatterToDesktop ? viewportSize.width : albumsSceneSize.width;
  const fieldHeight = scatterToDesktop ? viewportSize.height : albumsSceneSize.height;

  // What the rest of a fresh deal has to keep off. On the desktop: every window
  // on screen, this one included, so the tiles land on bare desktop wherever
  // there is any. Inside the maximized window: the centre frame — but never so
  // wide there is nowhere left.
  const getAvoidRects = (width: number, height: number): Rect[] => {
    if (scatterToDesktop) {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-desktop-window="true"]')).map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.left - 12, y: r.top - 12, w: r.width + 24, h: r.height + 24 };
      });
    }
    // Room for *any* picture in the set, not just the one on show, so picking a
    // differently shaped one never lands it underneath the tiles.
    const room = { w: Math.max(280, width - framePadding * 2), h: Math.max(280, height - framePadding) };
    const frame = { w: 0, h: 0 };
    for (const entry of albums) {
      const fit = fitWithin(room, entry.aspect);
      frame.w = Math.max(frame.w, fit.w);
      frame.h = Math.max(frame.h, fit.h);
    }
    const avoidW = Math.min(frame.w + 16, Math.max(0, width - iconSize * 2 - 24));
    const avoidH = Math.min(frame.h + 16, Math.max(0, height - iconSize - 16));
    return [{ x: (width - avoidW) / 2, y: (height - avoidH) / 2, w: avoidW, h: avoidH }];
  };

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
        getAvoidRects(width, height),
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

  const onAlbumTilePointerDown = (index: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pos = albumTilePositions[index];
    if (!pos) return;
    const field = getScatterField();

    setActiveAlbum(index);
    albumTileStackTopRef.current += 1;
    const stack = albumTileStack.length === albums.length ? albumTileStack.slice() : albums.map(() => 0);
    stack[index] = albumTileStackTopRef.current;
    setAlbumTileStack(stack);
    saveLayout(albumTilePositions, stack, index);

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
          <div style={{ alignSelf: "stretch", display: "flex", gap: 4 }}>
            {([
              { value: "cards", label: "Cards" },
              { value: "albums", label: "Albums" },
              { value: "paintings", label: "Paintings" },
              { value: "songs", label: "Songs" },
            ] as const).map(({ value, label }) => (
              <Button
                key={value}
                size="sm"
                style={{ fontWeight: "bold" }}
                active={category === value}
                onClick={() => setCategory(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          <GroupBox
            label={
              category === "paintings"
                ? "paints.gif"
                : category === "songs"
                  ? "songs.gif"
                  : category === "cards"
                    ? "cards.gif"
                    : "albums.gif"
            }
            style={{ width: "100%", flex: "1 1 auto", minHeight: 0, padding: 4 }}
          >
            <div
              ref={albumsSceneRef}
              style={{
                width: "100%",
                height: "100%",
                minHeight: layout === "maximized" ? 280 : 176,
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
                  <Hourglass size={layout === "maximized" ? 52 : 38} />
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

              {!albumsLoading && !scatterToDesktop && albums.map(renderAlbumTile)}
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
                {albums.map(renderAlbumTile)}
              </div>,
              portalHost
            )}
          {/* One line each, whatever the title: a caption that wrapped would
              change the size of the scene above it every time you picked a
              different tile. */}
          <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
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
              disabled={albumsLoading || albums.length === 0}
              onClick={() => setShuffleCount((n) => n + 1)}
            >
              Shuffle
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
