/**
 * Everything trees.exe draws under the trees that isn't a tree: Seattle's
 * parks, Green Seattle Partnership's forest-restoration zones inside them,
 * P-Patch community gardens, creeks, the areaways — the hollow sidewalks of
 * Pioneer Square and downtown — Link light rail's track and stations, and
 * what Seattle Public Utilities has under the streets: drainage vaults and
 * tanks, the drilled drains under rain gardens, the outfalls where pipes empty
 * into the water, and the rats its sewer cameras have caught on video.
 * One static, gzipped
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

import { dataUrl, fetchGzip, Progress, readHeader, Trees } from "@/lib/trees";

export const PLACES_URL = dataUrl("/trees/places.bin.gz");
/** The parks past Seattle's own: national, state, King County's and its other cities', in the same layout. */
export const PARKLANDS_URL = dataUrl("/trees/parklands.bin.gz");

export type PlaceKind =
  | "park"
  | "restoration"
  | "garden"
  | "creek"
  | "areaway"
  | "rail"
  | "station"
  | "vault"
  | "injection"
  | "outfall"
  | "rat"
  | "structure"
  | "pipe"
  | "parkland";

/** Which layers are on: Parks, Water, Underground, Pipes (with King County's structures), and Rats on their own. */
export type PlacesShown = { parks: boolean; water: boolean; underground: boolean; rats: boolean; pipes: boolean };

/** The kinds the Underground layer shows. */
const UNDERGROUND_KINDS = new Set<PlaceKind>(["areaway", "rail", "station", "vault", "injection", "outfall"]);
/** The kinds drawn at a single point. */
const POINT_KINDS = new Set<PlaceKind>(["injection", "outfall", "rat", "structure"]);

