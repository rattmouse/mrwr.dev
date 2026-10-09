/**
 * The world cubicles.exe stands you up in, and the rules for walking around it.
 *
 * Everything in here is an axis-aligned box: three partitions with the fourth
 * side left open, the desk against the far one, the computer sitting on it,
 * and — out through the gap — the rest of the floor, which is a bare carpeted
 * room with the lights on and nothing in it at all. There is one way out of
 * that room and it is locked, so the cubicle is still the whole of where you
 * live; it just has a view now.
 *
 * marbles3d does all the arithmetic. This file only says where things are and
 * how close you are allowed to stand to them.
 */

import { Tint, Vec3, vec } from "@/lib/marbles3d";
import type { Difficulty } from "@/lib/tasksGame";

/**
 * postMessage type for flipping the room's lights from outside the frame —
 * sent by bash.exe's lights.exe when it is running nested inside the
 * computer on the desk, so it can reach the cubicle actually holding it.
 */
export const LIGHTS_MESSAGE_TYPE = "cubicles:toggle-lights";

/** Same route, for bash.exe's upgrade.exe: IT swaps the monitor for the next size up. */
export const MONITOR_MESSAGE_TYPE = "cubicles:next-monitor";

/** Same route, for bash.exe's unlock.exe: the door out of the office stops being locked (though it stays shut). */
export const DOOR_MESSAGE_TYPE = "cubicles:unlock-door";

/**
 * Set once tasks.exe has been survived to 5 o'clock on the computer on the
 * desk — the only thing that gets unlock.exe past "Permission denied" — and
 * holding which difficulty the day was worked on, which decides whether the
 * doors down the hallway open (hallDoorsOpen). The latest day counts. Kept in localStorage,
 * so a finished day stays finished; a bare "1" is from before the
 * difficulty was kept, and counts as Easy.
 */
const CLOCKED_OUT_KEY = "cubicles:clocked-out";
export function clockedOutAs(): Difficulty | null {
  try {
    const kept = window.localStorage.getItem(CLOCKED_OUT_KEY);
    if (kept === "medium" || kept === "hard") return kept;
    return kept ? "easy" : null;
  } catch {
    return null;
  }
}
export const hasClockedOut = () => clockedOutAs() !== null;
export function markClockedOut(difficulty: Difficulty) {
  try {
    window.localStorage.setItem(CLOCKED_OUT_KEY, difficulty);
    if (RANK[difficulty] > RANK[bestDayWorked() ?? "easy"]) window.localStorage.setItem(BEST_DAY_KEY, difficulty);
  } catch {
    // No storage, no record: they'll have to work another day.
  }
}

/**
 * The hardest day ever worked to 5 o'clock, unlike clockedOutAs's latest:
 * what the walk outside the hallway's doors (TreesWalk) lets you do. A day
 * clocked out before this was kept still counts, through clockedOutAs.
 */
const BEST_DAY_KEY = "cubicles:best-day";
const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
export function bestDayWorked(): Difficulty | null {
  const latest = clockedOutAs();
  let best: string | null = null;
  try {
    best = window.localStorage.getItem(BEST_DAY_KEY);
  } catch {
    // No storage: the latest day is all there is.
  }
  const kept = best === "easy" || best === "medium" || best === "hard" ? best : null;
  if (!kept) return latest;
  if (!latest) return kept;
  return RANK[kept] >= RANK[latest] ? kept : latest;
}

/** Same route, for bash.exe's eyes.exe: the player's eyes go wrong, or come right again. */
export const EYES_MESSAGE_TYPE = "cubicles:toggle-eyes";

/** One box in the room. Axis-aligned, so a centre and three half-extents. */
export type Box = {
  centre: Vec3;
  half: Vec3;
  /** The colour of it, before the shading and the distance are taken off. */
  tint: Tint;
  /** Lit panels ignore the shading and the fog — they are the light. */
  glow?: boolean;
  /**
   * Metres taken off the box's place in the paint order, which moves it later.
   * The sort goes on the furthest corner, so a thing lying flat against a
   * surface bigger than itself already wins; this is for the few that sit so
   * close to something their own size that the order could go either way.
   */
  bias?: number;
  /**
   * The face of this box that has the cubicle behind it, if it is one of the
   * partitions. Painting back to front by furthest corner cannot hide what is
   * behind a wall you are looking at from outside: the wall's far corner is
   * the one at its other end, which is further off than the filing cabinet
   * tucked against its near half — so the cabinet wins the sort and is drawn
   * straight through it. Naming the outward face here paints that one face
   * after everything else instead, which is what a wall is for.
   *
   * It only works because the far side of a partition is the cubicle and
   * nothing else: put something out on the office floor between you and a
   * partition and the partition would be painted over it.
   */
  occludes?: { axis: 0 | 1 | 2; side: 1 | -1 };

  /* The painter's own scratch, filled on first sight and kept. Nothing in the
     room ever moves except the door, so its eight corners and the colour of
     each of its faces at each band of fog are worth working out once. */
  corners?: Vec3[];
  tones?: (string | undefined)[][];
};

/** A footprint on the floor you can't walk through. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/* ------------------------------------------------------------- dimensions */

/**
 * One cubicle is this wide and this deep either side of its middle, and its
 * partitions are this thick a side. Neighbours stand exactly two half-widths
 * apart, so each one's outward panel lands back to back with the next one's
 * and the two together make the shared wall between them.
 */
const CUBE = 1.425;
const PANEL_T = 0.025;
const WALL_TOP = 1.72;
const CEILING = 2.45;

/** The middles of the four cubicles. Yours is the one at nought. */
export const PODS = [-2.85, 0, 2.85, 5.7];

/** The room they stand in — the inside faces of its four walls. */
export const FLOOR = { minX: -5.6, maxX: 8.5, minZ: -3, maxZ: 7 };

