// The party interface.exe keeps: the character shape, the pick-lists the sheet
// and the portrait both read from, the dice that roll one up, and the roster's
// own little store.

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const RACES = [
  "Human",
  "Elf",
  "Dwarf",
  "Halfling",
  "Gnome",
  "Half-Elf",
  "Half-Orc",
  "Tiefling",
  "Dragonborn",
] as const;
export type Race = (typeof RACES)[number];

// Hit die per class, for the HP line on the sheet.
export const CLASSES = {
  Barbarian: 12,
  Bard: 8,
  Cleric: 8,
  Druid: 8,
  Fighter: 10,
  Monk: 8,
  Paladin: 10,
  Ranger: 10,
  Rogue: 8,
  Sorcerer: 6,
  Warlock: 8,
  Wizard: 6,
} as const;
export type ClassName = keyof typeof CLASSES;
export const CLASS_NAMES = Object.keys(CLASSES) as ClassName[];

export const ALIGNMENTS = [
  "Lawful Good",
  "Neutral Good",
  "Chaotic Good",
  "Lawful Neutral",
  "True Neutral",
  "Chaotic Neutral",
  "Lawful Evil",
  "Neutral Evil",
  "Chaotic Evil",
] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export type Character = {
  id: string;
  name: string;
  race: string;
  cls: string;
  level: number;
  alignment: string;
  scores: Record<Ability, number>;
};

// A party only sticks around this long once it forms, then it walks off. Keeps
// the roster from becoming anyone's permanent scratch space.
export const DEPART_MS = 10 * 60 * 1000;
// Walk-off animation: how long each member takes to cross the screen, and the
// stagger between them.
export const WALK_MS = 8000;
export const WALK_STAGGER_MS = 400;

const STORAGE_KEY = "mrwr.dnd.party";

const NAME_STARTS = [
  "Ar", "Bel", "Cor", "Dor", "El", "Fen", "Gar", "Hal", "Is", "Kel",
  "Lor", "Mor", "Nym", "Or", "Per", "Quin", "Ral", "Ser", "Tor", "Val",
  "Wren", "Xan", "Yor", "Zeph",
];
const NAME_ENDS = [
  "a", "an", "ath", "dor", "eth", "ia", "ic", "ien", "il", "in",
  "is", "ith", "lan", "lyn", "mir", "on", "ra", "rik", "us", "wyn",
];

const d6 = () => 1 + Math.floor(Math.random() * 6);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Classic 4d6, drop the lowest. */
function rollAbility(): number {
  const dice = [d6(), d6(), d6(), d6()].sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

export function rollAllScores(): Record<Ability, number> {
  return {
    str: rollAbility(),
    dex: rollAbility(),
    con: rollAbility(),
    int: rollAbility(),
    wis: rollAbility(),
    cha: rollAbility(),
  };
}

export function randomName(): string {
  return pick(NAME_STARTS) + pick(NAME_ENDS);
}

export function modifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function proficiency(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// Max hit die at level 1, then the fixed "average" roll each level after, plus
// CON per level — the by-the-book default, no rolling.
export function hitPoints(c: Character): number {
  const die = (CLASSES as Record<string, number>)[c.cls] ?? 8;
  const con = modifier(c.scores.con);
  const level = Math.max(1, c.level);
  const perLevel = Math.floor(die / 2) + 1;
  return Math.max(1, die + con + (level - 1) * (perLevel + con));
}

export function freshCharacter(): Character {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: randomName(),
    race: pick(RACES) as string,
    cls: pick(CLASS_NAMES) as string,
    level: 1,
    alignment: pick(ALIGNMENTS) as string,
    scores: rollAllScores(),
  };
}

export const sameCharacter = (a: Character, b: Character) => JSON.stringify(a) === JSON.stringify(b);

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** The roster as it sits in localStorage: who is in it, and when they leave. */
export type StoredParty = { members: Character[]; departsAt: number | null };

function isCharacter(c: unknown): c is Character {
  return typeof c === "object" && c !== null && typeof (c as Character).id === "string";
}

export function loadParty(): StoredParty {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { members: [], departsAt: null };
    const parsed: unknown = JSON.parse(raw);
    // First cut stored a bare array; treat it as a party with no clock set.
    if (Array.isArray(parsed)) return { members: parsed.filter(isCharacter), departsAt: null };
    if (typeof parsed !== "object" || parsed === null) return { members: [], departsAt: null };
    const obj = parsed as Partial<StoredParty>;
    const members = Array.isArray(obj.members) ? obj.members.filter(isCharacter) : [];
    const departsAt = typeof obj.departsAt === "number" ? obj.departsAt : null;
    return { members, departsAt };
  } catch {
    return { members: [], departsAt: null };
  }
}

export function saveParty(stored: StoredParty) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or quota — the party just doesn't outlive the tab.
  }
}
