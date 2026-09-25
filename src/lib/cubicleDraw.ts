/**
 * Turning the office into a picture.
 *
 * The same back-to-front painter marbles.exe uses, cut down to axis-aligned
 * boxes: every face pointing at the eye is clipped against the near plane,
 * projected, and dropped into one queue sorted by its furthest corner.
 *
 * One quad per face, never cut up — that is the whole of why things stop
 * sinking into the walls. Sorting by the furthest corner is only sound while
 * the thing underneath is bigger than the thing on top of it: a whole floor's
 * furthest corner is the far corner of the room, which beats everything
 * standing on it, and a whole partition's beats anything pinned to it. Cut
 * that floor into tiles and the rule breaks — a tile under the middle of the
 * desk has its corners nearer than the desk's own far corners, so it sorts
 * last and paints straight over the desk.
 *
 * Every face is a flat colour. The work the painter does per frame is
 * therefore almost all arithmetic, and most of it is thrown away before it is
 * done: a box outside the view is dropped on one test of its bounding sphere,
 * and a face that lands off screen is dropped before it reaches the queue.
 * What is left carries no closures and builds no colour strings, so a frame
 * allocates a few hundred small things rather than a few thousand.
 *
 * What the monitor is showing is usually not in here at all. That is a real
 * browser, a DOM element the window lays over the glass — this file only works
 * out where the glass has ended up on screen so it can be put there. The one
 * exception is a cubicle already running inside one, which has no browser to
 * lay over anything and hands the glass the last frame of the room instead;
 * that is the only thing still stretched over triangles.
 */

import {
  clipNear,
  fogged,
  project,
  rgb,
  Screen,
  Tint,
  toEye,
  vec,
  Vec3,
  View,
} from "@/lib/marbles3d";
import { Box, screenPoint } from "@/lib/cubicle";

/** An image and the size to treat it as. Only the glass has one. */
export type Skin = { image: CanvasImageSource; width: number; height: number };

/**
 * One flat quad, ready to paint. Plain data rather than a closure: there are a
 * few hundred a frame and the closures alone were worth collecting.
 */
export type Face = {
  away: number;
  poly: Screen[];
  colour: string;
  /** The glass, and only the glass, has more to do than fill itself. */
  extra?: (ctx: CanvasRenderingContext2D) => void;
};

/** What the room sinks into once it is far enough off. */
export const VOID: Tint = [17, 18, 24];
const FOG_NEAR = 5;
const FOG_FAR = 30;
const FOG_MAX = 0.7;
/** Fog is banded so its colours can be worked out once and kept. */
const FOG_STEPS = 24;

/** Strip lighting: flat from above, so the shade depends only on which way a face looks. */
const SHADE = [0.7, 0.7, 1, 0.56, 0.86, 0.86];

/** How far off screen a face may stray before it is not worth queueing. */
const MARGIN = 48;

/**
 * How far back in the queue a wall's outward face is pushed, in metres. Bigger
 * than the room, so it lands after everything the room contains.
 */
const OCCLUDE = 1000;

/** One cell of the picture hung on the glass, and where it falls on screen. */
type Cell = { p: [Screen, Screen, Screen, Screen]; t: [Screen, Screen, Screen, Screen] };

/** How many cells across the glass is split into to follow the perspective. */
const GLASS_CELLS = 4;

/** A monitor with nothing on it. */
const GLASS_OFF = "#0b0f16";

/**
 * The corners of a box, numbered so that bit 0 is x, bit 1 is y and bit 2 is
 * z, each bit saying which end of that half-extent the corner is at. The six
 * faces are then just four of those numbers each, in ring order.
 */
const FACE_RINGS: number[][] = [];
for (let axis = 0; axis < 3; axis += 1) {
  for (const side of [1, -1]) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    FACE_RINGS[axis * 2 + (side > 0 ? 0 : 1)] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([du, dv]) => {
      const bits = [0, 0, 0];
      bits[axis] = side > 0 ? 1 : 0;
      bits[u] = du > 0 ? 1 : 0;
      bits[v] = dv > 0 ? 1 : 0;
      return bits[0] + 2 * bits[1] + 4 * bits[2];
    });
  }
}

function cornersOf(b: Box): Vec3[] {
  if (b.corners) return b.corners;
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push(
      vec(
        b.centre.x + (i & 1 ? b.half.x : -b.half.x),
        b.centre.y + (i & 2 ? b.half.y : -b.half.y),
        b.centre.z + (i & 4 ? b.half.z : -b.half.z),
      ),
    );
  }
  b.corners = out;
  return out;
}

/** The colour of one face of one box at one band of fog, worked out once. */
function toneOf(b: Box, face: number, step: number): string {
  let tones = b.tones;
  if (!tones) {
    tones = [];
    b.tones = tones;
  }
  let row = tones[face];
  if (!row) {
    row = [];
    tones[face] = row;
  }
  const had = row[step];
  if (had) return had;
  const made = b.glow
    ? rgb(b.tint)
    : rgb(fogged(b.tint, SHADE[face], (step / FOG_STEPS) * FOG_MAX, VOID));
  row[step] = made;
  return made;
}

