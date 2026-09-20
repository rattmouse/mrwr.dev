/**
 * The little software renderer marbles.exe draws itself with: enough 3D to put
 * some boxes and a ball in space, and no more.
 *
 * There is no WebGL and no scene graph here. Corners are moved into the
 * camera's frame by hand, clipped against the near plane, divided through by
 * depth, and the resulting flat quads are sorted back-to-front and filled on an
 * ordinary 2D canvas. A painter's algorithm is wrong the moment two shapes
 * interlock, which is exactly why the course is built out of separate boxes
 * floating clear of each other.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Row-major 3×3. Only ever a rotation, so the transpose is the inverse. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

export function normalise(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : vec(0, 0, 0);
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotate a point out of a box's own frame and into the world. */
export function apply(m: Mat3, v: Vec3): Vec3 {
  return vec(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );
}

/** The other way: the world into the box's frame, using the transpose. */
export function applyT(m: Mat3, v: Vec3): Vec3 {
  return vec(
    m[0] * v.x + m[3] * v.y + m[6] * v.z,
    m[1] * v.x + m[4] * v.y + m[7] * v.z,
    m[2] * v.x + m[5] * v.y + m[8] * v.z,
  );
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as Mat3;
}

/**
 * A block's orientation: yaw about the world's up axis, then tilt about the
 * block's own left-right axis. A positive tilt lifts the end facing away from
 * the camera's start, which is the direction the course runs in — so the ramps
 * read as "uphill" with a positive number.
 */
export function orientation(yaw: number, tilt: number): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx: Mat3 = [1, 0, 0, 0, ct, -st, 0, st, ct];
  return multiply(ry, rx);
}

/** Rodrigues' formula, used once a frame to spin the marble by its own roll. */
export function spinBy(m: Mat3, axis: Vec3, angle: number): Mat3 {
  if (Math.abs(angle) < 1e-9) return m;
  const a = normalise(axis);
  if (a.x === 0 && a.y === 0 && a.z === 0) return m;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const delta: Mat3 = [
    t * a.x * a.x + c,
    t * a.x * a.y - s * a.z,
    t * a.x * a.z + s * a.y,
    t * a.x * a.y + s * a.z,
    t * a.y * a.y + c,
    t * a.y * a.z - s * a.x,
    t * a.x * a.z - s * a.y,
    t * a.y * a.z + s * a.x,
    t * a.z * a.z + c,
  ];
  return orthonormalise(multiply(delta, m));
}

/**
 * Thousands of tiny rotations a minute drift out of true, and a marble whose
 * frame has quietly turned into a squash looks wrong. Gram-Schmidt, every time,
 * is cheap enough at one ball.
 */
function orthonormalise(m: Mat3): Mat3 {
  const r0 = normalise(vec(m[0], m[1], m[2]));
  let r1 = vec(m[3], m[4], m[5]);
  r1 = normalise(sub(r1, scale(r0, dot(r0, r1))));
  const r2 = cross(r0, r1);
  return [r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, r2.x, r2.y, r2.z];
}

/* ------------------------------------------------------------------ camera */

export type Camera = {
  /** Where the eye is. */
  pos: Vec3;
  /** Clockwise from looking down −Z. */
  yaw: number;
  /** Positive looks down at the ground. */
  pitch: number;
  /** Vertical field of view, in radians. */
  fov: number;
};

/**
 * Everything the draw pass needs that only changes when the camera or the
 * canvas does — worked out once a frame instead of once a corner.
 */
export type View = {
  camera: Camera;
  /** World → eye, rotation only; the eye's position is subtracted first. */
  rot: Mat3;
  focal: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
};

/** How close to the eye a corner may come before it has to be clipped away. */
const NEAR = 0.12;

