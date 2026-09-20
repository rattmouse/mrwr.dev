/**
 * Something for the party to do with its ten minutes. An encounter puts
 * somebody on party.webp's canvas as a node like any other — the party walks
 * towards them either way — and hands you a hook to hang it on and something to
 * come away with.
 *
 * Not everything that wanders in is a threat. A monster arrives and the crowd
 * scatters out of its way; a guest arrives and the crowd gathers round instead.
 * That is the whole difference, and it is enough to tell them apart across a
 * room.
 *
 * None of it is a game. There is nothing to win and the monster cannot be
 * fought; it is a prompt, the way the roster is a character sheet rather than
 * a character.
 */

import type { Node } from "@/lib/partyCanvas";

/** Whether the crowd backs away from this one or comes over to look. */
export type ArrivalKind = "threat" | "welcome";

export type Arrival = {
  id: number;
  name: string;
  face: string;
  kind: ArrivalKind;
  /** How big a thing it is, 0–1, which is its size and its presence both. */
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** It wanders in, and it wanders off again after this. */
  goesAt: number;
  arrivedAt: number;
};

type Somebody = { name: string; face: string; size: number };

const BESTIARY: Somebody[] = [
  { name: "goblin", face: "👺", size: 0.3 },
  { name: "tech bro", face: "👨🏻‍💻", size: 0.25 },
  { name: "jimothy", face: "🦝", size: 0.2 },
  { name: "wolf", face: "🐺", size: 0.45 },
  { name: "big foot", face: "🫈", size: 0.8 },
  { name: "skeleton", face: "💀", size: 0.4 },
  { name: "ghost", face: "👻", size: 0.5 },
  { name: "ogre", face: "👹", size: 0.7 },
  { name: "giant spider", face: "🕷️", size: 0.5 },
  { name: "zombie", face: "🧟", size: 0.5 },
  { name: "wyvern", face: "🐉", size: 0.85 },
  { name: "mimic", face: "🪎", size: 0.45 },
  { name: "slime", face: "🫧", size: 0.35 },
  { name: "tyrant", face: "🤴🏻", size: 0.28 },
  { name: "troll", face: "🧌", size: 0.75 },
  { name: "work", face: "🖥", size: 0.3 },
  { name: "vampire", face: "🧛🏻‍♂️", size: 0.4 },
  { name: "dragon", face: "🐲", size: 1 },
  { name: "boss", face: "🦹🏻‍♂️", size: 1 },
];