/**
 * The way out, in the far wall, down the aisle from your own cubicle. It is a
 * door in every respect except that it opens, which it does not.
 */
export const DOOR = { x: 1.5, halfW: 0.47, bottom: 0, top: 2.05, z: 6.92 };

export const EYE_STANDING = 1.62;
export const PLAYER_RADIUS = 0.26;
export const WALK_SPEED = 1.65;
/** How far from the screen you can still reach the keyboard. */
export const USE_RANGE = 2;
/** And how close you have to be to the door to find out about it. */
export const DOOR_RANGE = 2.4;

/* ----------------------------------------------------------------- palette */

const CARPET: Tint = [104, 104, 108];
const PANEL: Tint = [112, 122, 138];
const WALL: Tint = [196, 194, 186];
const DOOR_WOOD: Tint = [176, 158, 126];
const BAR_METAL: Tint = [196, 196, 192];
const CARD: Tint = [178, 152, 114];
const CARD_DARK: Tint = [146, 122, 88];
/** The aluminium trim a partition system is edged and capped with. */
const EDGE: Tint = [158, 160, 164];
const TRIM: Tint = [84, 88, 98];
const DESK: Tint = [198, 184, 156];
const DESK_DARK: Tint = [150, 138, 114];
const BEIGE: Tint = [214, 206, 186];
const PLASTIC: Tint = [50, 52, 58];
const FABRIC: Tint = [96, 102, 118];
const METAL: Tint = [152, 152, 148];
const PAPER: Tint = [238, 236, 226];
const CEIL: Tint = [236, 236, 230];
const LIT: Tint = [255, 252, 230];

/* ------------------------------------------------------------- the screen */

/**
 * The monitor's glass, as a flat rectangle standing a whisker proud of the
 * front of the case. Everything the computer shows is painted into a picture
 * this many pixels across and then stretched over it, and a click is turned
 * back into a pixel on that picture the same way.
 */
export const SCREEN = {
  centre: vec(0, 1.05, -0.962),
  halfW: 0.178,
  halfH: 0.1425,
  width: 640,
  height: 512,
};

/** The glass and the case as issued, before upgrade.exe gets at them. */
const GLASS_HALF = { w: SCREEN.halfW, h: SCREEN.halfH };
const CASE_HALF = vec(0.235, 0.2, 0.19);
/** The case stands on its neck, so it grows up and out from here rather than into the desk. */
const CASE_BOTTOM = 0.85;
const CASE_Z = -1.17;
const MONITOR_CASE: Box = { centre: vec(0, CASE_BOTTOM + CASE_HALF.y, CASE_Z), half: CASE_HALF, tint: BEIGE };

/** The sizes upgrade.exe steps through, as multiples of the one you were issued, before IT takes it back. */
export const MONITOR_SIZES = [1, 1.6, 2.4, 3.2];
let monitorScale = 1;

/**
 * Swaps the monitor on your desk for one this many times the size: the case
 * and the glass grow up off the neck and out to the sides, never deeper, so
 * the back of it stays off the partition. Everything that reads SCREEN —
 * the painter, the hit test, the seated pose — picks the new size up as it
 * is. The case's corners and colours are cached on it, so those are dropped.
 */
export function setMonitorScale(scale: number) {
  monitorScale = scale;
  const centreY = CASE_BOTTOM + CASE_HALF.y * scale;
  SCREEN.halfW = GLASS_HALF.w * scale;
  SCREEN.halfH = GLASS_HALF.h * scale;
  SCREEN.centre = vec(SCREEN.centre.x, centreY, SCREEN.centre.z);
  MONITOR_CASE.centre = vec(0, centreY, CASE_Z);
  MONITOR_CASE.half = vec(CASE_HALF.x * scale, CASE_HALF.y * scale, CASE_HALF.z);
  MONITOR_CASE.corners = undefined;
  MONITOR_CASE.tones = undefined;
}

export function nextMonitorScale(): number {
  return MONITOR_SIZES[(MONITOR_SIZES.indexOf(monitorScale) + 1) % MONITOR_SIZES.length];
}


/** A point on the glass. u and v both run −1 … 1, v up. */
export function screenPoint(u: number, v: number): Vec3 {
  return vec(
    SCREEN.centre.x + u * SCREEN.halfW,
    SCREEN.centre.y + v * SCREEN.halfH,
    SCREEN.centre.z,
  );
}

/* -------------------------------------------------------------- the poses */

/** Where the eye is, where it is pointed, and how wide it is looking. */
export type Pose = { pos: Vec3; yaw: number; pitch: number; fov: number };

/** With your back to the locked door, looking down the row at the day. */
export const STANDING: Pose = { pos: vec(DOOR.x, EYE_STANDING, DOOR.z - 1.15), yaw: 0, pitch: 0.07, fov: 1.12 };
/**
 * Leaning in at the desk: closer, eye level with the middle of the glass and
 * looking straight at it. Square-on is deliberate. Facing the glass head-on
 * leaves the browser laid over it with no perspective at all, just scale and
 * position — and Firefox drops text from a page under a perspective
 * transform, so tilting down at the glass left the computer's menus and
 * windows blank there.
 */
export const SEATED: Pose = { pos: vec(0, SCREEN.centre.y, -0.5), yaw: 0, pitch: 0, fov: 0.72 };

/** How much of the view's width the glass may fill when you're seated. */
const SEATED_FIT = 0.94;

/**
 * SEATED, widened as far as it takes for the whole of the glass to fit across
 * a view this shape. The field of view is set by the height alone, so on a
 * tall, narrow view — a phone held upright — the glass comes out about as
 * wide as the view is tall and hangs off both sides, taking the computer's
 * edges with it. Anywhere the glass already fits, this is just SEATED.
 */
