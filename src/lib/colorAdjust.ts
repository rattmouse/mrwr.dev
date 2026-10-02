/**
 * Paint's Adjust colors: turn the hue, wash the color out or turn it up,
 * push any one of red, green and blue up or down, and lighten or darken the
 * lot. Alpha is left alone, so a free-form selection keeps its soft edge.
 *
 * Hue and saturation are the same 3×3 color matrices CSS's hue-rotate() and
 * saturate() filters use, folded into one. Everything after the matrix works
 * on one channel at a time, so it's a 256-entry table per channel — a pixel
 * costs nine multiplies and three lookups, however many sliders have moved.
 */
export type ColorAdjust = {
  /** Degrees, −180 to 180. */
  hue: number;
  /** Per cent, 0 (grey) to 200; 100 leaves it alone. */
  saturation: number;
  /** −100 (black) to 100 (white). */
  brightness: number;
  /** Added to each channel, −255 to 255. */
  red: number;
  green: number;
  blue: number;
};

export const NO_ADJUST: ColorAdjust = { hue: 0, saturation: 100, brightness: 0, red: 0, green: 0, blue: 0 };

export const isNoAdjust = (adj: ColorAdjust) =>
  adj.hue === 0 &&
  adj.saturation === 100 &&
  adj.brightness === 0 &&
  adj.red === 0 &&
  adj.green === 0 &&
  adj.blue === 0;

type Matrix = [number, number, number, number, number, number, number, number, number];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(9) as Matrix;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function hueMatrix(degrees: number): Matrix {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
}

function saturationMatrix(percent: number): Matrix {
  const s = percent / 100;
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s,
  ];
}

/** One channel's offset, then the brightness: towards white above 0, black below. */
function channelTable(offset: number, brightness: number): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  const k = brightness / 100;
  for (let v = 0; v < 256; v += 1) {
    const shifted = Math.min(255, Math.max(0, v + offset));
    table[v] = k >= 0 ? shifted + (255 - shifted) * k : shifted * (1 + k);
  }
  return table;
}

/**
 * Write `src` adjusted into `out`, which must be the same length. Both are
 * RGBA, as an ImageData's data is; `out` gets `src`'s alpha.
 */
export function adjustColors(src: Uint8ClampedArray, out: Uint8ClampedArray, adj: ColorAdjust): void {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = multiply(saturationMatrix(adj.saturation), hueMatrix(adj.hue));
  const tr = channelTable(adj.red, adj.brightness);
  const tg = channelTable(adj.green, adj.brightness);
  const tb = channelTable(adj.blue, adj.brightness);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  for (let p = 0; p < src.length; p += 4) {
    const a = src[p + 3];
    out[p + 3] = a;
    if (a === 0) continue;
    const r = src[p];
    const g = src[p + 1];
    const b = src[p + 2];
    out[p] = tr[clamp(m0 * r + m1 * g + m2 * b)];
    out[p + 1] = tg[clamp(m3 * r + m4 * g + m5 * b)];
    out[p + 2] = tb[clamp(m6 * r + m7 * g + m8 * b)];
  }
}
