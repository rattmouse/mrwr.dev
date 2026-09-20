/**
 * The dice party.webp throws across its canvas. The roster is a D&D party and
 * there was nothing to roll, so this is the rolling: a die is a body that
 * tumbles over the crowd, shoves people out of its way, comes to rest showing
 * a number, and after a moment is gone again.
 *
 * The number is settled the instant you ask for it — the tumbling is the die
 * showing you faces it has already stopped caring about — because a result
 * that depended on where the die happened to stop would be a result that
 * depended on the frame rate.
 */

import type { Node } from "@/lib/partyCanvas";

export type DieKind = "d20" | "d6" | "d100";
export type Luck = "normal" | "advantage" | "disadvantage";

export const DIE_FACES: Record<DieKind, number> = { d20: 20, d6: 6, d100: 100 };

// How long a die tumbles, how long it then sits there, and how long it takes to
// fade out once its time is up.
const TUMBLE_MS = 1500;
const LINGER_MS = 4200;
const FADE_MS = 800;

const RADIUS: Record<DieKind, number> = { d6: 21, d20: 24, d100: 26 };
// A d6 is a square, a d20 reads as a hexagon from any useful angle, and a d100
// is round enough to be a decagon.
const SIDES: Record<DieKind, number> = { d6: 4, d20: 6, d100: 10 };

const DRAG = 0.012;
const BOUNCE = 0.72;
// How far past its own edge a die shoves the crowd, and how hard.
const SHOVE_REACH = 2.4;
const SHOVE_PUSH = 0.9;

export type Die = {
  id: number;
  kind: DieKind;
  /** What it will read when it stops. Decided before it is ever thrown. */
  value: number;
  /** Whether this is the one of a pair that the roll actually took. */
  kept: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  spinRate: number;
  restsAt: number;
  goesAt: number;
};

export type Roll = {
  id: number;
  /** Wall clock, for the log. The dice themselves run on the frame clock. */
  at: number;
  kind: DieKind;
  luck: Luck;
  /** Both numbers, with advantage or disadvantage; one otherwise. */
  rolled: number[];
  value: number;
};

export const dieRadius = (die: Die) => RADIUS[die.kind];

const d = (faces: number) => 1 + Math.floor(Math.random() * faces);

/**
 * Throw one die, or two of them when the roll is made with advantage or
 * disadvantage. They come in off an edge heading across the canvas, which is
 * what puts them through the middle of the crowd.
 */
export function throwDice(
  kind: DieKind,
  luck: Luck,
  width: number,
  height: number,
  now: number,
  nextId: () => number,
): { dice: Die[]; roll: Roll } {
  const faces = DIE_FACES[kind];
  const rolled = luck === "normal" ? [d(faces)] : [d(faces), d(faces)];
  const value =
    luck === "disadvantage" ? Math.min(...rolled) : luck === "advantage" ? Math.max(...rolled) : rolled[0];
  // With two of them the one that counts is marked, so you can see which way
  // the luck went rather than being told.
  const taken = rolled.indexOf(value);

  // In from one of the four edges, aimed at somewhere near the middle.
  const from = Math.floor(Math.random() * 4);
  const dice = rolled.map((face, index) => {
    const spot = throwFrom(from, width, height, index);
    const toX = width * (0.35 + Math.random() * 0.3);
    const toY = height * (0.35 + Math.random() * 0.3);
    const away = Math.max(1, Math.hypot(toX - spot.x, toY - spot.y));
    const speed = 11 + Math.random() * 5;
    return {
      id: nextId(),
      kind,
      value: face,
      kept: index === taken,
      x: spot.x,
      y: spot.y,
      vx: ((toX - spot.x) / away) * speed,
      vy: ((toY - spot.y) / away) * speed,
      spin: Math.random() * Math.PI * 2,
      spinRate: (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.16),
      restsAt: now + TUMBLE_MS + Math.random() * 260,
      goesAt: now + TUMBLE_MS + LINGER_MS,
    } satisfies Die;
  });

  return {
    dice,
    roll: { id: nextId(), at: Date.now(), kind, luck, rolled, value },
  };
}

