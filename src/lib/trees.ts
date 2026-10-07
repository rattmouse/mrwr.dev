/**
 * Seattle's street trees, as trees.exe reads them: one static, pre-gzipped
 * file from this site (`/trees/trees.bin.gz`, written by
 * scripts/content/refresh-trees.mjs — the format is written up there). It is
 * gzipped on disk rather than left to the server, so it arrives small whatever
 * sits in front of the site, and is inflated here.
 */

export const TREES_URL = "/trees/trees.bin.gz";

export type TreeSpecies = { common: string; scientific: string; genus: string };

export type TreeOwner = "private" | "sdot" | "parks" | "other";

export type Trees = {
  count: number;
  fetched: string;
  source: string;
  bbox: { south: number; north: number; west: number; east: number };
  species: TreeSpecies[];
  streets: string[];
  /** Position across bbox, 0–65535 west→east and south→north. */
  x: Uint16Array;
  y: Uint16Array;
  species16: Uint16Array;
  street: Uint16Array;
  house: Uint16Array;
  /** Year planted − 1900; 0 when the city has no date. */
  year: Uint8Array;
  /** Trunk diameter in inches. */
  diam: Uint8Array;
  /** Bits 0–1 owner, bit 2 heritage, bit 3 exceptional. */
  flags: Uint8Array;
};

type Meta = {
  source: string;
  fetched: string;
  count: number;
  bbox: Trees["bbox"];
  species: [string, string, string][];
  streets: string[];
};

async function inflate(res: Response): Promise<ArrayBuffer> {
  if (!res.body) throw new Error("no body");
  // A server that has already decoded it (or sent it with Content-Encoding)
  // hands back the raw file; only gzip's own magic number means inflate here.
  const raw = await res.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadTrees(signal?: AbortSignal): Promise<Trees> {
  const res = await fetch(TREES_URL, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await inflate(res);
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "TRE1") throw new Error("not a trees file");
  const metaLength = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, metaLength))) as Meta;
  const n = meta.count;

  const align = (bytes: number) => (bytes + 3) & ~3;
  let at = 8 + metaLength;
  const u16 = () => {
    const col = new Uint16Array(buf, at, n);
    at += align(n * 2);
    return col;
  };
  const u8 = () => {
    const col = new Uint8Array(buf, at, n);
    at += align(n);
    return col;
  };
  const x = u16();
  const y = u16();
  const species16 = u16();
  const street = u16();
  const house = u16();
  const year = u8();
  const diam = u8();
  const flags = u8();

  return {
    count: n,
    fetched: meta.fetched,
    source: meta.source,
    bbox: meta.bbox,
    species: meta.species.map(([common, scientific, genus]) => ({ common, scientific, genus })),
    streets: meta.streets,
    x,
    y,
    species16,
    street,
    house,
    year,
    diam,
    flags,
  };
}

export function treeOwner(trees: Trees, i: number): TreeOwner {
  return (["private", "sdot", "parks", "other"] as const)[trees.flags[i] & 3];
}

export function treeAddress(trees: Trees, i: number): string {
  const street = trees.streets[trees.street[i]] ?? "";
  const house = trees.house[i];
  return titleCase(house ? `${house} ${street}` : street);
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