/** Whether a place is on with these layers. */
export function placeShown(p: Place, show: PlacesShown): boolean {
  if (p.kind === "rat") return show.rats;
  if (p.kind === "pipe" || p.kind === "structure") return show.pipes;
  return p.kind === "creek" ? show.water : UNDERGROUND_KINDS.has(p.kind) ? show.underground : show.parks;
}

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
  /** Garden (and an outfall's permit address, or a rat's pipe's). */
  address?: string;
  plots?: number;
  /** The year it was started, built or laid. */
  since?: number;
  sqft?: number;
  /** Creek: 1 where it runs through a pipe. */
  piped?: number;
  /** Areaway: SDOT's id (name is its location), and who owns it. */
  id?: string;
  owner?: "private" | "sdot" | "county" | "light";
  /** "out of service" or "under construction"; absent when in service. */
  status?: string;
  use?: string;
  /** What the street-side wall is built of, and what holds the sidewalk up over it. */
  wall?: string;
  roof?: string;
  /** Feet: the wall's tallest, the space's width, and the wall's length. A rat's `deep` is its pipe's depth under it. */
  deep?: number;
  wide?: number;
  long?: number;
  /** Good, Fair or Poor at the last inspection, and its year. */
  wallRating?: string;
  roofRating?: string;
  inspected?: number;
  /** 1 where part of it has been filled in. */
  filled?: number;
  /** Rail: how the track runs here — "tunnel", "elevated", "street level", "cutting", ... */
  profile?: string;
  /** Station: 1 where its platform is down in a tunnel. */
  underground?: number;
  /** Vault, injection cell, outfall: who owns it, as SPU names them. */
  ownedBy?: string;
  /** Vault: 1 for a tank (a big pipe laid in the ground) rather than a box. */
  tank?: number;
  /** Outfall and rat: what the pipe carries — "storm drain", "combined sewer" or "sanitary sewer". */
  flow?: string;
  /** Outfall: the water it empties into. */
  into?: string;
  /** Outfall and rat: the pipe's material, and its widest, inches. */
  material?: string;
  inches?: number;
  /** Outfall: the pipe's size as SPU gives it ("36 in", "160 × 40 in"); 1 where it's an open swale instead. */
  pipe?: string;
  swale?: number;
  /** Outfall: its combined-sewer overflow number and discharge permit, and 1 while that permit is active. */
  cso?: string;
  permit?: number;
  /** Rat: the day the camera went down the pipe, how many stills were taken, and how many rats the pipe has had. */
  seen?: string;
  photos?: number;
  sightings?: number;
  /** Outfall: the ground's height at it, feet. */
  elev?: number;
  /** Structure, pipe: the King County trunk it's on. */
  trunk?: string;
  /** Pipe: which sort, how deep each point is (metres, NaN not recorded), its ends' depths in feet, and 1 where it's been relined. */
  pipeKind?: string;
  z?: Float32Array;
  upDeep?: number;
  downDeep?: number;
  lined?: number;
  /** Parkland: whose it is, what sort ("National Park", "State Park"…), and for a city's, which city. */
  agency?: "national" | "state" | "county" | "city";
  category?: string;
  manager?: string;
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
  url = PLACES_URL,
): Promise<Places> {
  const buf = await fetchGzip(url, "PLC1", signal, onProgress);
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

/** The city's places with the parklands beyond it added on, the overlay tinting whatever of them is over the city too. */
export function withParklands(places: Places, parklands: Places, widthM: number, heightM: number): Places {
  const list = places.list.concat(parklands.list);
  return { fetched: places.fetched, list, overlay: rasterize(list, widthM, heightM) };
}

/** The parks and restoration zones, filled into the overlay grid even-odd, a row of cell centres at a time. */
function rasterize(list: Place[], widthM: number, heightM: number): Overlay {
  const w = Math.ceil(widthM / OVERLAY_CELL);
  const h = Math.ceil(heightM / OVERLAY_CELL);
  const bits = new Uint8Array(w * h);
  const xs: number[] = [];
  for (const place of list) {
    const bit = place.kind === "park" || place.kind === "parkland" ? OVERLAY_PARK : place.kind === "restoration" ? OVERLAY_RESTORATION : 0;
    if (!bit) continue;
    const { x, y, parts, box } = place;
    // The parklands reach across the state; only those over the city's rectangle tint it.
    if (box[2] < 0 || box[0] > widthM || box[3] < 0 || box[1] > heightM) continue;
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
 * current zoom: a garden, creek, areaway, track, station, vault or one of the
 * drainage points near enough first, as they're small, then the restoration
 * zone, then the park. A rat wins a tie, being the smallest of all.
 */
export function placeAt(
  places: Places,
  show: PlacesShown,
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
    } else if (p.kind === "rail" && show.underground) {
      const d = distanceToLine(p, mx, my, reach);
      if (d <= reach && d < bestD) {
        best = p;
        bestD = d;
      }
    } else if (POINT_KINDS.has(p.kind) && (p.kind === "rat" ? show.rats : p.kind === "structure" ? show.pipes : show.underground)) {
      const d = Math.hypot(p.x[0] - mx, p.y[0] - my) - (p.kind === "rat" ? 0.5 : 0);
      if (d <= Math.max(reach * 1.5, markSide(p) / 2) && d < bestD) {
        best = p;
        bestD = d;
      }
    } else if ((p.kind === "areaway" || p.kind === "station" || p.kind === "vault") && show.underground) {
      // A strip a few metres wide, or a platform: inside it, or near enough its edge at this zoom.
      const d = inside(p, mx, my) ? 0 : distanceToLine(p, mx, my, reach);
      if (d <= reach && d < bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  if (best || !show.parks) return best;
  let park: Place | null = null;
  let land: Place | null = null;
  let landArea = Infinity;
  for (const p of places.list) {
    if (p.kind === "restoration" && inside(p, mx, my)) return p;
    if (!park && p.kind === "park" && inside(p, mx, my)) park = p;
    // The smallest of the parklands round it: a county park inside a national forest is the county park.
    if (p.kind === "parkland") {
      const area = (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
      if (area < landArea && inside(p, mx, my)) {
        land = p;
        landArea = area;
      }
    }
  }
  return park ?? land;
}

/** Whose a parkland is, in a word or two. */
export function parklandAgency(p: Place): string {
  switch (p.agency) {
    case "national":
      return "National Park Service";
    case "state":
      return "Washington State Parks";
    case "county":
      return "King County Parks";
    default:
      return p.manager ?? "City park";
  }
}

/**
 * The parklands rasterized onto another grid — the region's height grid — as
 * a byte per cell (1 inside any of them), even-odd a row of cell centres at a
 * time. `rect` is the grid's bbox in the same metres, row 0 at the north.
 */
export function parklandMask(list: Place[], w: number, h: number, rect: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const mask = new Uint8Array(w * h);
  const cw = (rect.x1 - rect.x0) / w;
  const ch = (rect.y1 - rect.y0) / h;
  const xs: number[] = [];
  for (const place of list) {
    if (place.kind !== "parkland") continue;
    const { x, y, parts, box } = place;
    const r0 = Math.max(0, Math.floor((rect.y1 - box[3]) / ch - 0.5));
    const r1 = Math.min(h - 1, Math.ceil((rect.y1 - box[1]) / ch - 0.5));
    for (let r = r0; r <= r1; r++) {
      const cy = rect.y1 - (r + 0.5) * ch;
      xs.length = 0;
      for (let p = 0; p + 1 < parts.length; p++) {
        const from = parts[p];
        const to = parts[p + 1];
        for (let i = from; i < to; i++) {
          const j = i + 1 < to ? i + 1 : from;
          if (y[i] <= cy === y[j] <= cy) continue;
          xs.push(x[i] + ((cy - y[i]) / (y[j] - y[i])) * (x[j] - x[i]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - rect.x0) / cw - 0.5));
        const c1 = Math.min(w - 1, Math.floor((xs[k + 1] - rect.x0) / cw - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * w + c] = 1;
      }
    }
  }
  return mask;
}

/** A garden's side, metres, from its size: they're drawn as squares of about their own area. */
export function gardenSide(p: Place): number {
  return p.sqft ? Math.max(8, Math.sqrt(p.sqft) * 0.3048) : 20;
}

/** A point place's mark, metres across: an outfall as wide as its pipe, the rest a fixed size. */
export function markSide(p: Place): number {
  if (p.kind === "outfall") return Math.max(1.5, (p.inches ?? 12) * 0.0254 * 1.5);
  return p.kind === "rat" ? 1 : p.kind === "structure" ? 1.5 : 2;
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

// --- in words -------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-US");

export const acresLabel = (acres: number | undefined) =>
  acres === undefined ? null : `${acres < 10 ? acres.toFixed(1) : fmt(Math.round(acres))} acres`;

/** A park, restoration zone, garden, creek, areaway, track, vault, drain, outfall or rat, in a line for the status bar, or the walk's crosshair. */
export function describePlace(p: Place): string {
  switch (p.kind) {
    case "park":
      return [p.name ?? "Park", acresLabel(p.acres)].filter(Boolean).join(" · ");
    case "parkland":
      return [p.name ?? "Park", p.category ?? parklandAgency(p), acresLabel(p.acres)].filter(Boolean).join(" · ");
    case "restoration":
      return [
        p.zone ?? "Restoration zone",
        p.name ? `forest restoration in ${p.name}` : "forest restoration",
        p.phase !== undefined ? RESTORATION_PHASES[p.phase]?.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "garden":
      return [`${p.name ?? "Community"} P-Patch`, p.address, p.plots ? `${p.plots} plots` : null].filter(Boolean).join(" · ");
    case "areaway":
      return ["Areaway", p.name, p.deep ? `${feet(p.deep)} ft down` : null, p.status].filter(Boolean).join(" · ");
    case "rail":
      return [railLine(p), p.profile].filter(Boolean).join(" · ");
    case "station":
      return [p.name ?? "Link station", p.underground ? "underground" : null].filter(Boolean).join(" · ");
    case "vault":
      return [p.name ?? "Vault", p.sqft ? `${fmt(p.sqft)} sq ft` : null, p.deep ? `${feet(p.deep)} ft deep` : null, p.ownedBy]
        .filter(Boolean)
        .join(" · ");
    case "injection":
      return ["Drilled drain", p.name].filter(Boolean).join(" · ");
    case "outfall":
      return [`${capitalize(p.flow ?? "pipe")} outfall`, p.into ? `into ${p.into}` : null, p.pipe, p.cso].filter(Boolean).join(" · ");
    case "rat":
      return ["Sewer rat", p.seen ? ratDate(p.seen) : null, p.address, p.deep ? `${feet(p.deep)} ft down` : null]
        .filter(Boolean)
        .join(" · ");
    case "structure":
      return [p.name ?? "Sewer structure", p.trunk, p.deep ? `${feet(p.deep)} ft deep` : null].filter(Boolean).join(" · ");
    case "pipe":
      return [pipeTitle(p), p.inches ? `${p.inches} in` : null, p.material, pipeDepth(p), p.since ? `laid ${p.since}` : null]
        .filter(Boolean)
        .join(" · ");
    default:
      return `${p.name ?? "Unnamed creek"}${p.piped ? " · piped here" : ""}`;
  }
}

/** "2021-06-14" → "June 14, 2021". */
export function ratDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Feet to a tenth at most: SDOT's measurements come with float noise on the end. */
export const feet = (n: number) => String(Math.round(n * 10) / 10);

/** Which Link line a stretch of track carries, from the project that built it. */
export function railLine(p: Place): string {
  if (p.name === "OMF") return "Link maintenance yard";
  if (p.name === "East Link") return "Link 2 Line";
  return "Link 1 Line";
}

/** What a pipe is, in a few words: "Combined sewer", "Storm drain force main", "Abandoned sanitary sewer", "Henderson Street Trunk". */
export function pipeTitle(p: Place): string {
  const flow = p.flow ?? "sewer";
  switch (p.pipeKind) {
    case "county":
      return p.name ?? "King County sewer trunk";
    case "force":
      return `${capitalize(flow)} force main`;
    case "detention":
      return "Detention pipe";
    case "abandoned":
      return `Abandoned ${flow}`;
    case "stub":
      return `${capitalize(flow)} stub`;
    default:
      return capitalize(flow);
  }
}

/** "6.1–8.4 ft down", or "7 ft down" where the two ends are as deep or only one is known. */
export function pipeDepth(p: Place): string | null {
  const a = p.upDeep;
  const b = p.downDeep;
  if (a && b && Math.abs(a - b) >= 0.5) return `${feet(Math.min(a, b))}–${feet(Math.max(a, b))} ft down`;
  const d = a || b;
  return d ? `${feet(d)} ft down` : null;
}