export function seatedPose(width: number, height: number): Pose {
  // A bigger monitor puts you further back from it, at the middle of its glass,
  // so it sits in the same part of the view whatever size IT has sent up.
  const away = (SEATED.pos.z - SCREEN.centre.z) * monitorScale;
  const fits = 2 * Math.atan((SCREEN.halfW / away) * (height / (width * SEATED_FIT)));
  return {
    ...SEATED,
    pos: vec(SEATED.pos.x, SCREEN.centre.y, SCREEN.centre.z + away),
    fov: Math.max(SEATED.fov, fits),
  };
}

/* ------------------------------------------------------------------ props */

const box = (centre: Vec3, half: Vec3, tint: Tint, skin: Partial<Box> = {}): Box =>
  ({ centre, half, tint, ...skin });


/** Anything lying against a surface roughly its own size gets nudged later. */
const STUCK = { bias: 0.6 } as const;

/**
 * Where a thing pinned to a partition sits, and how thick it is. Flat against
 * the panel is not good enough: a decal in the same plane as the wall behind it
 * is a coin toss over which of the two gets drawn, and the toss is re-thrown
 * every time you move. This stands them a centimetre off it.
 */
const PIN_Z = -(CUBE - 2 * PANEL_T) + 0.012;
const PIN_T = 0.004;

const MID_X = (FLOOR.minX + FLOOR.maxX) / 2;
const MID_Z = (FLOOR.minZ + FLOOR.maxZ) / 2;
const SPAN_X = FLOOR.maxX - FLOOR.minX;
const SPAN_Z = FLOOR.maxZ - FLOOR.minZ;

/**
 * The T-bars a suspended ceiling hangs its tiles in. The tiles themselves are
 * flat off-white and there is nothing to photograph about them; it is the grid
 * that tells you what you are standing under.
 */
const BAR = 1.25;
const GRID: Box[] = [];
for (let x = MID_X - BAR / 2; x > FLOOR.minX; x -= BAR) {
  GRID.push({ centre: vec(x, CEILING - 0.01, MID_Z), half: vec(0.022, 0.01, SPAN_Z / 2), tint: BAR_METAL, bias: 0.5 });
  GRID.push({ centre: vec(2 * MID_X - x, CEILING - 0.01, MID_Z), half: vec(0.022, 0.01, SPAN_Z / 2), tint: BAR_METAL, bias: 0.5 });
}
for (let z = MID_Z - BAR / 2; z > FLOOR.minZ; z -= BAR) {
  GRID.push({ centre: vec(MID_X, CEILING - 0.01, z), half: vec(SPAN_X / 2, 0.01, 0.022), tint: BAR_METAL, bias: 0.5 });
  GRID.push({ centre: vec(MID_X, CEILING - 0.01, 2 * MID_Z - z), half: vec(SPAN_X / 2, 0.01, 0.022), tint: BAR_METAL, bias: 0.5 });
}

/** The strip lights, dropped into cells of that grid. */
const LIGHTS: Box[] = [];
for (const z of [MID_Z - 3 * BAR, MID_Z - BAR, MID_Z + BAR, MID_Z + 3 * BAR]) {
  for (const x of [MID_X - 3 * BAR, MID_X, MID_X + 3 * BAR]) {
    LIGHTS.push({
      centre: vec(x, CEILING - 0.02, z),
      half: vec(BAR / 2 - 0.03, 0.02, 0.3),
      tint: LIT,
      glow: true,
      bias: 0.9,
    });
  }
}

/**
 * One cubicle's three partitions. Each panel sits wholly on its own side of
 * the line between two cubicles and hides outwards, so where two cubicles meet
 * their panels stand back to back and each hides its own half. One panel doing
 * both jobs cannot work: the face you are looking at would be painted last,
 * over the filing cabinet on your own side of it as well as the desk on the
 * far side.
 */
function partitions(cx: number): Box[] {
  return [
    box(vec(cx, WALL_TOP / 2, -CUBE + PANEL_T), vec(CUBE, WALL_TOP / 2, PANEL_T), PANEL, {
      occludes: { axis: 2, side: -1 },
    }),
    box(vec(cx - CUBE + PANEL_T, WALL_TOP / 2, 0), vec(PANEL_T, WALL_TOP / 2, CUBE), PANEL, {
      occludes: { axis: 0, side: -1 },
    }),
    box(vec(cx + CUBE - PANEL_T, WALL_TOP / 2, 0), vec(PANEL_T, WALL_TOP / 2, CUBE), PANEL, {
      occludes: { axis: 0, side: 1 },
    }),
    // The aluminium cap along the top of each run, and the trim the open end
    // is finished with — which also covers the seam where two outward faces
    // meet and neither can be said to be in front.
    box(vec(cx, WALL_TOP + 0.015, -CUBE + PANEL_T), vec(CUBE, 0.015, 0.032), EDGE),
    box(vec(cx - CUBE + PANEL_T, WALL_TOP + 0.015, 0), vec(0.032, 0.015, CUBE), EDGE),
    box(vec(cx + CUBE - PANEL_T, WALL_TOP + 0.015, 0), vec(0.032, 0.015, CUBE), EDGE),
    // The trim caps the mouth of each panel rather than straddling its face.
    // Straddling meant giving it a bias big enough to beat its own wall, which
    // made it beat every other wall too — and it turned up through the
    // partition from the cubicle next door.
    box(vec(cx - CUBE + PANEL_T, WALL_TOP / 2, CUBE + 0.02), vec(PANEL_T, WALL_TOP / 2, 0.02), EDGE, { bias: 0.3 }),
    box(vec(cx + CUBE - PANEL_T, WALL_TOP / 2, CUBE + 0.02), vec(PANEL_T, WALL_TOP / 2, 0.02), EDGE, { bias: 0.3 }),
  ];
}

