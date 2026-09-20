/**
 * Where a course comes from. marbles.exe rolls a fresh one every time the
 * window is opened, out of the same handful of things a course is made of: a
 * bridge, a zigzag, a ramp, a ferry across open space, a staircase curving
 * down, a run between bumpers, a gap or a line of stepping stones to jump,
 * and a lit pad at the end.
 *
 * It is laid out like a turtle walking: a cursor carries a position, a heading
 * and the height of the surface you are standing on, and each section is built
 * ahead of wherever the cursor has got to and hands back a new one. That is
 * what keeps the pieces joined up without any of the numbers being written
 * down by hand.
 *
 * Two rules do most of the work, and both of them are scars:
 *
 *  - **No two sections overlap in plan.** Not "rarely" — never. Shapes that
 *    pass through each other cannot be put in any drawing order that looks
 *    right, and the renderer sorts whole faces, so an interlocking seam flips
 *    as the camera moves and one shape shows through the other. A candidate
 *    section that would land on top of anything already placed is thrown away
 *    and rolled again.
 *  - **Pieces that meet end-on stop short of each other** by SEAM rather than
 *    touching, for the same reason. A marble is nearly a metre across and
 *    rolls over a gap that size without noticing it.
 *
 * The staircase is the one place anything overlaps, because its steps have to
 * for the ribbon to be continuous — there each step drops further than a step
 * is thick, so they clear each other vertically instead.
 */

import { orientation, vec, type Tint, type Vec3 } from "@/lib/marbles3d";
import type { Block } from "@/lib/marblesCourse";

/** Half the thickness of everything you roll on, and the same for all of it. */
const SLAB = 0.28;
/** How much daylight is left between two pieces that meet end-on. */
const SEAM = 0.15;
/** How far each step of a staircase drops. More than a step is thick. */
const STEP_DROP = 0.6;
/**
 * How wide a gap may be before it stops being a jump and starts being a fall.
 * A jump carries about four metres at a fair roll, so these are cut to leave
 * something in hand for arriving short of top speed.
 */
const LEAP = { least: 2.4, most: 4 };
/** How far above and below the starting pad the course is allowed to wander. */
const CEILING = 10;
const FLOOR = -8;

const PAD: Tint = [86, 100, 128];
const LEDGE: Tint = [112, 126, 156];
const RAMP: Tint = [176, 132, 74];
const WALL: Tint = [198, 86, 104];
const FERRY: Tint = [92, 176, 148];
const POST: Tint = [120, 214, 214];
const GOAL: Tint = [96, 232, 208];
const SCENERY: Tint = [74, 70, 112];

export type Course = {
  blocks: Block[];
  /** Where the ball is put, and put back after it has been round. */
  start: Vec3;
  /**
   * The line the course is meant to be taken along, a point per section. The
   * game only reads the first step of it, to point the camera down the course
   * rather than at whatever happens to be behind you; the checks walk the
   * whole thing to make sure a course can actually be got round.
   */
  route: Vec3[];
  seed: number;
};

/* ------------------------------------------------------------------ dice */

