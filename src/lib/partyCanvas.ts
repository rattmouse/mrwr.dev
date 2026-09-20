/**
 * What party.webp's canvas does with its crowd: the shape of a node, the forces
 * the Forces panel pushes them around with, and the lines the Links panel
 * strings between them.
 *
 * It lives out here rather than in the draw loop because both are now a good
 * deal more than a couple of lines, and the loop reads better as a list of
 * steps than as the steps themselves.
 */

// Which of the painted figures this node is, which way it faces and how big it
// is — rolled once when the node is born so a guy doesn't flicker into someone
// else every frame. The id is what selection and per-node edits hold on to,
// since the array itself shuffles as the density changes.
export type Node = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  guy: number;
  flip: boolean;
  size: number;
  /** Set on the nodes standing in for party members, to the character's id. */
  charId?: string;
};

export type Pointer = { x: number; y: number; on: boolean };

/** How far past the link reach the pointer still has a hold on the crowd. */
export const POINTER_REACH = 1.6;

/* ------------------------------------------------------------------ forces */

export type PointerMode = "ignore" | "attract" | "repel" | "orbit";

export type Forces = {
  /** Degrees clockwise from straight up, so 180 is the gravity you expect. */
  gravityAngle: number;
  gravity: number;
  /** Signed: below zero it blows to the left. Gusts rather than holds steady. */
  wind: number;
  jitter: number;
  pointer: PointerMode;
  /** How hard the pointer pulls, pushes or swings them round. */
  pull: number;
  separation: number;
  alignment: number;
  cohesion: number;
};

/** Nothing pushing: the crowd drifts exactly as it did before the panel existed. */
export const NO_FORCES: Forces = {
  gravityAngle: 180,
  gravity: 0,
  wind: 0,
  jitter: 0,
  pointer: "ignore",
  pull: 0.5,
  separation: 0,
  alignment: 0,
  cohesion: 0,
};

export const forcesAtRest = (f: Forces) =>
  f.gravity === 0 &&
  f.wind === 0 &&
  f.jitter === 0 &&
  f.separation === 0 &&
  f.alignment === 0 &&
  f.cohesion === 0 &&
  (f.pointer === "ignore" || f.pull === 0);

// Every one of these is per node per frame at 60Hz, scaled by the step — they
// are accelerations, not speeds, and they were all picked by eye.
const GRAVITY_PULL = 0.07;
const WIND_PUSH = 0.06;
const JITTER_KICK = 0.4;
const POINTER_PUSH = 1.1;
const COHESION_PULL = 0.6;
const ALIGNMENT_RATE = 0.09;
const SEPARATION_PUSH = 1.2;
// Without something taking speed back out, gravity and the pointer wind the
// crowd up until it is a blur. This is what gives them a terminal velocity —
// so turning a force on does quiet the drift a little, which is the price of
// the crowd not running away.
const DRAG = 0.009;
const MAX_SPEED = 5;
// A flock that agrees on a heading is a flock whose velocities cancel out, and
// with the drag above that ends in everyone standing still — turning Alignment
// up would quietly freeze the crowd. So while they are flocking they keep
// walking: this is the slowest anyone in a flock goes.
const FLOCK_SPEED = 0.55;
// How close is close enough to be shoved away from. A shorter radius than the
// one they flock at, or separation simply cancels cohesion out.
const SEPARATION_REACH = 0.42;

// Per-node scratch for the flocking pass, grown as the density does and reused
// from frame to frame rather than reallocated sixty times a second.
let scratch = {
  count: new Float64Array(0),
  cx: new Float64Array(0),
  cy: new Float64Array(0),
  vx: new Float64Array(0),
  vy: new Float64Array(0),
  sx: new Float64Array(0),
  sy: new Float64Array(0),
};

const fitScratch = (n: number) => {
  if (scratch.count.length < n) {
    const make = () => new Float64Array(n);
    scratch = { count: make(), cx: make(), cy: make(), vx: make(), vy: make(), sx: make(), sy: make() };
  } else {
    for (const buffer of Object.values(scratch)) buffer.fill(0, 0, n);
  }
  return scratch;
};

/**
 * Push the crowd about, once per frame, before they are moved. Everything lands
 * on vx/vy — the integrate step below is untouched by which forces are on.
 *
 * With every force at rest this returns immediately, so a canvas nobody has
 * touched the Forces panel on costs exactly what it used to.
 */
