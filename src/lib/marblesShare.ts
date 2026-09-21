/**
 * How a course gets handed to somebody else — not as a link, but as a code you
 * copy out and somebody else pastes in, the way a game on a console with no
 * memory would give you a password to carry on with.
 *
 * Two kinds of writing-down live here:
 *
 *  - The **seed**, in base 36, which is what the toolbar shows: seven
 *    characters at the most, usually six, and the whole of a course.
 *  - The **code**, which is the seed, the time and the run itself — every
 *    place the ball was, so what arrives is a ghost to race and not just a
 *    number — packed together, scrambled, stamped with a check and written out
 *    in groups of five. A code that has been meddled with fails its check and
 *    is thrown away rather than believed, so a time cannot be edited down to
 *    something nobody did.
 *
 * It is a lock on a garden gate. Everything needed to mint a code is in the
 * page's own script, so anybody determined can read it out and claim whatever
 * time they like; what this stops is the easy thing, which is changing a
 * couple of characters on the way past.
 */

import { thin, type Trail } from "@/lib/marblesGhost";
import type { Vec3 } from "@/lib/marbles3d";

/** One past the largest seed there is; buildCourse works in 32 bits. */
const LIMIT = 0x100000000;

/**
 * Crockford's base 32 — no I, L, O or U, so nothing in a token can be read
 * back as something else over a phone.
 */
const DIGITS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Four bytes of seed and three of time, before any run is written down. */
const HEAD = 7;
/** Seed, time and check with no run behind them: the shortest a code gets. */
const CODE_LEAST = 15;
/**
 * And the longest one worth handing anybody. A run of about a minute fits —
 * most courses go round in half that — and anything longer goes without its
 * ghost rather than turning into a code nobody can face pasting.
 */
const CODE_MOST = 2000;
/** How the code is broken up to be read and copied, as any password was. */
const GROUP = 5;
/**
 * A time is kept in hundredths, to the same precision the clock shows, and
 * three bytes of them is longer than anybody is going to be at it.
 */
const TICK = 100;
const SLOWEST = 0xffffff;
/** How finely a shared path is measured: eighths of a metre, near enough. */
const GRAIN = 8;
/** And how often a point of it is kept — ten a second, thinned on the way in. */
export const SHARE_STEP = 0.1;
/** What the check is mixed with. A number off the golden ratio, nothing more. */
const PEPPER = 0x9e3779b9;

/** A course nobody has seen before. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/** The seed as it is written down: in the box, in a code, read out loud. */
export function formatSeed(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}

/**
 * What somebody typed, as a seed. A code that could have come out of
 * formatSeed is taken as itself, so that copying one in gives back exactly the
 * course it came from. Anything else — a word, a name, today's date — is
 * stirred into a number instead: whatever you type gets you *some* course,
 * which is a better answer than an error message. Only an empty box is
 * nothing at all.
 */
export function readSeed(text: string): number | null {
  const tidy = text.trim();
  if (!tidy) return null;
  if (/^[0-9a-z]{1,7}$/i.test(tidy)) {
    const value = parseInt(tidy, 36);
    // Seven characters can spell more than fits in 32 bits; those fall through
    // and get stirred like any other word.
    if (Number.isFinite(value) && value < LIMIT) return value >>> 0;
  }
  return stir(tidy);
}

