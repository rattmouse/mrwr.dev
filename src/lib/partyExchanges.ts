/**
 * What happens when whoever has wandered onto party.webp's canvas actually
 * catches somebody.
 *
 * The Encounters tool used to put a troll on the canvas and leave it at that:
 * the party closed in, the crowd got out of the way, and nothing ever touched
 * anything. This is the touching. A monster that reaches you takes a swing; a
 * party member standing next to one swings back; the crowd, which is a crowd
 * and not an audience, turns round at a safe distance and throws things. A
 * guest does the opposite of all of it and goes about patching people up.
 *
 * It is still not a game — there is nothing to win, nothing is scored and
 * nobody dies. The worst that happens to anyone is that they are knocked flat
 * and lie there until they come round. What it is for is that the canvas
 * should have consequences on it: a knot of figures round an ogre with numbers
 * lifting off them reads as something happening, where the same knot standing
 * politely does not.
 *
 * Everything to do with the arithmetic lives here, and so do the numbers that
 * lift off whoever it happened to, because those numbers are the only way to
 * see any of it.
 */

import { isDown, type Node, type Vitals } from "@/lib/partyCanvas";
import { arrivalSize, type Arrival, type ArrivalKind } from "@/lib/partyEncounters";
import { hitPoints, modifier, proficiency, type Character } from "@/lib/dnd";

const d = (faces: number) => 1 + Math.floor(Math.random() * faces);

/* ------------------------------------------------------------------ rules */

// How close something has to be to lay a hand on you, as a multiple of how big
// it is drawn — and how far off the crowd will throw something from, which is
// further, because throwing things is what you do instead of going closer.
const TOUCH = 1.35;
const PELT_REACH = 3.4;
/** How far out of their way a guest will go to help somebody. */
const GIFT_REACH = 3.2;

// How often each of them can act. A monster is slower than any one of the
// people round it, which is what gives a party of three a chance against
// something twice their size — and what makes a dragon a matter of arithmetic
// rather than of luck.
const SWING_MS = 1600;
const PARRY_MS = 1300;
const PELT_MS = 2600;
const GIFT_MS = 1500;

// How long somebody knocked down lies there before coming round, how much of
// themselves they have when they do, and how often somebody left alone gets a
// point back.
const UP_MS = 11000;
const UP_AT = 0.4;
const MEND_MS = 5200;
/** No mending for this long after a hit, or a fight could never go badly. */
const SHOCK_MS = 6000;

/** What one of the crowd can take. They are bystanders, not fighters. */
const CROWD_HP = 3;
/** How hard a blow throws whoever took it. The crowd is lighter on its feet. */
const KNOCK = 2.6;

/** How long a number hangs about, and how fast it lifts off its owner. */
const HIT_MS = 1150;
const HIT_RISE = 0.42;
/** Past this many the oldest ones are dropped — a canvas, not a ledger. */
const HITS_KEPT = 80;

/* ------------------------------------------------------------------- state */

/**
 * A number lifting off whoever it happened to: damage in red, help in green,
 * and a miss in whatever the canvas is drawing everything else in.
 */
export type Hit = {
  id: number;
  x: number;
  y: number;
  /** Sideways drift, so two at once don't rise as one. */
  drift: number;
  text: string;
  tone: "hurt" | "help" | "miss";
  /** A clean hit, or somebody back on their feet: drawn bigger. */
  big: boolean;
  at: number;
};

/** One thing presently going on, as the Goings-on panel wants to read it. */
export type Going = {
  id: number;
  kind: ArrivalKind;
  who: string;
  face: string;
  /** Why they are here, and what they leave behind them. */
  hook: string;
  reward: string;
  /** How big a thing they are, 0–1 — their size on the canvas and their presence. */
  size: number;
  hp: number;
  max: number;
  /** Who they are dealing with right now, or "" before they have met anybody. */
  with: string;
  turns: number;
  dealt: number;
  taken: number;
  last: string;
  /** Seconds before they wander off, and seconds since they walked in. */
  leaves: number;
  here: number;
  beaten: boolean;
};