const throwFrom = (edge: number, width: number, height: number, index: number) => {
  const spread = index * 54;
  if (edge === 0) return { x: -40 - spread, y: Math.random() * height };
  if (edge === 1) return { x: width + 40 + spread, y: Math.random() * height };
  if (edge === 2) return { x: Math.random() * width, y: -40 - spread };
  return { x: Math.random() * width, y: height + 40 + spread };
};

/**
 * Roll the dice forward a frame: they slow down, they bounce off the sides, and
 * anyone in the crowd they pass close to is shoved out of the way — harder the
 * faster the die is still going, so a die that has come to rest is just an
 * object lying there rather than a permanent hole in the crowd.
 */
export function stepDice(
  dice: Die[],
  nodes: Node[],
  opts: { step: number; now: number; width: number; height: number },
) {
  const { step, now, width, height } = opts;
  for (let i = dice.length - 1; i >= 0; i -= 1) {
    const die = dice[i];
    if (now > die.goesAt + FADE_MS) {
      dice.splice(i, 1);
      continue;
    }
    if (step === 0) continue;

    const radius = RADIUS[die.kind];
    die.x += die.vx * step;
    die.y += die.vy * step;
    if (die.x < radius && die.vx < 0) {
      die.x = radius;
      die.vx = -die.vx * BOUNCE;
    }
    if (die.x > width - radius && die.vx > 0) {
      die.x = width - radius;
      die.vx = -die.vx * BOUNCE;
    }
    if (die.y < radius && die.vy < 0) {
      die.y = radius;
      die.vy = -die.vy * BOUNCE;
    }
    if (die.y > height - radius && die.vy > 0) {
      die.y = height - radius;
      die.vy = -die.vy * BOUNCE;
    }

    const speed = Math.hypot(die.vx, die.vy);
    if (now >= die.restsAt) {
      // Called time: it stops where it is and settles upright, so the number
      // on it can be read.
      die.vx *= Math.max(0, 1 - 0.08 * step);
      die.vy *= Math.max(0, 1 - 0.08 * step);
      die.spinRate *= Math.max(0, 1 - 0.08 * step);
      const upright = Math.round(die.spin / (Math.PI / 2)) * (Math.PI / 2);
      die.spin += (upright - die.spin) * Math.min(1, 0.09 * step);
    } else {
      die.vx *= Math.max(0, 1 - DRAG * step);
      die.vy *= Math.max(0, 1 - DRAG * step);
      die.spin += die.spinRate * step;
    }

    if (speed < 0.2) continue;
    const reach = radius * SHOVE_REACH;
    const shove = Math.min(1, speed / 9) * SHOVE_PUSH * step;
    for (const node of nodes) {
      const dx = node.x - die.x;
      const dy = node.y - die.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > reach) continue;
      const push = (1 - dist / reach) * shove;
      node.vx += (dx / dist) * push;
      node.vy += (dy / dist) * push;
    }
  }
}

/**
 * Draw the dice. While a die is tumbling it shows a face it is not going to
 * keep — it flickers through the others — and the number is always drawn the
 * right way up however the die itself is lying, because a rolling 6 you have
 * to tilt your head to read is not a 6.
 */