/** The desk that every one of them has, wanted or not. */
function desk(cx: number): Box[] {
  return [
    box(vec(cx, 0.72, -1.035), vec(1.18, 0.025, 0.325), DESK),
    box(vec(cx - 1.1, 0.36, -1.035), vec(0.03, 0.36, 0.305), DESK_DARK),
    box(vec(cx + 1.1, 0.36, -1.035), vec(0.03, 0.36, 0.305), DESK_DARK),
    box(vec(cx, 0.46, -1.345), vec(1.18, 0.26, 0.02), DESK_DARK),
  ];
}

/** And the chair, wherever whoever left it pushed it to. */
function chair(cx: number, dx = 0, dz = 0): Box[] {
  const x = cx + dx;
  const z = -0.48 + dz;
  return [
    box(vec(x, 0.03, z), vec(0.24, 0.03, 0.24), PLASTIC),
    box(vec(x, 0.22, z), vec(0.035, 0.22, 0.035), PLASTIC),
    box(vec(x, 0.44, z), vec(0.21, 0.035, 0.2), FABRIC),
    box(vec(x, 0.72, z + 0.21), vec(0.19, 0.18, 0.035), FABRIC),
  ];
}

/**
 * The three nobody sits in. A desk, a chair somebody pushed out on their way
 * past, and one thing left behind — which is all an emptied desk ever has.
 */
function spareCubicle(cx: number, kit: number): Box[] {
  const leftovers: Box[][] = [
    // A monitor nobody took, with nothing to plug into: the tower is gone and
    // the glass has been dark long enough to have dust on it.
    [
      box(vec(cx - 0.12, 0.765, -1.1), vec(0.13, 0.02, 0.1), BEIGE),
      box(vec(cx - 0.12, 0.805, -1.1), vec(0.05, 0.03, 0.05), BEIGE),
      box(vec(cx - 0.12, 1.05, -1.15), vec(0.235, 0.2, 0.19), BEIGE),
      box(vec(cx - 0.12, 1.05, -0.954), vec(0.178, 0.1425, 0.006), [26, 30, 36], { bias: 0.4 }),
      box(vec(cx - 0.12, 0.757, -0.87), vec(0.21, 0.012, 0.075), BEIGE),
    ],
    // A printer, with the last thing anyone asked it for still in the tray.
    [
      box(vec(cx + 0.42, 0.8, -1.12), vec(0.2, 0.055, 0.15), BEIGE),
      box(vec(cx + 0.42, 0.845, -0.976), vec(0.17, 0.006, 0.012), [70, 74, 80], { bias: 0.4 }),
      box(vec(cx + 0.42, 0.858, -1.05), vec(0.105, 0.002, 0.08), PAPER, { bias: 0.5 }),
      box(vec(cx - 0.45, 0.748, -0.9), vec(0.11, 0.003, 0.08), PAPER, STUCK),
    ],
    // A phone still on the desk, and the boxes somebody started packing.
    [
      box(vec(cx - 0.42, 0.765, -1.0), vec(0.1, 0.02, 0.07), PLASTIC),
      box(vec(cx - 0.42, 0.798, -1.03), vec(0.1, 0.018, 0.026), PLASTIC),
      box(vec(cx + 0.58, 0.16, 0.36), vec(0.19, 0.16, 0.14), CARD),
      box(vec(cx + 0.58, 0.47, 0.36), vec(0.19, 0.15, 0.14), CARD),
      box(vec(cx + 0.58, 0.625, 0.36), vec(0.195, 0.008, 0.145), CARD_DARK, { bias: 0.4 }),
    ],
  ];
  const pushed: [number, number][] = [
    [0.34, 0.22],
    [-0.42, 0.3],
    [0.12, 0.42],
  ];
  return [...partitions(cx), ...desk(cx), ...chair(cx, ...pushed[kit]), ...leftovers[kit]];
}

/**
 * The room, in one list. Nothing moves, so it is built once and handed to the
 * painter every frame — except the door, which gets a shove now and then and
 * is added on top.
 */
