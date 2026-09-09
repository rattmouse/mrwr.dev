// Shared bits for dnd.exe: the character shape and the pick-lists the sheet
// and the portrait both read from.

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