export function applyForces(
  nodes: Node[],
  forces: Forces,
  opts: { step: number; now: number; reach: number; pointer: Pointer },
) {
  if (forcesAtRest(forces) || opts.step === 0) return;
  const { step, now, reach, pointer } = opts;
  const { gravity, gravityAngle, wind, jitter, separation, alignment, cohesion } = forces;

  if (gravity > 0) {
    const radians = (gravityAngle * Math.PI) / 180;
    const gx = Math.sin(radians) * gravity * GRAVITY_PULL * step;
    const gy = -Math.cos(radians) * gravity * GRAVITY_PULL * step;
    for (const node of nodes) {
      node.vx += gx;
      node.vy += gy;
    }
  }

  if (wind !== 0) {
    // Two slow sines beaten against each other, so the wind comes in gusts
    // instead of leaning on the crowd at a constant pressure.
    const gust = 0.55 + 0.45 * Math.sin(now / 1700) * Math.sin(now / 640);
    const push = wind * gust * WIND_PUSH * step;
    for (const node of nodes) node.vx += push;
  }

  if (jitter > 0) {
    const kick = jitter * JITTER_KICK * step;
    for (const node of nodes) {
      node.vx += (Math.random() * 2 - 1) * kick;
      node.vy += (Math.random() * 2 - 1) * kick;
    }
  }

  if (pointer.on && forces.pointer !== "ignore" && forces.pull > 0) {
    const range = reach * POINTER_REACH;
    const strength = forces.pull * POINTER_PUSH * step;
    for (const node of nodes) {
      const dx = pointer.x - node.x;
      const dy = pointer.y - node.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > range) continue;
      const falloff = (1 - dist / range) * strength;
      const ux = dx / dist;
      const uy = dy / dist;
      if (forces.pointer === "attract") {
        node.vx += ux * falloff;
        node.vy += uy * falloff;
      } else if (forces.pointer === "repel") {
        node.vx -= ux * falloff;
        node.vy -= uy * falloff;
      } else {
        // Sideways, with a little of the pull left in, or they spiral off
        // rather than going round.
        node.vx += (-uy + ux * 0.28) * falloff;
        node.vy += (ux + uy * 0.28) * falloff;
      }
    }
  }

  const flocking = separation > 0 || alignment > 0 || cohesion > 0;
  if (flocking) {
    const n = nodes.length;
    const acc = fitScratch(n);
    const reachSq = reach * reach;
    const sepReach = reach * SEPARATION_REACH;
    const sepSq = sepReach * sepReach;

    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > reachSq || distSq === 0) continue;
        acc.count[i] += 1;
        acc.count[j] += 1;
        acc.cx[i] += b.x;
        acc.cy[i] += b.y;
        acc.cx[j] += a.x;
        acc.cy[j] += a.y;
        acc.vx[i] += b.vx;
        acc.vy[i] += b.vy;
        acc.vx[j] += a.vx;
        acc.vy[j] += a.vy;
        if (distSq < sepSq) {
          // Harder the closer they are, and away from each other.
          const dist = Math.sqrt(distSq);
          const push = (1 - dist / sepReach) / dist;
          acc.sx[i] -= dx * push;
          acc.sy[i] -= dy * push;
          acc.sx[j] += dx * push;
          acc.sy[j] += dy * push;
        }
      }
    }

    for (let i = 0; i < n; i += 1) {
      const node = nodes[i];
      const neighbours = acc.count[i];
      if (neighbours > 0) {
        if (cohesion > 0) {
          const pull = (cohesion * COHESION_PULL * step) / reach;
          node.vx += (acc.cx[i] / neighbours - node.x) * pull;
          node.vy += (acc.cy[i] / neighbours - node.y) * pull;
        }
        if (alignment > 0) {
          const rate = alignment * ALIGNMENT_RATE * step;
          node.vx += (acc.vx[i] / neighbours - node.vx) * rate;
          node.vy += (acc.vy[i] / neighbours - node.vy) * rate;
        }
      }
      if (separation > 0) {
        const push = separation * SEPARATION_PUSH * step;
        node.vx += acc.sx[i] * push;
        node.vy += acc.sy[i] * push;
      }
    }
  }

  const drag = Math.max(0, 1 - DRAG * step);
  const floor = flocking ? FLOCK_SPEED : 0;
  for (const node of nodes) {
    node.vx *= drag;
    node.vy *= drag;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED;
      node.vy = (node.vy / speed) * MAX_SPEED;
    } else if (speed < floor) {
      // Dead still and nothing to point them at: any direction will do.
      const angle = speed > 0.001 ? Math.atan2(node.vy, node.vx) : Math.random() * Math.PI * 2;
      node.vx = Math.cos(angle) * floor;
      node.vy = Math.sin(angle) * floor;
    }
  }
}

/* ------------------------------------------------------------------- links */

export type LinkColour = "ink" | "accent" | "nodes";