/** FNV-1a, which is only here to turn a word into a course. */
function stir(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------- the token */

/** The same mixing, over bytes, cut down to the sixteen bits of the check. */
function checkOf(bytes: Uint8Array): number {
  let h = PEPPER >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

/**
 * Bytes to hide the seed and the time behind, drawn from the check — so the
 * two halves of a token depend on each other and neither can be lifted out of
 * one code and dropped into another.
 */
function scramble(bytes: Uint8Array, from: number) {
  let x = ((from ^ PEPPER) >>> 0) || 1;
  for (let i = 0; i < bytes.length; i += 1) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    bytes[i] ^= x & 0xff;
  }
}

function toDigits(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += DIGITS[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += DIGITS[(acc << (5 - bits)) & 31];
  return out;
}

function fromDigits(text: string): Uint8Array | null {
  const out = new Uint8Array(Math.floor((text.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let got = 0;
  for (const ch of text) {
    const value = DIGITS.indexOf(ch);
    if (value < 0) return null;
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (got >= out.length) return null;
      out[got] = (acc >>> bits) & 0xff;
      got += 1;
    }
  }
  // Whatever is left over at the end is padding, and padding that is not zero
  // was never minted here, whatever else is wrong with it.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
  return got === out.length ? out : null;
}

/* ------------------------------------------------------------- the run */

/**
 * The path, as nibbles — three bits and a carry bit at a time.
 *
 * Points are put down in eighths of a metre, and what is written is not the
 * point, nor even the step from the one before, but how that step differs from
 * the step before it. A ball rolling keeps doing roughly what it was doing, so
 * that difference is nearly always nothing, or next to it, and fits in one
 * nibble where the step itself would take two: it is a quarter off the length
 * of every code.
 */
function putStep(nibbles: number[], value: number) {
  // Zigzag, so that a step backwards is as cheap as a step forwards.
  let z = ((value << 1) ^ (value >> 31)) >>> 0;
  for (;;) {
    const part = z & 7;
    z >>>= 3;
    nibbles.push(z ? part | 8 : part);
    if (!z) return;
  }
}

function takeStep(nibbles: number[], from: number): { value: number; next: number } | null {
  let shift = 0;
  let z = 0;
  let at = from;
  for (;;) {
    if (at >= nibbles.length || shift > 30) return null;
    const part = nibbles[at];
    at += 1;
    z |= (part & 7) << shift;
    shift += 3;
    if (!(part & 8)) break;
  }
  z >>>= 0;
  return { value: (z >>> 1) ^ -(z & 1), next: at };
}

function packTrail(trail: Trail): number[] {
  const nibbles: number[] = [];
  const was = [0, 0, 0];
  const pace = [0, 0, 0];
  for (const point of trail.points) {
    const now = [point.x * GRAIN, point.y * GRAIN, point.z * GRAIN];
    for (let a = 0; a < 3; a += 1) {
      const here = Math.round(now[a]);
      const step = here - was[a];
      putStep(nibbles, step - pace[a]);
      pace[a] = step;
      was[a] = here;
    }
  }
  return nibbles;
}

function unpackTrail(nibbles: number[], count: number, step: number): Trail | null {
  const points: Vec3[] = [];
  const was = [0, 0, 0];
  const pace = [0, 0, 0];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const got = takeStep(nibbles, at);
      if (!got) return null;
      at = got.next;
      pace[a] += got.value;
      was[a] += pace[a];
    }
    points.push({ x: was[0] / GRAIN, y: was[1] / GRAIN, z: was[2] / GRAIN });
  }
  return { step, points };
}

/**
 * What a code turns out to hold: the course, the time whoever wrote it down
 * did it in if they had one, and the run they did it on if it fitted.
 */
export type Shared = { seed: number; beat: number | null; run: Trail | null };

/**
 * Everything as one word. Four bytes of seed, three of hundredths, and — when
 * there is a run to send — two for how many points it has and then the points
 * themselves, two nibbles to the byte. All of it is hidden behind a keystream
 * drawn from the check, and the two bytes of check go on the end, so that any
 * one character altered anywhere takes the whole thing with it.
 *
 * The spacing of the points is not sent: they are laid out evenly across the
 * run, so the other end works it out from the time.
 */
export function writeCode(seed: number, time?: number | null, run?: Trail | null): string {
  const ticks = time != null && time > 0 ? Math.min(SLOWEST, Math.round(time * TICK)) : 0;
  // A path with no time to hang it on has nothing to say about when the ball
  // was where, so it does not go.
  const path = ticks > 0 && run && run.points.length > 1 ? thin(run, SHARE_STEP) : null;
  const nibbles = path ? packTrail(path) : [];
  const body = new Uint8Array(HEAD + (path ? 2 + Math.ceil(nibbles.length / 2) : 0));
  body[0] = (seed >>> 24) & 0xff;
  body[1] = (seed >>> 16) & 0xff;
  body[2] = (seed >>> 8) & 0xff;
  body[3] = seed & 0xff;
  body[4] = (ticks >>> 16) & 0xff;
  body[5] = (ticks >>> 8) & 0xff;
  body[6] = ticks & 0xff;
  if (path) {
    body[HEAD] = (path.points.length >>> 8) & 0xff;
    body[HEAD + 1] = path.points.length & 0xff;
    for (let i = 0; i < nibbles.length; i += 1) {
      const at = HEAD + 2 + (i >> 1);
      body[at] |= i % 2 === 0 ? nibbles[i] << 4 : nibbles[i];
    }
  }
  const sum = checkOf(body);
  scramble(body, sum);
  const whole = new Uint8Array(body.length + 2);
  whole.set(body, 0);
  whole[body.length] = (sum >>> 8) & 0xff;
  whole[body.length + 1] = sum & 0xff;
  const written = toDigits(whole);
  // A run long enough to make a code nobody can face pasting goes without its
  // ghost: the course and the time are worth more than the path.
  if (written.length > CODE_MOST && run) return writeCode(seed, time, null);
  return group(written);
}

/** In fives, with a dash between, the way a password was always printed. */
function group(code: string): string {
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += GROUP) parts.push(code.slice(i, i + GROUP));
  return parts.join("-");
}

/**
 * And back again, or nothing at all if it has been got at. Dashes, spaces and
 * line breaks are thrown away first: a code that has been through a chat
 * window and come back wrapped is still the same code.
 */
function readRun(code: string): Shared | null {
  const tidy = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (tidy.length < CODE_LEAST || tidy.length > CODE_MOST) return null;
  const whole = fromDigits(tidy);
  if (!whole || whole.length < HEAD + 2) return null;
  const sum = (whole[whole.length - 2] << 8) | whole[whole.length - 1];
  const body = whole.subarray(0, whole.length - 2);
  scramble(body, sum);
  if (checkOf(body) !== sum) return null;

  const seed = ((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0;
  const ticks = (body[4] << 16) | (body[5] << 8) | body[6];
  const beat = ticks > 0 ? ticks / TICK : null;
  if (body.length === HEAD || beat === null) return { seed, beat, run: null };

  const count = (body[HEAD] << 8) | body[HEAD + 1];
  if (count < 2) return { seed, beat, run: null };
  const nibbles: number[] = [];
  for (let i = HEAD + 2; i < body.length; i += 1) {
    nibbles.push(body[i] >> 4, body[i] & 0xf);
  }
  const run = unpackTrail(nibbles, count, beat / (count - 1));
  return { seed, beat, run };
}

/**
 * Whatever somebody has pasted in. A whole code gives back the course, the
 * time and the run; a bare seed gives the course alone; and anything else at
 * all is stirred into a course of its own, so that a name or a word typed into
 * the box is an answer rather than an error.
 */
export function readCode(text: string): Shared | null {
  const tidy = text.trim();
  if (!tidy) return null;
  const run = readRun(tidy);
  if (run) return run;
  // Something long that is made of nothing but code characters was plainly
  // meant to be a code, and if it does not check out the person should be told
  // so rather than quietly put on some course their typo happened to spell.
  const bare = tidy.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (bare.length >= CODE_LEAST && [...bare].every((ch) => DIGITS.includes(ch))) return null;
  const seed = readSeed(tidy);
  return seed === null ? null : { seed, beat: null, run: null };
}

/**
 * Put text on the clipboard, by whichever of the two ways this browser allows:
 * the modern one wants a secure context, and the old one wants something on
 * the page to select. Says whether it worked, because the button that asked
 * has to tell you.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard, or permission refused — try the old way below.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const done = document.execCommand("copy");
    document.body.removeChild(box);
    return done;
  } catch {
    return false;
  }
}