export const ROOM: Box[] = [
  /* --- the room itself --------------------------------------------------- */
  box(vec(MID_X, -0.03, MID_Z), vec(SPAN_X / 2, 0.03, SPAN_Z / 2), CARPET),
  box(vec(MID_X, CEILING + 0.04, MID_Z), vec(SPAN_X / 2, 0.04, SPAN_Z / 2), CEIL),
  ...GRID,
  box(vec(MID_X, CEILING / 2, FLOOR.minZ - 0.06), vec(SPAN_X / 2, CEILING / 2, 0.06), WALL),
  // The far wall is three pieces round the doorway, so that there is a hole
  // behind the door for when it opens (see hallBoxes).
  box(vec((FLOOR.minX + DOOR.x - DOOR.halfW) / 2, CEILING / 2, FLOOR.maxZ + 0.06), vec((DOOR.x - DOOR.halfW - FLOOR.minX) / 2, CEILING / 2, 0.06), WALL),
  box(vec((DOOR.x + DOOR.halfW + FLOOR.maxX) / 2, CEILING / 2, FLOOR.maxZ + 0.06), vec((FLOOR.maxX - DOOR.x - DOOR.halfW) / 2, CEILING / 2, 0.06), WALL),
  box(vec(DOOR.x, (DOOR.top + CEILING) / 2, FLOOR.maxZ + 0.06), vec(DOOR.halfW, (CEILING - DOOR.top) / 2, 0.06), WALL),
  box(vec(FLOOR.minX - 0.06, CEILING / 2, MID_Z), vec(0.06, CEILING / 2, SPAN_Z / 2), WALL),
  box(vec(FLOOR.maxX + 0.06, CEILING / 2, MID_Z), vec(0.06, CEILING / 2, SPAN_Z / 2), WALL),
  // Skirting, which is most of what tells you a bare room is a room.
  box(vec(MID_X, 0.06, FLOOR.minZ + 0.01), vec(SPAN_X / 2, 0.06, 0.012), TRIM, STUCK),
  box(vec((FLOOR.minX + DOOR.x - DOOR.halfW) / 2, 0.06, FLOOR.maxZ - 0.01), vec((DOOR.x - DOOR.halfW - FLOOR.minX) / 2, 0.06, 0.012), TRIM, STUCK),
  box(vec((DOOR.x + DOOR.halfW + FLOOR.maxX) / 2, 0.06, FLOOR.maxZ - 0.01), vec((FLOOR.maxX - DOOR.x - DOOR.halfW) / 2, 0.06, 0.012), TRIM, STUCK),
  box(vec(FLOOR.minX + 0.01, 0.06, MID_Z), vec(0.012, 0.06, SPAN_Z / 2), TRIM, STUCK),
  box(vec(FLOOR.maxX - 0.01, 0.06, MID_Z), vec(0.012, 0.06, SPAN_Z / 2), TRIM, STUCK),
  ...LIGHTS,

  /* --- the way out, such as it is ---------------------------------------- */
  box(vec(DOOR.x - DOOR.halfW - 0.05, DOOR.top / 2, FLOOR.maxZ - 0.03), vec(0.05, DOOR.top / 2 + 0.05, 0.03), TRIM, STUCK),
  box(vec(DOOR.x + DOOR.halfW + 0.05, DOOR.top / 2, FLOOR.maxZ - 0.03), vec(0.05, DOOR.top / 2 + 0.05, 0.03), TRIM, STUCK),
  box(vec(DOOR.x, DOOR.top + 0.05, FLOOR.maxZ - 0.03), vec(DOOR.halfW + 0.1, 0.05, 0.03), TRIM, STUCK),
  // A sign over it, on the one thing in the room that is still switched on.
  box(vec(DOOR.x, DOOR.top + 0.25, FLOOR.maxZ - 0.02), vec(0.24, 0.1, 0.02), [88, 210, 120], { glow: true, bias: 0.8 }),

  /* --- the three nobody sits in ------------------------------------------ */
  ...spareCubicle(PODS[0], 0),
  ...spareCubicle(PODS[2], 1),
  ...spareCubicle(PODS[3], 2),

  /* --- and yours --------------------------------------------------------- */
  ...partitions(0),
  ...desk(0),
  ...chair(0),

  /* --- the computer ----------------------------------------------------- */
  box(vec(0, 0.765, -1.12), vec(0.13, 0.02, 0.1), BEIGE),
  box(vec(0, 0.805, -1.12), vec(0.05, 0.03, 0.05), BEIGE),
  MONITOR_CASE,
  // The tower is a tall narrow box and every photograph of a PC front is a
  // wide one, so it is plain plastic with its own fittings rather than a
  // picture of somebody else's machine stretched three ways.
  box(vec(0.8, 0.28, -1.13), vec(0.09, 0.28, 0.2), BEIGE),
  box(vec(0.8, 0.44, -0.925), vec(0.062, 0.012, 0.008), [232, 228, 214], { bias: 0.4 }),
  box(vec(0.8, 0.36, -0.925), vec(0.062, 0.008, 0.008), [232, 228, 214], { bias: 0.4 }),
  box(vec(0.845, 0.2, -0.925), vec(0.012, 0.012, 0.008), [70, 74, 80], { bias: 0.4 }),
  box(vec(0.762, 0.2, -0.925), vec(0.008, 0.008, 0.008), [90, 230, 120], { glow: true, bias: 0.5 }),

  /* --- everything else on the desk -------------------------------------- */
  box(vec(0.31, 0.746, -0.86), vec(0.1, 0.002, 0.08), PLASTIC, STUCK),
  box(vec(0, 0.757, -0.86), vec(0.21, 0.012, 0.075), BEIGE),
  box(vec(0.31, 0.759, -0.86), vec(0.033, 0.014, 0.05), BEIGE),
  box(vec(-0.36, 0.79, -0.9), vec(0.038, 0.045, 0.038), [186, 72, 60]),
  box(vec(-0.55, 0.748, -0.82), vec(0.11, 0.003, 0.08), PAPER, STUCK),
  box(vec(-0.82, 0.765, -0.98), vec(0.1, 0.02, 0.07), PLASTIC),
  box(vec(-0.82, 0.798, -1.01), vec(0.1, 0.018, 0.026), PLASTIC),

  /* --- the corners of your cubicle --------------------------------------- */
  box(vec(-1.1, 0.31, 0.85), vec(0.22, 0.31, 0.27), METAL),
  box(vec(-1.1, 0.42, 0.545), vec(0.13, 0.015, 0.008), PLASTIC),
  box(vec(-1.1, 0.16, 0.545), vec(0.13, 0.015, 0.008), PLASTIC),
  box(vec(0.78, 0.13, 0.45), vec(0.11, 0.13, 0.11), PLASTIC),
  box(vec(1.1, 0.17, 0.92), vec(0.14, 0.17, 0.14), [152, 94, 62]),
  box(vec(1.1, 0.4, 0.92), vec(0.15, 0.05, 0.13), [58, 108, 62]),
  box(vec(1.1, 0.49, 0.92), vec(0.11, 0.05, 0.1), [70, 126, 70]),
  box(vec(1.1, 0.57, 0.92), vec(0.06, 0.05, 0.06), [84, 142, 82]),

  /* --- pinned to your partitions ----------------------------------------- */
  box(vec(-0.8, 1.36, PIN_Z), vec(0.17, 0.12, PIN_T), PAPER, STUCK),
  box(vec(-0.8, 1.44, PIN_Z + 0.004), vec(0.17, 0.04, PIN_T), [40, 60, 130], { bias: 0.8 }),
  box(vec(0.62, 1.28, PIN_Z), vec(0.04, 0.04, PIN_T), [244, 226, 120], STUCK),
  box(vec(0.74, 1.36, PIN_Z), vec(0.04, 0.04, PIN_T), [240, 170, 190], STUCK),
  box(vec(0.68, 1.18, PIN_Z), vec(0.04, 0.04, PIN_T), [170, 226, 180], STUCK),
  box(vec(PIN_Z, 1.15, 0.2), vec(PIN_T, 0.19, 0.27), [64, 106, 150], STUCK),
  box(vec(-PIN_Z, 1.2, -0.2), vec(PIN_T, 0.22, 0.34), PAPER, STUCK),
];

