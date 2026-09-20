/**
 * What marbles.exe is a game of: what a piece of a course is, the ball that
 * rolls over it, and the handful of rules that get one to the other. The
 * courses themselves are rolled in marblesLayout.
 *
 * Every solid in a course is a box — some of them turned, some tilted into
 * ramps, one of them sliding back and forth across a gap. That is the whole
 * vocabulary, which is why a sphere-against-box test is the only collision
 * this file knows how to do.
 */

import {
  add,
  apply,
  applyT,
  cross,
  dot,
  IDENTITY,
  length,
  Mat3,
  normalise,
  orientation,
  scale,
  spinBy,
  sub,
  Tint,
  vec,
  Vec3,
} from "@/lib/marbles3d";

export type Block = {
  /** Where it was built; a sliding block swings either side of this. */
  home: Vec3;
  /** Where it is this frame. */
  centre: Vec3;
  /** How fast it is going, so the ball it is carrying goes too. */
  vel: Vec3;
  /** Half its size along its own three axes. */
  half: Vec3;
  yaw: number;
  tilt: number;
  rot: Mat3;
  tint: Tint;
  /** Scenery is drawn but not stood on. */
  solid: boolean;
  /** The finish pad, which lights up rather than being told about in words. */
  goal?: boolean;
  /** Radians a second about up — scenery only. */
  spin?: number;
  /** A block that shuttles along an axis, to ferry the ball over a gap. */
  slide?: { axis: Vec3; reach: number; period: number; phase: number };
};

export type Marble = {
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** How far it has rolled, so the spots on it turn with it. */
  turn: Mat3;
  /** The roll it picked up at its last contact; it keeps it through the air. */
  omega: Vec3;
  grounded: boolean;
  /** How long since it last had footing, which is what a late jump is allowed. */
  offGround: number;
  /** The last place it was properly supported — where a fall puts it back. */
  safe: Vec3;
};

/** What the keys are asking for this frame, in the camera's own directions. */
export type Input = {
  forward: number;
  right: number;
  yaw: number;
  /** True on the frame the jump key goes down, not while it is held. */
  jump: boolean;
};

export type Events = { fell: boolean; reached: boolean };

/** Below this there is nothing but sky, and the ball has plainly missed. */
const VOID = -25;

const GRAVITY = 26;
const PUSH_GROUND = 30;
const PUSH_AIR = 11;
const TOP_SPEED = 17;
/** How fast rolling bleeds off on the flat, per second. */
const ROLL_DRAG = 0.9;
const AIR_DRAG = 0.06;
/** Only a real thump bounces; anything gentler just stops dead against the box. */
const BOUNCE_ABOVE = 7;
const BOUNCE = 0.35;
/**
 * How hard a sliding block hangs on to whatever is riding it. High enough that
 * rolling drag — which works against the world, not against the block — can't
 * walk the ball off the back of the ferry over the length of a crossing, and
 * no higher: grip much past this pins the ball to the deck, and there is no
 * rolling off at the far end before the ferry sets back the way it came.
 */
const CARRY = 9;
/** A surface this close to level is something you can stand on. */
const FOOTING = 0.5;
/**
 * How hard a jump pushes off. About a marble and a half of height, which is
 * roughly four metres of ground at a fair roll — the gaps are cut to suit.
 */
const JUMP = 9.5;
/**
 * And how long after rolling off an edge a jump still works. Without a little
 * of this every jump from the lip of a platform feels stolen.
 */
const COYOTE = 0.12;
/** Fixed physics step. Collisions against thin walls need the small slice. */
const STEP = 1 / 120;

export function newMarble(start: Vec3): Marble {
  return {
    pos: { ...start },
    vel: vec(0, 0, 0),
    radius: 0.45,
    turn: IDENTITY,
    omega: vec(0, 0, 0),
    grounded: false,
    offGround: 0,
    safe: { ...start },
  };
}

