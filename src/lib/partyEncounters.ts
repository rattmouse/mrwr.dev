/**
 * Something for the party to do with its ten minutes. An encounter puts a
 * monster on party.webp's canvas as a node like any other — except that the
 * party walks towards it and the crowd gets out of its way — and hands you a
 * hook to hang it on and a pile of loot for afterwards.
 *
 * None of it is a game. There is nothing to win and the monster cannot be
 * fought; it is a prompt, the way the roster is a character sheet rather than
 * a character.
 */

import type { Node } from "@/lib/partyCanvas";

export type Monster = {
  id: number;
  name: string;
  face: string;
  /** How big a thing it is, 0–1, which is its size and its menace both. */
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** It wanders in, and it wanders off again after this. */
  goesAt: number;
  arrivedAt: number;
};

const BESTIARY: { name: string; face: string; size: number }[] = [
  { name: "goblin", face: "👺", size: 0.3 },
  { name: "giant rat", face: "🐀", size: 0.25 },
  { name: "wolf", face: "🐺", size: 0.45 },
  { name: "bandit", face: "🗡️", size: 0.4 },
  { name: "skeleton", face: "💀", size: 0.4 },
  { name: "ghost", face: "👻", size: 0.5 },
  { name: "ogre", face: "👹", size: 0.7 },
  { name: "giant spider", face: "🕷️", size: 0.5 },
  { name: "owlbear", face: "🦉", size: 0.72 },
  { name: "wyvern", face: "🐉", size: 0.85 },
  { name: "mimic", face: "🧰", size: 0.45 },
  { name: "slime", face: "🫧", size: 0.35 },
  { name: "wizard's familiar", face: "🐈‍⬛", size: 0.28 },
  { name: "troll", face: "🧌", size: 0.75 },
  { name: "dragon", face: "🐲", size: 1 },
];

const HOOKS = [
  "it was following the party, and has been for two days",
  "it is guarding a door nobody remembers being there",
  "it is badly hurt, and something worse did it",
  "it has something of yours",
  "it is not alone, and the other one has not shown itself",
  "it is asleep, and the noise was coming from somewhere else",
  "the villagers said it was a legend and paid in advance",
  "it wants to talk, which is the part nobody expected",
  "it is between the party and the only way out",
  "it has been dead a while and has not let that stop it",
  "it is eating the evidence",
  "somebody set it loose on purpose",
];

const LOOT = [
  "a purse of 3d6 silver",
  "a map with one corner burnt off",
  "a key that fits nothing you have found yet",
  "a potion, unlabelled, faintly warm",
  "a sword with a name scratched off the blade",
  "somebody's wedding ring",
  "a sealed letter addressed to a dead man",
  "a lantern that will not blow out",
  "boots one size too small for everyone",
  "a ledger of debts, most of them crossed out",
  "a tooth the size of a thumb",
  "nothing at all, which is its own kind of news",
];

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** How long a monster hangs about before wandering off again. */
const STAY_MS = 40000;
/** How big on the canvas the smallest and the largest of them are drawn. */
const SMALLEST = 26;
const LARGEST = 64;

export const monsterSize = (monster: Monster) => SMALLEST + (LARGEST - SMALLEST) * monster.size;

export type Encounter = {
  id: number;
  at: number;
  monster: string;
  hook: string;
  loot: string;
};

/** Roll a monster onto the canvas, with something to hang it on and a reward. */
export function rollEncounter(
  width: number,
  height: number,
  now: number,
  nextId: () => number,
): { monster: Monster; encounter: Encounter } {
  const beast = pick(BESTIARY);
  // In from an edge, like the dice — it should arrive rather than appear.
  const side = Math.floor(Math.random() * 4);
  const spot =
    side === 0
      ? { x: -50, y: Math.random() * height }
      : side === 1
        ? { x: width + 50, y: Math.random() * height }
        : side === 2
          ? { x: Math.random() * width, y: -50 }
          : { x: Math.random() * width, y: height + 50 };
  const toX = width * (0.3 + Math.random() * 0.4);
  const toY = height * (0.3 + Math.random() * 0.4);
  const away = Math.max(1, Math.hypot(toX - spot.x, toY - spot.y));

  return {
    monster: {
      id: nextId(),
      name: beast.name,
      face: beast.face,
      size: beast.size,
      x: spot.x,
      y: spot.y,
      // The big ones lumber and the small ones scurry.
      vx: ((toX - spot.x) / away) * (2.6 - beast.size * 1.4),
      vy: ((toY - spot.y) / away) * (2.6 - beast.size * 1.4),
      arrivedAt: now,
      goesAt: now + STAY_MS,
    },
    encounter: {
      id: nextId(),
      at: Date.now(),
      monster: beast.name,
      hook: pick(HOOKS),
      loot: pick(LOOT),
    },
  };
}