/**
 * The door, which is handed out separately because it is the only thing in the
 * room that ever moves — and all it does is rattle when you try it.
 */
export function doorBoxes(shove: number): Box[] {
  const x = DOOR.x + shove;
  const mid = (DOOR.bottom + DOOR.top) / 2;
  const tall = (DOOR.top - DOOR.bottom) / 2;
  if (doorOpen) {
    // Swung in against its hinge, on the left of the frame, and left there.
    const hinge = DOOR.x - DOOR.halfW + 0.03;
    return [
      box(vec(hinge, mid, DOOR.z - DOOR.halfW), vec(0.03, tall, DOOR.halfW), DOOR_WOOD),
      box(vec(hinge + 0.04, 1.02, DOOR.z - 2 * DOOR.halfW + 0.1), vec(0.025, 0.018, 0.055), METAL, { bias: 0.9 }),
    ];
  }
  return [
    // Wall where the hole in it would be, so nothing shows round the door's edges.
    box(vec(DOOR.x, mid, FLOOR.maxZ + 0.06), vec(DOOR.halfW, tall, 0.06), WALL),
    box(vec(x, mid, DOOR.z), vec(DOOR.halfW, tall, 0.03), DOOR_WOOD),
    box(vec(x + DOOR.halfW - 0.1, 1.02, DOOR.z - 0.04), vec(0.055, 0.018, 0.025), METAL, { bias: 0.9 }),
  ];
}

/* ---------------------------------------------------------- the way out */

/**
 * unlock.exe only unlocks the door; opening it is still up to you. Shared
 * module state, like the monitor — a fresh cubicle shuts and locks it again
 * (closeDoor).
 */
let doorLocked = true;
let doorOpen = false;
export const isDoorLocked = () => doorLocked;
export const isDoorOpen = () => doorOpen;
export const unlockDoor = () => {
  doorLocked = false;
};
export const openDoor = () => {
  if (!doorLocked) doorOpen = true;
};
/** Swung shut behind you, but not locked: you can open it again. */
export const shutDoor = () => {
  doorOpen = false;
};
export const closeDoor = () => {
  doorOpen = false;
  doorLocked = true;
};

/**
 * The doors down the hallway, and the places in the city behind them —
 * trees.exe's city, stood in (TreesWalk). Which way to face is radians
 * clockwise from north, and above level.
 */
export type DropIn = { name: string; lat: number; lon: number; yaw: number; pitch: number };
const deg = (d: number) => (d * Math.PI) / 180;
export const DROP_INS: DropIn[] = [
  { name: "Green Lake", lat: 47.678879, lon: -122.344809, yaw: deg(33), pitch: 0.057 },
  { name: "Gas Works Park", lat: 47.644588, lon: -122.336976, yaw: deg(215), pitch: 0.03 },
  { name: "Alki Beach", lat: 47.580927, lon: -122.407961, yaw: deg(70), pitch: 0.03 },
  { name: "Golden Gardens", lat: 47.69021, lon: -122.403885, yaw: deg(340), pitch: 0.03 },
  { name: "Seward Park", lat: 47.553597, lon: -122.254523, yaw: deg(300), pitch: 0.03 },
  { name: "Washington Park Arboretum", lat: 47.644938, lon: -122.2955, yaw: deg(0), pitch: 0.03 },
];

/**
 * Whether the doors down the hallway open: only for a day worked on Medium or
 * Hard. Easy's way out is the hallway itself, and the office again at the end
 * of it. Hard's city weighs next to nothing (outsideIsLight).
 */
export const hallDoorsOpen = () => {
  const day = clockedOutAs();
  return day === "medium" || day === "hard";
};
export const outsideIsLight = () => clockedOutAs() === "hard";

/**
 * Where the hallway behind the door ends. It is exactly as wide and as tall as
 * the doorway and it runs on into the fog, lit every few metres, with a door
 * every few metres down alternate sides, one for each of DROP_INS. At the far
 * end is the office again (see OTHER_END), and walking into it walks you back
 * in through the door you left by (see throughTheEnd).
 */
const HALL_DOOR_FIRST = 4;
const HALL_DOOR_EVERY = 6;
const HALL_END = FLOOR.maxZ + HALL_DOOR_FIRST + HALL_DOOR_EVERY * DROP_INS.length;
const HALL_LIGHT_EVERY = 4;
const HALL_SECTION = 4;
/** Half a hallway door's width, along the wall. */
const HALL_DOOR_HALF = 0.42;
const HALL_DOOR_TOP = 1.9;

/** Each hallway door: where along the hallway it is, and which wall it's in (−1 the wall towards −x, 1 towards +x). */
const HALL_DOORS = DROP_INS.map((_, k) => ({
  z: FLOOR.maxZ + HALL_DOOR_FIRST + k * HALL_DOOR_EVERY,
  side: k % 2 ? 1 : -1,
}));

/**
 * The hallway is a tube seen from inside, and the painter sorts by each face's
 * furthest corner — so the room behind you, nearer than the hallway's far end,
 * would be painted straight over its walls. Instead the tube's inward faces go
 * after everything else (`occludes`), which hides all of the room except what
 * is framed by the doorway — the only part of it you could see anyway — and
 * the few things inside the tube are pushed later still.
 */
const INSIDE_TUBE = { bias: 1100 } as const;