/** How one party member is holding up. */
export type Standing = {
  id: string;
  name: string;
  hp: number;
  max: number;
  down: boolean;
};

/** Everything the Goings-on panel shows, taken off the canvas as it stands. */
export type Goings = {
  visits: Going[];
  party: Standing[];
  /** The crowd in the round: how many there are, and how they are faring. */
  crowd: { all: number; hurt: number; down: number };
};

export const NO_GOINGS: Goings = { visits: [], party: [], crowd: { all: 0, hurt: 0, down: 0 } };

export type ExchangeOpts = {
  step: number;
  now: number;
  /** The sheet behind a party member's node: what they can take, and dish out. */
  memberOf: (charId: string) => Character | undefined;
  nextId: () => number;
  /** A line for the Console. Only what is worth reading goes through it. */
  note: (line: string) => void;
};

/** What somebody is called, for a line of log that has to name them. */
const nameOf = (member: Character | undefined) =>
  member ? member.name.trim() || "somebody" : "one of the crowd";

/**
 * What is left of a node, made the first time anything happens to them — so a
 * canvas nobody has rolled an encounter onto carries none of this at all.
 */
function vitalsFor(node: Node, member: Character | undefined): Vitals {
  const max = member ? hitPoints(member) : CROWD_HP;
  const had = node.vitals;
  if (!had) {
    const made: Vitals = { hp: max, max, upAt: 0, swingAt: 0, mendAt: 0 };
    node.vitals = made;
    return made;
  }
  // A sheet edited mid-scrap changes what its owner can take.
  if (had.max !== max) {
    had.max = max;
    had.hp = Math.min(had.hp, max);
  }
  return had;
}

const pop = (
  hits: Hit[],
  opts: ExchangeOpts,
  x: number,
  y: number,
  text: string,
  tone: Hit["tone"],
  big = false,
) => {
  hits.push({
    id: opts.nextId(),
    x,
    y,
    drift: (Math.random() * 2 - 1) * 0.36,
    text,
    tone,
    big,
    at: opts.now,
  });
  if (hits.length > HITS_KEPT) hits.splice(0, hits.length - HITS_KEPT);
};

/* ----------------------------------------------------------------- the step */

/**
 * A frame of everybody getting on with each other. It runs before the arrivals
 * are moved and culled, so that somebody whose welcome has just run out is
 * still here to be seen off in the log.
 */
export function stepExchanges(arrivals: Arrival[], nodes: Node[], hits: Hit[], opts: ExchangeOpts) {
  const { step, now } = opts;

  for (const arrival of arrivals) {
    if (now > arrival.goesAt) {
      farewell(arrival, opts);
      continue;
    }
    if (step === 0 || arrival.beaten || now < arrival.arrivedAt + 600) continue;
    const size = arrivalSize(arrival);
    if (arrival.kind === "welcome") handOut(arrival, nodes, hits, opts, size);
    else scrap(arrival, nodes, hits, opts, size);
  }

  if (step === 0) return;
  // Coming round, and getting better: everyone on the canvas that anything has
  // ever happened to, whether or not there is still somebody here doing it.
  for (const node of nodes) {
    const vitals = node.vitals;
    if (!vitals) continue;
    if (vitals.upAt > 0) {
      // Lying down is lying still — whatever is pushing the crowd about doesn't
      // get to drag a body round the canvas with it.
      const settle = Math.max(0, 1 - 0.14 * step);
      node.vx *= settle;
      node.vy *= settle;
      if (now < vitals.upAt) continue;
      vitals.upAt = 0;
      vitals.hp = Math.max(1, Math.round(vitals.max * UP_AT));
      vitals.mendAt = now + MEND_MS;
      pop(hits, opts, node.x, node.y - 14, "up", "help");
      if (node.charId) {
        opts.note(`${nameOf(opts.memberOf(node.charId))} is back on their feet`);
      }
      continue;
    }
    if (vitals.hp < vitals.max && now >= vitals.mendAt) {
      vitals.hp += 1;
      vitals.mendAt = now + MEND_MS;
    }
  }
}

