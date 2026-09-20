/**
 * Turning a course and a ball into a picture: six flat quads per box, a shaded
 * disc for the marble, and a smudge under it so you can tell how far above the
 * floor it is.
 *
 * Nothing here knows the rules of the game — it is handed the state the physics
 * left behind and paints it.
 */

import {
  add,
  apply,
  applyT,
  clipNear,
  cross,
  Drawable,
  dot,
  fogged,
  length,
  normalise,
  project,
  rgb,
  scale,
  SKY,
  sub,
  Tint,
  toEye,
  vec,
  Vec3,
  View,
} from "@/lib/marbles3d";
import type { Block, Marble } from "@/lib/marblesCourse";

/** Where the light comes from. A fixed direction, so shapes read consistently. */
const LIGHT = normalise(vec(0.45, 0.85, 0.28));

/** How far off before a shape has sunk entirely into the background. */
const FOG_NEAR = 22;
const FOG_FAR = 82;
const FOG_MAX = 0.82;

const CORNERS: Vec3[] = [];
for (let z = -1; z <= 1; z += 2) {
  for (let y = -1; y <= 1; y += 2) {
    for (let x = -1; x <= 1; x += 2) {
      CORNERS[(x + 1) / 2 + ((y + 1) / 2) * 2 + ((z + 1) / 2) * 4] = vec(x, y, z);
    }
  }
}

/** The six faces, each as a normal in the box's own frame and a ring of corners. */
const FACES: { normal: Vec3; ring: [number, number, number, number] }[] = [
  { normal: vec(1, 0, 0), ring: [1, 5, 7, 3] },
  { normal: vec(-1, 0, 0), ring: [0, 2, 6, 4] },
  { normal: vec(0, 1, 0), ring: [2, 3, 7, 6] },
  { normal: vec(0, -1, 0), ring: [0, 4, 5, 1] },
  { normal: vec(0, 0, 1), ring: [4, 6, 7, 5] },
  { normal: vec(0, 0, -1), ring: [0, 1, 3, 2] },
];

function fogAt(away: number) {
  return Math.min(FOG_MAX, Math.max(0, (away - FOG_NEAR) / (FOG_FAR - FOG_NEAR)) * FOG_MAX);
}

/**
 * Cutting a face up before sorting it. One quad is sorted as a single thing,
 * so a floor stretching away from you is either in front of everything on its
 * far half or behind everything on its near half, and whichever way it falls
 * something is drawn through the ground. Cut into pieces this big, each piece
 * sorts beside its own neighbours instead.
 */
const TILE = 1.2;
/** However big a face is, it is never cut into more than this many strips. */
const TILE_MOST = 20;
/**
 * And it is only cut at all within this far of the eye. Further off than this
 * everything near a face is far off too, so one piece sorts as well as twenty
 * — which keeps the count down to a few hundred pieces a frame rather than
 * a few thousand.
 */
const TILE_REACH = 26;

/** How far the furthest of these points is from the eye — the paint order. */
function furthest(points: Vec3[], eye: Vec3) {
  let most = 0;
  for (const p of points) most = Math.max(most, length(sub(p, eye)));
  return most;
}

