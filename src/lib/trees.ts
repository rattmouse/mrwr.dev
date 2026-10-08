/**
 * Seattle's street trees — and the trees Seattle Parks has inventoried in its
 * parks, which ride in the same file — as trees.exe reads them: static, pre-gzipped files
 * from this site, written by scripts/content/refresh-trees.mjs (the formats
 * are written up there). They're gzipped on disk rather than left to the
 * server, so they arrive small whatever sits in front of the site, and are
 * inflated here.
 *
 * The map file comes first and is all the map needs; the addresses follow in
 * a file of their own, for the hover line and the tree card.
 */

export const TREES_URL = "/trees/trees.bin.gz";
export const ADDRESSES_URL = "/trees/addresses.bin.gz";
export const REMOVED_URL = "/trees/removed.bin.gz";
export const CROWNS_URL = "/trees/crowns.bin.gz";

export type TreeSpecies = { common: string; scientific: string; genus: string };

export type TreeOwner = "private" | "sdot" | "parks" | "other";

export type TreeAddresses = {
  streets: string[];
  street: Uint16Array;
  /** 0 when the address is a corner or a place rather than a number on a street. */
  house: Uint16Array;
};

export type Trees = {
  count: number;
  /** How many of them are from Parks' inventory rather than the street-tree one. */
  parkCount: number;
  fetched: string;
  source: string;
  bbox: { south: number; north: number; west: number; east: number };
  species: TreeSpecies[];
  /** Position across bbox, 0–65535 west→east and south→north. */
  x: Uint16Array;
  y: Uint16Array;
  species16: Uint16Array;
  /** Year planted − 1900; 0 when the city has no date. */
  year: Uint8Array;
  /** Trunk diameter in inches. */
  diam: Uint8Array;
  /** Bits 0–1 owner, bit 2 heritage, bit 3 exceptional, bit 4 from Parks' inventory. */
  flags: Uint8Array;
};

/** How far through a download is, 0–1, or null while the size isn't known. */
export type Progress = (fraction: number | null) => void;

/**
 * Fetch one of the gzipped files, reporting progress as it comes in, and hand
 * back the inflated bytes, which should open with `magic`. A server that has
 * already decoded it (or sent it with a Content-Encoding) hands over the raw
 * file, which gzip's magic number tells apart.
 *
 * The files sit at the same URLs from one deploy to the next and are cached
 * for an hour, so just after a deploy that changes a format the browser can
 * still be holding the old one: the wrong magic means one more fetch, past
 * the cache, before giving up.
 */
export async function fetchGzip(
  url: string,
  magic: string,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<ArrayBuffer> {
  const buf = await fetchGzipOnce(url, "default", signal, onProgress);
  if (magicOf(buf) === magic) return buf;
  return fetchGzipOnce(url, "reload", signal, onProgress);
}

function magicOf(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return String.fromCharCode(...b);
}

async function fetchGzipOnce(
  url: string,
  cache: RequestCache,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal, cache });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  let raw: Uint8Array;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    onProgress(total ? 0 : null);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(total ? Math.min(1, got / total) : null);
    }
    raw = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      raw.set(c, at);
      at += c.length;
    }
  } else {
    raw = new Uint8Array(await res.arrayBuffer());
  }
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw.slice().buffer;
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** The magic, the metadata, and where the body starts. */
export function readHeader<M>(buf: ArrayBuffer, magic: string): { meta: M; body: number } {
  const view = new DataView(buf);
  const got = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (got !== magic) throw new Error(`expected ${magic}, got ${got}`);
  const metaLength = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, metaLength))) as M;
  return { meta, body: 8 + metaLength };
}

/** A column stored as byte planes — every low byte, then every high byte. */
function unplane(bytes: Uint8Array, at: number, n: number): Uint16Array {
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes[at + i] | (bytes[at + n + i] << 8);
  return out;
}

/** Positions stored as steps from the point before, `shift` bits coarse, back to 0–65535 across the bbox. */
function positions(bytes: Uint8Array, at: number, n: number, shift: number): { x: Uint16Array; y: Uint16Array } {
  const dx = unplane(bytes, at, n);
  const dy = unplane(bytes, at + n * 2, n);
  const x = new Uint16Array(n);
  const y = new Uint16Array(n);
  let qx = 0;
  let qy = 0;
  const half = shift ? 1 << (shift - 1) : 0;
  for (let i = 0; i < n; i++) {
    qx = (qx + dx[i]) & 0xffff;
    qy = (qy + dy[i]) & 0xffff;
    x[i] = Math.min(65535, (qx << shift) + half);
    y[i] = Math.min(65535, (qy << shift) + half);
  }
  return { x, y };
}

export async function loadTrees(signal?: AbortSignal, onProgress?: Progress): Promise<Trees> {
  const buf = await fetchGzip(TREES_URL, "TRE3", signal, onProgress);
  const { meta, body } = readHeader<{
    source: string;
    fetched: string;
    count: number;
    parkCount?: number;
    bbox: Trees["bbox"];
    posShift: number;
    species: [string, string, string][];
  }>(buf, "TRE3");
  const n = meta.count;
  const bytes = new Uint8Array(buf);
  let at = body;
  const { x, y } = positions(bytes, at, n, meta.posShift);
  at += n * 4;
  const species16 = unplane(bytes, at, n);
  at += n * 2;
  const year = bytes.slice(at, at + n);
  at += n;
  const diam = bytes.slice(at, at + n);
  at += n;
  const flags = bytes.slice(at, at + n);

  return {
    count: n,
    parkCount: meta.parkCount ?? 0,
    fetched: meta.fetched,
    source: meta.source,
    bbox: meta.bbox,
    species: meta.species.map(([common, scientific, genus]) => ({ common, scientific, genus })),
    x,
    y,
    species16,
    year,
    diam,
    flags,
  };
}