export type Links = {
  opacity: number;
  /** How thick the lines are drawn, in px. */
  weight: number;
  /** How many lines one node may hold. At LINK_ALL the cap is off. */
  max: number;
  /** 0 is a straight line; up from there they bow out. */
  curve: number;
  colour: LinkColour;
  /** How strongly a triangle of three close nodes is filled in. */
  mesh: number;
};

/** The top of the Links slider, where the cap comes off entirely. */
export const LINK_ALL = 12;

// A triangle is only filled when all three of its nodes are this much closer
// than the link reach. Three nodes a whole reach apart are linked but they are
// not *close*, and filling those sheets in turns the canvas into a solid wash —
// at the top of Density and Reach it is also some ten thousand translucent
// fills a frame, which is the difference between a mesh and a slideshow. At
// this radius the worst the sliders can ask for is about sixteen hundred.
const MESH_REACH = 0.65;

/** What the canvas drew before the Links panel existed. */
export const DEFAULT_LINKS: Links = {
  opacity: 0.24,
  weight: 1,
  max: LINK_ALL,
  curve: 0,
  colour: "ink",
  mesh: 0,
};

// How many opacity steps the links are drawn in. Five is under the threshold
// where the banding shows and well under the point where the draw calls hurt.
const LINK_STEPS = 5;
const bucketFor = (closeness: number) =>
  Math.max(0, Math.min(LINK_STEPS - 1, Math.floor(closeness * LINK_STEPS)));
const bucketAlpha = (index: number) => (index + 0.5) / LINK_STEPS;

// One reusable path per opacity step, for both the node-to-node links and the
// ones reaching for the pointer. They are made on the first frame rather than
// up here because this module is imported during the server render too, where
// there is no Path2D to make one with.
type Bucket = { path: Path2D; used: boolean };
let linkBuckets: Bucket[] | null = null;
let pointerBuckets: Bucket[] | null = null;
const emptied = (buckets: Bucket[] | null): Bucket[] => {
  const kept = buckets ?? Array.from({ length: LINK_STEPS }, () => ({ path: new Path2D(), used: false }));
  for (const bucket of kept) {
    bucket.path = new Path2D();
    bucket.used = false;
  }
  return kept;
};

// Every pair close enough to be linked, as three parallel arrays rather than an
// array of objects — there are hundreds of them a frame and none of them
// outlives the frame.
const pairA: number[] = [];
const pairB: number[] = [];
const pairNear: number[] = [];

/**
 * Bow a link out to one side. Which side is decided by the two nodes rather
 * than rolled, so a line doesn't flip from one frame to the next, and the mesh
 * ends up leaning every which way instead of all one way.
 */