const HALL: Box[] = (() => {
  const tall = DOOR.top / 2;
  const hall: Box[] = [];
  // In lengths rather than one long box a side: the painter fogs a whole face
  // by its furthest corner, and a face that long would be all fog.
  for (let z = FLOOR.maxZ; z < HALL_END - 1e-6; z += HALL_SECTION) {
    const half = Math.min(HALL_SECTION, HALL_END - z) / 2;
    const mid = z + half;
    hall.push(
      box(vec(DOOR.x, -0.03, mid), vec(DOOR.halfW, 0.03, half), CARPET, { occludes: { axis: 1, side: 1 } }),
      box(vec(DOOR.x, DOOR.top + 0.04, mid), vec(DOOR.halfW, 0.04, half), CEIL, { occludes: { axis: 1, side: -1 } }),
      box(vec(DOOR.x - DOOR.halfW - 0.06, tall, mid), vec(0.06, tall, half), WALL, { occludes: { axis: 0, side: 1 } }),
      box(vec(DOOR.x + DOOR.halfW + 0.06, tall, mid), vec(0.06, tall, half), WALL, { occludes: { axis: 0, side: -1 } }),
    );
  }
  for (let z = FLOOR.maxZ + HALL_LIGHT_EVERY / 2; z < HALL_END - 1; z += HALL_LIGHT_EVERY) {
    hall.push(box(vec(DOOR.x, DOOR.top - 0.012, z), vec(DOOR.halfW * 0.6, 0.012, 0.3), LIT, { glow: true, ...INSIDE_TUBE }));
  }
  for (const { z, side } of HALL_DOORS) {
    const x = DOOR.x + side * (DOOR.halfW - 0.012);
    hall.push(box(vec(x, HALL_DOOR_TOP / 2, z), vec(0.012, HALL_DOOR_TOP / 2, HALL_DOOR_HALF), DOOR_WOOD, INSIDE_TUBE));
    hall.push(box(vec(x - side * 0.03, 1.0, z + 0.3), vec(0.02, 0.018, 0.05), METAL, { bias: INSIDE_TUBE.bias + 1 }));
  }
  return hall;
})();

/**
 * The office as it looks from the far end of the hallway: the same room, turned
 * half round about the middle of the hallway, so that its door lands exactly on
 * the end of it. Turning is its own undoing — do it twice and you're back where
 * you started — which is what makes throughTheEnd seamless: the room you walk
 * into down there is the one you were already looking at.
 */
function otherEnd(b: Box): Box {
  const o = b.occludes;
  return {
    ...b,
    centre: vec(2 * DOOR.x - b.centre.x, b.centre.y, FLOOR.maxZ + HALL_END - b.centre.z),
    // Turned round, a box's left face is its right and its front its back.
    occludes: o && { axis: o.axis, side: o.axis === 1 ? o.side : ((-o.side) as 1 | -1) },
    corners: undefined,
    tones: undefined,
  };
}

/** The unchanging part of it, turned once and kept. The monitor is left to be turned each frame. */
let otherRoom: Box[] | null = null;

/**
 * Which hallway door a ray meets within reach, by its index in DROP_INS, or
 * null. Only from in the hallway.
 */
export function aimAtHallDoor(from: Vec3, dir: Vec3, range = USE_RANGE): number | null {
  if (!doorOpen || from.z < FLOOR.maxZ) return null;
  for (let k = 0; k < HALL_DOORS.length; k++) {
    const { z, side } = HALL_DOORS[k];
    if (dir.x * side <= 1e-6) continue;
    const t = (DOOR.x + side * (DOOR.halfW - 0.024) - from.x) / dir.x;
    if (t <= 0 || t > range) continue;
    const hitZ = from.z + dir.z * t;
    const hitY = from.y + dir.y * t;
    if (Math.abs(hitZ - z) <= HALL_DOOR_HALF && hitY >= 0 && hitY <= HALL_DOOR_TOP) return k;
  }
  return null;
}

/** Back in from a hallway door: stood in front of it, facing on down the hallway. */
export function besideHallDoor(k: number): Pose {
  return { pos: vec(DOOR.x, EYE_STANDING, HALL_DOORS[k].z), yaw: Math.PI, pitch: 0, fov: STANDING.fov };
}

/** The hallway, and the office again at the end of it — nothing at all while the door is shut. */
export function hallBoxes(): Box[] {
  if (!doorOpen) return [];
  otherRoom ??= ROOM.filter((b) => b !== MONITOR_CASE).map(otherEnd);
  return [
    ...HALL,
    ...otherRoom,
    otherEnd(MONITOR_CASE),
    ...doorBoxes(0).map(otherEnd),
    // Its screen is off. The only browser is the one on your desk, and it
    // comes on for you once you've walked through and are sitting at it again.
    otherEnd(box(vec(SCREEN.centre.x, SCREEN.centre.y, SCREEN.centre.z - 0.006), vec(SCREEN.halfW, SCREEN.halfH, 0.006), [11, 15, 22], { glow: true, bias: 0.4 })),
  ];
}

/** Far enough through the doorway at the end to be in the room beyond it. */
const THE_END = HALL_END + PLAYER_RADIUS + 0.05;

/**
 * Past the end of the hallway you are in the office at the other end of it,
 * which is this office turned round — so turn yourself back the same way and
 * you're standing just inside its door, facing in, having seen no join. Null
 * while you're still in the hallway.
 */
export function throughTheEnd(pos: Vec3, yaw: number): { pos: Vec3; yaw: number } | null {
  if (pos.z < THE_END) return null;
  return {
    pos: vec(2 * DOOR.x - pos.x, pos.y, FLOOR.maxZ + HALL_END - pos.z),
    yaw: yaw + Math.PI,
  };
}

