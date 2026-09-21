/**
 * The ghost of a run: where the ball was at every thirtieth of a second of it.
 *
 * marbles.exe keeps one of these for the best time known on the course you are
 * on — yours, or one that came in on a pasted code — and sets it going again
 * the moment your next run starts. So the thing you are racing is not a number
 * in the toolbar but the run itself, out there on the course beside you,
 * taking the corners the way it took them.
 *
 * It is only a list of points. Nothing here knows about physics: the ghost
 * cannot be knocked, cannot fall and cannot be stood on, because it already
 * happened.
 */

import { cross, length, Mat3, normalise, spinBy, type Vec3 } from "@/lib/marbles3d";

/** How often a run is written down as it happens. Thirty a second is plenty. */
export const GHOST_STEP = 1 / 30;

/**
 * As long a run as is worth remembering — twenty minutes. Past that it is not
 * going to be anybody's best time, and the list should stop growing.
 */
const MOST = Math.round((20 * 60) / GHOST_STEP);

/**
 * A run, as points a fixed step apart. The step travels with the points
 * because a run that has come in as a code is thinned out on the way to keep
 * the code short, and plays back at whatever spacing it arrived with.
 */
export type Trail = { step: number; points: Vec3[] };

export const newTrail = (step: number = GHOST_STEP): Trail => ({ step, points: [] });

/** Write down where the ball is, if the clock has got as far as the next step. */
export function record(trail: Trail, at: Vec3, clock: number) {
  while (trail.points.length < MOST && trail.points.length * trail.step <= clock) {
    trail.points.push({ ...at });
  }
}

/** How long the run lasted, by the same reckoning. */
export function spanOf(trail: Trail) {
  return Math.max(0, (trail.points.length - 1) * trail.step);
}

/**
 * Where the ghost had got to this far into its run — between the two points
 * either side, so it moves smoothly however the frames fall — or nothing at
 * all once it is home and has no more to show you.
 */
export function ghostAt(trail: Trail, clock: number): Vec3 | null {
  const { points, step } = trail;
  if (points.length < 2 || clock < 0 || clock > spanOf(trail)) return null;
  const at = clock / step;
  const i = Math.min(points.length - 2, Math.floor(at));
  const part = at - i;
  const a = points[i];
  const b = points[i + 1];
  return {
    x: a.x + (b.x - a.x) * part,
    y: a.y + (b.y - a.y) * part,
    z: a.z + (b.z - a.z) * part,
  };
}

/**
 * The same run laid out on a coarser grid, for sending: ten points a second
 * are plenty to watch a ball roll, and thirty would make the code three times
 * as long. The grid is stretched to land exactly on both ends, so a shared
 * ghost sets off and gets home at the times it really did — and so that the
 * spacing can be worked out again at the other end from the run's time alone,
 * without the code having to carry it.
 */
export function thin(trail: Trail, step: number): Trail {
  const span = spanOf(trail);
  if (span <= 0 || step <= trail.step) return trail;
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const spacing = span / (count - 1);
  const points: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = ghostAt(trail, Math.min(span, i * spacing));
    points.push(at ?? trail.points[trail.points.length - 1]);
  }
  return { step: spacing, points };
}

/**
 * Turn it by however far it has just moved. A ball rolling along the ground
 * turns about the axis across its path, once for every circumference it
 * covers — which is enough to make a ghost read as rolling rather than
 * sliding, without asking what it is rolling on.
 */
export function rollBy(turn: Mat3, moved: Vec3, radius: number): Mat3 {
  const gone = length(moved);
  if (gone < 1e-5) return turn;
  const axis = cross({ x: 0, y: 1, z: 0 }, moved);
  if (length(axis) < 1e-6) return turn;
  return spinBy(turn, normalise(axis), gone / radius);
}