/**
 * Somebody's welcome has run out: what they leave behind them, in a line. This
 * runs on the one frame between their time being up and the arrivals step
 * culling them, which is why the order of the two matters.
 */
function farewell(arrival: Arrival, opts: ExchangeOpts) {
  // Driven off was said at the time, and saying it twice would be gloating.
  if (arrival.beaten) return;
  if (arrival.kind === "welcome") {
    opts.note(
      arrival.dealt > 0
        ? `${arrival.name} went on their way — ${arrival.dealt} put right`
        : `${arrival.name} went on their way`,
    );
  } else {
    opts.note(
      arrival.dealt > 0
        ? `the ${arrival.name} wandered off — ${arrival.dealt} damage done`
        : `the ${arrival.name} wandered off, having got nowhere near anybody`,
    );
  }
}

/** It has had enough and is going, and whatever it was carrying is yours. */
function drivenOff(arrival: Arrival, opts: ExchangeOpts) {
  arrival.beaten = true;
  arrival.last = "driven off";
  arrival.with = "";
  // Just long enough to fade out on, which is what the last of its welcome is
  // drawn as anyway.
  arrival.goesAt = Math.min(arrival.goesAt, opts.now + 1200);
  opts.note(`the ${arrival.name} is driven off — ${arrival.reward}`);
}

/** Take it down by this much, and see it off if that was the last of it. */
function wear(arrival: Arrival, amount: number, opts: ExchangeOpts) {
  arrival.hp = Math.max(0, arrival.hp - amount);
  arrival.taken += amount;
  if (arrival.hp <= 0) drivenOff(arrival, opts);
}

/** Take it out of somebody, throw them off their feet, and say if they fell. */
function wound(
  node: Node,
  vitals: Vitals,
  amount: number,
  from: Arrival,
  hits: Hit[],
  opts: ExchangeOpts,
): boolean {
  const { now } = opts;
  vitals.hp = Math.max(0, vitals.hp - amount);
  vitals.mendAt = now + SHOCK_MS;

  const dx = node.x - from.x;
  const dy = node.y - from.y;
  const away = Math.max(1, Math.hypot(dx, dy));
  const shove = KNOCK * (node.charId ? 0.7 : 1);
  node.vx += (dx / away) * shove;
  node.vy += (dy / away) * shove;

  if (vitals.hp > 0) return false;
  vitals.upAt = now + UP_MS;
  return true;
}

/**
 * A monster's frame. It picks whoever is nearest — a party member first, since
 * they are the ones walking towards it — and swings at them on its own slow
 * clock. Everybody it has not got hold of is doing something about it: the
 * party swings back, and the crowd, from further off, throws things.
 */