// Nobody here is carrying anything sharp. They run small on purpose — a guest
// is somebody you can see past, and the crowd has to fit round them.
const GUESTS: Somebody[] = [
  { name: "phoebe", face: "🧝🏻‍♀️", size: 0.2 },
  { name: "the cat", face: "🐈", size: 0.18 },
  { name: "wizard", face: "🧙🏼‍♂️", size: 0.3 },
  { name: "sea man", face: "🧜🏻‍♂️", size: 0.34 },
  { name: "loot", face: "🪎", size: 0.65 },
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

const WELCOMES = [
  "they have been walking since dawn and would like to sit down",
  "they are looking for someone, and it might be one of you",
  "they heard there was a party and came to see it",
  "they are lost, cheerfully, and in no hurry to stop being",
  "they have news from home, and for once it is good",
  "they want to hear where you have been",
  "they have brought back something you left behind",
  "they are following the music",
  "they will not say why they are so pleased to see you",
  "they came to warn you, kindly, about the road ahead",
  "they are selling nothing and want nothing, which takes some explaining",
  "they were only passing through and stopped anyway",
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

const GIFTS = [
  "bread still warm, and enough to go round",
  "directions, and they are right",
  "a song you will be humming for a week",
  "a night's lodging, no charge",
  "a name to ask for in the next town",
  "a dog that has decided to come along",
  "their good word, which travels faster than you do",
  "a mended strap you had not noticed was going",
  "the truth about something you were wrong about",
  "an hour in which nothing whatsoever happens",
  "a flask of something that helps",
  "an invitation, for later, that they mean",
];

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** How long somebody hangs about before wandering off again. */
const STAY_MS = 40000;
/** How big on the canvas the smallest and the largest of them are drawn. */
const SMALLEST = 26;
const LARGEST = 64;
// How often what wanders in turns out to be friendly. Rare on purpose — roughly
// one roll in ten — so the canvas stays a place where things happen to you, and
// a guest is a turn of luck rather than a welcoming committee.
const WELCOME_CHANCE = 0.1;

export const arrivalSize = (arrival: Arrival) => SMALLEST + (LARGEST - SMALLEST) * arrival.size;

export type Encounter = {
  id: number;
  at: number;
  kind: ArrivalKind;
  /** What walked in, by name. */
  who: string;
  hook: string;
  /** What the party comes away with — loot off a monster, a gift from a guest. */
  reward: string;
};

/** Roll somebody onto the canvas, with something to hang it on and a reward. */
export function rollEncounter(
  width: number,
  height: number,
  now: number,
  nextId: () => number,
): { arrival: Arrival; encounter: Encounter } {
  const kind: ArrivalKind = Math.random() < WELCOME_CHANCE ? "welcome" : "threat";
  const somebody = pick(kind === "welcome" ? GUESTS : BESTIARY);
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
    arrival: {
      id: nextId(),
      name: somebody.name,
      face: somebody.face,
      kind,
      size: somebody.size,
      x: spot.x,
      y: spot.y,
      // The big ones lumber and the small ones scurry.
      vx: ((toX - spot.x) / away) * (2.6 - somebody.size * 1.4),
      vy: ((toY - spot.y) / away) * (2.6 - somebody.size * 1.4),
      arrivedAt: now,
      goesAt: now + STAY_MS,
    },
    encounter: {
      id: nextId(),
      at: Date.now(),
      kind,
      who: somebody.name,
      hook: pick(kind === "welcome" ? WELCOMES : HOOKS),
      reward: pick(kind === "welcome" ? GIFTS : LOOT),
    },
  };
}

// How far somebody's presence is felt, as a multiple of how big they are, and
// how hard the party closes in against how hard everyone else reacts. The crowd
// is more frightened than the party is brave, which is the right way round.
const REACH = 5.5;
const BRAVERY = 0.055;
const FRIGHT = 0.16;
// Curiosity is gentler than fright and slower to arrive: a crowd gathering has
// all the time in the world, a crowd getting out of the way does not.
const CURIOSITY = 0.045;
// Where the crowd comes to rest around a guest, as a multiple of their size —
// close enough to be a huddle, far enough to leave them room.
const GATHER_AT = 1.9;
const DRAG = 0.02;
const WANDER = 0.035;

/**
 * Move whoever has wandered in and let everyone react to them. The party
 * converges either way; the crowd scatters from a monster and collects around a
 * guest. Both are forces like any other — nobody is teleported and nothing is
 * scripted, so what you get is a knot of party members closing in through a
 * hole in the crowd, or a ring of onlookers with the party pushing to the
 * front.
 */
export function stepArrivals(
  arrivals: Arrival[],
  nodes: Node[],
  opts: { step: number; now: number; width: number; height: number },
) {
  const { step, now, width, height } = opts;
  for (let i = arrivals.length - 1; i >= 0; i -= 1) {
    const arrival = arrivals[i];
    if (now > arrival.goesAt) {
      arrivals.splice(i, 1);
      continue;
    }
    if (step === 0) continue;

    // They keep moving, turn when they meet a wall, and drift.
    arrival.vx += (Math.random() * 2 - 1) * WANDER * step;
    arrival.vy += (Math.random() * 2 - 1) * WANDER * step;
    arrival.vx *= Math.max(0, 1 - DRAG * step);
    arrival.vy *= Math.max(0, 1 - DRAG * step);
    arrival.x += arrival.vx * step;
    arrival.y += arrival.vy * step;
    const size = arrivalSize(arrival);
    const edge = size / 2;
    if (arrival.x < edge && arrival.vx < 0) arrival.vx = -arrival.vx;
    if (arrival.x > width - edge && arrival.vx > 0) arrival.vx = -arrival.vx;
    if (arrival.y < edge && arrival.vy < 0) arrival.vy = -arrival.vy;
    if (arrival.y > height - edge && arrival.vy > 0) arrival.vy = -arrival.vy;

    const reach = size * REACH;
    for (const node of nodes) {
      const dx = arrival.x - node.x;
      const dy = arrival.y - node.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > reach) continue;
      const near = 1 - dist / reach;
      if (node.charId) {
        // The party closes in — but stops short of walking into the thing.
        const want = dist > size * 1.1 ? 1 : -1.6;
        const pull = near * BRAVERY * want * step;
        node.vx += (dx / dist) * pull;
        node.vy += (dy / dist) * pull;
      } else if (arrival.kind === "welcome") {
        // Everybody else comes over to see, and stops where the ring is drawn.
        const want = dist > size * GATHER_AT ? 1 : -1.2;
        const pull = near * CURIOSITY * want * step;
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
 * Draw whoever has wandered in: the figure, their name under it, and a ring.
 * The ring is the only part that isn't literal, and it says which sort this is
 * — around a monster it is the ground the crowd will not stand on, drawn as a
 * dashed line turning slowly; around a guest it is the ground the crowd is
 * standing on, drawn solid and filled, with everybody gathered on it.
 */
export function drawArrivals(
  ctx: CanvasRenderingContext2D,
  arrivals: Arrival[],
  opts: {
    now: number;
    ink: string;
    accent: string;
    sprite: (emoji: string) => HTMLCanvasElement | null;
  },
) {
  const { now, ink, accent, sprite } = opts;
  for (const arrival of arrivals) {
    const size = arrivalSize(arrival);
    // They fade in as they arrive and out as their welcome runs out.
    const arriving = Math.min(1, (now - arrival.arrivedAt) / 500);
    const leaving = Math.min(1, (arrival.goesAt - now) / 1200);
    const there = Math.max(0, Math.min(arriving, leaving));
    if (there <= 0) continue;

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    if (arrival.kind === "welcome") {
      ctx.beginPath();
      ctx.arc(arrival.x, arrival.y, size * GATHER_AT, 0, Math.PI * 2);
      ctx.globalAlpha = there * 0.09;
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.globalAlpha = there * 0.45;
      ctx.stroke();
    } else {
      ctx.globalAlpha = there * 0.5;
      ctx.setLineDash([3, 6]);
      // Turning slowly, so a thing that has come to a stop still reads as alive.
      ctx.lineDashOffset = -((now / 90) % 9);
      ctx.beginPath();
      ctx.arc(arrival.x, arrival.y, (size * REACH) / 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    const tile = sprite(arrival.face);
    if (tile) {
      ctx.save();
      ctx.globalAlpha = there;
      ctx.drawImage(tile, arrival.x - size / 2, arrival.y - size / 2, size, size);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = there;
    ctx.font = "700 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgba(${ink}, 0.8)`;
    ctx.fillText(arrival.name, arrival.x, arrival.y + size / 2 + 12);
    ctx.restore();
  }
}