// How far a monster's presence is felt, as a multiple of how big it is, and how
// hard the party closes in against how hard everyone else backs off. The crowd
// is more frightened than the party is brave, which is the right way round.
const DREAD_REACH = 5.5;
const BRAVERY = 0.055;
const FRIGHT = 0.16;
const MONSTER_DRAG = 0.02;
const MONSTER_WANDER = 0.035;

/**
 * Move the monsters and let everyone react to them: the party converges, the
 * crowd scatters. Both are forces like any other — nobody is teleported and
 * nothing is scripted, so what you get is a knot of party members closing in
 * through a hole in the crowd.
 */
export function stepMonsters(
  monsters: Monster[],
  nodes: Node[],
  opts: { step: number; now: number; width: number; height: number },
) {
  const { step, now, width, height } = opts;
  for (let i = monsters.length - 1; i >= 0; i -= 1) {
    const monster = monsters[i];
    if (now > monster.goesAt) {
      monsters.splice(i, 1);
      continue;
    }
    if (step === 0) continue;

    // It prowls: it keeps moving, turns when it meets a wall, and drifts.
    monster.vx += (Math.random() * 2 - 1) * MONSTER_WANDER * step;
    monster.vy += (Math.random() * 2 - 1) * MONSTER_WANDER * step;
    monster.vx *= Math.max(0, 1 - MONSTER_DRAG * step);
    monster.vy *= Math.max(0, 1 - MONSTER_DRAG * step);
    monster.x += monster.vx * step;
    monster.y += monster.vy * step;
    const edge = monsterSize(monster) / 2;
    if (monster.x < edge && monster.vx < 0) monster.vx = -monster.vx;
    if (monster.x > width - edge && monster.vx > 0) monster.vx = -monster.vx;
    if (monster.y < edge && monster.vy < 0) monster.vy = -monster.vy;
    if (monster.y > height - edge && monster.vy > 0) monster.vy = -monster.vy;

    const reach = monsterSize(monster) * DREAD_REACH;
    for (const node of nodes) {
      const dx = monster.x - node.x;
      const dy = monster.y - node.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > reach) continue;
      const near = 1 - dist / reach;
      if (node.charId) {
        // The party closes in — but stops short of walking into the thing.
        const want = dist > monsterSize(monster) * 1.1 ? 1 : -1.6;
        const pull = near * BRAVERY * want * step;
        node.vx += (dx / dist) * pull;
        node.vy += (dy / dist) * pull;
      } else {
        const push = near * near * FRIGHT * step;
        node.vx -= (dx / dist) * push;
        node.vy -= (dy / dist) * push;
      }
    }
  }
}

/**
 * Draw the monsters: the thing itself, its name under it, and the faint ring of
 * ground the crowd will not stand on. The ring is the only part that isn't
 * literal — it is there because "everyone is keeping their distance" is hard to
 * read as a shape when the shape is a hole.
 */
export function drawMonsters(
  ctx: CanvasRenderingContext2D,
  monsters: Monster[],
  opts: {
    now: number;
    ink: string;
    accent: string;
    sprite: (emoji: string) => HTMLCanvasElement | null;
  },
) {
  const { now, ink, accent, sprite } = opts;
  for (const monster of monsters) {
    const size = monsterSize(monster);
    // It fades in as it arrives and out as its welcome runs out.
    const arriving = Math.min(1, (now - monster.arrivedAt) / 500);
    const leaving = Math.min(1, (monster.goesAt - now) / 1200);
    const there = Math.max(0, Math.min(arriving, leaving));
    if (there <= 0) continue;

    ctx.save();
    ctx.globalAlpha = there * 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    // Turning slowly, so a thing that has come to a stop still reads as alive.
    ctx.lineDashOffset = -((now / 90) % 9);
    ctx.beginPath();
    ctx.arc(monster.x, monster.y, (size * DREAD_REACH) / 2.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const tile = sprite(monster.face);
    if (tile) {
      ctx.save();
      ctx.globalAlpha = there;
      ctx.drawImage(tile, monster.x - size / 2, monster.y - size / 2, size, size);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = there;
    ctx.font = "700 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgba(${ink}, 0.8)`;
    ctx.fillText(monster.name, monster.x, monster.y + size / 2 + 12);
    ctx.restore();
  }
}
