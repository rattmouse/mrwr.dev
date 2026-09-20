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
 * This module only gets them onto the canvas and moves them about on it. What
 * happens when one of them actually catches somebody — the blows, the numbers
 * coming off whoever they landed on, who ends up flat on their back — is
 * partyExchanges' business, and everything here that a fight needs is the
 * couple of tallies the Arrival carries for it.
 */

import { isDown, type Node } from "@/lib/partyCanvas";

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
  /** What it can take before it gives up and goes. Guests are never hit. */
  hp: number;
  max: number;
  /** When it can next take a swing at whoever is in front of it. */
  swingAt: number;
  /** How many times it has done something to somebody, or somebody to it. */
  turns: number;
  /** Damage dealt, or — for a guest — hit points handed back out. */
  dealt: number;
  taken: number;
  /** Who it is presently dealing with, by name. */
  with: string;
  /** The last thing that happened, in words, for the Goings-on panel. */
  last: string;
  /**
   * Why it is here and what it is carrying, kept on the arrival as well as on
   * the Encounter so that beating it can hand the loot over, and so that
   * picking it on the canvas has something to tell you about it.
   */
  hook: string;
  reward: string;
  /** True once it has been driven off, rather than having stayed its welcome out. */
  beaten: boolean;
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

/**
 * What one of them can take before it has had enough, by how big it is. It runs
 * steeply on purpose: a goblin goes down to a couple of good swings and the
 * odd rock, while a dragon simply outlasts its own welcome — there is nothing
 * a party of three can do to one in forty seconds but survive it. Guests carry
 * the number too and never spend any of it; nobody hits a guest.
 */
export const arrivalHp = (size: number) => Math.round(14 + size * 90);

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
  const hook = pick(kind === "welcome" ? WELCOMES : HOOKS);
  const reward = pick(kind === "welcome" ? GIFTS : LOOT);
  const stuffing = arrivalHp(somebody.size);

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
      hp: stuffing,
      max: stuffing,
      // It gets its bearings before it starts on anybody.
      swingAt: now + 1200,
      turns: 0,
      dealt: 0,
      taken: 0,
      with: "",
      last: kind === "welcome" ? "looking for somebody to help" : "sizing the room up",
      hook,
      reward,
      beaten: false,
    },
    encounter: {
      id: nextId(),
      at: Date.now(),
      kind,
      who: somebody.name,
      hook,
      reward,
    },
  };
}

// How far somebody's presence is felt, as a multiple of how big they are, and
// how hard the party closes in against how hard everyone else reacts. The crowd
// is more frightened than the party is brave, which is the right way round.
const REACH = 5.5;
const BRAVERY = 0.055;
const FRIGHT = 0.16;
// What the party does about something on the far side of the canvas, where its
// presence is not felt at all: they set off towards it anyway. This is the only
// reason an encounter is reliably an encounter — a party of three and a monster
// adrift in a window this size will otherwise often never meet, and forty
// seconds is not long to be crossing a room in.
//
// It is an acceleration like everything else here, and what holds it in check
// is the walking pace the crowd is kept at, which is forever easing everybody
// back down to a stroll. The two settle against each other at a little under
// five times that stroll — a party that has plainly set off somewhere, and
// arrives well inside the time their visitor is staying.
const SEEK = 0.012;
// Curiosity is gentler than fright and slower to arrive: a crowd gathering has
// all the time in the world, a crowd getting out of the way does not.
const CURIOSITY = 0.045;
// Where the crowd comes to rest around a guest, as a multiple of their size —
// close enough to be a huddle, far enough to leave them room.
const GATHER_AT = 1.9;
const DRAG = 0.02;
const WANDER = 0.035;
// What a monster does about the fact that everybody keeps getting out of its
// way: it goes after whoever is nearest. Held down by the drag above to a shade
// over twice a stroll, so it runs down the dawdlers and the unlucky while the
// rest of the crowd stays ahead of it — which is the whole picture of a crowd
// with something in it. Guests do not do this. Guests are not chasing anybody.
const HUNT = 0.025;
// Close enough to try, and what it puts into trying. Without this the crowd's
// fright — which is far stronger than anything a monster can walk at — parts
// around it perfectly for ever and it never lays a hand on a soul. With it, the
// unlucky and the slow get caught, which is the point of there being a monster.
const LUNGE_AT = 3;
const LUNGE = 6;

/** Whoever is closest and still on their feet, for something to go after. */
function nearest(arrival: Arrival, nodes: Node[]): Node | null {
  let best: Node | null = null;
  let bestAway = Infinity;
  for (const node of nodes) {
    if (isDown(node)) continue;
    const away = Math.hypot(node.x - arrival.x, node.y - arrival.y);
    if (away < bestAway) {
      bestAway = away;
      best = node;
    }
  }
  return best;
}

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

    const size = arrivalSize(arrival);

    // They keep moving, turn when they meet a wall, and drift.
    arrival.vx += (Math.random() * 2 - 1) * WANDER * step;
    arrival.vy += (Math.random() * 2 - 1) * WANDER * step;
    if (arrival.kind === "threat" && !arrival.beaten) {
      const quarry = nearest(arrival, nodes);
      if (quarry) {
        const dx = quarry.x - arrival.x;
        const dy = quarry.y - arrival.y;
        const away = Math.max(1, Math.hypot(dx, dy));
        const after = HUNT * (away < size * LUNGE_AT ? LUNGE : 1) * step;
        arrival.vx += (dx / away) * after;
        arrival.vy += (dy / away) * after;
      }
    }
    arrival.vx *= Math.max(0, 1 - DRAG * step);
    arrival.vy *= Math.max(0, 1 - DRAG * step);
    arrival.x += arrival.vx * step;
    arrival.y += arrival.vy * step;
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
      if (dist < 1) continue;
      // Somebody flat on their back is out of it: they don't run, they don't
      // close in, and nothing drags them across the canvas by the ankles.
      if (isDown(node)) continue;
      // Everybody else only reacts to what they can feel from where they are
      // standing. The party is the exception, below.
      if (dist > reach && !node.charId) continue;
      const near = 1 - dist / reach;
      if (node.charId) {
        // The party closes in — but stops short of walking into the thing —
        // and from right across the canvas sets off towards it in the first
        // place, because that is what the party is for.
        const want = dist > size * 1.1 ? 1 : -1.6;
        const pull = dist > reach ? SEEK * step : near * BRAVERY * want * step;
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