/** Move the blocks that move: the ferry along its axis, the scenery about itself. */
export function stepCourse(blocks: Block[], clock: number, dt: number) {
  for (const b of blocks) {
    if (b.slide) {
      const w = (Math.PI * 2) / b.slide.period;
      const offset = b.slide.reach * Math.sin(w * clock + b.slide.phase);
      b.centre = add(b.home, scale(b.slide.axis, offset));
      b.vel = scale(b.slide.axis, b.slide.reach * w * Math.cos(w * clock + b.slide.phase));
    }
    if (b.spin) {
      b.yaw += b.spin * dt;
      b.rot = orientation(b.yaw, b.tilt);
    }
  }
}

/* ------------------------------------------------------------------ the ball */

/**
 * One contact between the ball and one box, resolved on the spot: push the ball
 * back out along the shortest way, take the speed out of the direction it was
 * driven in, and let a block that is moving drag it along.
 */
function collide(marble: Marble, b: Block, dt: number): { normal: Vec3; safe: boolean } | null {
  const local = applyT(b.rot, sub(marble.pos, b.centre));
  const near = vec(
    Math.max(-b.half.x, Math.min(b.half.x, local.x)),
    Math.max(-b.half.y, Math.min(b.half.y, local.y)),
    Math.max(-b.half.z, Math.min(b.half.z, local.z)),
  );
  const away = sub(local, near);
  const gap = length(away);
  if (gap >= marble.radius) return null;

  let normalLocal: Vec3;
  let depth: number;
  if (gap > 1e-6) {
    normalLocal = scale(away, 1 / gap);
    depth = marble.radius - gap;
  } else {
    // Dead centre inside the box — nothing to point away from, so leave by
    // whichever face is closest.
    const slack = [b.half.x - Math.abs(local.x), b.half.y - Math.abs(local.y), b.half.z - Math.abs(local.z)];
    const axis = slack[0] < slack[1] ? (slack[0] < slack[2] ? 0 : 2) : slack[1] < slack[2] ? 1 : 2;
    const sign = (axis === 0 ? local.x : axis === 1 ? local.y : local.z) < 0 ? -1 : 1;
    normalLocal = vec(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    depth = marble.radius + slack[axis];
  }

  const normal = apply(b.rot, normalLocal);
  marble.pos = add(marble.pos, scale(normal, depth));

  // Everything below is relative to the box: a ferry sliding under the ball is
  // not a collision, and the ball should not bounce off it for moving.
  const rel = sub(marble.vel, b.vel);
  const closing = dot(rel, normal);
  if (closing < 0) {
    const bounce = closing < -BOUNCE_ABOVE ? BOUNCE : 0;
    marble.vel = sub(marble.vel, scale(normal, (1 + bounce) * closing));
  }

  const moving = length(b.vel);
  if (moving > 1e-4 && normal.y > FOOTING) {
    const axis = scale(b.vel, 1 / moving);
    const have = dot(marble.vel, axis);
    marble.vel = add(marble.vel, scale(axis, (moving - have) * (1 - Math.exp(-CARRY * dt))));
  }

  // Somewhere to come back to after a fall, but only from well inside a level
  // surface — the lip of a ramp is exactly where you don't want to be put back.
  const safe =
    normal.y > 0.85 &&
    !b.slide &&
    Math.abs(local.x) < b.half.x - 1 &&
    Math.abs(local.z) < b.half.z - 1;

  return { normal, safe };
}

/**
 * A slice of the game: gravity, whatever the keys are asking for, then every
 * box in turn. Called in fixed steps however long the frame was, because a fast
 * ball and a thin wall don't survive a variable one.
 */
function substep(marble: Marble, blocks: Block[], input: Input, dt: number): Events {
  const events: Events = { fell: false, reached: false };

  // The keys are in the camera's directions, not the world's.
  const forward = vec(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
  const right = vec(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  let push = add(scale(forward, input.forward), scale(right, input.right));
  const wanted = length(push);
  if (wanted > 1) push = scale(push, 1 / wanted);

  const wasGrounded = marble.grounded;
  let accel = scale(push, wasGrounded ? PUSH_GROUND : PUSH_AIR);
  accel = add(accel, vec(0, -GRAVITY, 0));

  marble.vel = add(marble.vel, scale(accel, dt));
  marble.pos = add(marble.pos, scale(marble.vel, dt));

  marble.grounded = false;
  let ground: Vec3 | null = null;
  let safeHere = false;
  for (const b of blocks) {
    if (!b.solid) continue;
    const hit = collide(marble, b, dt);
    if (!hit) continue;
    if (hit.normal.y > FOOTING) {
      marble.grounded = true;
      if (!ground || hit.normal.y > ground.y) ground = hit.normal;
      if (hit.safe) safeHere = true;
    }
    if (b.goal) events.reached = true;
  }

  marble.offGround = marble.grounded ? 0 : marble.offGround + dt;

  if (marble.grounded && ground) {
    // On a slope, push along the slope rather than into it.
    const into = dot(push, ground);
    if (into !== 0) {
      const along = sub(push, scale(ground, into));
      marble.vel = add(marble.vel, scale(sub(along, push), (wasGrounded ? PUSH_GROUND : PUSH_AIR) * dt));
    }
    const drag = Math.exp(-ROLL_DRAG * dt);
    marble.vel = vec(marble.vel.x * drag, marble.vel.y, marble.vel.z * drag);
    // Rolling without slipping: the whole ball turns at the speed its contact
    // point is being dragged along at.
    marble.omega = scale(cross(ground, marble.vel), 1 / marble.radius);
    if (safeHere && length(marble.vel) < 14) marble.safe = { ...marble.pos };
  } else {
    const drag = Math.exp(-AIR_DRAG * dt);
    marble.vel = scale(marble.vel, drag);
  }

  const flat = Math.hypot(marble.vel.x, marble.vel.z);
  if (flat > TOP_SPEED) {
    const k = TOP_SPEED / flat;
    marble.vel = vec(marble.vel.x * k, marble.vel.y, marble.vel.z * k);
  }

  const turn = length(marble.omega);
  if (turn > 1e-5) marble.turn = spinBy(marble.turn, normalise(marble.omega), turn * dt);

  if (marble.pos.y < VOID) {
    events.fell = true;
    marble.pos = { ...marble.safe };
    marble.vel = vec(0, 0, 0);
    marble.omega = vec(0, 0, 0);
  }

  return events;
}

/** A whole frame's worth of physics, however long the frame was. */
export function stepMarble(marble: Marble, blocks: Block[], input: Input, dt: number): Events {
  const events: Events = { fell: false, reached: false };

  // Taken once, at the top of the frame rather than inside the loop: the key
  // is pressed once and the ball should leave the ground once, however many
  // slices the frame happens to be cut into. Straight up whatever it is
  // standing on, and never twice without landing in between.
  if (input.jump && (marble.grounded || marble.offGround < COYOTE)) {
    marble.vel = vec(marble.vel.x, JUMP, marble.vel.z);
    marble.grounded = false;
    marble.offGround = COYOTE;
  }

  let left = Math.min(dt, 0.1);
  while (left > 1e-4) {
    const slice = Math.min(STEP, left);
    const got = substep(marble, blocks, input, slice);
    events.fell = events.fell || got.fell;
    events.reached = events.reached || got.reached;
    left -= slice;
  }
  return events;
}

export function resetMarble(marble: Marble, start: Vec3) {
  marble.pos = { ...start };
  marble.vel = vec(0, 0, 0);
  marble.omega = vec(0, 0, 0);
  marble.turn = IDENTITY;
  marble.grounded = false;
  marble.offGround = 0;
  marble.safe = { ...start };
}