const addLink = (path: Path2D, a: Node, b: Node, curve: number, lean: number) => {
  path.moveTo(a.x, a.y);
  if (curve === 0) {
    path.lineTo(b.x, b.y);
    return;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  path.quadraticCurveTo(
    (a.x + b.x) / 2 - dy * curve * 0.3 * lean,
    (a.y + b.y) / 2 + dx * curve * 0.3 * lean,
    b.x,
    b.y,
  );
};

/**
 * Draw the web: the lines between nodes that are close enough to see each
 * other, the triangles between three of them that all can, and the lines
 * reaching for the pointer.
 *
 * Every link is its own colour, since it fades with distance — but a stroke()
 * per link is hundreds of draw calls a frame. Sorting them into a handful of
 * opacity steps costs nothing visible and collapses the lot into one path per
 * step. Colouring them by the nodes at their ends is the one setting that
 * can't be batched that way, and it says so below.
 */
export function drawLinks(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  opts: {
    reach: number;
    links: Links;
    /** The canvas' own "r, g, b", dark on a pale surface and pale on a dark one. */
    ink: string;
    accent: string;
    pointer: Pointer;
    /** What one node has ended up being painted in, for the by-node colouring. */
    colourOf: (node: Node) => string;
  },
) {
  const { reach, links, ink, accent, pointer, colourOf } = opts;
  const count = nodes.length;
  const reachSq = reach * reach;

  pairA.length = 0;
  pairB.length = 0;
  pairNear.length = 0;
  for (let i = 0; i < count; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < count; j += 1) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > reachSq) continue;
      pairA.push(i);
      pairB.push(j);
      pairNear.push(1 - Math.sqrt(distSq) / reach);
    }
  }

  // With a cap on, each node keeps only the few nearest it — but a link belongs
  // to two nodes, and it survives if either of them kept it. Dropping the ones
  // neither kept would leave the crowd's loners with no lines at all.
  let kept: Uint8Array | null = null;
  if (links.max < LINK_ALL) {
    kept = new Uint8Array(pairA.length);
    const mine: number[][] = Array.from({ length: count }, () => []);
    for (let p = 0; p < pairA.length; p += 1) {
      mine[pairA[p]].push(p);
      mine[pairB[p]].push(p);
    }
    for (const held of mine) {
      if (held.length > links.max) held.sort((x, y) => pairNear[y] - pairNear[x]);
      for (let k = 0; k < Math.min(links.max, held.length); k += 1) kept[held[k]] = 1;
    }
  }
  const alive = (p: number) => kept === null || kept[p] === 1;

  if (links.mesh > 0) drawMesh(ctx, nodes, { links, ink, accent, colourOf, alive });

  ctx.lineWidth = links.weight;

  if (links.colour === "nodes") {
    // A line that runs from one node's colour to the other's needs a gradient
    // of its own, so this is the one setting that costs a draw call per link.
    ctx.lineCap = "round";
    for (let p = 0; p < pairA.length; p += 1) {
      if (!alive(p)) continue;
      const a = nodes[pairA[p]];
      const b = nodes[pairB[p]];
      const path = new Path2D();
      addLink(path, a, b, links.curve, (pairA[p] + pairB[p]) % 2 ? 1 : -1);
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, colourOf(a));
      gradient.addColorStop(1, colourOf(b));
      ctx.strokeStyle = gradient;
      ctx.globalAlpha = bucketAlpha(bucketFor(pairNear[p])) * links.opacity * 2.2;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  } else {
    linkBuckets = emptied(linkBuckets);
    const buckets = linkBuckets;
    for (let p = 0; p < pairA.length; p += 1) {
      if (!alive(p)) continue;
      const bucket = buckets[bucketFor(pairNear[p])];
      addLink(bucket.path, nodes[pairA[p]], nodes[pairB[p]], links.curve, (pairA[p] + pairB[p]) % 2 ? 1 : -1);
      bucket.used = true;
    }
    buckets.forEach((bucket, index) => {
      if (!bucket.used) return;
      const alpha = bucketAlpha(index) * links.opacity;
      if (links.colour === "accent") {
        ctx.strokeStyle = accent;
        ctx.globalAlpha = alpha;
        ctx.stroke(bucket.path);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
        ctx.stroke(bucket.path);
      }
    });
  }

  if (!pointer.on) return;
  const range = reach * POINTER_REACH;
  pointerBuckets = emptied(pointerBuckets);
  const reaching = pointerBuckets;
  for (const node of nodes) {
    const dist = Math.hypot(node.x - pointer.x, node.y - pointer.y);
    if (dist >= range) continue;
    const bucket = reaching[bucketFor(1 - dist / range)];
    bucket.path.moveTo(node.x, node.y);
    bucket.path.lineTo(pointer.x, pointer.y);
    bucket.used = true;
  }
  reaching.forEach((bucket, index) => {
    if (!bucket.used) return;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = bucketAlpha(index) * 0.55;
    ctx.stroke(bucket.path);
    ctx.globalAlpha = 1;
  });
}

/**
 * Fill in the triangles: wherever three nodes can all see each other, the pane
 * of glass between them. Walking the links rather than every third node keeps
 * this to the handful of neighbours each node actually has.
 */
function drawMesh(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  opts: {
    links: Links;
    ink: string;
    accent: string;
    colourOf: (node: Node) => string;
    alive: (pair: number) => boolean;
  },
) {
  const { links, ink, accent, colourOf, alive } = opts;
  const neighbours = new Map<number, Set<number>>();
  const near = new Map<number, number>();
  const key = (i: number, j: number) => i * nodes.length + j;
  for (let p = 0; p < pairA.length; p += 1) {
    if (!alive(p) || pairNear[p] < 1 - MESH_REACH) continue;
    const i = pairA[p];
    const j = pairB[p];
    let set = neighbours.get(i);
    if (!set) neighbours.set(i, (set = new Set()));
    set.add(j);
    near.set(key(i, j), pairNear[p]);
  }

  for (const [i, js] of neighbours) {
    for (const j of js) {
      const alsoJ = neighbours.get(j);
      if (!alsoJ) continue;
      for (const k of alsoJ) {
        // i < j < k, so each triangle is only found the once.
        if (!js.has(k)) continue;
        const a = nodes[i];
        const b = nodes[j];
        const c = nodes[k];
        // Rescaled over the mesh's own reach, so a triangle right at the edge
        // of it still comes out faintly rather than not at all.
        const tightness = Math.min(
          1,
          (((near.get(key(i, j)) ?? 0) + (near.get(key(j, k)) ?? 0) + (near.get(key(i, k)) ?? 0)) / 3 -
            (1 - MESH_REACH)) /
            MESH_REACH,
        );
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.globalAlpha = tightness * links.mesh * 0.55;
        ctx.fillStyle =
          links.colour === "ink" ? `rgb(${ink})` : links.colour === "accent" ? accent : colourOf(a);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}
