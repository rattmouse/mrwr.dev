/**
 * What marbles.exe is a game of: the boxes the course is built from, the ball
 * that rolls over them, and the handful of rules that get it from one to the
 * other.
 *
 * Every solid in the course is a box — some of them turned, some tilted into
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
  /** The last place it was properly supported — where a fall puts it back. */
  safe: Vec3;
};

/** What the keys are asking for this frame, in the camera's own directions. */
export type Input = { forward: number; right: number; yaw: number };

export type Events = { fell: boolean; reached: boolean };

export const START: Vec3 = { x: 0, y: 0.5, z: 4 };

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
 * walk the ball off the back of the ferry over the length of a crossing.
 */
const CARRY = 25;
/** A surface this close to level is something you can stand on. */
const FOOTING = 0.5;
/** Fixed physics step. Collisions against thin walls need the small slice. */
const STEP = 1 / 120;

/* ------------------------------------------------------------- the course */

function block(
  centre: Vec3,
  half: Vec3,
  tint: Tint,
  extra: Partial<Pick<Block, "yaw" | "tilt" | "solid" | "goal" | "spin" | "slide">> = {},
): Block {
  const yaw = extra.yaw ?? 0;
  const tilt = extra.tilt ?? 0;
  return {
    home: centre,
    centre,
    vel: vec(0, 0, 0),
    half,
    yaw,
    tilt,
    rot: orientation(yaw, tilt),
    tint,
    solid: extra.solid ?? true,
    goal: extra.goal,
    spin: extra.spin,
    slide: extra.slide,
  };
}

const DEG = Math.PI / 180;

const PAD: Tint = [86, 100, 128];
const LEDGE: Tint = [112, 126, 156];
const RAMP: Tint = [176, 132, 74];
const WALL: Tint = [198, 86, 104];
const FERRY: Tint = [92, 176, 148];
const POST: Tint = [120, 214, 214];
const GOAL: Tint = [96, 232, 208];
const SCENERY: Tint = [74, 70, 112];

/**
 * The course, from the pad the ball starts on to the pad it is trying to
 * reach: a narrow bridge, a zigzag between three walls, a ramp up, a ferry
 * across open space, a staircase curving down and away, and a short run
 * between bumpers to the finish. Everything hangs in the dark with nothing
 * under it.
 */