export async function loadAddresses(signal?: AbortSignal): Promise<TreeAddresses> {
  const buf = await fetchGzip(ADDRESSES_URL, "TRA1", signal);
  const { meta, body } = readHeader<{ count: number; streets: string[] }>(buf, "TRA1");
  const n = meta.count;
  const bytes = new Uint8Array(buf);
  return {
    streets: meta.streets,
    street: unplane(bytes, body, n),
    house: unplane(bytes, body + n * 2, n),
  };
}

export function treeOwner(trees: Trees, i: number): TreeOwner {
  return (["private", "sdot", "parks", "other"] as const)[trees.flags[i] & 3];
}

/** The tree's address, or null while the addresses are still on their way. */
export function treeAddress(addresses: TreeAddresses | null, i: number): string | null {
  if (!addresses) return null;
  const street = addresses.streets[addresses.street[i]] ?? "";
  const house = addresses.house[i];
  return titleCase(house ? `${house} ${street}` : street);
}

/** A tree from Parks' own inventory, standing in a park: its "address" is the park. */
export function isParkTree(trees: Trees, i: number): boolean {
  return (trees.flags[i] & 16) !== 0;
}

export function treeYear(trees: Trees, i: number): number | null {
  const y = trees.year[i];
  return y ? 1900 + y : null;
}

/** "8039 11TH AVE NW" → "8039 11th Ave NW": directions stay capitals, the rest reads like an address. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)\b/g, (word, first: string, rest: string) => {
      if (/^(n|s|e|w|ne|nw|se|sw)$/.test(word)) return word.toUpperCase();
      if (/^(and)$/.test(word)) return word;
      return first.toUpperCase() + rest;
    })
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n: string, suf: string) => n + suf.toLowerCase());
}

/** Street trees the city has taken down, on the same bbox as the rest. */
export type RemovedTrees = {
  count: number;
  fetched: string;
  source: string;
  x: Uint16Array;
  y: Uint16Array;
  species: TreeSpecies[];
  species16: Uint16Array;
  /** Year planted − 1900; 0 when the city has no date. */
  planted: Uint8Array;
  /** Year removed − 1900. */
  removed: Uint8Array;
  /** Bit 0: the removal year is only the record's last edit, so it came down by then. */
  flags: Uint8Array;
  diam: Uint8Array;
  addresses: TreeAddresses;
};

export async function loadRemoved(signal?: AbortSignal): Promise<RemovedTrees> {
  const buf = await fetchGzip(REMOVED_URL, "RMV1", signal);
  const { meta, body } = readHeader<{
    source: string;
    fetched: string;
    count: number;
    posShift: number;
    species: [string, string, string][];
    streets: string[];
  }>(buf, "RMV1");
  const n = meta.count;
  const bytes = new Uint8Array(buf);
  let at = body;
  const { x, y } = positions(bytes, at, n, meta.posShift);
  at += n * 4;
  const species16 = unplane(bytes, at, n);
  at += n * 2;
  const take = () => {
    const col = bytes.slice(at, at + n);
    at += n;
    return col;
  };
  const planted = take();
  const removed = take();
  const flags = take();
  const diam = take();
  const street = unplane(bytes, at, n);
  const house = unplane(bytes, at + n * 2, n);
  return {
    count: n,
    fetched: meta.fetched,
    source: meta.source,
    x,
    y,
    species: meta.species.map(([common, scientific, genus]) => ({ common, scientific, genus })),
    species16,
    planted,
    removed,
    flags,
    diam,
    addresses: { streets: meta.streets, street, house },
  };
}

/** Every other tree the 2021 LiDAR found: parks, yards, greenbelts. No species, but real heights. */
export type Crowns = {
  count: number;
  fetched: string;
  source: string;
  x: Uint16Array;
  y: Uint16Array;
  /** Metres. */
  height: Float32Array;
  /** Crown radius, metres. */
  radius: Float32Array;
  /** 1 for a conifer, 0 for a broadleaf tree. */
  conifer: Uint8Array;
  /** Measured height, in metres, of each street tree a crown landed on, in trees.bin.gz's order; 0 = none. */
  streetHeight: Float32Array;
};

export async function loadCrowns(signal?: AbortSignal, onProgress?: Progress): Promise<Crowns> {
  const buf = await fetchGzip(CROWNS_URL, "CRW1", signal, onProgress);
  const { meta, body } = readHeader<{
    source: string;
    fetched: string;
    count: number;
    streetCount: number;
    posShift: number;
  }>(buf, "CRW1");
  const n = meta.count;
  const bytes = new Uint8Array(buf);
  let at = body;
  const { x, y } = positions(bytes, at, n, meta.posShift);
  at += n * 4;
  const height = new Float32Array(n);
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    height[i] = bytes[at + i] * 0.5;
    radius[i] = bytes[at + n + i] * 0.25;
  }
  at += n * 2;
  const conifer = bytes.slice(at, at + n);
  at += n;
  const streetHeight = new Float32Array(meta.streetCount);
  for (let i = 0; i < meta.streetCount; i++) streetHeight[i] = bytes[at + i] * 0.5;
  return {
    count: n,
    fetched: meta.fetched,
    source: meta.source,
    x,
    y,
    height,
    radius,
    conifer,
    streetHeight,
  };
}