function trace(ctx: CanvasRenderingContext2D, poly: Screen[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function fill(ctx: CanvasRenderingContext2D, poly: Screen[], colour: string) {
  trace(ctx, poly);
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * Every face of every box that is pointing at us, in no particular order.
 * Faces looking away are dropped rather than painted over, which leaves a set
 * of quads that can only overlap across boxes — so the sort has one job
 * instead of two.
 */
export function collectRoom(view: View, boxes: Box[], into: Face[] = []): Face[] {
  into.length = 0;
  const eye = view.camera.pos;
  const { width, height, focal } = view;

  for (const b of boxes) {
    // Cheapest possible rejection first: a sphere round the whole box, tested
    // against the near plane and the edges of the screen. Most of an office is
    // behind you or off to one side at any moment.
    const middle = toEye(view, b.centre);
    const radius = Math.hypot(b.half.x, b.half.y, b.half.z);
    const depth = -middle.z;
    if (depth + radius < 0.12) continue;
    if (depth > radius) {
      const spread = (focal * radius) / (depth - radius);
      const sx = view.cx + (middle.x * focal) / depth;
      const sy = view.cy - (middle.y * focal) / depth;
      if (sx + spread < -MARGIN || sx - spread > width + MARGIN) continue;
      if (sy + spread < -MARGIN || sy - spread > height + MARGIN) continue;
    }

    const corners = cornersOf(b);
    const c = [b.centre.x, b.centre.y, b.centre.z];
    const h = [b.half.x, b.half.y, b.half.z];
    const e = [eye.x, eye.y, eye.z];

    for (let axis = 0; axis < 3; axis += 1) {
      for (const side of [1, -1]) {
        // Only faces the eye is on the outside of.
        if (side * (e[axis] - (c[axis] + side * h[axis])) <= 0) continue;
        const face = axis * 2 + (side > 0 ? 0 : 1);
        const ring = FACE_RINGS[face];

        let far = 0;
        for (const i of ring) {
          const p = corners[i];
          const dx = p.x - eye.x;
          const dy = p.y - eye.y;
          const dz = p.z - eye.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d > far) far = d;
        }
        far = Math.sqrt(far);

        const hiding = b.occludes && b.occludes.axis === axis && b.occludes.side === side;
        const away = far - (b.bias ?? 0) - (hiding ? OCCLUDE : 0);

        const clipped = clipNear(ring.map((i) => toEye(view, corners[i])));
        if (clipped.length < 3) continue;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const poly: Screen[] = [];
        for (const p of clipped) {
          const s = project(view, p);
          poly.push(s);
          if (s.x < minX) minX = s.x;
          if (s.x > maxX) maxX = s.x;
          if (s.y < minY) minY = s.y;
          if (s.y > maxY) maxY = s.y;
        }
        if (maxX < -MARGIN || minX > width + MARGIN) continue;
        if (maxY < -MARGIN || minY > height + MARGIN) continue;

        const step = b.glow
          ? 0
          : Math.min(FOG_STEPS, Math.round((Math.max(0, far - FOG_NEAR) / (FOG_FAR - FOG_NEAR)) * FOG_STEPS));
        into.push({ away, poly, colour: toneOf(b, face, step) });
      }
    }
  }

  return into;
}

/** Furthest first: everything nearer is painted over it. */
export function paintFaces(ctx: CanvasRenderingContext2D, faces: Face[]) {
  faces.sort((a, b) => b.away - a.away);
  for (const f of faces) {
    fill(ctx, f.poly, f.colour);
    if (f.extra) f.extra(ctx);
  }
}

function warpedTriangle(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  p: [Screen, Screen, Screen],
  t: [Screen, Screen, Screen],
) {
  const d = (t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y);
  if (Math.abs(d) < 1e-9) return;
  const a = ((p[1].x - p[0].x) * (t[2].y - t[0].y) - (p[2].x - p[0].x) * (t[1].y - t[0].y)) / d;
  const b = ((p[2].x - p[0].x) * (t[1].x - t[0].x) - (p[1].x - p[0].x) * (t[2].x - t[0].x)) / d;
  const c = ((p[1].y - p[0].y) * (t[2].y - t[0].y) - (p[2].y - p[0].y) * (t[1].y - t[0].y)) / d;
  const e = ((p[2].y - p[0].y) * (t[1].x - t[0].x) - (p[1].y - p[0].y) * (t[2].x - t[0].x)) / d;
  if (![a, b, c, e].every(Number.isFinite)) return;

  // The same hair's growth the room's cells get, so two triangles meeting
  // along a diagonal do not leave the dark showing through the seam.
  const mx = (p[0].x + p[1].x + p[2].x) / 3;
  const my = (p[0].y + p[1].y + p[2].y) / 3;
  const grown = p.map((q) => {
    const dx = q.x - mx;
    const dy = q.y - my;
    const len = Math.hypot(dx, dy) || 1;
    return { x: q.x + (dx / len) * 0.8, y: q.y + (dy / len) * 0.8 };
  });

  ctx.save();
  trace(ctx, grown);
  ctx.clip();
  ctx.transform(a, c, b, e, p[0].x - a * t[0].x - b * t[0].y, p[0].y - c * t[0].x - e * t[0].y);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

/**
 * The dark of a monitor with nothing on it — painted into the same queue as
 * the case around it, so the browser laid over the top always has a lit screen
 * behind it rather than a hole in the tube.
 *
 * Give it a picture and it paints that on the glass instead, on a grid, the
 * way a wall wears its photograph. Hand it the last frame of this very room
 * and the monitor shows the room, whose monitor shows the room before that,
 * for as far back as there is light to see — one blit a frame, however deep
 * it goes, because the depth is already in the picture.
 */
/**
 * Where the monitor's glass has landed on screen, clockwise from its top-left
 * corner — or null when a corner has come round behind the eye, which only
 * happens with your nose against the tube. The browser laid over the glass is
 * placed from these four points, so it sits in the picture exactly.
 */
export function glassQuad(view: View): [Screen, Screen, Screen, Screen] | null {
  const ring = [screenPoint(-1, 1), screenPoint(1, 1), screenPoint(1, -1), screenPoint(-1, -1)];
  const eyes = ring.map((p) => toEye(view, p));
  if (eyes.some((p) => -p.z < 0.14)) return null;
  const flat = eyes.map((e) => project(view, e));
  return [flat[0], flat[1], flat[2], flat[3]];
}

export function collectGlass(view: View, quad: Screen[] | null, showing?: Skin | null): Face | null {
  if (!quad) return null;
  const eye = view.camera.pos;
  const ring = [screenPoint(-1, 1), screenPoint(1, 1), screenPoint(1, -1), screenPoint(-1, -1)];
  let far = 0;
  for (const p of ring) {
    const d = (p.x - eye.x) ** 2 + (p.y - eye.y) ** 2 + (p.z - eye.z) ** 2;
    if (d > far) far = d;
  }
  const away = Math.sqrt(far);
  if (!showing) return { away, poly: quad, colour: GLASS_OFF };

  // The glass is one flat rectangle and the eye is usually square on to it, so
  // it wants far fewer cells than a wall would to follow the perspective.
  const at = (i: number, j: number) => {
    const u = -1 + (2 * i) / GLASS_CELLS;
    const v = 1 - (2 * j) / GLASS_CELLS;
    return {
      s: project(view, toEye(view, screenPoint(u, v))),
      t: { x: ((u + 1) / 2) * showing.width, y: ((1 - v) / 2) * showing.height },
    };
  };
  const grid: ReturnType<typeof at>[][] = [];
  for (let i = 0; i <= GLASS_CELLS; i += 1) {
    const col = [];
    for (let j = 0; j <= GLASS_CELLS; j += 1) col.push(at(i, j));
    grid.push(col);
  }
  const cells: Cell[] = [];
  for (let i = 0; i < GLASS_CELLS; i += 1) {
    for (let j = 0; j < GLASS_CELLS; j += 1) {
      const q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      cells.push({ p: [q[0].s, q[1].s, q[2].s, q[3].s], t: [q[0].t, q[1].t, q[2].t, q[3].t] });
    }
  }

  const image = showing.image;
  return {
    away,
    poly: quad,
    colour: GLASS_OFF,
    extra: (ctx) => {
      ctx.save();
      // Trimmed at the glass, so the grown cells cannot creep onto the bezel.
      trace(ctx, quad);
      ctx.clip();
      for (const cell of cells) {
        warpedTriangle(ctx, image, [cell.p[0], cell.p[1], cell.p[2]], [cell.t[0], cell.t[1], cell.t[2]]);
        warpedTriangle(ctx, image, [cell.p[0], cell.p[2], cell.p[3]], [cell.t[0], cell.t[2], cell.t[3]]);
      }
      ctx.restore();
    },
  };
}

/**
 * The CSS transform that lays a w × h element exactly over those four corners.
 * A flat rectangle seen in perspective is a homography, and a homography is
 * what matrix3d does when the third row and column are left alone — so the
 * browser on the desk lines up with the painted monitor around it at any
 * angle, and keeps lining up as you walk.
 */
export function quadTransform(quad: [Screen, Screen, Screen, Screen], w: number, h: number): string | null {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) return null;

  const g = (sx * dy2 - sy * dx2) / den;
  const i = (dx1 * sy - dy1 * sx) / den;
  const m = [
    (p1.x - p0.x + g * p1.x) / w,
    (p1.y - p0.y + g * p1.y) / w,
    g / w,
    (p3.x - p0.x + i * p3.x) / h,
    (p3.y - p0.y + i * p3.y) / h,
    i / h,
    p0.x,
    p0.y,
  ];
  if (m.some((n) => !Number.isFinite(n))) return null;
  return `matrix3d(${m[0]},${m[1]},0,${m[2]},${m[3]},${m[4]},0,${m[5]},0,0,1,0,${m[6]},${m[7]},0,1)`;
}