/** The footprints you bump into. The room's own walls are handled separately. */
export const BLOCKERS: Rect[] = [
  ...PODS.flatMap((cx): Rect[] => [
    { minX: cx - CUBE, maxX: cx + CUBE, minZ: -CUBE, maxZ: -CUBE + 2 * PANEL_T },
    { minX: cx - CUBE, maxX: cx - CUBE + 2 * PANEL_T, minZ: -CUBE, maxZ: CUBE },
    { minX: cx + CUBE - 2 * PANEL_T, maxX: cx + CUBE, minZ: -CUBE, maxZ: CUBE },
    { minX: cx - 1.18, maxX: cx + 1.18, minZ: -1.39, maxZ: -0.71 },
  ]),
  // Your own chair, and the corners you have filled up.
  { minX: -0.24, maxX: 0.24, minZ: -0.72, maxZ: -0.24 },
  { minX: -1.35, maxX: -0.91, minZ: 0.58, maxZ: 1.12 },
  { minX: 1, maxX: 1.28, minZ: 0.81, maxZ: 1.09 },
  { minX: 0.67, maxX: 0.89, minZ: 0.34, maxZ: 0.56 },
  // And theirs, wherever they left them.
  { minX: PODS[0] + 0.1, maxX: PODS[0] + 0.58, minZ: -0.5, maxZ: -0.02 },
  { minX: PODS[2] - 0.66, maxX: PODS[2] - 0.18, minZ: -0.42, maxZ: 0.06 },
  { minX: PODS[3] - 0.12, maxX: PODS[3] + 0.36, minZ: -0.3, maxZ: 0.18 },
  { minX: PODS[3] + 0.39, maxX: PODS[3] + 0.77, minZ: 0.22, maxZ: 0.5 },
];

/* ----------------------------------------------------------------- moving */

/** Which way the eye is pointed, as a unit vector. Positive pitch looks down. */
export function gaze(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return vec(-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp);
}

/**
 * Walk one frame's worth. dx is strafe and dz is forward, both −1 … 1; the
 * result is pushed back out of anything it ended up inside and clamped to the
 * partitions, which is the whole of why you can never leave.
 */
export function walk(pos: Vec3, yaw: number, dx: number, dz: number, dt: number): Vec3 {
  const push = Math.hypot(dx, dz);
  if (push < 1e-3) return pos;
  const k = (WALK_SPEED * dt) / Math.max(1, push);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  let x = pos.x + (fx * dz + rx * dx) * k;
  let z = pos.z + (fz * dz + rz * dx) * k;

  for (const r of BLOCKERS) {
    const nx = Math.min(Math.max(x, r.minX), r.maxX);
    const nz = Math.min(Math.max(z, r.minZ), r.maxZ);
    const ox = x - nx;
    const oz = z - nz;
    if (ox * ox + oz * oz >= PLAYER_RADIUS * PLAYER_RADIUS) continue;
    // Inside the footprint proper: out the nearest side. Otherwise push
    // straight back along the line from the nearest edge point.
    if (ox === 0 && oz === 0) {
      const left = x - r.minX;
      const right = r.maxX - x;
      const near = z - r.minZ;
      const far = r.maxZ - z;
      const least = Math.min(left, right, near, far);
      if (least === left) x = r.minX - PLAYER_RADIUS;
      else if (least === right) x = r.maxX + PLAYER_RADIUS;
      else if (least === near) z = r.minZ - PLAYER_RADIUS;
      else z = r.maxZ + PLAYER_RADIUS;
    } else {
      const len = Math.hypot(ox, oz);
      x = nx + (ox / len) * PLAYER_RADIUS;
      z = nz + (oz / len) * PLAYER_RADIUS;
    }
  }

  const r = PLAYER_RADIUS;
  // With the door open, the doorway is a way through the far wall: in it or
  // past it you're held between its jambs, and only there can you leave the room.
  const jambs = { minX: DOOR.x - DOOR.halfW + r, maxX: DOOR.x + DOOR.halfW - r };
  if (doorOpen && pos.z > FLOOR.maxZ - r) {
    return vec(Math.min(Math.max(x, jambs.minX), jambs.maxX), pos.y, Math.min(z, THE_END + 0.1));
  }
  const through = doorOpen && x >= jambs.minX && x <= jambs.maxX;
  return vec(
    Math.min(Math.max(x, FLOOR.minX + r), FLOOR.maxX - r),
    pos.y,
    Math.min(Math.max(z, FLOOR.minZ + r), through ? THE_END + 0.1 : FLOOR.maxZ - r),
  );
}

/** Where a ray meets the door, or null if it misses or is out of arm's reach. */
export function aimAtDoor(from: Vec3, dir: Vec3, range = DOOR_RANGE): boolean {
  if (dir.z <= 1e-6) return false;
  const t = (DOOR.z - 0.03 - from.z) / dir.z;
  if (t <= 0 || t > range) return false;
  const x = from.x + dir.x * t;
  const y = from.y + dir.y * t;
  return Math.abs(x - DOOR.x) <= DOOR.halfW && y >= DOOR.bottom && y <= DOOR.top;
}

/**
 * Where a ray meets the glass, in the picture's own pixels — or null if it
 * misses, comes from behind, or starts too far away to reach the keyboard.
 */
export function aimAtScreen(from: Vec3, dir: Vec3, range = Infinity): { x: number; y: number } | null {
  if (dir.z >= -1e-6) return null;
  const t = (SCREEN.centre.z - from.z) / dir.z;
  if (t <= 0 || t > range) return null;
  const u = (from.x + dir.x * t - SCREEN.centre.x) / SCREEN.halfW;
  const v = (from.y + dir.y * t - SCREEN.centre.y) / SCREEN.halfH;
  if (u < -1 || u > 1 || v < -1 || v > 1) return null;
  return { x: ((u + 1) / 2) * SCREEN.width, y: ((1 - v) / 2) * SCREEN.height };
}