function scrap(arrival: Arrival, nodes: Node[], hits: Hit[], opts: ExchangeOpts, size: number) {
  const { now, memberOf } = opts;
  const touch = size * TOUCH;
  const pelt = size * PELT_REACH;

  let member: Node | null = null;
  let memberAway = Infinity;
  let bystander: Node | null = null;
  let bystanderAway = Infinity;

  for (const node of nodes) {
    if (isDown(node)) continue;
    const away = Math.hypot(node.x - arrival.x, node.y - arrival.y);
    if (away > pelt) continue;
    if (node.charId) {
      if (away > touch) continue;
      if (away < memberAway) {
        member = node;
        memberAway = away;
      }
      swingBack(node, arrival, hits, opts, size);
    } else if (away <= touch) {
      if (away < bystanderAway) {
        bystander = node;
        bystanderAway = away;
      }
    } else {
      throwSomething(node, arrival, hits, opts);
    }
  }

  if (now < arrival.swingAt || arrival.beaten) return;
  // The party first, since they are the ones actually in its way — unless one
  // of the crowd is right under its nose, in which case that is who it gets.
  const victim =
    member && (!bystander || memberAway <= bystanderAway * 1.6) ? member : bystander;
  if (!victim) return;
  arrival.swingAt = now + SWING_MS;
  arrival.turns += 1;

  const sheet = victim.charId ? memberOf(victim.charId) : undefined;
  const vitals = vitalsFor(victim, sheet);
  const who = nameOf(sheet);

  // The crowd is not armoured and is not expecting it: a swipe at one of them
  // simply lands. A party member gets a roll against them.
  if (sheet) {
    const rolled = d(20);
    const guard = 11 + modifier(sheet.scores.dex);
    const clean = rolled === 20;
    if (!clean && rolled + 1 + Math.round(arrival.size * 5) < guard) {
      arrival.with = who;
      arrival.last = `swung at ${who} and missed`;
      pop(hits, opts, victim.x, victim.y - 18, "miss", "miss");
      return;
    }
    const damage = (d(4) + Math.round(arrival.size * 4)) * (clean ? 2 : 1);
    arrival.dealt += damage;
    arrival.with = who;
    const floored = wound(victim, vitals, damage, arrival, hits, opts);
    pop(hits, opts, victim.x, victim.y - 18, `-${damage}`, "hurt", clean);
    arrival.last = floored
      ? `put ${who} on the floor`
      : clean
        ? `caught ${who} square — ${damage}`
        : `hit ${who} for ${damage}`;
    if (floored) opts.note(`${who} is down — the ${arrival.name} put them there`);
    return;
  }

  const damage = 1 + d(2);
  arrival.dealt += damage;
  const floored = wound(victim, vitals, damage, arrival, hits, opts);
  pop(hits, opts, victim.x, victim.y - 12, `-${damage}`, "hurt");
  arrival.last = floored ? "flattened one of the crowd" : "swiped at the crowd";
}

/** A party member standing next to it, hitting it, on their own clock. */
function swingBack(node: Node, arrival: Arrival, hits: Hit[], opts: ExchangeOpts, size: number) {
  const { now, memberOf } = opts;
  const sheet = node.charId ? memberOf(node.charId) : undefined;
  const vitals = vitalsFor(node, sheet);
  if (now < vitals.swingAt || !sheet) return;
  vitals.swingAt = now + PARRY_MS;

  const best = Math.max(modifier(sheet.scores.str), modifier(sheet.scores.dex));
  const rolled = d(20);
  const clean = rolled === 20;
  const guard = 10 + Math.round(arrival.size * 8);
  const who = nameOf(sheet);
  arrival.turns += 1;
  arrival.with = who;

  if (!clean && rolled + best + proficiency(sheet.level) < guard) {
    arrival.last = `${who} swung and missed`;
    pop(hits, opts, arrival.x, arrival.y - size * 0.3, "miss", "miss");
    return;
  }
  const damage = Math.max(1, (d(8) + best) * (clean ? 2 : 1));
  arrival.last = clean ? `${who} landed a clean one — ${damage}` : `${who} hit it for ${damage}`;
  pop(hits, opts, arrival.x, arrival.y - size * 0.45, `-${damage}`, "hurt", clean);
  wear(arrival, damage, opts);
}

/**
 * One of the crowd turning round at a safe distance and throwing something.
 * Most of them are busy running away, which is what the roll is for — but there
 * are a great many of them, and a goblin surrounded by forty people who have
 * all found a rock is a goblin with a problem.
 */
function throwSomething(node: Node, arrival: Arrival, hits: Hit[], opts: ExchangeOpts) {
  const { now } = opts;
  const vitals = vitalsFor(node, undefined);
  if (now < vitals.swingAt) return;
  vitals.swingAt = now + PELT_MS + Math.random() * PELT_MS;
  if (Math.random() > 0.34) return;
  // Nobody's name goes on this one: it is the crowd doing it, not a person.
  arrival.turns += 1;
  arrival.last = "the crowd is throwing things";
  pop(hits, opts, arrival.x + (Math.random() * 2 - 1) * 12, arrival.y, "-1", "hurt");
  wear(arrival, 1, opts);
}

/**
 * A guest's frame. They go looking for the worst off within arm's reach and put
 * them right — somebody on the floor first, because somebody on the floor is
 * what a guest is for.
 */