function nearest(points: Vec3[], eye: Vec3) {
  let least = Infinity;
  for (const p of points) least = Math.min(least, length(sub(p, eye)));
  return least;
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/**
 * Every face of every box that is pointing at us, ready to sort. Faces looking
 * away are dropped here rather than drawn and covered over: for a solid box
 * that alone leaves a set of quads that can't overlap each other, so sorting
 * only has to get one box against another right.
 */
export function collectBlocks(view: View, blocks: Block[], lift: number): Drawable[] {
  const queue: Drawable[] = [];
  const eye = view.camera.pos;

  for (const b of blocks) {
    const world = CORNERS.map((c) =>
      add(b.centre, apply(b.rot, vec(c.x * b.half.x, c.y * b.half.y, c.z * b.half.z))),
    );

    for (const face of FACES) {
      const normal = apply(b.rot, face.normal);
      const ring = face.ring.map((i) => world[i]);
      // Facing us if the outward normal leans back toward the eye.
      if (dot(normal, sub(ring[0], eye)) >= 0) continue;

      const lambert = 0.34 + 0.66 * Math.max(0, dot(normal, LIGHT));
      const glow = b.goal ? 0.45 + lift * 0.9 : lift * 0.25;

      // The scenery hangs on its own out in the dark with nothing standing on
      // it, so it is never worth cutting up; nor is anything far enough off.
      const cut = b.solid && nearest(ring, eye) <= TILE_REACH;
      const strips = (a: Vec3, c: Vec3) =>
        cut ? Math.max(1, Math.min(TILE_MOST, Math.ceil(length(sub(c, a)) / TILE))) : 1;
      const cols = strips(ring[0], ring[1]);
      const rows = strips(ring[1], ring[2]);
      // Bilinear across the face: s runs along the first edge, t down the next.
      const corner = (s: number, t: number) =>
        lerp(lerp(ring[0], ring[1], s), lerp(ring[3], ring[2], s), t);

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const s0 = col / cols;
          const s1 = (col + 1) / cols;
          const t0 = row / rows;
          const t1 = (row + 1) / rows;
          const quad =
            cols === 1 && rows === 1
              ? ring
              : [corner(s0, t0), corner(s1, t0), corner(s1, t1), corner(s0, t1)];

          const poly = clipNear(quad.map((p) => toEye(view, p)));
          if (poly.length < 3) continue;

          // Fog by the middle of the piece; paint order by its far corner.
          let haze = 0;
          for (const p of quad) haze += length(sub(p, eye));
          haze /= quad.length;

          const shade: Tint = fogged(b.tint, lambert + glow, fogAt(haze), SKY);
          const fill = rgb(shade);
          const edge = rgb(shade, 0.62);
          const screen = poly.map((p) => project(view, p));
          // Which of a piece's four sides are the face's own outline rather
          // than a cut through the middle of it. Only those get the dark edge;
          // the rest are stroked in their own colour, to cover the hairline
          // the canvas leaves between two abutting fills.
          const rim =
            poly.length === 4
              ? [row === 0, col === cols - 1, row === rows - 1, col === 0]
              : null;

          queue.push({
            away: furthest(quad, eye),
            paint: (ctx) => {
              ctx.beginPath();
              ctx.moveTo(screen[0].x, screen[0].y);
              for (let i = 1; i < screen.length; i += 1) ctx.lineTo(screen[i].x, screen[i].y);
              ctx.closePath();
              ctx.fillStyle = fill;
              ctx.fill();
              ctx.lineWidth = 1;
              ctx.strokeStyle = fill;
              ctx.stroke();

              if (!rim) return;
              ctx.beginPath();
              for (let i = 0; i < 4; i += 1) {
                if (!rim[i]) continue;
                ctx.moveTo(screen[i].x, screen[i].y);
                ctx.lineTo(screen[(i + 1) % 4].x, screen[(i + 1) % 4].y);
              }
              ctx.strokeStyle = edge;
              ctx.stroke();
            },
          });
        }
      }
    }
  }
  return queue;
}

/* ------------------------------------------------------------------ shadow */

/** Straight down from the ball until something solid stops it. */
function floorBelow(blocks: Block[], from: Vec3): { point: Vec3; drop: number } | null {
  let best: number | null = null;
  for (const b of blocks) {
    if (!b.solid) continue;
    const origin = applyT(b.rot, sub(from, b.centre));
    const dir = applyT(b.rot, vec(0, -1, 0));
    let near = -Infinity;
    let far = Infinity;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    const h = [b.half.x, b.half.y, b.half.z];
    let missed = false;
    for (let a = 0; a < 3; a += 1) {
      if (Math.abs(d[a]) < 1e-9) {
        if (Math.abs(o[a]) > h[a]) {
          missed = true;
          break;
        }
        continue;
      }
      const t1 = (-h[a] - o[a]) / d[a];
      const t2 = (h[a] - o[a]) / d[a];
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
    }
    if (missed || near > far || far < 0) continue;
    const t = near > 0 ? near : far;
    if (t > 0 && (best === null || t < best)) best = t;
  }
  if (best === null) return null;
  return { point: vec(from.x, from.y - best, from.z), drop: best };
}

