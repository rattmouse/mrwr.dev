/**
 * Drawing trees.exe's places (places.ts) into the window's raw Uint32 pixel
 * buffer, under the trees: on the flat map as plain shapes, and in the Tilt
 * view draped over the hills — every point of a creek or a park's edge stood
 * on the ground at its own height, and drawn only where that ground is the
 * nearest thing to the eye.
 */

import { Overlay, OVERLAY_CELL, OVERLAY_PARK, OVERLAY_RESTORATION, overlayAt, Place, Places, gardenSide } from "@/lib/places";
import { EXAG, Ground, groundZ, shadeColor, TiltView } from "@/lib/treesTilt";

export type PlacesShown = { parks: boolean; water: boolean };

const pack = (r: number, g: number, b: number) =>
  ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

/** The flat map's colors: dark, so the trees' dots stay what's looked at. */
const FLAT_PARK = pack(24, 38, 27);
const FLAT_RESTORATION = pack(36, 48, 24);
const FLAT_PARK_EDGE = pack(50, 80, 52);
const CREEK = pack(80, 150, 210);
const CREEK_PIPED = pack(46, 74, 100);
const GARDEN = pack(206, 146, 66);
const GARDEN_EDGE = pack(96, 62, 28);
/** Tilt's park edge: a darker line of the ground's own green. */
const TILT_PARK_EDGE = pack(58, 92, 50);

/**
 * The flat map's ground: the background, the parks and restoration zones
 * tinted in, then their edges, the creeks, and the gardens.
 * `stride` 2 does the fills a 2×2 block at a time, for while the view moves.
 */
export function drawFlatPlaces(
  buf: Uint32Array,
  W: number,
  H: number,
  s: number,
  ox: number,
  oy: number,
  places: Places,
  show: PlacesShown,
  bg: number,
  stride: 1 | 2,
) {
  buf.fill(bg);
  const o = places.overlay;
  if (show.parks) fillOverlay(buf, W, H, s, ox, oy, o, stride);
  const toX = (mx: number) => mx * s + ox;
  const toY = (my: number) => oy - my * s;
  const thick = s > 1.5 ? 2 : 1;
  for (const p of places.list) {
    if (p.kind === "park" && show.parks) flatLines(buf, W, H, p, toX, toY, FLAT_PARK_EDGE, 1, 0);
    else if (p.kind === "creek" && show.water) {
      flatLines(buf, W, H, p, toX, toY, p.piped ? CREEK_PIPED : CREEK, thick, p.piped ? 3 : 0);
    }
  }
  if (show.parks) {
    for (const p of places.list) {
      if (p.kind !== "garden") continue;
      const half = Math.max(2, (gardenSide(p) * s) / 2);
      box(buf, W, H, toX(p.x[0]), toY(p.y[0]), half, half, GARDEN, GARDEN_EDGE);
    }
  }
}

function fillOverlay(buf: Uint32Array, W: number, H: number, s: number, ox: number, oy: number, o: Overlay, stride: 1 | 2) {
  // Only the rows and columns over the grid at all.
  const x0 = Math.max(0, Math.floor(ox));
  const x1 = Math.min(W, Math.ceil(ox + o.w * OVERLAY_CELL * s));
  const y0 = Math.max(0, Math.floor(oy - o.h * OVERLAY_CELL * s));
  const y1 = Math.min(H, Math.ceil(oy));
  for (let py = y0; py < y1; py += stride) {
    const my = (oy - py - stride / 2) / s;
    const row = py * W;
    for (let px = x0; px < x1; px += stride) {
      const bits = overlayAt(o, (px + stride / 2 - ox) / s, my);
      if (!bits) continue;
      const c = bits & OVERLAY_RESTORATION ? FLAT_RESTORATION : bits & OVERLAY_PARK ? FLAT_PARK : 0;
      if (!c) continue;
      buf[row + px] = c;
      if (stride === 2) {
        if (px + 1 < W) buf[row + px + 1] = c;
        if (py + 1 < H) {
          buf[row + W + px] = c;
          if (px + 1 < W) buf[row + W + px + 1] = c;
        }
      }
    }
  }
}

/** A filled square with a border, centred on a point. */
function box(buf: Uint32Array, W: number, H: number, cx: number, cy: number, hx: number, hy: number, fill: number, edge: number) {
  const x0 = Math.round(cx - hx);
  const x1 = Math.round(cx + hx);
  const y0 = Math.round(cy - hy);
  const y1 = Math.round(cy + hy);
  if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) return;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      buf[y * W + x] = x === x0 || x === x1 || y === y0 || y === y1 ? edge : fill;
    }
  }
}

/** Every part of a place as lines, `thick` pixels; `dash` > 0 draws every other run of that many. */
function flatLines(
  buf: Uint32Array,
  W: number,
  H: number,
  p: Place,
  toX: (mx: number) => number,
  toY: (my: number) => number,
  color: number,
  thick: number,
  dash: number,
) {
  const { x, y, parts } = p;
  const ring = p.kind !== "creek";
  for (let k = 0; k + 1 < parts.length; k++) {
    const from = parts[k];
    const to = parts[k + 1];
    const last = ring ? to : to - 1;
    let run = 0;
    for (let i = from; i < last; i++) {
      const j = i + 1 < to ? i + 1 : from;
      const ax = toX(x[i]);
      const ay = toY(y[i]);
      const bx = toX(x[j]);
      const by = toY(y[j]);
      if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax >= W && bx >= W) || (ay >= H && by >= H)) continue;
      const n = Math.min(4000, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) || 1);
      for (let t = 0; t <= n; t++, run++) {
        if (dash && Math.floor(run / dash) & 1) continue;
        const px = Math.round(ax + ((bx - ax) * t) / n);
        const py = Math.round(ay + ((by - ay) * t) / n);
        for (let d = 0; d < thick; d++) {
          const qx = px + d;
          if (qx >= 0 && py >= 0 && qx < W && py < H) buf[py * W + qx] = color;
        }
      }
    }
  }
}

