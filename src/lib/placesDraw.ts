/**
 * Drawing trees.exe's places (places.ts) into the window's raw Uint32 pixel
 * buffer, under the trees: on the flat map as plain shapes, and in the Tilt
 * view draped over the hills — every point of a creek or a park's edge stood
 * on the ground at its own height, and drawn only where that ground is the
 * nearest thing to the eye. The areaways go down into it: Tilt draws each as
 * an open pit as deep as SDOT measured it, seen through the sidewalk. So do
 * the sewer rats, each down at its pipe's depth on a line from the street.
 */

import {
  gardenSide,
  markSide,
  Overlay,
  OVERLAY_CELL,
  OVERLAY_PARK,
  OVERLAY_RESTORATION,
  overlayAt,
  Place,
  Places,
  PlacesShown,
} from "@/lib/places";
import { Pipes, pipesNear } from "@/lib/pipes";
import { EXAG, Ground, groundZ, shadeColor, TiltView } from "@/lib/treesTilt";

export type { PlacesShown };

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
/** SPU's drainage: vaults in poured concrete, the rain gardens' drilled drains a wet teal. */
const VAULT = pack(92, 98, 108);
const VAULT_EDGE = pack(160, 166, 178);
const INJECTION = pack(80, 176, 160);
const INJECTION_EDGE = pack(24, 64, 58);
/** Outfalls by what comes out: rain clean enough to be blue, sewage brown. */
const OUTFALL_STORM = pack(120, 184, 236);
const OUTFALL_SEWER = pack(178, 122, 64);
const OUTFALL_EDGE = pack(20, 30, 44);
/** A sewer rat, and the line from the street down to it. */
const RAT = pack(176, 160, 150);
const RAT_EYE = pack(16, 8, 8);
const RAT_SHAFT = pack(92, 82, 78);
/**
 * Pipes by what they carry — rain blue, sewage brown, the two together
 * between — King County's trunks rust, and the abandoned ones a dead grey.
 */
const PIPE_COLORS = [pack(120, 124, 130), pack(76, 136, 190), pack(156, 104, 60), pack(132, 120, 72)];
const PIPE_COUNTY = pack(206, 108, 58);
const PIPE_ABANDONED = pack(70, 72, 76);
/** A King County structure: its lid, and the shaft down to its floor. */
const STRUCTURE = pack(206, 108, 58);
const STRUCTURE_EDGE = pack(60, 30, 16);
const STRUCTURE_SHAFT = pack(140, 80, 50);
const FT = 0.3048;
const IN = 0.0254;

/** A rat side on, facing east: # body, e its eye. */
const RAT_SPRITE = [
  "      #   ",
  "   ###### ",
  "  #####e##",
  "# ####### ",
  " #  #  #  ",
];
const RAT_W = RAT_SPRITE[0].length;
const RAT_H = RAT_SPRITE.length;

const outfallColor = (p: Place) => (p.flow && p.flow !== "storm drain" ? OUTFALL_SEWER : OUTFALL_STORM);
/** A point place's fill and rim. */
const markColors = (p: Place): [number, number] =>
  p.kind === "injection" ? [INJECTION, INJECTION_EDGE] : [outfallColor(p), OUTFALL_EDGE];

const areawayFill = (p: Place) => {
  const t = Math.min(1, (p.deep ?? 8) / AREAWAY_DEEPEST);
  const [a, b] = [AREAWAY_SHALLOW, AREAWAY_DEEP];
  return pack(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
};

/** Lines rather than rings: creeks and track run on; everything else closes on itself. */
const isLine = (p: Place) => p.kind === "creek" || p.kind === "rail" || p.kind === "pipe";
const tunnel = (p: Place) => p.profile === "tunnel";

/**
 * The flat map's ground: the background, the parks and restoration zones
 * tinted in, then their edges, the creeks, the gardens, the areaways
 * (darker the deeper), the vaults, the light rail, and the drainage points
 * with the rats on top. The pipes, while the walk has them on, go under all
 * of that but the ground's own tints.
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
  pipes: Pipes | null = null,
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
  if (show.pipes && pipes) flatPipes(buf, W, H, s, ox, oy, pipes);
  if (show.pipes) {
    for (const p of places.list) {
      if (p.kind !== "structure") continue;
      const half = Math.max(1, (markSide(p) * s) / 2);
      box(buf, W, H, toX(p.x[0]), toY(p.y[0]), half, half, STRUCTURE, STRUCTURE_EDGE);
    }
  }
  if (show.underground) {
    for (const p of places.list) {
      if (p.kind === "areaway") {
        fillPolygon(buf, W, H, p, toX, toY, areawayFill(p));
        flatLines(buf, W, H, p, toX, toY, AREAWAY_EDGE, 1, 0);
      } else if (p.kind === "vault") flatVault(buf, W, H, p, toX, toY);
      else if (p.kind === "rail") flatLines(buf, W, H, p, toX, toY, RAIL, thick, tunnel(p) ? 4 : 0);
    }
    for (const p of places.list) {
      if (p.kind !== "station") continue;
      fillPolygon(buf, W, H, p, toX, toY, p.underground ? STATION_UNDER : STATION);
      flatLines(buf, W, H, p, toX, toY, STATION_EDGE, 1, 0);
    }
    for (const p of places.list) {
      if (p.kind !== "injection" && p.kind !== "outfall") continue;
      const half = Math.max(1.5, (markSide(p) * s) / 2);
      const [fill, rim] = markColors(p);
      box(buf, W, H, toX(p.x[0]), toY(p.y[0]), half, half, fill, rim);
    }
  }
  if (show.rats) for (const p of places.list) if (p.kind === "rat") rat(buf, W, H, toX(p.x[0]), toY(p.y[0]), ratScale(s));
}

/** A pipe's colour, by what it carries and whose it is. */
function pipeColor(pipes: Pipes, i: number): number {
  const kind = pipes.kinds[pipes.kind[i]];
  if (kind === "abandoned") return PIPE_ABANDONED;
  if (kind === "county") return PIPE_COUNTY;
  return PIPE_COLORS[pipes.flow[i]] ?? PIPE_COLORS[0];
}

/** Dashed for the pipes under pressure, and the abandoned ones. */
const pipeDash = (pipes: Pipes, i: number) => {
  const kind = pipes.kinds[pipes.kind[i]];
  return kind === "force" ? 3 : kind === "abandoned" ? 2 : 0;
};

/** Every pipe on screen as a line on the flat map, as wide as it really is once zoomed in that far. */
function flatPipes(buf: Uint32Array, W: number, H: number, s: number, ox: number, oy: number, pipes: Pipes) {
  const west = -ox / s;
  const east = (W - ox) / s;
  const north = oy / s;
  const south = (oy - H) / s;
  const { x, y, start, box: b } = pipes;
  for (let i = 0; i < pipes.n; i++) {
    if (b[i * 4 + 2] < west || b[i * 4] > east || b[i * 4 + 3] < south || b[i * 4 + 1] > north) continue;
    const color = pipeColor(pipes, i);
    const county = pipes.kinds[pipes.kind[i]] === "county";
    const thick = Math.max(county ? 2 : 1, Math.min(8, Math.round(pipes.width[i] * IN * s)));
    const dash = pipeDash(pipes, i);
    let run = 0;
    for (let k = start[i]; k + 1 < start[i + 1]; k++) {
      const ax = x[k] * s + ox;
      const ay = oy - y[k] * s;
      const bx = x[k + 1] * s + ox;
      const by = oy - y[k + 1] * s;
      const n = Math.min(4000, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) || 1);
      for (let t = 0; t <= n; t++, run++) {
        if (dash && Math.floor(run / dash) & 1) continue;
        const px = Math.round(ax + ((bx - ax) * t) / n) - (thick >> 1);
        const py = Math.round(ay + ((by - ay) * t) / n) - (thick >> 1);
        for (let dy = 0; dy < thick; dy++) {
          const qy = py + dy;
          if (qy < 0 || qy >= H) continue;
          for (let dx = 0; dx < thick; dx++) {
            const qx = px + dx;
            if (qx >= 0 && qx < W) buf[qy * W + qx] = color;
          }
        }
      }
    }
  }
}