function handOut(arrival: Arrival, nodes: Node[], hits: Hit[], opts: ExchangeOpts, size: number) {
  const { now, memberOf } = opts;
  if (now < arrival.swingAt) return;
  const reach = size * GIFT_REACH;

  let needy: Node | null = null;
  let worst = 1;
  for (const node of nodes) {
    const vitals = node.vitals;
    if (!vitals) continue;
    if (Math.hypot(node.x - arrival.x, node.y - arrival.y) > reach) continue;
    if (vitals.upAt > 0) {
      needy = node;
      break;
    }
    const left = vitals.hp / vitals.max;
    if (left < worst) {
      needy = node;
      worst = left;
    }
  }

  if (!needy || !needy.vitals) {
    // Nobody wants anything. Ask again shortly rather than standing idle for a
    // second and a half.
    arrival.swingAt = now + GIFT_MS / 2;
    return;
  }

  arrival.swingAt = now + GIFT_MS;
  arrival.turns += 1;
  const vitals = needy.vitals;
  const sheet = needy.charId ? memberOf(needy.charId) : undefined;
  const who = nameOf(sheet);
  arrival.with = who;

  if (vitals.upAt > 0) {
    vitals.upAt = 0;
    vitals.hp = Math.max(1, Math.round(vitals.max * 0.6));
    vitals.mendAt = now + MEND_MS;
    arrival.dealt += vitals.hp;
    arrival.last = `helped ${who} up`;
    pop(hits, opts, needy.x, needy.y - 16, "up", "help", true);
    opts.note(`${arrival.name} helped ${who} up`);
    return;
  }

  const mended = Math.min(vitals.max - vitals.hp, d(4) + 2);
  vitals.hp += mended;
  arrival.dealt += mended;
  arrival.last = `${who} is ${mended} the better for it`;
  pop(hits, opts, needy.x, needy.y - 16, `+${mended}`, "help");
}

/**
 * Lift the numbers off their owners and let go of the ones that have faded.
 * `frames` is the frame clock rather than the crowd's — a number reads and is
 * gone on its own schedule, so turning Speed down doesn't leave a column of
 * them hanging in the air over somebody.
 */
export function stepHits(hits: Hit[], opts: { frames: number; now: number }) {
  const { frames, now } = opts;
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const hit = hits[i];
    if (now - hit.at > HIT_MS) {
      hits.splice(i, 1);
      continue;
    }
    hit.y -= HIT_RISE * frames;
    hit.x += hit.drift * frames;
  }
}

/* ---------------------------------------------------------------- drawing */

// Red for damage and green for help, in a pair of tones each — the pale ones
// glow on a dark canvas and are invisible on Mist, so the surface picks.
const HURT = { dark: "#fb7185", light: "#be123c" };
const HELP = { dark: "#4ade80", light: "#15803d" };
const FAIR = { dark: "#fbbf24", light: "#b45309" };

const toneOf = (hit: Hit, ink: string, light: boolean) =>
  hit.tone === "hurt"
    ? light
      ? HURT.light
      : HURT.dark
    : hit.tone === "help"
      ? light
        ? HELP.light
        : HELP.dark
      : `rgba(${ink}, 0.5)`;

/**
 * Draw the numbers. They lift off whoever it happened to, drift a little to one
 * side and fade — and each is drawn with the surface's own colour behind it,
 * because a red 7 over a crowd of figures in a red palette is a smudge.
 */