export function buildCourse(): Block[] {
  const blocks: Block[] = [];

  // Where you start. The back wall is there so the first thing you do can't be
  // to roll off behind you.
  blocks.push(block(vec(0, -0.5, 2), vec(5, 0.5, 5), PAD));
  blocks.push(block(vec(0, 0.1, 7.3), vec(5.3, 0.6, 0.3), LEDGE));

  // The bridge over: two and a half marbles wide, and nothing either side.
  blocks.push(block(vec(0, -0.5, -7.5), vec(1.3, 0.5, 4.5), LEDGE));

  // The zigzag. Each wall leaves its gap on the other side from the last.
  blocks.push(block(vec(0, -0.5, -17), vec(5, 0.5, 5), PAD));
  blocks.push(block(vec(-1.6, 0.7, -14.5), vec(3.4, 0.7, 0.3), WALL));
  blocks.push(block(vec(1.6, 0.7, -17), vec(3.4, 0.7, 0.3), WALL));
  blocks.push(block(vec(-1.6, 0.7, -19.5), vec(3.4, 0.7, 0.3), WALL));

  // Up the ramp. Its lower lip is flush with the pad behind it and its top
  // with the pad in front, which is what the awkward numbers are.
  blocks.push(block(vec(0, 0.77, -26.15), vec(2.6, 0.4, 4.2), RAMP, { tilt: 16 * DEG }));
  blocks.push(block(vec(0, 1.8, -34), vec(5, 0.5, 4), PAD));

  // The ferry. It touches the pad behind at one end of its travel and the
  // island ahead at the other, so it is only ever worth boarding on the beat.
  // Deck and rails are three separate boxes sliding on the same description,
  // which is the only way they stay together; without the rails the least
  // sideways drift takes you off the edge somewhere over the gap.
  const crossing = { axis: vec(0, 0, 1), reach: 5.8, period: 7, phase: 0 };
  blocks.push(block(vec(0, 1.9, -44), vec(2.2, 0.4, 2.2), FERRY, { slide: crossing }));
  for (const x of [-2.05, 2.05]) {
    blocks.push(block(vec(x, 2.7, -44), vec(0.15, 0.4, 2.2), POST, { slide: crossing }));
  }
  // Longer at the far end than it looks like it needs to be: the steps below
  // are turned to follow their arc, so their near edge comes away at an angle
  // and the island has to reach past it or there is a notch to drop into.
  blocks.push(block(vec(0, 1.8, -55), vec(5.5, 0.5, 5.8), PAD));

  // Five steps curving away off the island and dropping as they go. Worked
  // round an arc rather than typed out one by one, so the ribbon stays joined
  // up if the radius or the sweep is ever changed.
  const arc = { x: -9, z: -60, radius: 9 };
  for (let i = 1; i <= 5; i += 1) {
    const angle = i * 18 * DEG;
    blocks.push(
      block(
        vec(
          arc.x + arc.radius * Math.cos(angle),
          2.3 - 0.6 * i - 0.5,
          arc.z - arc.radius * Math.sin(angle),
        ),
        vec(2.2, 0.5, 1.9),
        i % 2 ? LEDGE : PAD,
        // Turned to put its long axis along the arc, not across it — the
        // steps overlap each other by a marble's width that way round.
        { yaw: angle },
      ),
    );
  }

  // The run in, with three bumpers to get round. Wide enough that there is
  // always a clear way past each one without being wide enough to ignore them.
  blocks.push(block(vec(-16.5, -1.2, -69), vec(5.5, 0.5, 3.6), PAD));
  blocks.push(block(vec(-13, 0.1, -70.2), vec(0.8, 0.8, 0.8), WALL, { yaw: 20 * DEG }));
  blocks.push(block(vec(-16, 0.1, -67.8), vec(0.8, 0.8, 0.8), WALL, { yaw: -25 * DEG }));
  blocks.push(block(vec(-19, 0.1, -70.2), vec(0.8, 0.8, 0.8), WALL, { yaw: 10 * DEG }));

  // The finish: a lit pad between four posts. Nothing says so in words.
  blocks.push(block(vec(-25, -1.2, -69), vec(3, 0.5, 3.6), GOAL, { goal: true }));
  for (const x of [-22.6, -27.4]) {
    for (const z of [-71.6, -66.4]) {
      blocks.push(block(vec(x, 0.9, z), vec(0.25, 1.6, 0.25), POST));
    }
  }

  // Scenery: shapes hanging in the dark, turning slowly, that the ball passes
  // straight through. They are here to give the space some depth — without
  // them there is nothing out there to judge distance against.
  const floaters: [number, number, number, number, number][] = [
    [12, 6, -10, 2.4, 0.18],
    [-13, 9, -24, 3.2, -0.12],
    [16, -5, -36, 2.0, 0.24],
    [-18, 4, -46, 2.8, 0.09],
    [11, 12, -58, 3.6, -0.16],
    [-4, -9, -64, 2.2, 0.21],
    [-28, 7, -56, 3.0, -0.2],
    [4, 5, -76, 2.6, 0.13],
    [-34, -4, -74, 2.4, 0.17],
    [22, 2, -66, 2.0, -0.26],
  ];
  for (const [x, y, z, size, spin] of floaters) {
    blocks.push(
      block(vec(x, y, z), vec(size, size * 0.7, size), SCENERY, {
        solid: false,
        spin,
        tilt: 22 * DEG,
      }),
    );
  }

  return blocks;
}

export function newMarble(): Marble {
  return {
    pos: { ...START },
    vel: vec(0, 0, 0),
    radius: 0.45,
    turn: IDENTITY,
    omega: vec(0, 0, 0),
    grounded: false,
    safe: { ...START },
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

export function resetMarble(marble: Marble) {
  marble.pos = { ...START };
  marble.vel = vec(0, 0, 0);
  marble.omega = vec(0, 0, 0);
  marble.turn = IDENTITY;
  marble.grounded = false;
  marble.safe = { ...START };
}