/** A vault filled in concrete and edged; one too small to see still a dot. */
function flatVault(buf: Uint32Array, W: number, H: number, p: Place, toX: (mx: number) => number, toY: (my: number) => number) {
  const b = p.box;
  if ((b[2] - b[0]) * Math.abs(toX(1) - toX(0)) < 3) {
    box(buf, W, H, toX((b[0] + b[2]) / 2), toY((b[1] + b[3]) / 2), 1, 1, VAULT, VAULT_EDGE);
    return;
  }
  fillPolygon(buf, W, H, p, toX, toY, VAULT);
  flatLines(buf, W, H, p, toX, toY, VAULT_EDGE, 1, 0);
}

/** The rat sprite's pixels per pixel at `s` screen pixels a metre: none (a dot) when zoomed right out. */
const ratScale = (s: number) => (s >= 8 ? 2 : s >= 0.8 ? 1 : 0);

/** A rat centred on a screen point, `scale` pixels to each of the sprite's, or a two-pixel dot at 0. */
function rat(
  buf: Uint32Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  scale: number,
  body = RAT,
  eye = RAT_EYE,
  ids?: Int32Array,
  k = -1,
) {
  if (scale === 0) {
    box(buf, W, H, cx, cy, 0.5, 0.5, body, body);
    return;
  }
  const x0 = Math.round(cx - (RAT_W * scale) / 2);
  const y0 = Math.round(cy - (RAT_H * scale) / 2);
  if (x0 + RAT_W * scale < 0 || y0 + RAT_H * scale < 0 || x0 >= W || y0 >= H) return;
  for (let r = 0; r < RAT_H; r++) {
    const row = RAT_SPRITE[r];
    for (let c = 0; c < RAT_W; c++) {
      const ch = row[c];
      if (ch === " ") continue;
      const color = ch === "e" ? eye : body;
      for (let dy = 0; dy < scale; dy++) {
        const py = y0 + r * scale + dy;
        if (py < 0 || py >= H) continue;
        for (let dx = 0; dx < scale; dx++) {
          const px = x0 + c * scale + dx;
          if (px < 0 || px >= W) continue;
          buf[py * W + px] = color;
          if (ids) ids[py * W + px] = k;
        }
      }
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

/** Rings already on screen filled even-odd, a row of pixel centres at a time; `ids`, if given, gets `k` wherever it fills. */
function fillScreen(
  buf: Uint32Array,
  W: number,
  H: number,
  sx: Float32Array,
  sy: Float32Array,
  parts: Uint32Array,
  color: number,
  ids?: Int32Array,
  k = -1,
) {
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
    for (let r = 0; r + 1 < parts.length; r++) {
      const from = parts[r];
      const to = parts[r + 1];
      for (let i = from; i < to; i++) {
        const j = i + 1 < to ? i + 1 : from;
        const ya = sy[i];
        const yb = sy[j];
        if (ya <= cy === yb <= cy) continue;
        xs.push(sx[i] + ((cy - ya) / (yb - ya)) * (sx[j] - sx[i]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let e = 0; e + 1 < xs.length; e += 2) {
      const x0 = Math.max(0, Math.ceil(xs[e] - 0.5));
      const x1 = Math.min(W - 1, Math.floor(xs[e + 1] - 0.5));
      for (let px = x0; px <= x1; px++) {
        buf[py * W + px] = color;
        if (ids) ids[py * W + px] = k;
      }
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
 * track, platforms and vaults as lines draped on the hills, gardens and the
 * drainage points as little plots, areaways and the vaults SPU has a depth
 * for as pits, rats and King County's structures down their shafts, and the
 * pipes at their own depths, seen through the ground over them.
 * `dim` is the light — 1 by day.
 */
export function drapePlaces(
  buf: Uint32Array,
  depth: Float32Array,
  view: TiltView,
  g: Ground | null,
  places: Places,
  show: PlacesShown,
  dim: number,
  pipes: Pipes | null = null,
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
    const vaultFloor = tone(VAULT);
    const vaultRim = tone(VAULT_EDGE);
    for (const p of places.list) if (p.kind === "vault" && p.deep) drapePit(buf, depth, view, g, p, vaultFloor, vaultRim, vaultRim);
    const rail = tone(RAIL);
    const platform = tone(STATION_EDGE);
    const vault = tone(VAULT_EDGE);
    for (const p of places.list) {
      if (p.kind === "rail") drapeLine(buf, depth, view, g, p, rail, thick, tunnel(p) ? 4 : 0);
      else if (p.kind === "station") drapeLine(buf, depth, view, g, p, platform, 1, 0);
      else if (p.kind === "vault" && !p.deep) drapeLine(buf, depth, view, g, p, vault, 1, 0);
    }
    for (const p of places.list) {
      if (p.kind !== "injection" && p.kind !== "outfall") continue;
      const [fill, rim] = markColors(p);
      drapeMark(buf, depth, view, g, p, tone(fill), tone(rim));
    }
  }
  if (show.pipes) {
    if (pipes) drapePipes(buf, depth, view, g, pipes, tone);
    const lid = tone(STRUCTURE);
    const edge = tone(STRUCTURE_EDGE);
    const shaft = tone(STRUCTURE_SHAFT);
    for (const p of places.list) {
      if (p.kind !== "structure") continue;
      const at = shaftOnScreen(view, g, depth, p);
      if (!at) continue;
      screenLine(buf, view.W, view.H, at.gx, at.gy, at.x, at.y, shaft);
      box(buf, view.W, view.H, at.gx, at.gy, 1, 1, lid, edge);
      box(buf, view.W, view.H, at.x, at.y, 1.5, 1.5, lid, edge);
    }
  }
  if (show.rats) {
    const body = tone(RAT);
    const eye = tone(RAT_EYE);
    const shaft = tone(RAT_SHAFT);
    for (const p of places.list) {
      if (p.kind !== "rat") continue;
      const at = shaftOnScreen(view, g, depth, p);
      if (!at) continue;
      screenLine(buf, view.W, view.H, at.gx, at.gy, at.x, at.y, shaft);
      rat(buf, view.W, view.H, at.x, at.y, ratScale(view.S), body, eye);
    }
  }
}

/** A drainage point as a little square on the ground, `markSide` across, hidden if a hill stands in front. */
function drapeMark(buf: Uint32Array, depth: Float32Array, view: TiltView, g: Ground | null, p: Place, fill: number, rim: number) {
  const { W, H, S } = view;
  const at = tiltScreen(view, g, p.x[0], p.y[0]);
  const side = markSide(p);
  const hx = Math.max(1.5, (side * S) / 2);
  const hy = Math.max(1, (side * S * view.sin) / 2);
  if (at.x < -hx || at.y < -hy || at.x >= W + hx || at.y >= H + hy) return;
  const qx = Math.round(at.x);
  const qy = Math.round(at.y);
  if (qx >= 0 && qy >= 0 && qx < W && qy < H && at.v > depth[qy * W + qx] + tiltSlack(view) + side) return;
  box(buf, W, H, at.x, at.y, hx, hy, fill, rim);
}

/** Where a pipe's point lands in Tilt, `z` metres under the ground at it. */
function dropped(view: TiltView, g: Ground | null, mx: number, my: number, z: number) {
  const top = tiltScreen(view, g, mx, my);
  return { x: top.x, y: top.y + z * view.S * view.cos * EXAG, gx: top.x, gy: top.y, v: top.v };
}

/**
 * The pipes in Tilt, each stretch at its depth under the ground, drawn where
 * the ground over it is in view — seen through it, like the areaways.
 */
function drapePipes(buf: Uint32Array, depth: Float32Array, view: TiltView, g: Ground | null, pipes: Pipes, tone: (c: number) => number) {
  const { W, H } = view;
  const slack = tiltSlack(view);
  const { x, y, z, start, box: b } = pipes;
  const colors = new Map<number, number>();
  for (let i = 0; i < pipes.n; i++) {
    const mid = tiltScreen(view, g, (b[i * 4] + b[i * 4 + 2]) / 2, (b[i * 4 + 1] + b[i * 4 + 3]) / 2);
    const reach = (b[i * 4 + 2] - b[i * 4] + b[i * 4 + 3] - b[i * 4 + 1]) * view.S + 60;
    if (mid.x < -reach || mid.y < -reach || mid.x >= W + reach || mid.y >= H + reach) continue;
    const raw = pipeColor(pipes, i);
    let color = colors.get(raw);
    if (color === undefined) colors.set(raw, (color = tone(raw)));
    const width = Math.max(1, Math.min(6, Math.round(pipes.width[i] * IN * view.S)));
    for (let k = start[i]; k + 1 < start[i + 1]; k++) {
      const a = dropped(view, g, x[k], y[k], z[k]);
      const c = dropped(view, g, x[k + 1], y[k + 1], z[k + 1]);
      // Hidden where the ground over its middle is behind a hill.
      const gx = Math.round((a.gx + c.gx) / 2);
      const gy = Math.round((a.gy + c.gy) / 2);
      if (gx >= 0 && gy >= 0 && gx < W && gy < H && (a.v + c.v) / 2 > depth[gy * W + gx] + slack + 2) continue;
      for (let d = 0; d < width; d++) screenLine(buf, W, H, a.x + d, a.y, c.x + d, c.y, color);
    }
  }
}

/**
 * The pipe Tilt draws at a screen pixel, or -1: within a few pixels of one of
 * its stretches, at its depth. `mx`, `my` is the ground under the pixel; the
 * pipes looked at are the ones near it, as one deeper than that is drawn far
 * enough down the screen to be under some other bit of ground.
 */
export function pipeAtScreen(
  view: TiltView,
  g: Ground | null,
  pipes: Pipes,
  mx: number,
  my: number,
  px: number,
  py: number,
): number {
  let best = -1;
  let bestD = 4;
  pipesNear(pipes, mx, my, 80, (i) => {
    for (let k = pipes.start[i]; k + 1 < pipes.start[i + 1]; k++) {
      const a = dropped(view, g, pipes.x[k], pipes.y[k], pipes.z[k]);
      const c = dropped(view, g, pipes.x[k + 1], pipes.y[k + 1], pipes.z[k + 1]);
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - px, a.y + t * dy - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

/**
 * A rat or structure on screen, down its depth under the street (gx, gy), or
 * null off screen or behind a hill. Seen through the pavement, like the areaways.
 */
function shaftOnScreen(view: TiltView, g: Ground | null, depth: Float32Array, p: Place) {
  const { W, H } = view;
  const top = tiltScreen(view, g, p.x[0], p.y[0]);
  const drop = (p.deep ?? 6) * FT * view.S * view.cos * EXAG;
  if (top.x < -20 || top.x >= W + 20 || top.y < -20 || top.y + drop >= H + 20) return null;
  const qx = Math.round(top.x);
  const qy = Math.round(top.y);
  if (qx >= 0 && qy >= 0 && qx < W && qy < H && top.v > depth[qy * W + qx] + tiltSlack(view) + 2) return null;
  return { gx: top.x, gy: top.y, x: top.x, y: top.y + drop, v: top.v };
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
 * The rat or areaway Tilt draws under the pavement at a screen pixel: a rat
 * within a few pixels of it first, or the areaway whose pit covers it — its
 * rim, floor, or any of its walls — the nearest where they overlap. Picking by
 * the ground under the pixel would only find the rim, as the rest is drawn
 * below the pavement it's under.
 */
export function belowAtScreen(
  view: TiltView,
  g: Ground | null,
  depth: Float32Array,
  places: Places,
  show: PlacesShown,
  px: number,
  py: number,
): Place | null {
  let best: Place | null = null;
  let bestV = Infinity;
  let bestD = Math.max(4, (RAT_W * ratScale(view.S)) / 2 + 1);
  for (const p of places.list) {
    if (!((p.kind === "rat" && show.rats) || (p.kind === "structure" && show.pipes))) continue;
    const at = shaftOnScreen(view, g, depth, p);
    const d = at ? Math.hypot(at.x - px, at.y - py) : Infinity;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best || !show.underground) return best;
  for (const p of places.list) {
    if (p.kind !== "areaway" && !(p.kind === "vault" && p.deep)) continue;
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

/** A one-pixel line between two screen points; `ids`, if given, gets `k` along it. */
function screenLine(
  buf: Uint32Array,
  W: number,
  H: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: number,
  ids?: Int32Array,
  k = -1,
) {
  if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax >= W && bx >= W) || (ay >= H && by >= H)) return;
  const n = Math.min(4000, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))) || 1);
  for (let t = 0; t <= n; t++) {
    const px = Math.round(ax + ((bx - ax) * t) / n);
    const py = Math.round(ay + ((by - ay) * t) / n);
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    buf[py * W + px] = color;
    if (ids) ids[py * W + px] = k;
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
    } else if (place.kind === "injection" || place.kind === "outfall") {
      const half = Math.max(1.5, (markSide(place) * flat.s) / 2) + 2;
      box(buf, W, H, toX(place.x[0]), toY(place.y[0]), half, half, markColors(place)[0], color);
    } else if (place.kind === "rat") {
      ratRing(buf, W, H, toX(place.x[0]), toY(place.y[0]), ratScale(flat.s), color);
    } else if (place.kind === "structure") {
      const half = Math.max(1, (markSide(place) * flat.s) / 2) + 2;
      box(buf, W, H, toX(place.x[0]), toY(place.y[0]), half, half, STRUCTURE, color);
    } else flatLines(buf, W, H, place, toX, toY, color, 2, 0);
  } else if (tilt) {
    if (place.kind === "garden") drapeGarden(buf, tilt.depth, tilt.view, tilt.g, place, GARDEN, color);
    else if (place.kind === "injection" || place.kind === "outfall") drapeMark(buf, tilt.depth, tilt.view, tilt.g, place, markColors(place)[0], color);
    else if (place.kind === "rat" || place.kind === "structure") {
      const at = shaftOnScreen(tilt.view, tilt.g, tilt.depth, place);
      if (at) {
        screenLine(buf, W, H, at.gx, at.gy, at.x, at.y, color);
        if (place.kind === "rat") ratRing(buf, W, H, at.x, at.y, ratScale(tilt.view.S), color);
        else box(buf, W, H, at.x, at.y, 3, 3, STRUCTURE, color);
      }
    } else if (place.kind === "pipe" && place.z) {
      for (let k = 0; k + 1 < place.x.length; k++) {
        const a = dropped(tilt.view, tilt.g, place.x[k], place.y[k], place.z[k]);
        const c = dropped(tilt.view, tilt.g, place.x[k + 1], place.y[k + 1], place.z[k + 1]);
        for (let d = -1; d <= 1; d++) screenLine(buf, W, H, a.x + d, a.y, c.x + d, c.y, color);
      }
    }
    else if (place.kind === "areaway" || (place.kind === "vault" && place.deep)) {
      // The whole pit, rim, corners and floor, not just its edge on the ground.
      const pit = pitOnScreen(tilt.view, tilt.g, tilt.depth, place);
      if (pit) pitEdges(buf, W, H, pit, place.parts, color, color, 2);
    } else drapeLine(buf, tilt.depth, tilt.view, tilt.g, place, color, 2, 0);
  }
}

/** The walk's rats: the 🐀 emoji, drawn once off a canvas (null where there's no canvas, or it drew nothing), RATS_PX square. */
const RATS_PX = 48;
let ratEmojiSprite: { w: number; h: number; px: Uint32Array } | null | undefined;
function ratEmoji() {
  if (ratEmojiSprite !== undefined) return ratEmojiSprite;
  ratEmojiSprite = null;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RATS_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `${Math.round(RATS_PX * 0.8)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("\u{1F400}", RATS_PX / 2, RATS_PX / 2);
  const data = ctx.getImageData(0, 0, RATS_PX, RATS_PX).data;
  // Cut to what it drew: half see-through and more is in, the rest isn't.
  let x0 = RATS_PX;
  let y0 = RATS_PX;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < RATS_PX; y++) {
    for (let x = 0; x < RATS_PX; x++) {
      if (data[(y * RATS_PX + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = ((y + y0) * RATS_PX + x + x0) * 4;
      px[y * w + x] = data[q + 3] < 128 ? 0 : pack(data[q], data[q + 1], data[q + 2]);
    }
  }
  return (ratEmojiSprite = { w, h, px });
}

/**
 * A 🐀 spinning round on its own up-and-down, `size` pixels long, centred on a
 * screen point: squeezed side to side as it turns, and mirrored past edge-on.
 * `tint` colours it into the fog or the dark; `ids` gets `k` on its pixels.
 * Without the emoji to hand, the drawn rat, turning the same way.
 */
export function spinRat(
  buf: Uint32Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  size: number,
  turn: number,
  tint: (c: number) => number,
  ids?: Int32Array,
  k = -1,
) {
  const sprite = ratEmoji();
  if (!sprite) {
    rat(buf, W, H, cx, cy, Math.max(1, Math.round(size / RAT_W)), tint(RAT), tint(RAT_EYE), ids, k);
    return;
  }
  const c = Math.cos(turn);
  const scale = size / sprite.w;
  const w = Math.max(1, Math.round(sprite.w * scale * Math.abs(c)));
  const h = Math.max(1, Math.round(sprite.h * scale));
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  if (x0 + w < 0 || y0 + h < 0 || x0 >= W || y0 >= H) return;
  const tinted = new Map<number, number>();
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    const sy = Math.min(sprite.h - 1, Math.floor(((y - y0) / h) * sprite.h));
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      let sx = Math.min(sprite.w - 1, Math.floor(((x - x0) / w) * sprite.w));
      if (c < 0) sx = sprite.w - 1 - sx;
      const color = sprite.px[sy * sprite.w + sx];
      if (!color) continue;
      let out = tinted.get(color);
      if (out === undefined) tinted.set(color, (out = tint(color)));
      buf[y * W + x] = out;
      if (ids) ids[y * W + x] = k;
    }
  }
}

/** A rat's turn now: each a little out of step with the next, one turn every two seconds. */
export const ratTurn = (k: number) => (performance.now() / 1000) * Math.PI + k * 1.3;

/** A picked rat: drawn in `color`, boxed in it with a pixel's gap. */
function ratRing(buf: Uint32Array, W: number, H: number, cx: number, cy: number, scale: number, color: number) {
  const hx = (RAT_W * Math.max(1, scale)) / 2 + 2;
  const hy = (RAT_H * Math.max(1, scale)) / 2 + 2;
  for (let x = Math.round(cx - hx); x <= Math.round(cx + hx); x++) {
    for (const y of [Math.round(cy - hy), Math.round(cy + hy)]) if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = color;
  }
  for (let y = Math.round(cy - hy); y <= Math.round(cy + hy); y++) {
    for (const x of [Math.round(cx - hx), Math.round(cx + hx)]) if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = color;
  }
  rat(buf, W, H, cx, cy, Math.max(1, scale), color, RAT_EYE);
}

// --- walking among them --------------------------------------------------------

/**
 * A perspective eye for drapeWalkPlaces (treesWalk.ts's camera): where a
 * world point lands on screen and how far ahead of the eye it is, and the
 * fog to colour it by.
 */
export type PlaceEye = {
  W: number;
  H: number;
  /** Screen x and y of a point `mx`, `my` metres across and `z` metres up, and its distance ahead; `d` under `near` is behind the eye. */
  project(mx: number, my: number, z: number): { x: number; y: number; d: number };
  near: number;
  /** Pixels per metre, one metre ahead. */
  f: number;
  /** Where the eye stands, and the furthest a place is drawn. */
  cx: number;
  cy: number;
  reach: number;
  /** A colour seen `d` metres off, into the fog. */
  tint(c: number, d: number): number;
  /** The eye's down under the ground itself (Dive): nothing down here is hidden behind the hills above. */
  below?: boolean;
};

/** Metres across each kind of line, stood on it: at least a pixel however far. */
const WALK_CREEK = 1.2;
const WALK_RAIL = 1.4;
const WALK_EDGE = 0.35;
/** Metres a dash runs, for piped creek and tunnelled track. */
const WALK_DASH = 6;

/**
 * The places as the walk sees them: the same lines draped on the ground as
 * Tilt's — park edges, creeks, track, platforms, vaults — each sampled about
 * a pixel apart at its own distance and hidden behind any hill in front,
 * gardens and drainage points as plots, the areaways as open pits under the
 * sidewalk, seen through it, and the rats down in the sewers under it.
 * Drawn after the ground, before the trees. `ids` gets each vault's, drain's,
 * outfall's, structure's and rat's index in places.list on its pixels, for the
 * crosshair, and `pipeIds` each pipe's index in pipes. The rats in `caught`
 * have left their pipes to follow the walker, and aren't drawn there.
 */
export function drapeWalkPlaces(
  buf: Uint32Array,
  depth: Float32Array,
  eye: PlaceEye,
  g: Ground | null,
  places: Places,
  show: PlacesShown,
  ids?: Int32Array,
  pipes: Pipes | null = null,
  pipeIds?: Int32Array,
  caught?: Set<number>,
) {
  if (show.pipes && pipes) walkPipes(buf, depth, eye, g, pipes, pipeIds);
  const near = (p: Place) => {
    const b = p.box;
    const dx = Math.max(b[0] - eye.cx, 0, eye.cx - b[2]);
    const dy = Math.max(b[1] - eye.cy, 0, eye.cy - b[3]);
    return dx * dx + dy * dy < eye.reach * eye.reach;
  };
  for (let k = 0; k < places.list.length; k++) {
    const p = places.list[k];
    if (!near(p)) continue;
    if (p.kind === "park" && show.parks) walkLine(buf, depth, eye, g, p, TILT_PARK_EDGE, WALK_EDGE, 0);
    else if (p.kind === "creek" && show.water) {
      walkLine(buf, depth, eye, g, p, p.piped ? CREEK_PIPED : CREEK, WALK_CREEK, p.piped ? WALK_DASH : 0);
    } else if (p.kind === "garden" && show.parks) walkGarden(buf, depth, eye, g, p);
    else if (p.kind === "rat") {
      if (show.rats && !caught?.has(k)) walkRat(buf, depth, eye, g, p, ids, k);
    } else if (p.kind === "structure") {
      if (show.pipes) walkStructure(buf, depth, eye, g, p, ids, k);
    } else if (show.underground) {
      if (p.kind === "areaway") walkPit(buf, depth, eye, g, p);
      else if (p.kind === "vault" && p.deep) walkPit(buf, depth, eye, g, p, ids, k);
      else if (p.kind === "rail") walkLine(buf, depth, eye, g, p, RAIL, WALK_RAIL, tunnel(p) ? WALK_DASH : 0);
      else if (p.kind === "station") walkLine(buf, depth, eye, g, p, STATION_EDGE, WALK_EDGE, 0);
      else if (p.kind === "vault") walkLine(buf, depth, eye, g, p, VAULT_EDGE, WALK_EDGE, 0, ids, k);
      else if (p.kind === "injection" || p.kind === "outfall") walkMark(buf, depth, eye, g, p, ids, k);
    }
  }
}

/** How far behind the ground drawn at a pixel a point can be and still be that ground. */
const walkSlack = (d: number) => 0.3 + d * 0.02;

/** Every part of a place as a line on the ground, `wide` metres across, dashed every `dash` metres if that's not 0; `ids` gets `k` on it. */
function walkLine(
  buf: Uint32Array,
  depth: Float32Array,
  eye: PlaceEye,
  g: Ground | null,
  p: Place,
  color: number,
  wide: number,
  dash: number,
  ids?: Int32Array,
  k = -1,
) {
  const { W, H } = eye;
  const { x, y, parts } = p;
  const ring = !isLine(p);
  const reach2 = eye.reach * eye.reach;
  for (let r = 0; r + 1 < parts.length; r++) {
    const from = parts[r];
    const to = parts[r + 1];
    const last = ring ? to : to - 1;
    let run = 0;
    for (let i = from; i < last; i++) {
      const j = i + 1 < to ? i + 1 : from;
      const ax = x[i];
      const ay = y[i];
      const len = Math.hypot(x[j] - ax, y[j] - ay);
      if (len < 1e-6) continue;
      const ux = (x[j] - ax) / len;
      const uy = (y[j] - ay) / len;
      // Only the stretch of the segment within reach of the eye.
      const along = (eye.cx - ax) * ux + (eye.cy - ay) * uy;
      const offX = ax + ux * along - eye.cx;
      const offY = ay + uy * along - eye.cy;
      const off2 = offX * offX + offY * offY;
      if (off2 >= reach2) {
        run += len;
        continue;
      }
      const half = Math.sqrt(reach2 - off2);
      let s = Math.max(0, along - half);
      const end = Math.min(len, along + half);
      while (s <= end) {
        const mx = ax + ux * s;
        const my = ay + uy * s;
        const at = eye.project(mx, my, (g ? groundZ(g, mx, my) : 0) + 0.05);
        // About a pixel apart wherever it's seen. Behind the eye, straight on
        // to where it could come in front (a metre along moves it at most a
        // metre nearer); off the side of the screen, to where it could come
        // back on, at the fastest a point that far out can cross the screen.
        let step: number;
        if (at.d < eye.near) step = Math.max(0.12, eye.near - at.d);
        else {
          step = Math.max(0.12, (at.d / eye.f) * 0.8);
          const outX = Math.max(-at.x, at.x - W, 0);
          const outY = Math.max(-at.y, at.y - H, 0);
          const out = Math.max(outX, outY);
          if (out > 2) {
            const rate = (eye.f / at.d) * (1 + (Math.abs(at.x - W / 2) + Math.abs(at.y - H / 2)) / eye.f);
            step = Math.max(step, (out / rate) * 0.5);
          }
        }
        if (at.d >= eye.near && !(dash && Math.floor((run + s) / dash) & 1)) {
          const px = Math.round(at.x);
          const py = Math.round(at.y);
          const w = Math.max(1, Math.round((wide * eye.f) / at.d));
          const h = Math.max(1, Math.round(w / 3));
          const x0 = px - (w >> 1);
          if (x0 + w > 0 && x0 < W && py + h > 0 && py < H) {
            const slack = walkSlack(at.d);
            const c = eye.tint(color, at.d);
            for (let yy = Math.max(0, py); yy < Math.min(H, py + h); yy++) {
              for (let xx = Math.max(0, x0); xx < Math.min(W, x0 + w); xx++) {
                const q = yy * W + xx;
                if (at.d > depth[q] + slack) continue;
                buf[q] = c;
                if (ids) ids[q] = k;
              }
            }
          }
        }
        s += step;
      }
      run += len;
    }
  }
}

/** A garden as its square plot on the ground, edged, hidden whole if a hill stands in front of its middle. */
function walkGarden(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, p: Place) {
  const cx = p.x[0];
  const cy = p.y[0];
  const half = gardenSide(p) / 2;
  const z = (g ? groundZ(g, cx, cy) : 0) + 0.05;
  const mid = eye.project(cx, cy, z);
  if (!visibleAt(depth, eye, mid, half)) return;
  const corners = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  const sx = new Float32Array(4);
  const sy = new Float32Array(4);
  for (let i = 0; i < 4; i++) {
    const at = eye.project(corners[i][0], corners[i][1], z);
    if (at.d < eye.near) return;
    sx[i] = at.x;
    sy[i] = at.y;
  }
  const ring = Uint32Array.of(0, 4);
  fillScreen(buf, eye.W, eye.H, sx, sy, ring, eye.tint(GARDEN, mid.d));
  const rim = eye.tint(GARDEN_EDGE, mid.d);
  for (let i = 0; i < 4; i++) screenLine(buf, eye.W, eye.H, sx[i], sy[i], sx[(i + 1) % 4], sy[(i + 1) % 4], rim);
}

/** A drainage point as a square plot on the ground, `markSide` across, edged, hidden whole behind a hill. */
function walkMark(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, p: Place, ids?: Int32Array, k = -1) {
  const cx = p.x[0];
  const cy = p.y[0];
  const half = markSide(p) / 2;
  const z = (g ? groundZ(g, cx, cy) : 0) + 0.05;
  const mid = eye.project(cx, cy, z);
  if (!visibleAt(depth, eye, mid, half)) return;
  const sx = new Float32Array(4);
  const sy = new Float32Array(4);
  const corners = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  for (let i = 0; i < 4; i++) {
    const at = eye.project(corners[i][0], corners[i][1], z);
    if (at.d < eye.near) return;
    sx[i] = at.x;
    sy[i] = at.y;
  }
  const [fill, rim] = markColors(p);
  fillScreen(buf, eye.W, eye.H, sx, sy, Uint32Array.of(0, 4), eye.tint(fill, mid.d), ids, k);
  const edge = eye.tint(rim, mid.d);
  for (let i = 0; i < 4; i++) screenLine(buf, eye.W, eye.H, sx[i], sy[i], sx[(i + 1) % 4], sy[(i + 1) % 4], edge, ids, k);
}

/** Metres out a rat is still drawn: further than that it's under a pixel. */
const WALK_RAT_REACH = 60;

/** A rat down in its sewer, `deep` feet under the street, spinning on a line up to the street, seen through it. */
function walkRat(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, p: Place, ids?: Int32Array, k = -1) {
  const mx = p.x[0];
  const my = p.y[0];
  const z = g ? groundZ(g, mx, my) : 0;
  const top = eye.project(mx, my, z);
  if (top.d > WALK_RAT_REACH || !visibleAt(depth, eye, top, 1)) return;
  const at = eye.project(mx, my, z - (p.deep ?? 6) * FT);
  if (at.d < eye.near) return;
  screenLine(buf, eye.W, eye.H, top.x, top.y, at.x, at.y, eye.tint(RAT_SHAFT, at.d), ids, k);
  // Half a metre nose to tail: bigger than life, to be seen down there and swum to.
  const size = Math.max(6, (0.5 * eye.f) / at.d);
  spinRat(buf, eye.W, eye.H, at.x, at.y, size, ratTurn(k), (c) => eye.tint(c, at.d), ids, k);
}

/** Metres out a King County structure is still drawn. */
const WALK_STRUCTURE_REACH = 150;

/** A King County structure: its lid on the street and a shaft down to its floor, `deep` feet under, seen through the street. */
function walkStructure(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, p: Place, ids?: Int32Array, k = -1) {
  const mx = p.x[0];
  const my = p.y[0];
  const z = g ? groundZ(g, mx, my) : 0;
  const top = eye.project(mx, my, z);
  if (top.d > WALK_STRUCTURE_REACH || !visibleAt(depth, eye, top, 1)) return;
  const at = eye.project(mx, my, z - (p.deep ?? 8) * FT);
  if (at.d < eye.near) return;
  // About a metre and a half across, the shaft as wide as a person.
  const half = Math.max(1, (0.75 * eye.f) / at.d);
  const shaft = Math.max(1, Math.round((0.6 * eye.f) / at.d));
  for (let d = 0; d < shaft; d++) {
    screenLine(buf, eye.W, eye.H, top.x + d - (shaft >> 1), top.y, at.x + d - (shaft >> 1), at.y, eye.tint(STRUCTURE_SHAFT, at.d), ids, k);
  }
  box(buf, eye.W, eye.H, top.x, top.y, half, Math.max(1, half / 3), eye.tint(STRUCTURE, top.d), eye.tint(STRUCTURE_EDGE, top.d));
  box(buf, eye.W, eye.H, at.x, at.y, half, Math.max(1, half / 3), eye.tint(STRUCTURE, at.d), eye.tint(STRUCTURE_EDGE, at.d));
}

/** Metres out the pipes are drawn in the walk: further than that they're a haze of lines. */
const WALK_PIPE_REACH = 150;

/**
 * The pipes near the eye, each at its depth under the ground, as wide as it
 * really is, sampled about a pixel apart, and drawn where the ground over it
 * is in view (or everywhere, from down under it); `ids` gets each one's index.
 */
function walkPipes(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, pipes: Pipes, ids?: Int32Array) {
  const { W, H } = eye;
  const { x, y, z, start } = pipes;
  const reach2 = WALK_PIPE_REACH * WALK_PIPE_REACH;
  pipesNear(pipes, eye.cx, eye.cy, WALK_PIPE_REACH, (i) => {
    const color = pipeColor(pipes, i);
    const wide = Math.max(0.15, pipes.width[i] * IN);
    const dash = pipeDash(pipes, i);
    let run = 0;
    for (let k = start[i]; k + 1 < start[i + 1]; k++) {
      const ax = x[k];
      const ay = y[k];
      const len = Math.hypot(x[k + 1] - ax, y[k + 1] - ay);
      if (len < 1e-6) continue;
      const za = z[k];
      const zb = z[k + 1];
      let s = 0;
      while (s <= len) {
        const t = s / len;
        const mx = ax + (x[k + 1] - ax) * t;
        const my = ay + (y[k + 1] - ay) * t;
        const ox = mx - eye.cx;
        const oy = my - eye.cy;
        const gz = g ? groundZ(g, mx, my) : 0;
        const at = eye.project(mx, my, gz - (za + (zb - za) * t));
        let step = Math.max(0.15, (Math.abs(at.d) / eye.f) * 1.2);
        if (ox * ox + oy * oy > reach2 || at.d < eye.near) {
          s += Math.max(step, 1);
          continue;
        }
        const out = Math.max(-at.x, at.x - W, -at.y, at.y - H, 0);
        if (out > 2) step = Math.max(step, (out * at.d) / eye.f / 2);
        else if (!(dash && Math.floor((run + s) / (dash * 2)) & 1)) {
          // The ground over it in view, or the eye down here with it.
          const top = eye.below ? null : eye.project(mx, my, gz);
          const q = top ? Math.round(top.y) * W + Math.round(top.x) : -1;
          const seen = !top || top.x < 0 || top.y < 0 || top.x >= W || top.y >= H || top.d <= depth[q] + walkSlack(top.d);
          if (seen) {
            const w = Math.max(1, Math.round((wide * eye.f) / at.d));
            const c = eye.tint(color, at.d);
            const x0 = Math.round(at.x) - (w >> 1);
            const y0 = Math.round(at.y) - (w >> 1);
            for (let yy = Math.max(0, y0); yy < Math.min(H, y0 + w); yy++) {
              for (let xx = Math.max(0, x0); xx < Math.min(W, x0 + w); xx++) {
                buf[yy * W + xx] = c;
                if (ids) ids[yy * W + xx] = i;
              }
            }
          }
        }
        s += step;
      }
      run += len;
    }
  });
}

/**
 * An areaway (or a vault) as an open pit `deep` feet down, its floor filled
 * and its walls and rim drawn, seen through the sidewalk over it. Cut off
 * just in front of the eye rather than dropped when part of it is behind you
 * — stood over it, or on its edge — the cut itself drawn as no wall.
 */
function walkPit(buf: Uint32Array, depth: Float32Array, eye: PlaceEye, g: Ground | null, p: Place, ids?: Int32Array, k = -1) {
  const { x, y, box: b, parts } = p;
  const mx = (b[0] + b[2]) / 2;
  const my = (b[1] + b[3]) / 2;
  const mid = eye.project(mx, my, g ? groundZ(g, mx, my) : 0);
  // Over it or beside it, no hill comes between; further off, it's hidden behind one as anything is.
  const over = eye.cx > b[0] - 3 && eye.cx < b[2] + 3 && eye.cy > b[1] - 3 && eye.cy < b[3] + 3;
  if (!over && !visibleAt(depth, eye, mid, b[2] - b[0] + b[3] - b[1])) return;
  if (mid.d > eye.reach) return;
  const drop = (p.deep ?? 8) * FT;
  const front = eye.near * 1.05;
  const shade = Math.max(eye.near, mid.d);
  const vault = p.kind === "vault";
  const floorColor = eye.tint(vault ? VAULT : AREAWAY_FLOOR, shade);
  const wall = eye.tint(vault ? VAULT_EDGE : AREAWAY_WALL, shade);
  const rim = vault ? wall : eye.tint(AREAWAY_EDGE, shade);
  const { W, H } = eye;
  for (let r = 0; r + 1 < parts.length; r++) {
    // The ring, cut to what's in front of the eye: each point, whether the edge on from it is the cut, and whether it's a corner of its own.
    const cx: number[] = [];
    const cy: number[] = [];
    const cut: boolean[] = [];
    const corner: boolean[] = [];
    const from = parts[r];
    const to = parts[r + 1];
    const d = (i: number) => eye.project(x[i], y[i], 0).d;
    for (let i = from; i < to; i++) {
      const j = i + 1 < to ? i + 1 : from;
      const da = d(i);
      const db = d(j);
      if (da >= front) {
        cx.push(x[i]);
        cy.push(y[i]);
        cut.push(false);
        corner.push(true);
      }
      if (da >= front !== db >= front) {
        const t = (front - da) / (db - da);
        cx.push(x[i] + (x[j] - x[i]) * t);
        cy.push(y[i] + (y[j] - y[i]) * t);
        // Going out of view, the edge on from here runs along the cut to where it comes back.
        cut.push(da >= front);
        corner.push(false);
      }
    }
    const n = cx.length;
    if (n < 3) continue;
    const tx = new Float32Array(n);
    const ty = new Float32Array(n);
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = g ? groundZ(g, cx[i], cy[i]) : 0;
      const top = eye.project(cx[i], cy[i], z);
      const bottom = eye.project(cx[i], cy[i], z - drop);
      tx[i] = top.x;
      ty[i] = top.y;
      fx[i] = bottom.x;
      fy[i] = bottom.y;
    }
    fillScreen(buf, W, H, fx, fy, Uint32Array.of(0, n), floorColor, ids, k);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (corner[i]) screenLine(buf, W, H, tx[i], ty[i], fx[i], fy[i], wall);
      if (cut[i]) continue;
      screenLine(buf, W, H, fx[i], fy[i], fx[j], fy[j], wall);
      screenLine(buf, W, H, tx[i], ty[i], tx[j], ty[j], rim);
    }
  }
}

/** Whether a point on the ground is in front of the eye, in reach, on screen (near enough) and not behind a hill. */
function visibleAt(depth: Float32Array, eye: PlaceEye, at: { x: number; y: number; d: number }, size: number) {
  if (at.d < eye.near || at.d > eye.reach) return false;
  const margin = (size * eye.f) / at.d + 2;
  if (at.x < -margin || at.y < -margin || at.x >= eye.W + margin || at.y >= eye.H + margin) return false;
  if (eye.below) return true;
  const qx = Math.round(at.x);
  const qy = Math.round(at.y);
  if (qx < 0 || qy < 0 || qx >= eye.W || qy >= eye.H) return true;
  return at.d <= depth[qy * eye.W + qx] + walkSlack(at.d) + size;
}