export function drawHits(
  ctx: CanvasRenderingContext2D,
  hits: Hit[],
  opts: { now: number; ink: string; light: boolean; surface: string },
) {
  const { now, ink, light, surface } = opts;
  for (const hit of hits) {
    const age = (now - hit.at) / HIT_MS;
    if (age < 0 || age >= 1) continue;
    // Straight in, and out over the back half, so a number is legible for most
    // of the time it is on the canvas.
    const there = age < 0.08 ? age / 0.08 : age < 0.55 ? 1 : 1 - (age - 0.55) / 0.45;

    ctx.save();
    ctx.globalAlpha = Math.max(0, there);
    ctx.font = `700 ${hit.big ? 17 : 13}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = surface;
    ctx.strokeText(hit.text, hit.x, hit.y);
    ctx.fillStyle = toneOf(hit, ink, light);
    ctx.fillText(hit.text, hit.x, hit.y);
    ctx.restore();
  }
}

/** One little bar of what somebody has left. */
function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  left: number,
  ink: string,
  light: boolean,
) {
  const height = 3;
  ctx.fillStyle = `rgba(${ink}, 0.2)`;
  ctx.fillRect(x - width / 2, y, width, height);
  const well = left > 0.6 ? HELP : left > 0.3 ? FAIR : HURT;
  ctx.fillStyle = light ? well.light : well.dark;
  ctx.fillRect(x - width / 2, y, Math.max(1, width * Math.max(0, left)), height);
}

/**
 * Draw what everyone has left — but only for those who have lost some of it, so
 * a canvas nothing has happened on stays a canvas of people walking about
 * rather than a stock-take of hit points.
 */
export function drawVitals(
  ctx: CanvasRenderingContext2D,
  nodes: Node[],
  arrivals: Arrival[],
  opts: { now: number; ink: string; light: boolean; heightOf: (node: Node) => number },
) {
  const { now, ink, light, heightOf } = opts;

  for (const node of nodes) {
    const vitals = node.vitals;
    if (!vitals || (vitals.hp >= vitals.max && vitals.upAt === 0)) continue;
    // Under the feet of a figure still standing, and under the body of one that
    // isn't — a party member has their name in between.
    const under = node.y + heightOf(node) / 2 + (node.charId && vitals.upAt === 0 ? 16 : 6);
    bar(ctx, node.x, under, node.charId ? 26 : 15, vitals.hp / vitals.max, ink, light);
  }

  for (const arrival of arrivals) {
    if (arrival.hp >= arrival.max) continue;
    // While it is fading out there is nothing left to report.
    if (now > arrival.goesAt - 1200) continue;
    const size = arrivalSize(arrival);
    bar(
      ctx,
      arrival.x,
      arrival.y + size / 2 + 17,
      Math.max(30, size * 0.9),
      arrival.hp / arrival.max,
      ink,
      light,
    );
  }
}

/* --------------------------------------------------------------- the panel */

/**
 * The canvas as the Goings-on panel wants to read it: who is here and what they
 * have been up to, how the party is holding up, and how the crowd is faring.
 * Taken fresh a few times a second rather than kept in step, because the fight
 * happens in the draw loop and React has no business being in there.
 */
export function goingsOn(
  arrivals: Arrival[],
  nodes: Node[],
  roster: Character[],
  now: number,
): Goings {
  const visits: Going[] = arrivals.map((arrival) => ({
    id: arrival.id,
    kind: arrival.kind,
    who: arrival.name,
    face: arrival.face,
    hook: arrival.hook,
    reward: arrival.reward,
    size: arrival.size,
    hp: arrival.hp,
    max: arrival.max,
    with: arrival.with,
    turns: arrival.turns,
    dealt: arrival.dealt,
    taken: arrival.taken,
    last: arrival.last,
    leaves: Math.max(0, Math.round((arrival.goesAt - now) / 1000)),
    here: Math.max(0, Math.round((now - arrival.arrivedAt) / 1000)),
    beaten: arrival.beaten,
  }));

  const standing = new Map<string, Node>();
  const crowd = { all: 0, hurt: 0, down: 0 };
  for (const node of nodes) {
    if (node.charId) {
      standing.set(node.charId, node);
      continue;
    }
    crowd.all += 1;
    const vitals = node.vitals;
    if (!vitals) continue;
    if (vitals.upAt > 0) crowd.down += 1;
    else if (vitals.hp < vitals.max) crowd.hurt += 1;
  }

  const party: Standing[] = roster.map((member) => {
    const vitals = standing.get(member.id)?.vitals;
    const max = hitPoints(member);
    return {
      id: member.id,
      name: member.name.trim() || "unnamed",
      hp: vitals ? vitals.hp : max,
      max: vitals ? vitals.max : max,
      down: vitals ? vitals.upAt > 0 : false,
    };
  });

  return { visits, party, crowd };
}
