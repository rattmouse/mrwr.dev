/**
 * Drawing trees.exe's places (places.ts) into the window's raw Uint32 pixel
 * buffer, under the trees: on the flat map as plain shapes, and in the Tilt
 * view draped over the hills — every point of a creek or a park's edge stood
 * on the ground at its own height, and drawn only where that ground is the
 * nearest thing to the eye. The areaways go down into it: Tilt draws each as
 * an open pit as deep as SDOT measured it, seen through the sidewalk.
 */

import { Overlay, OVERLAY_CELL, OVERLAY_PARK, OVERLAY_RESTORATION, overlayAt, Place, Places, gardenSide } from "@/lib/places";
import { EXAG, Ground, groundZ, shadeColor, TiltView } from "@/lib/treesTilt";

export type PlacesShown = { parks: boolean; water: boolean; underground: boolean };

const pack = (r: number, g: number, b: number) =>
  ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

/** The flat map's colors: parks solid green, a restoration zone yellower, and a P-Patch a lighter lime. */
const FLAT_PARK = pack(46, 98, 44);
const FLAT_RESTORATION = pack(74, 104, 34);
const FLAT_PARK_EDGE = pack(84, 146, 76);
const CREEK = pack(80, 150, 210);
const CREEK_PIPED = pack(46, 74, 100);
const GARDEN = pack(150, 196, 80);
const GARDEN_EDGE = pack(64, 96, 34);
/** Tilt's park edge: a lighter line of the parks' own green. */
const TILT_PARK_EDGE = pack(84, 146, 76);
/**
 * Areaways: the purple of the sidewalk glass that lit them, the manganese in
 * it turned by a century of sun. Filled darker the deeper they go, down to
 * AREAWAY_DEEPEST feet.
 */
const AREAWAY_SHALLOW: [number, number, number] = [128, 92, 170];
const AREAWAY_DEEP: [number, number, number] = [58, 34, 88];
const AREAWAY_DEEPEST = 20;
const AREAWAY_EDGE = pack(176, 138, 222);
/** Tilt's pit: its floor, and the walls and floor's edge. */
const AREAWAY_FLOOR = pack(44, 26, 68);
const AREAWAY_WALL = pack(120, 86, 162);
/** Link light rail: pale track, dashed where it's in a tunnel; stations as platforms, darker for the underground ones. */
const RAIL = pack(206, 210, 220);
const STATION = pack(150, 154, 166);
const STATION_UNDER = pack(88, 80, 112);
const STATION_EDGE = pack(220, 224, 232);
const FT = 0.3048;