/* ------------------------------------------------------------------ marble */

/**
 * The ball is a little globe: an ocean with land on it and ice at both poles,
 * which is a far better way of showing that a sphere is turning than a pattern
 * of dots — you can see which way is which, and which way up it has got to.
 *
 * Each landmass is a closed loop of directions on the ball's surface. Rolling
 * turns the loops with everything else; drawing one means throwing away the
 * part of it that has gone round the back, then projecting what is left.
 */
type Land = { loop: Vec3[]; tint: Tint };

const OCEAN: Tint = [38, 82, 156];
const GRASS: Tint = [92, 152, 86];
const SAND: Tint = [158, 140, 92];
const ICE: Tint = [224, 234, 244];
const RIM: Tint = [150, 180, 220];

/** A ring of directions at a fixed angle from `axis`, wobbled by `shape`. */
function ring(axis: Vec3, spread: number, points: number, shape: (a: number) => number): Vec3[] {
  // Any two directions square to the axis will do to sweep around it.
  const side = Math.abs(axis.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalise(cross(axis, side));
  const v = cross(axis, u);
  const loop: Vec3[] = [];
  for (let i = 0; i < points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    const r = spread * shape(a);
    const out = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    loop.push(normalise(add(scale(axis, Math.cos(r)), scale(out, Math.sin(r)))));
  }
  return loop;
}

/** The same world every time the window opens; it is one ball, not a new one. */
const GLOBE: Land[] = (() => {
  let seed = 0x5bf03635;
  const roll = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const lands: Land[] = [];
  for (let i = 0; i < 7; i += 1) {
    const y = roll() * 1.5 - 0.75;
    const a = roll() * Math.PI * 2;
    const flat = Math.sqrt(Math.max(0, 1 - y * y));
    const axis = vec(Math.cos(a) * flat, y, Math.sin(a) * flat);
    // Two slow harmonics are enough to keep a coastline from looking drawn
    // with a compass.
    const wob1 = 0.16 + roll() * 0.2;
    const wob2 = 0.1 + roll() * 0.16;
    const turn1 = roll() * Math.PI * 2;
    const turn2 = roll() * Math.PI * 2;
    lands.push({
      loop: ring(axis, 0.34 + roll() * 0.4, 18, (t) =>
        1 + wob1 * Math.sin(2 * t + turn1) + wob2 * Math.sin(3 * t + turn2),
      ),
      tint: roll() < 0.3 ? SAND : GRASS,
    });
  }
  // Ice at both ends, so which way up the ball has rolled is never in doubt.
  for (const pole of [1, -1]) {
    lands.push({
      loop: ring(vec(0, pole, 0), 0.3, 16, (t) => 1 + 0.12 * Math.sin(3 * t)),
      tint: ICE,
    });
  }
  return lands;
})();

/**
 * The part of a loop still on the side of the ball facing us. `limb` is where
 * the horizon actually falls: on a ball this close it is not quite halfway
 * round, and using halfway leaves slivers of the far side showing at the edge.
 */
function thisSide(loop: Vec3[], toCam: Vec3, limb: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const da = dot(a, toCam) - limb;
    const db = dot(b, toCam) - limb;
    if (da > 0) out.push(a);
    if (da > 0 !== db > 0) {
      const t = da / (da - db);
      out.push(normalise(vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)));
    }
  }
  return out;
}