export function drawDice(
  ctx: CanvasRenderingContext2D,
  dice: Die[],
  opts: { now: number; accent: string; ink: string; surface: string },
) {
  const { now, accent, ink, surface } = opts;
  for (const die of dice) {
    const radius = RADIUS[die.kind];
    const going = now > die.goesAt ? 1 - (now - die.goesAt) / FADE_MS : 1;
    if (going <= 0) continue;
    const resting = now >= die.restsAt;
    // A die nobody is going to count is drawn faintly, so which of a pair the
    // roll took is something you can see.
    const weight = die.kept ? 1 : 0.38;

    ctx.save();
    ctx.globalAlpha = going * weight;
    ctx.translate(die.x, die.y);
    ctx.rotate(die.spin);

    ctx.beginPath();
    const sides = SIDES[die.kind];
    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(${ink}, 0.35)`;
    ctx.stroke();
    ctx.restore();

    // Face up, whatever the die is doing underneath it.
    const face = resting ? die.value : 1 + Math.floor((now / 70 + die.id) % DIE_FACES[die.kind]);
    ctx.save();
    ctx.globalAlpha = going * weight;
    ctx.font = `700 ${die.kind === "d100" ? 15 : 17}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = surface;
    ctx.fillText(String(face), die.x, die.y + 1);
    ctx.restore();
  }
}

/** "d20 with advantage — 18, 7 → 18", the line the roll goes into the log as. */
export const readRoll = (roll: Roll) => {
  const how =
    roll.luck === "advantage"
      ? " with advantage"
      : roll.luck === "disadvantage"
        ? " with disadvantage"
        : "";
  const both = roll.rolled.length > 1 ? `${roll.rolled.join(", ")} → ` : "";
  return `${roll.kind}${how} — ${both}${roll.value}`;
};

/* -------------------------------------------------------------- initiative */

/**
 * Who goes first. Every party member rolls a d20 and adds their Dexterity, and
 * then — this being the point of rolling for initiative — they line up in that
 * order and stand there for a while.
 */
export type Initiative = {
  /** Character id to what they rolled, total included. */
  scores: Record<string, { rolled: number; bonus: number; total: number }>;
  /** Character ids, highest total first. */
  order: string[];
  /** They hold the line until this. */
  until: number;
};

/** How long the party stands in its line before going back to the drift. */
const LINE_MS = 14000;

export function rollInitiative(
  members: { id: string; name: string; dex: number }[],
  now: number,
): { initiative: Initiative; lines: string[] } {
  const scores: Initiative["scores"] = {};
  for (const member of members) {
    const rolled = d(20);
    scores[member.id] = { rolled, bonus: member.dex, total: rolled + member.dex };
  }
  const order = members
    .slice()
    // A tie goes to the higher Dexterity, which is how it is settled at a table.
    .sort((a, b) => scores[b.id].total - scores[a.id].total || b.dex - a.dex)
    .map((m) => m.id);

  const byId = new Map(members.map((m) => [m.id, m] as const));
  const lines = order.map((id, place) => {
    const score = scores[id];
    const sign = score.bonus >= 0 ? `+${score.bonus}` : `${score.bonus}`;
    return `${place + 1}. ${byId.get(id)?.name ?? "unnamed"} — ${score.rolled}${sign} = ${score.total}`;
  });

  return { initiative: { scores, order, until: now + LINE_MS }, lines };
}

/**
 * Walk the party into its initiative order and hold them there — the same pull
 * the Formation panel uses, aimed at one line across the middle of the canvas
 * and applied to the party alone. The crowd goes on about its business.
 */
export function holdTheLine(
  party: Node[],
  initiative: Initiative,
  opts: { step: number; now: number; width: number; height: number },
) {
  if (opts.step === 0 || opts.now > initiative.until) return;
  const places = initiative.order.length;
  if (places === 0) return;
  // They ease out of the line over its last couple of seconds rather than being
  // dropped out of it.
  const left = initiative.until - opts.now;
  const grip = Math.min(1, left / 2000);
  const pull = 0.0055 * grip * opts.step;
  const damp = Math.min(0.9, 0.13 * grip * opts.step);

  for (const node of party) {
    const place = node.charId ? initiative.order.indexOf(node.charId) : -1;
    if (place < 0) continue;
    const toX = (opts.width * (place + 1)) / (places + 1);
    const toY = opts.height * 0.5;
    node.vx += (toX - node.x) * pull - node.vx * damp;
    node.vy += (toY - node.y) * pull - node.vy * damp;
  }
}