const areawayFill = (p: Place) => {
  const t = Math.min(1, (p.deep ?? 8) / AREAWAY_DEEPEST);
  const [a, b] = [AREAWAY_SHALLOW, AREAWAY_DEEP];
  return pack(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
};

/** Lines rather than rings: creeks and track run on; everything else closes on itself. */
const isLine = (p: Place) => p.kind === "creek" || p.kind === "rail";
const tunnel = (p: Place) => p.profile === "tunnel";

/**
 * The flat map's ground: the background, the parks and restoration zones
 * tinted in, then their edges, the creeks, the gardens, the areaways
 * (darker the deeper), and the light rail.
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
  if (show.underground) {
    for (const p of places.list) {
      if (p.kind === "areaway") {
        fillPolygon(buf, W, H, p, toX, toY, areawayFill(p));
        flatLines(buf, W, H, p, toX, toY, AREAWAY_EDGE, 1, 0);
      } else if (p.kind === "rail") flatLines(buf, W, H, p, toX, toY, RAIL, thick, tunnel(p) ? 4 : 0);
    }
    for (const p of places.list) {
      if (p.kind !== "station") continue;
      fillPolygon(buf, W, H, p, toX, toY, p.underground ? STATION_UNDER : STATION);
      flatLines(buf, W, H, p, toX, toY, STATION_EDGE, 1, 0);
    }
  }
}

/** A small place's shape filled even-odd on screen, a row of pixel centres at a time. */
function fillPolygon(
  buf: Uint32Array,
  W: number,
  H: number,
  p: Place,
  toX: (mx: number) => number,
  toY: (my: number) => number,
  color: number,
) {
  const { x, y, parts, box: b } = p;
  if (toX(b[2]) < 0 || toX(b[0]) >= W || toY(b[1]) < 0 || toY(b[3]) >= H) return;
  const sx = new Float32Array(x.length);
  const sy = new Float32Array(y.length);
  for (let i = 0; i < x.length; i++) {
    sx[i] = toX(x[i]);
    sy[i] = toY(y[i]);
  }
  fillScreen(buf, W, H, sx, sy, parts, color);
}

/** Rings already on screen filled even-odd, a row of pixel centres at a time. */
function fillScreen(buf: Uint32Array, W: number, H: number, sx: Float32Array, sy: Float32Array, parts: Uint32Array, color: number) {
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < sy.length; i++) {
    if (sy[i] < top) top = sy[i];
    if (sy[i] > bottom) bottom = sy[i];
  }
  const xs: number[] = [];
  for (let py = Math.max(0, Math.ceil(top - 0.5)); py <= Math.min(H - 1, Math.floor(bottom - 0.5)); py++) {
    const cy = py + 0.5;
    xs.length = 0;
    for (let k = 0; k + 1 < parts.length; k++) {
      const from = parts[k];
      const to = parts[k + 1];
      for (let i = from; i < to; i++) {
        const j = i + 1 < to ? i + 1 : from;
        const ya = sy[i];
        const yb = sy[j];
        if (ya <= cy === yb <= cy) continue;
        xs.push(sx[i] + ((cy - ya) / (yb - ya)) * (sx[j] - sx[i]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let px = x0; px <= x1; px++) buf[py * W + px] = color;
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
  const ring = !isLine(p);
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
 * Tilt's places, into the ground layer once it's drawn: park edges, creeks,
 * track and platforms as lines draped on the hills, gardens as little plots,
 * areaways as pits. `dim` is the light — 1 by day.
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
  if (show.underground) {
    const rim = tone(AREAWAY_EDGE);
    const floor = tone(AREAWAY_FLOOR);
    const wall = tone(AREAWAY_WALL);
    for (const p of places.list) if (p.kind === "areaway") drapePit(buf, depth, view, g, p, floor, wall, rim);
    const rail = tone(RAIL);
    const platform = tone(STATION_EDGE);
    for (const p of places.list) {
      if (p.kind === "rail") drapeLine(buf, depth, view, g, p, rail, thick, tunnel(p) ? 4 : 0);
      else if (p.kind === "station") drapeLine(buf, depth, view, g, p, platform, 1, 0);
    }
  }
}

/**
 * An areaway as an open pit under the sidewalk, `deep` feet down: its floor
 * filled, its corners dropped to it, its rim on the ground. Seen through the
 * pavement, so it's drawn whole wherever the ground over its middle is in
 * view, and hidden whole where a hill is in front.
 */
function drapePit(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  g: Ground | null,
  p: Place,
  floor: number,
  wall: number,
  rim: number,
) {
  const { W, H } = view;
  const pit = pitOnScreen(view, g, depth, p);
  if (!pit) return;
  const { tx, ty, fx, fy } = pit;
  const { parts } = p;
  fillScreen(buf, W, H, fx, fy, parts, floor);
  pitEdges(buf, W, H, pit, parts, wall, rim, 1);
}

/** A pit's edges: the floor's and the corners' in `wall`, then the rim over them in `rim`, `width` pixels. */
function pitEdges(
  buf: Uint32Array,
  W: number,
  H: number,
  pit: { tx: Float32Array; ty: Float32Array; fx: Float32Array; fy: Float32Array },
  parts: Uint32Array,
  wall: number,
  rim: number,
  width: number,
) {
  const { tx, ty, fx, fy } = pit;
  for (let k = 0; k + 1 < parts.length; k++) {
    for (let i = parts[k]; i < parts[k + 1]; i++) {
      const j = i + 1 < parts[k + 1] ? i + 1 : parts[k];
      for (let d = 0; d < width; d++) {
        screenLine(buf, W, H, fx[i] + d, fy[i], fx[j] + d, fy[j], wall);
        screenLine(buf, W, H, tx[i] + d, ty[i], fx[i] + d, fy[i], wall);
      }
    }
  }
  for (let k = 0; k + 1 < parts.length; k++) {
    for (let i = parts[k]; i < parts[k + 1]; i++) {
      const j = i + 1 < parts[k + 1] ? i + 1 : parts[k];
      for (let d = 0; d < width; d++) screenLine(buf, W, H, tx[i] + d, ty[i], tx[j] + d, ty[j], rim);
    }
  }
}

/**
 * An areaway's pit on screen — its rim (tx, ty) on the ground and its floor
 * (fx, fy) — or null where it's off screen or a hill stands in front of it.
 */
function pitOnScreen(view: TiltView, g: Ground | null, depth: Float32Array, p: Place) {
  const { W, H } = view;
  const { x, y, box: b } = p;
  const mid = tiltScreen(view, g, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  const reach = (b[2] - b[0] + b[3] - b[1]) * view.S + 40;
  if (mid.x < -reach || mid.y < -reach || mid.x >= W + reach || mid.y >= H + reach) return null;
  const qx = Math.round(mid.x);
  const qy = Math.round(mid.y);
  if (qx >= 0 && qy >= 0 && qx < W && qy < H && mid.v > depth[qy * W + qx] + tiltSlack(view) + (b[3] - b[1])) return null;
  const drop = (p.deep ?? 8) * FT * view.S * view.cos * EXAG;
  const n = x.length;
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const fx = new Float32Array(n);
  const fy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const top = tiltScreen(view, g, x[i], y[i]);
    tx[i] = top.x;
    ty[i] = top.y;
    fx[i] = top.x;
    fy[i] = top.y + drop;
  }
  return { tx, ty, fx, fy, v: mid.v };
}

/** Whether a screen point is inside a quadrilateral or ring of screen points, even-odd. */
function insideScreen(xs: ArrayLike<number>, ys: ArrayLike<number>, from: number, to: number, px: number, py: number) {
  let hit = false;
  for (let i = from, j = to - 1; i < to; j = i++) {
    if (ys[i] > py !== ys[j] > py && px < xs[i] + ((py - ys[i]) / (ys[j] - ys[i])) * (xs[j] - xs[i])) hit = !hit;
  }
  return hit;
}

/**
 * The areaway whose pit, as Tilt draws it, covers a screen pixel: its rim,
 * its floor, or any of its walls, the nearest where they overlap. Picking by
 * the ground under the pixel would only find the rim, as the rest is drawn
 * below the pavement it's under.
 */
export function areawayAtScreen(
  view: TiltView,
  g: Ground | null,
  depth: Float32Array,
  places: Places,
  px: number,
  py: number,
): Place | null {
  let best: Place | null = null;
  let bestV = Infinity;
  for (const p of places.list) {
    if (p.kind !== "areaway") continue;
    const pit = pitOnScreen(view, g, depth, p);
    if (!pit || pit.v >= bestV) continue;
    if (onPit(pit, p.parts, px, py)) {
      best = p;
      bestV = pit.v;
    }
  }
  return best;
}

/** Whether a screen point is on a pit: its rim, its floor or a wall. */
function onPit(pit: { tx: Float32Array; ty: Float32Array; fx: Float32Array; fy: Float32Array }, parts: Uint32Array, px: number, py: number) {
  const { tx, ty, fx, fy } = pit;
  for (let k = 0; k + 1 < parts.length; k++) {
    const from = parts[k];
    const to = parts[k + 1];
    if (insideScreen(tx, ty, from, to, px, py) || insideScreen(fx, fy, from, to, px, py)) return true;
    for (let i = from; i < to; i++) {
      const j = i + 1 < to ? i + 1 : from;
      if (insideScreen([tx[i], tx[j], fx[j], fx[i]], [ty[i], ty[j], fy[j], fy[i]], 0, 4, px, py)) return true;
    }
  }
  return false;
}

/** A one-pixel line between two screen points. */
function screenLine(buf: Uint32Array, W: number, H: number, ax: number, ay: number, bx: number, by: number, color: number) {
  if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax >= W && bx >= W) || (ay >= H && by >= H)) return;
  const n = Math.min(4000, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) || 1);
  for (let t = 0; t <= n; t++) {
    const px = Math.round(ax + ((bx - ax) * t) / n);
    const py = Math.round(ay + ((by - ay) * t) / n);
    if (px >= 0 && py >= 0 && px < W && py < H) buf[py * W + px] = color;
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
  const ring = !isLine(p);
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

/** The picked place picked out: its outline, its plot, or (an areaway in Tilt) every edge of its pit, in `color`. */
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
    else if (place.kind === "areaway") {
      // The whole pit, rim, corners and floor, not just its edge on the ground.
      const pit = pitOnScreen(tilt.view, tilt.g, tilt.depth, place);
      if (pit) pitEdges(buf, W, H, pit, place.parts, color, color, 2);
    } else drapeLine(buf, tilt.depth, tilt.view, tilt.g, place, color, 2, 0);
  }
}