export function collectMarble(view: View, marble: Marble, blocks: Block[]): Drawable[] {
  const queue: Drawable[] = [];
  // Its centre, not its far side. Measured to the far side it can beat the far
  // corner of the very floor it is resting on, and sink into it.
  const ballAway = length(sub(marble.pos, view.camera.pos));

  const shadow = floorBelow(blocks, marble.pos);
  if (shadow && shadow.drop < 14) {
    const e = toEye(view, add(shadow.point, vec(0, 0.02, 0)));
    const depth = -e.z;
    if (depth > 0.3) {
      const p = project(view, e);
      const rx = (view.focal / depth) * marble.radius * (1.05 + shadow.drop * 0.05);
      const ry = rx * Math.max(0.2, Math.sin(view.camera.pitch));
      const alpha = 0.42 * Math.max(0, 1 - shadow.drop / 14) * (1 - fogAt(depth));
      queue.push({
        // Sorted with the ball rather than with the floor it lands on: it only
        // ever falls directly under the ball, so whatever hides the ball's feet
        // should hide it too, and this way the floor can't swallow it.
        away: ballAway + 0.01,
        paint: (ctx) => {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(4,6,14,${alpha})`;
          ctx.fill();
        },
      });
    }
  }

  const eye = toEye(view, marble.pos);
  const depth = -eye.z;
  if (depth <= marble.radius + 0.15) return queue;

  const centre = project(view, eye);
  const radius = (view.focal / depth) * marble.radius;
  const toCam = normalise(sub(view.camera.pos, marble.pos));
  const fog = fogAt(ballAway);
  // Where on the disc the light lands, so the shading turns with the camera.
  const lightEye = apply(view.rot, LIGHT);
  const offX = lightEye.x * radius * 0.45;
  const offY = -lightEye.y * radius * 0.45;

  // Where the horizon of a ball this size falls, seen from this far off.
  const limb = marble.radius / depth;
  const coasts = GLOBE.map((land) => {
    const seen = thisSide(land.loop.map((d) => apply(marble.turn, d)), toCam, limb);
    if (seen.length < 3) return null;
    return {
      fill: rgb(fogged(land.tint, 1, fog, SKY)),
      shape: seen.map((d) => project(view, toEye(view, add(marble.pos, scale(d, marble.radius))))),
    };
  }).filter((c): c is { fill: string; shape: { x: number; y: number }[] } => c !== null);

  const sea = rgb(fogged(OCEAN, 1, fog, SKY));
  const rim = rgb(fogged(RIM, 0.55, fog, SKY));

  queue.push({
    away: ballAway,
    paint: (ctx) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = sea;
      ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);

      for (const coast of coasts) {
        ctx.beginPath();
        ctx.moveTo(coast.shape[0].x, coast.shape[0].y);
        for (let i = 1; i < coast.shape.length; i += 1) ctx.lineTo(coast.shape[i].x, coast.shape[i].y);
        ctx.closePath();
        ctx.fillStyle = coast.fill;
        ctx.fill();
        // Stroked in its own colour: without it the canvas leaves the coastline
        // ragged at this size.
        ctx.lineWidth = 1;
        ctx.strokeStyle = coast.fill;
        ctx.stroke();
      }

      // Daylight across the face of it: bright where the light falls, falling
      // away into shadow round the other side.
      const shade = ctx.createRadialGradient(
        centre.x + offX,
        centre.y + offY,
        radius * 0.1,
        centre.x + offX * 0.4,
        centre.y + offY * 0.4,
        radius * 1.5,
      );
      shade.addColorStop(0, "rgba(255,252,236,0.3)");
      shade.addColorStop(0.45, "rgba(255,252,236,0)");
      shade.addColorStop(1, "rgba(2,6,18,0.72)");
      ctx.fillStyle = shade;
      ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rim;
      ctx.stroke();
    },
  });

  return queue;
}

/**
 * The finish pad's halo. Drawn over everything because it is light rather than
 * a thing, and it is the only congratulation the game offers.
 */
export function drawFinishGlow(ctx: CanvasRenderingContext2D, view: View, blocks: Block[], lift: number) {
  if (lift <= 0.01) return;
  const pad = blocks.find((b) => b.goal);
  if (!pad) return;
  const e = toEye(view, add(pad.centre, vec(0, 1.4, 0)));
  const depth = -e.z;
  if (depth < 0.5) return;
  const p = project(view, e);
  const radius = (view.focal / depth) * 7;
  const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
  halo.addColorStop(0, `rgba(150,248,226,${0.34 * lift})`);
  halo.addColorStop(1, "rgba(150,248,226,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
}