/** The same seed gives the same course, which is what makes a bug reportable. */
function dice(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Roll = () => number;
const between = (r: Roll, lo: number, hi: number) => lo + r() * (hi - lo);
const upTo = (r: Roll, n: number) => Math.floor(r() * n);
const coin = (r: Roll) => (r() < 0.5 ? -1 : 1);

/* --------------------------------------------------------------- the walk */

/**
 * Where the last section left off: a point on the ground, the way the course
 * is running, and the height of the surface you would be standing on.
 */
type Cursor = { x: number; z: number; top: number; heading: number };

/** Which way is forward, and which way is to the right of that. */
const ahead = (c: Cursor) => ({ x: Math.sin(c.heading), z: -Math.cos(c.heading) });
const beside = (c: Cursor) => ({ x: Math.cos(c.heading), z: Math.sin(c.heading) });

const step = (c: Cursor, forward: number, side = 0): Cursor => {
  const f = ahead(c);
  const r = beside(c);
  return {
    ...c,
    x: c.x + f.x * forward + r.x * side,
    z: c.z + f.z * forward + r.z * side,
  };
};

function make(
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

/** A flat piece of floor, placed by the height of the surface you roll on. */
function slab(
  c: Cursor,
  forward: number,
  side: number,
  top: number,
  halfW: number,
  halfL: number,
  tint: Tint,
  extra: Partial<Pick<Block, "goal">> = {},
) {
  const at = step(c, forward, side);
  return make(vec(at.x, top - SLAB, at.z), vec(halfW, SLAB, halfL), tint, { yaw: -c.heading, ...extra });
}

/** A point on the intended line through a section, in the cursor's own frame. */
const spot = (c: Cursor, forward: number, side: number, top: number): Vec3 => {
  const at = step(c, forward, side);
  return vec(at.x, top, at.z);
};

/** Something standing on the floor — a wall, a bumper, a gatepost. */
function stood(c: Cursor, forward: number, side: number, floor: number, half: Vec3, tint: Tint, turn = 0) {
  const at = step(c, forward, side);
  return make(vec(at.x, floor + half.y, at.z), half, tint, { yaw: -(c.heading + turn) });
}

/* --------------------------------------------------------------- sections */

type Section = {
  blocks: Block[];
  cursor: Cursor;
  /** The line through this section, in order — through each gap, past each bumper. */
  marks: Vec3[];
};

/** Somewhere to stand still. Every section ends on one of these. */
function landing(c: Cursor, halfW: number, halfL: number, tint = PAD): Section {
  return {
    blocks: [slab(c, halfL, 0, c.top, halfW, halfL, tint)],
    cursor: { ...step(c, 2 * halfL + SEAM), top: c.top },
    marks: [spot(c, halfL, 0, c.top)],
  };
}

/** A bridge barely wider than the ball, with nothing either side of it. */
function bridgeRun(c: Cursor, r: Roll): Section {
  const halfL = between(r, 3.5, 6);
  const span = slab(c, halfL, 0, c.top, between(r, 1.0, 1.5), halfL, LEDGE);
  const rest = landing({ ...step(c, 2 * halfL + SEAM), top: c.top }, between(r, 3.4, 5), between(r, 2.8, 4));
  return {
    blocks: [span, ...rest.blocks],
    cursor: rest.cursor,
    marks: [spot(c, halfL, 0, c.top), ...rest.marks],
  };
}

/** A pad with walls across it, each leaving its gap on the other side. */
function zigzagRun(c: Cursor, r: Roll): Section {
  const halfW = between(r, 4.4, 5.6);
  const halfL = between(r, 4.5, 6);
  const gap = between(r, 3.0, 3.7);
  const blocks = [slab(c, halfL, 0, c.top, halfW, halfL, PAD)];
  const marks: Vec3[] = [];
  const walls = 2 + upTo(r, 2);
  let side = coin(r);
  for (let i = 0; i < walls; i += 1) {
    const along = ((i + 1) * 2 * halfL) / (walls + 1);
    // The wall runs from one edge to within `gap` of the other; the way past
    // it is the middle of what it leaves.
    blocks.push(
      stood(c, along, (-side * gap) / 2, c.top, vec(halfW - gap / 2, 0.7, 0.3), WALL),
    );
    marks.push(spot(c, along, side * (halfW - gap / 2), c.top));
    side = -side;
  }
  marks.push(spot(c, 2 * halfL - 0.4, 0, c.top));
  return {
    blocks,
    cursor: { ...step(c, 2 * halfL + SEAM), top: c.top },
    marks,
  };
}

/**
 * A ramp to another height, placed from the two ends it has to meet: tilted so
 * its top face leaves at the height behind it and arrives at the height ahead,
 * and stopping clear of both rather than burying its ends in them.
 */
function rampRun(c: Cursor, r: Roll, climbing: boolean): Section {
  const rise = between(r, 1.5, 3) * (climbing ? 1 : -1);
  const tilt = between(r, 13, 19) * (Math.PI / 180) * Math.sign(rise);
  const reach = Math.abs(rise) / (2 * Math.abs(Math.sin(tilt)));
  // Half the ramp's footprint along the way it runs — a tilted box takes up a
  // little more than its length, its thickness leaning into the bargain.
  const spread = Math.abs(SLAB * Math.sin(tilt)) + reach * Math.cos(tilt);
  const middle = step(c, SEAM + spread);
  const blocks = [
    make(
      vec(middle.x, c.top + reach * Math.sin(tilt) - SLAB * Math.cos(tilt), middle.z),
      vec(between(r, 2.2, 3), SLAB, reach),
      RAMP,
      { yaw: -c.heading, tilt },
    ),
  ];
  const top = c.top + rise;
  const rest = landing(
    { ...step(c, SEAM + 2 * spread + SEAM), top },
    between(r, 3.6, 5.2),
    between(r, 3, 4.4),
  );
  return {
    blocks: [...blocks, ...rest.blocks],
    cursor: rest.cursor,
    marks: [vec(middle.x, c.top + rise / 2, middle.z), ...rest.marks],
  };
}

/**
 * Open space, and a deck that slides across it. It runs from a hand's breadth
 * off the near side to a hand's breadth off the far one and overlaps neither,
 * so it is only worth boarding on the beat. Deck and rails are three boxes on
 * the same sliding description, which is the only way they stay together;
 * without the rails the least sideways drift takes you off over the gap.
 */
function ferryRun(c: Cursor, r: Roll): Section {
  const deckHalf = between(r, 1.9, 2.4);
  const deckWide = between(r, 1.8, 2.3);
  const travel = between(r, 2.2, 4);
  const gap = 2 * SEAM + 2 * (deckHalf + travel);
  const f = ahead(c);
  const home = step(c, SEAM + deckHalf + travel);
  const crossing = {
    axis: vec(f.x, 0, f.z),
    reach: travel,
    period: between(r, 6.5, 9),
    phase: 0,
  };
  const blocks = [
    make(vec(home.x, c.top - SLAB, home.z), vec(deckWide, SLAB, deckHalf), FERRY, {
      yaw: -c.heading,
      slide: crossing,
    }),
  ];
  for (const side of [-1, 1]) {
    const rail = step(home, 0, side * (deckWide - 0.15));
    blocks.push(
      make(vec(rail.x, c.top + 0.4, rail.z), vec(0.15, 0.4, deckHalf), POST, {
        yaw: -c.heading,
        slide: crossing,
      }),
    );
  }
  const rest = landing({ ...step(c, gap), top: c.top }, between(r, 4, 5.5), between(r, 3.4, 5));
  return { blocks: [...blocks, ...rest.blocks], cursor: rest.cursor, marks: rest.marks };
}

/**
 * A staircase curving away and dropping as it goes. Its steps are the one
 * thing in the course that overlap each other — they have to, or the ribbon
 * comes apart where it turns — so the drop is bigger than a step is thick and
 * they clear each other that way instead.
 */
function stairsRun(c: Cursor, r: Roll): Section {
  const steps = 4 + upTo(r, 3);
  const halfW = between(r, 1.9, 2.4);
  const halfL = between(r, 1.7, 2.1);
  const turn = between(r, 12, 22) * (Math.PI / 180) * coin(r);
  // Enough overlap that turning never opens a notch between one step and the
  // next; the corner of a turned step swings out by about this much.
  const spacing = 2 * halfL - Math.max(1, halfW * Math.abs(Math.sin(turn)) + 0.4);
  const blocks: Block[] = [];
  const marks: Vec3[] = [];
  let walk = { ...c };
  let top = c.top;
  for (let i = 0; i < steps; i += 1) {
    top -= STEP_DROP;
    blocks.push(slab(walk, halfL, 0, top, halfW, halfL, i % 2 ? LEDGE : PAD));
    marks.push(spot(walk, halfL, 0, top));
    // Mid-staircase the next step is pulled back so the two overlap; off the
    // end of the last one, clear of its far edge like anything else.
    const last = i === steps - 1;
    walk = {
      ...step(walk, last ? 2 * halfL + SEAM : spacing),
      heading: walk.heading + (last ? 0 : turn),
      top,
    };
  }
  const rest = landing({ ...walk, top }, between(r, 3.6, 5), between(r, 3, 4.2));
  return { blocks: [...blocks, ...rest.blocks], cursor: rest.cursor, marks: [...marks, ...rest.marks] };
}

/** A pad with a few blocks on it to get round. */
function bumperRun(c: Cursor, r: Roll): Section {
  const halfW = between(r, 4.2, 5.5);
  const halfL = between(r, 3.2, 4.6);
  const blocks = [slab(c, halfL, 0, c.top, halfW, halfL, PAD)];
  const marks: Vec3[] = [];
  const lumps = 2 + upTo(r, 3);
  const taken: Patch[] = [];
  let side = coin(r);
  for (let i = 0; i < lumps; i += 1) {
    const size = between(r, 0.65, 0.9);
    const along = ((i + 1) * 2 * halfL) / (lumps + 1);
    const off = between(r, 0.8, halfW - size - 1.6);
    // Kept a clear marble's width in from the edge, so there is always a way
    // past on the other side — which is where the line through goes.
    const on = side;
    side = -side;
    const lump = stood(c, along, on * off, c.top, vec(size, size, size), WALL,
      between(r, -30, 30) * (Math.PI / 180));
    // On a short pad two of these can land on each other. One bumper fewer is
    // no loss; two drawn through each other is.
    const patch = patchOf(lump);
    if (taken.some((q) => clash(patch, q, 0.2))) continue;
    taken.push(patch);
    blocks.push(lump);
    // The way past is round the other side of it.
    marks.push(spot(c, along, -on * Math.min(halfW - 1, off + size + 1.1), c.top));
  }
  marks.push(spot(c, 2 * halfL - 0.4, 0, c.top));
  return {
    blocks,
    cursor: { ...step(c, 2 * halfL + SEAM), top: c.top },
    marks,
  };
}

/**
 * A gap in the floor with nothing across it. The only way on is the jump, and
 * it is cut narrow enough that a fair roll at it clears with room to spare.
 */
function gapRun(c: Cursor, r: Roll): Section {
  const leap = between(r, LEAP.least, LEAP.most);
  // A raised far side, sometimes: a jump has height in it as well as reach.
  const lift = r() < 0.35 ? between(r, 0.5, 1.1) : 0;
  const rest = landing({ ...step(c, leap), top: c.top + lift }, between(r, 3.8, 5.4), between(r, 3.2, 4.6));
  return { blocks: rest.blocks, cursor: rest.cursor, marks: rest.marks };
}

/**
 * Stepping stones: small islands with nothing between them, each one a jump
 * from the last. Room to stop and think on every one of them.
 */
function steppingRun(c: Cursor, r: Roll): Section {
  const stones = 2 + upTo(r, 3);
  const halfW = between(r, 1.5, 2.2);
  const halfL = between(r, 1.4, 2);
  const blocks: Block[] = [];
  const marks: Vec3[] = [];
  let walk = { ...c };
  for (let i = 0; i < stones; i += 1) {
    const leap = between(r, LEAP.least, LEAP.most - 0.6);
    // Set a little to one side of the last, so the jumps are not all in line.
    const drift = between(r, -1, 1) * (halfW * 0.7);
    const stone = step(walk, leap + halfL, drift);
    blocks.push(
      make(vec(stone.x, c.top - SLAB, stone.z), vec(halfW, SLAB, halfL), LEDGE, { yaw: -c.heading }),
    );
    marks.push(vec(stone.x, c.top, stone.z));
    walk = { ...stone, top: c.top };
  }
  const rest = landing(
    { ...step(walk, halfL + between(r, LEAP.least, LEAP.most - 0.6)), top: c.top },
    between(r, 3.8, 5.2),
    between(r, 3.2, 4.4),
  );
  return { blocks: [...blocks, ...rest.blocks], cursor: rest.cursor, marks: [...marks, ...rest.marks] };
}

/**
 * A square pad you come onto by one edge and leave by the next one round, so
 * the course can change direction. The edge you leave by is square to the way
 * you were going, so whatever comes next still meets it edge to parallel edge.
 */
function cornerRun(c: Cursor, r: Roll): Section {
  const half = between(r, 3.2, 4.4);
  const turning = coin(r);
  const blocks = [slab(c, half, 0, c.top, half, half, LEDGE)];
  const at = step(c, half);
  const out = step({ ...at, heading: c.heading }, 0, turning * (half + SEAM));
  return {
    blocks,
    cursor: { x: out.x, z: out.z, top: c.top, heading: c.heading + turning * (Math.PI / 2) },
    marks: [spot(c, half, 0, c.top), spot(c, half, turning * (half - 0.8), c.top)],
  };
}

/** The finish: a lit pad between four posts. Nothing says so in words. */
function finishRun(c: Cursor, r: Roll): Section {
  const halfW = between(r, 2.8, 3.4);
  const halfL = between(r, 3, 3.8);
  const blocks = [slab(c, halfL, 0, c.top, halfW, halfL, GOAL, { goal: true })];
  for (const side of [-1, 1]) {
    for (const along of [halfL * 0.55, halfL * 1.45]) {
      blocks.push(stood(c, along, side * (halfW - 0.4), c.top, vec(0.25, 1.6, 0.25), POST));
    }
  }
  return {
    blocks,
    cursor: { ...step(c, 2 * halfL + SEAM), top: c.top },
    marks: [spot(c, halfL, 0, c.top)],
  };
}

/* ------------------------------------------------------------- keeping out */

/** A block's footprint on the ground: a rectangle, turned however it is turned. */
type Patch = { x: number; z: number; hx: number; hz: number; ux: number; uz: number };

function patchOf(b: Block): Patch {
  const spread = Math.abs(b.half.y * Math.sin(b.tilt)) + b.half.z * Math.cos(b.tilt);
  // A ferry claims the whole corridor it sweeps, not the square of floor it
  // happens to be standing on. Every ferry here slides along its own length,
  // which is what lets the reach simply be added to it.
  const swept = b.slide ? b.slide.reach : 0;
  return {
    x: b.centre.x,
    z: b.centre.z,
    hx: b.half.x,
    hz: spread + swept,
    ux: Math.cos(b.yaw),
    uz: -Math.sin(b.yaw),
  };
}

/** How far a block reaches above and below its own centre, tilt included. */
const stands = (b: Block) =>
  Math.abs(b.half.y * Math.cos(b.tilt)) + Math.abs(b.half.z * Math.sin(b.tilt));

/** Separating axes: two rectangles miss if any of their four sides can part them. */
function clash(a: Patch, b: Patch, margin: number) {
  const axes = [
    [a.ux, a.uz],
    [-a.uz, a.ux],
    [b.ux, b.uz],
    [-b.uz, b.ux],
  ];
  for (const [ax, az] of axes) {
    const reach = (p: Patch) =>
      Math.abs(p.hx * (p.ux * ax + p.uz * az)) + Math.abs(p.hz * (-p.uz * ax + p.ux * az));
    const apart = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
    if (apart > reach(a) + reach(b) + margin) return false;
  }
  return true;
}

/* ------------------------------------------------------------- the course */

type Kind =
  | "bridge"
  | "zigzag"
  | "climb"
  | "drop"
  | "ferry"
  | "stairs"
  | "bumpers"
  | "corner"
  | "gap"
  | "stepping";

function buildSection(kind: Kind, c: Cursor, r: Roll): Section {
  switch (kind) {
    case "bridge":
      return bridgeRun(c, r);
    case "zigzag":
      return zigzagRun(c, r);
    case "climb":
      return rampRun(c, r, true);
    case "drop":
      return rampRun(c, r, false);
    case "ferry":
      return ferryRun(c, r);
    case "stairs":
      return stairsRun(c, r);
    case "bumpers":
      return bumperRun(c, r);
    case "corner":
      return cornerRun(c, r);
    case "gap":
      return gapRun(c, r);
    case "stepping":
      return steppingRun(c, r);
  }
}

/** What may come next: never the same thing twice, and nothing out of room. */
function choices(last: Kind | null, top: number): Kind[] {
  const all: Kind[] = [
    "bridge",
    "zigzag",
    "climb",
    "drop",
    "ferry",
    "stairs",
    "bumpers",
    "corner",
    "gap",
    "stepping",
  ];
  return all.filter((k) => {
    if (k === last) return false;
    if (k === "climb") return top < CEILING - 3;
    if (k === "drop") return top > FLOOR + 3;
    if (k === "stairs") return top > FLOOR + 4;
    return true;
  });
}

/**
 * Roll a course. The same seed always gives the same one.
 *
 * Sections are tried against everything already placed and thrown away if they
 * would land on top of it, so a course wanders off in whatever direction it
 * has room for rather than folding back through itself.
 */
export function buildCourse(seed = Math.floor(Math.random() * 0xffffffff)): Course {
  const r = dice(seed);

  // Sections are kept whole rather than poured straight into one list, so that
  // the finish can back up over the last one or two if it has nowhere to go.
  type Placed = { blocks: Block[]; patches: Patch[]; cursor: Cursor; marks: Vec3[] };
  const laid: Placed[] = [];

  // Where you start, and the wall that stops the first thing you do being to
  // roll off the back of it.
  const home: Cursor = { x: 0, z: 0, top: 0, heading: 0 };
  const first = landing(home, 5, 4.6);
  const opening = [...first.blocks, stood(home, 0.7, 0, 0, vec(4.6, 0.4, 0.35), LEDGE)];
  laid.push({ blocks: opening, patches: opening.map(patchOf), cursor: first.cursor, marks: first.marks });
  const startAt = step(home, 2.6);

  /**
   * Everything a new section has to keep out of: all of it but the section it
   * is being joined to, which it is meant to be right up against.
   */
  const occupied = () => laid.slice(0, -1).flatMap((p) => p.patches);
  const roomFor = (blocks: Block[]) => {
    const fresh = blocks.map(patchOf);
    const older = occupied();
    return !fresh.some((p) => older.some((q) => clash(p, q, 0.5)));
  };

  const wanted = 5 + upTo(r, 4);
  let last: Kind | null = null;

  for (let i = 0; i < wanted; i += 1) {
    const cursor = laid[laid.length - 1].cursor;
    const room = choices(last, cursor.top);
    let placed: Section | null = null;
    let kind: Kind | null = null;
    for (let tries = 0; tries < 16 && !placed; tries += 1) {
      kind = room[upTo(r, room.length)];
      const section = buildSection(kind, cursor, r);
      if (!roomFor(section.blocks)) continue;
      placed = section;
    }
    if (!placed) break;
    last = kind;
    laid.push({
      blocks: placed.blocks,
      patches: placed.blocks.map(patchOf),
      cursor: placed.cursor,
      marks: placed.marks,
    });
  }

  const asPlaced = (section: Section): Placed => ({
    blocks: section.blocks,
    patches: section.blocks.map(patchOf),
    cursor: section.cursor,
    marks: section.marks,
  });

  // The finish goes on wherever the course has got to — straight ahead if
  // there is room, and round a corner if there isn't, a corner being the one
  // turn that still meets a pad squarely. Failing both, drop the last section
  // and finish on the one before: better a shorter course than a finish
  // standing in the middle of something else.
  let end: Placed[] | null = null;
  while (!end && laid.length) {
    const cursor = laid[laid.length - 1].cursor;
    for (let tries = 0; tries < 10 && !end; tries += 1) {
      const straight = finishRun(cursor, r);
      if (roomFor(straight.blocks)) end = [asPlaced(straight)];
    }
    for (let tries = 0; tries < 10 && !end; tries += 1) {
      const corner = cornerRun(cursor, r);
      if (!roomFor(corner.blocks)) continue;
      laid.push(asPlaced(corner));
      const after = finishRun(corner.cursor, r);
      if (roomFor(after.blocks)) end = [asPlaced(corner), asPlaced(after)];
      laid.pop();
    }
    if (!end) laid.pop();
  }
  if (end) laid.push(...end);

  const blocks = laid.flatMap((p) => p.blocks);
  const route = laid.flatMap((p) => p.marks);
  scatterScenery(blocks, route, r);

  return { blocks, start: vec(startAt.x, 0.5, startAt.z), route, seed };
}

/**
 * Shapes hanging in the dark, turning slowly, that the ball passes straight
 * through. They are here to give the space some depth — without them there is
 * nothing out there to judge distance against. They keep well clear of the
 * course, which is the only thing asked of them.
 */
function scatterScenery(blocks: Block[], route: Vec3[], r: Roll) {
  const patches = blocks.map(patchOf);
  for (let i = 0; i < 12; i += 1) {
    const near = route[upTo(r, route.length)];
    const size = between(r, 1.8, 3.6);
    for (let tries = 0; tries < 10; tries += 1) {
      const angle = r() * Math.PI * 2;
      const out = between(r, 12, 26);
      const centre = vec(
        near.x + Math.cos(angle) * out,
        near.y + between(r, -11, 13),
        near.z + Math.sin(angle) * out,
      );
      const floater = make(centre, vec(size, size * 0.7, size), SCENERY, {
        solid: false,
        spin: between(r, 0.08, 0.26) * coin(r),
        tilt: 22 * (Math.PI / 180),
      });
      // Only worth keeping out of the way of things at its own height — and a
      // box tilted on its corner stands taller than its own half-height, which
      // is what has to be compared.
      const mine = patchOf(floater);
      const clear = blocks.every(
        (b, n) => Math.abs(b.centre.y - centre.y) >= stands(b) + stands(floater) || !clash(mine, patches[n], 1),
      );
      if (!clear) continue;
      blocks.push(floater);
      patches.push(mine);
      break;
    }
  }
}