/**
 * Tilt's places, into the ground layer once it's drawn: park edges and creeks
 * as lines draped on the hills, gardens as little plots. `dim` is the light —
 * 1 by day.
 */
export function drapePlaces(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  g: Ground | null,
  places: Places,
  show: PlacesShown,
  dim: number,
) {
  const tone = (c: number) => (dim === 1 ? c : shadeColor(c, dim));
  const edge = tone(TILT_PARK_EDGE);
  const creek = tone(CREEK);
  const piped = tone(CREEK_PIPED);
  const thick = view.S > 2 ? 2 : 1;
  for (const p of places.list) {
    if (p.kind === "park" && show.parks) drapeLine(buf, depth, view, g, p, edge, 1, 0);
    else if (p.kind === "creek" && show.water) {
      drapeLine(buf, depth, view, g, p, p.piped ? piped : creek, p.piped ? 1 : thick, p.piped ? 3 : 0);
    }
  }
  if (show.parks) {
    const fill = tone(GARDEN);
    const rim = tone(GARDEN_EDGE);
    for (const p of places.list) if (p.kind === "garden") drapeGarden(buf, depth, view, g, p, fill, rim);
  }
}

/** Where a world point stands on screen, on the ground under it, and its depth. */
function tiltScreen(view: TiltView, g: Ground | null, mx: number, my: number) {
  const u = view.ux * mx + view.uy * my;
  const v = view.vx * mx + view.vy * my;
  const z = g ? groundZ(g, mx, my) : 0;
  return {
    x: view.W / 2 + (u - view.cu) * view.S,
    y: view.H / 2 - (v - view.cv) * view.S * view.sin - z * view.S * view.cos * EXAG,
    v,
  };
}

/** How far behind the ground drawn at a pixel a point can be and still be that ground: a pixel's depth, and a little. */
const tiltSlack = (view: TiltView) => 2 / (view.S * view.sin) + 1;

function drapeLine(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  g: Ground | null,
  p: Place,
  color: number,
  width: number,
  dash: number,
) {
  const { W, H } = view;
  const slack = tiltSlack(view);
  const { x, y, parts } = p;
  const ring = p.kind !== "creek";
  for (let k = 0; k + 1 < parts.length; k++) {
    const from = parts[k];
    const to = parts[k + 1];
    const last = ring ? to : to - 1;
    let run = 0;
    for (let i = from; i < last; i++) {
      const j = i + 1 < to ? i + 1 : from;
      const a = tiltScreen(view, g, x[i], y[i]);
      const b = tiltScreen(view, g, x[j], y[j]);
      if ((a.x < 0 && b.x < 0) || (a.y < 0 && b.y < 0) || (a.x >= W && b.x >= W) || (a.y >= H && b.y >= H)) continue;
      const n = Math.min(3000, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))) || 1);
      for (let t = 0; t <= n; t++, run++) {
        if (dash && Math.floor(run / dash) & 1) continue;
        const f = t / n;
        // Stood on the ground under each point, not on the straight line between the ends.
        const at = n > 2 ? tiltScreen(view, g, x[i] + (x[j] - x[i]) * f, y[i] + (y[j] - y[i]) * f) : f < 0.5 ? a : b;
        const px = Math.round(at.x);
        const py = Math.round(at.y);
        for (let d = 0; d < width; d++) {
          const qx = px + d;
          if (qx < 0 || py < 0 || qx >= W || py >= H) continue;
          const q = py * W + qx;
          if (at.v <= depth[q] + slack) buf[q] = color;
        }
      }
    }
  }
}

/** A garden as a little plot on the ground, hidden whole if a hill stands in front of its middle. */
function drapeGarden(buf: Uint32Array, depth: Float32Array, view: TiltView, g: Ground | null, p: Place, fill: number, rim: number) {
  const { W, H, S } = view;
  const at = tiltScreen(view, g, p.x[0], p.y[0]);
  const side = gardenSide(p);
  const hx = Math.max(1.5, (side * S) / 2);
  const hy = Math.max(1, (side * S * view.sin) / 2);
  if (at.x < -hx || at.y < -hy || at.x >= W + hx || at.y >= H + hy) return;
  const qx = Math.round(at.x);
  const qy = Math.round(at.y);
  if (qx >= 0 && qy >= 0 && qx < W && qy < H && at.v > depth[qy * W + qx] + tiltSlack(view) + side) return;
  box(buf, W, H, at.x, at.y, hx, hy, fill, rim);
}

/** The picked place picked out: its outline, or its plot, in `color`. */
export function outlinePlace(
  buf: Uint32Array,
  W: number,
  H: number,
  place: Place,
  color: number,
  flat: { s: number; ox: number; oy: number } | null,
  tilt: { view: TiltView; depth: Float32Array; g: Ground | null } | null,
) {
  if (flat) {
    const toX = (mx: number) => mx * flat.s + flat.ox;
    const toY = (my: number) => flat.oy - my * flat.s;
    if (place.kind === "garden") {
      const half = Math.max(2, (gardenSide(place) * flat.s) / 2) + 2;
      box(buf, W, H, toX(place.x[0]), toY(place.y[0]), half, half, GARDEN, color);
    } else flatLines(buf, W, H, place, toX, toY, color, 2, 0);
  } else if (tilt) {
    if (place.kind === "garden") drapeGarden(buf, tilt.depth, tilt.view, tilt.g, place, GARDEN, color);
    else drapeLine(buf, tilt.depth, tilt.view, tilt.g, place, color, 2, 0);
  }
}