export function makeView(camera: Camera, width: number, height: number): View {
  // Undo the camera's own turn: yaw back about up, then pitch back about the
  // camera's left-right axis.
  const cy = Math.cos(-camera.yaw);
  const sy = Math.sin(-camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx: Mat3 = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  return {
    camera,
    rot: multiply(rx, ry),
    focal: height * 0.5 / Math.tan(camera.fov / 2),
    cx: width / 2,
    cy: height / 2,
    width,
    height,
  };
}

/** World point → eye space, where the camera sits at the origin looking down −Z. */
export function toEye(view: View, p: Vec3): Vec3 {
  return apply(view.rot, sub(p, view.camera.pos));
}

export type Screen = { x: number; y: number };

/** Eye space → pixels. Only ever called on points already known to be in front. */
export function project(view: View, e: Vec3): Screen {
  const depth = -e.z;
  const k = view.focal / depth;
  return { x: view.cx + e.x * k, y: view.cy - e.y * k };
}

/**
 * Sutherland-Hodgman against the near plane alone. The canvas clips the sides
 * for free; it is only the plane behind the eye that turns a projection inside
 * out, so that is the only one worth the arithmetic.
 */
export function clipNear(poly: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = -a.z >= NEAR;
    const bIn = -b.z >= NEAR;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (-NEAR - a.z) / (b.z - a.z);
      out.push(vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ colour */

/** Colours are kept as triples so shading is arithmetic rather than string work. */
export type Tint = [number, number, number];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export const rgb = (t: Tint, k = 1): string =>
  `rgb(${clamp255(t[0] * k)},${clamp255(t[1] * k)},${clamp255(t[2] * k)})`;

/** Mix toward the void so far-off shapes sink into the background. */
export function fogged(t: Tint, k: number, fog: number, sky: Tint): Tint {
  const f = fog < 0 ? 0 : fog > 1 ? 1 : fog;
  return [
    t[0] * k * (1 - f) + sky[0] * f,
    t[1] * k * (1 - f) + sky[1] * f,
    t[2] * k * (1 - f) + sky[2] * f,
  ];
}

/* ------------------------------------------------------------- draw queue */

/**
 * One thing to paint, and how far from the eye it is. Faces, the ball and the
 * shadow under it all go into the same queue, so the ball is properly hidden
 * when it rolls behind a pillar.
 *
 * `away` is how far the piece's *furthest* corner is from the eye, which is
 * the one measure that gets a box standing on a floor right. Sort a floor by
 * its middle and anything standing on its far half is painted over; sort it by
 * its far corner and the floor always goes down first, because the far corner
 * of the ground is further away than anything resting on it. Straight-line
 * distance rather than depth into the screen, since the camera looks down on
 * the course rather than along it.
 */
export type Drawable = { away: number; paint: (ctx: CanvasRenderingContext2D) => void };

export function paintQueue(ctx: CanvasRenderingContext2D, queue: Drawable[]) {
  // Furthest first: everything nearer is painted over it.
  queue.sort((a, b) => b.away - a.away);
  for (const item of queue) item.paint(ctx);
}

/* ---------------------------------------------------------------- the sky */

export const SKY: Tint = [10, 12, 22];

/**
 * A fixed scatter of stars on a sphere around the whole course. They are
 * treated as directions rather than places, so they turn with the camera and
 * ignore where it has rolled to — which is what "very far away" looks like.
 */
export function makeStars(count: number): { dir: Vec3; size: number; glow: number }[] {
  // Deterministic: the sky should be the same sky every time the window opens.
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const stars: { dir: Vec3; size: number; glow: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    stars.push({
      dir: vec(r * Math.cos(a), z, r * Math.sin(a)),
      size: 0.5 + random() * 1.4,
      glow: 0.25 + random() * 0.75,
    });
  }
  return stars;
}

export function drawSky(
  ctx: CanvasRenderingContext2D,
  view: View,
  stars: { dir: Vec3; size: number; glow: number }[],
) {
  const { width, height } = view;
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, "rgb(6,7,15)");
  wash.addColorStop(0.55, rgb(SKY));
  wash.addColorStop(1, "rgb(18,16,32)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  for (const star of stars) {
    const e = apply(view.rot, star.dir);
    if (-e.z < 0.2) continue;
    const p = project(view, e);
    if (p.x < -4 || p.y < -4 || p.x > width + 4 || p.y > height + 4) continue;
    ctx.fillStyle = `rgba(226,232,255,${star.glow * 0.8})`;
    ctx.fillRect(p.x - star.size / 2, p.y - star.size / 2, star.size, star.size);
  }
}
