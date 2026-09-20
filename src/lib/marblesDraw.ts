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

/** How far the furthest of these points is from the eye — the paint order. */
function furthest(points: Vec3[], eye: Vec3) {
  let most = 0;
  for (const p of points) most = Math.max(most, length(sub(p, eye)));
  return most;
}

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

      const poly = clipNear(ring.map((p) => toEye(view, p)));
      if (poly.length < 3) continue;

      const away = furthest(ring, eye);
      // Fog by how far off the middle of the face is, not its far corner —
      // otherwise a floor underfoot would fade out along with the horizon.
      let haze = 0;
      for (const p of ring) haze += length(sub(p, eye));
      haze /= ring.length;

      const lambert = 0.34 + 0.66 * Math.max(0, dot(normal, LIGHT));
      const glow = b.goal ? 0.45 + lift * 0.9 : lift * 0.25;
      const shade: Tint = fogged(b.tint, lambert + glow, fogAt(haze), SKY);
      const fill = rgb(shade);
      const edge = rgb(shade, 0.62);
      const screen = poly.map((p) => project(view, p));

      queue.push({
        away,
        paint: (ctx) => {
          ctx.beginPath();
          ctx.moveTo(screen[0].x, screen[0].y);
          for (let i = 1; i < screen.length; i += 1) ctx.lineTo(screen[i].x, screen[i].y);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = edge;
          ctx.stroke();
        },
      });
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

/** A scatter of points over the ball, so that it visibly turns as it rolls. */
const SPOTS: Vec3[] = (() => {
  const out: Vec3[] = [];
  const count = 26;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = golden * i;
    out.push(vec(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
})();

const BALL: Tint = [236, 240, 250];
const BALL_SPOT: Tint = [108, 128, 198];

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

  const spots = SPOTS.map((s) => {
    const dir = apply(marble.turn, s);
    const face = dot(dir, toCam);
    if (face <= 0.12) return null;
    const p = project(view, toEye(view, add(marble.pos, scale(dir, marble.radius * 0.99))));
    return { p, r: radius * 0.2 * face };
  }).filter((s): s is { p: { x: number; y: number }; r: number } => s !== null);

  const lit = rgb(fogged(BALL, 1.05, fog, SKY));
  const dim = rgb(fogged(BALL, 0.42, fog, SKY));
  const spotFill = rgb(fogged(BALL_SPOT, 1, fog, SKY));
  const rim = rgb(fogged(BALL, 0.3, fog, SKY));

  queue.push({
    away: ballAway,
    paint: (ctx) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.clip();

      const shade = ctx.createRadialGradient(
        centre.x + offX,
        centre.y + offY,
        radius * 0.08,
        centre.x,
        centre.y,
        radius * 1.15,
      );
      shade.addColorStop(0, lit);
      shade.addColorStop(1, dim);
      ctx.fillStyle = shade;
      ctx.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);

      ctx.fillStyle = spotFill;
      for (const s of spots) {
        if (s.r < 0.35) continue;
        ctx.beginPath();
        ctx.arc(s.p.x, s.p.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
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
