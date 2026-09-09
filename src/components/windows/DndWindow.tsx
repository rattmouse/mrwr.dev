"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { GroupBox, NumberInput, ScrollView, Select, TextInput } from "react95";
import DndPortrait, { listGear } from "@/components/windows/DndPortrait";
import {
  ABILITIES,
  ALIGNMENTS,
  CLASSES,
  CLASS_NAMES,
  RACES,
  type Ability,
  type Character,
} from "@/lib/dnd";

export type DndWindowHandle = {
  /** Start a fresh, randomly rolled character (unsaved until Save). */
  newCharacter: () => void;
  /** Re-roll the six ability scores of the sheet being edited (4d6, drop lowest). */
  rollScores: () => void;
  /** Add the sheet to the party, or update it if it's already a member. */
  save: () => void;
  /** Strike the sheet's character from the party. */
  remove: () => void;
  /** Send the whole party on its way right now, walk-off and all. */
  depart: () => void;
};

type DndWindowProps = {
  /** Fires whenever the sheet gains/loses a saved counterpart or unsaved edits. */
  onStateChange?: (state: { saved: boolean; dirty: boolean; count: number }) => void;
};

const STORAGE_KEY = "mrwr.dnd.party";

// A party only sticks around this long once it forms, then it walks off. Keeps
// the roster from becoming anyone's permanent scratch space.
const DEPART_MS = 10 * 60 * 1000;
// Walk-off animation: how long each member takes to cross the screen, and the
// stagger between them.
const WALK_MS = 8000;
const WALK_STAGGER_MS = 400;

const ABILITY_LABEL: Record<Ability, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

const NAME_STARTS = [
  "Ar", "Bel", "Cor", "Dor", "El", "Fen", "Gar", "Hal", "Is", "Kel",
  "Lor", "Mor", "Nym", "Or", "Per", "Quin", "Ral", "Ser", "Tor", "Val",
  "Wren", "Xan", "Yor", "Zeph",
];
const NAME_ENDS = [
  "a", "an", "ath", "dor", "eth", "ia", "ic", "ien", "il", "in",
  "is", "ith", "lan", "lyn", "mir", "on", "ra", "rik", "us", "wyn",
];

type Roster = Character[];
type Stored = { members: Roster; departsAt: number | null };

const d6 = () => 1 + Math.floor(Math.random() * 6);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Classic 4d6, drop the lowest. */
function rollAbility(): number {
  const dice = [d6(), d6(), d6(), d6()].sort((a, b) => a - b);
  return dice[1] + dice[2] + dice[3];
}

function rollAllScores(): Record<Ability, number> {
  return {
    str: rollAbility(),
    dex: rollAbility(),
    con: rollAbility(),
    int: rollAbility(),
    wis: rollAbility(),
    cha: rollAbility(),
  };
}

function randomName(): string {
  return pick(NAME_STARTS) + pick(NAME_ENDS);
}

function modifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function proficiency(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// Max hit die at level 1, then the fixed "average" roll each level after, plus
// CON per level — the by-the-book default, no rolling.
function hitPoints(c: Character): number {
  const die = (CLASSES as Record<string, number>)[c.cls] ?? 8;
  const con = modifier(c.scores.con);
  const level = Math.max(1, c.level);
  const perLevel = Math.floor(die / 2) + 1;
  return Math.max(1, die + con + (level - 1) * (perLevel + con));
}

function freshCharacter(): Character {
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

function isCharacter(c: unknown): c is Character {
  return typeof c === "object" && c !== null && typeof (c as Character).id === "string";
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { members: [], departsAt: null };
    const parsed: unknown = JSON.parse(raw);
    // First cut stored a bare array; treat it as a party with no clock set.
    if (Array.isArray(parsed)) return { members: parsed.filter(isCharacter), departsAt: null };
    if (typeof parsed !== "object" || parsed === null) return { members: [], departsAt: null };
    const obj = parsed as Partial<Stored>;
    const members = Array.isArray(obj.members) ? obj.members.filter(isCharacter) : [];
    const departsAt = typeof obj.departsAt === "number" ? obj.departsAt : null;
    return { members, departsAt };
  } catch {
    return { members: [], departsAt: null };
  }
}

function saveStored(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or quota — the party just doesn't outlive the tab.
  }
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const sameCharacter = (a: Character, b: Character) => JSON.stringify(a) === JSON.stringify(b);

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: "bold",
  whiteSpace: "nowrap",
};

/**
 * A pocket character roster: roll up an adventurer, tweak the sheet, and Save
 * to add them to the party. The roster lives in localStorage — nothing
 * leaves the browser.
 */
const DndWindow = forwardRef<DndWindowHandle, DndWindowProps>(function DndWindow(
  { onStateChange },
  ref,
) {
  const [roster, setRoster] = useState<Roster>([]);
  const [draft, setDraft] = useState<Character>(() => freshCharacter());
  const [loaded, setLoaded] = useState(false);
  // When the current party walks off, or null while there is no party.
  const [departsAt, setDepartsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Members mid-walk-off, plus where they set out from (the window, in
  // viewport px). Null when nobody is leaving.
  const [departing, setDeparting] = useState<{ members: Roster; from: { x: number; y: number } } | null>(null);
  // True after a party has left and nobody new has joined yet.
  const [departed, setDeparted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // localStorage is browser-only; read it after mount so SSR and the first
  // client render agree. A party whose time ran out while the tab was closed
  // has simply gone.
  useEffect(() => {
    const stored = loadStored();
    if (stored.departsAt !== null && Date.now() >= stored.departsAt) {
      setRoster([]);
      setDepartsAt(null);
      setDeparted(stored.members.length > 0);
    } else {
      setRoster(stored.members);
      setDepartsAt(stored.departsAt);
      if (stored.members.length > 0) setDraft(stored.members[0]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveStored({ members: roster, departsAt });
  }, [roster, departsAt, loaded]);

  // The clock starts when a party forms and stops when it's gone.
  useEffect(() => {
    if (!loaded) return;
    if (roster.length === 0) {
      setDepartsAt(null);
    } else {
      setDepartsAt((prev) => prev ?? Date.now() + DEPART_MS);
    }
  }, [roster.length, loaded]);

  // Tick once a second while there's a party, for the countdown and to notice
  // when it's time to go.
  useEffect(() => {
    if (departsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [departsAt]);

  // Everyone files out from behind the window, and the roster empties.
  const depart = useCallback(() => {
    if (roster.length === 0) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const from = rect
      ? { x: rect.left + rect.width / 2, y: rect.bottom - 48 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setDeparting({ members: roster, from });
    setRoster([]);
    setDeparted(true);
  }, [roster]);

  useEffect(() => {
    if (departsAt === null || now < departsAt) return;
    depart();
  }, [now, departsAt, depart]);

  // Clear the walkers once the last one is off screen.
  useEffect(() => {
    if (!departing) return;
    const total = WALK_MS + departing.members.length * WALK_STAGGER_MS + 500;
    const timer = window.setTimeout(() => setDeparting(null), total);
    return () => window.clearTimeout(timer);
  }, [departing]);

  const savedTwin = roster.find((c) => c.id === draft.id);
  const isSaved = savedTwin !== undefined;
  const isDirty = savedTwin === undefined || !sameCharacter(savedTwin, draft);

  useEffect(() => {
    onStateChange?.({ saved: isSaved, dirty: isDirty, count: roster.length });
  }, [isSaved, isDirty, roster.length, onStateChange]);

  const patch = useCallback((changes: Partial<Character>) => {
    setDraft((prev) => ({ ...prev, ...changes }));
  }, []);

  const setScore = (ability: Ability, value: number) => {
    const clamped = Math.max(1, Math.min(30, Math.round(value)));
    setDraft((prev) => ({ ...prev, scores: { ...prev.scores, [ability]: clamped } }));
  };

  useImperativeHandle(
    ref,
    () => ({
      newCharacter: () => setDraft(freshCharacter()),
      rollScores: () => setDraft((prev) => ({ ...prev, scores: rollAllScores() })),
      save: () => {
        const trimmed = { ...draft, name: draft.name.trim() || randomName() };
        const idx = roster.findIndex((c) => c.id === trimmed.id);
        const next = roster.slice();
        if (idx === -1) next.push(trimmed);
        else next[idx] = trimmed;
        setRoster(next);
        setDraft(trimmed);
        setDeparted(false);
      },
      remove: () => {
        const idx = roster.findIndex((c) => c.id === draft.id);
        if (idx === -1) return;
        const next = roster.filter((c) => c.id !== draft.id);
        setRoster(next);
        setDraft(next[Math.min(idx, next.length - 1)] ?? freshCharacter());
      },
      depart,
    }),
    [draft, roster, depart],
  );

  const hp = hitPoints(draft);
  const countdown = departsAt !== null && roster.length > 0 ? formatCountdown(departsAt - now) : null;

  return (
    <div
      ref={rootRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignContent: "stretch",
        overflow: "auto",
      }}
    >
      <GroupBox
        label={`Party (${roster.length})`}
        style={{ flex: "1 1 140px", minWidth: 0, minHeight: 120, display: "flex", flexDirection: "column", padding: 4 }}
      >
        <ScrollView style={{ width: "100%", flex: "1 1 auto", minHeight: 96, background: "#fff" }}>
          <div role="listbox" aria-label="Party" style={{ fontSize: 12, lineHeight: 1.3 }}>
            {roster.length === 0 && (
              <div style={{ padding: "4px 6px", color: "#808080" }}>
                {departed ? "the party has moved on — roll up a new one and Save" : "no one yet — roll one up and Save"}
              </div>
            )}
            {roster.map((c) => {
              const selected = c.id === draft.id;
              return (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={selected}
                  onClick={() => setDraft(c)}
                  style={{
                    padding: "2px 6px",
                    cursor: "pointer",
                    background: selected ? "#000080" : "transparent",
                    color: selected ? "#ffffff" : "inherit",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`${c.name} — ${c.race} ${c.cls} ${c.level}`}
                >
                  <DndPortrait
                    character={c}
                    size={16}
                    style={{ display: "inline-block", verticalAlign: "-3px", marginRight: 5 }}
                  />
                  {c.name}
                  <span style={{ opacity: 0.75 }}>
                    {" · "}
                    {c.cls} {c.level}
                  </span>
                </div>
              );
            })}
            {!isSaved && (
              <div
                role="option"
                aria-selected
                style={{
                  padding: "2px 6px",
                  background: "#000080",
                  color: "#ffffff",
                  fontStyle: "italic",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <DndPortrait
                  character={draft}
                  size={16}
                  style={{ display: "inline-block", verticalAlign: "-3px", marginRight: 5 }}
                />
                {draft.name.trim() || "unnamed"} (unsaved)
              </div>
            )}
          </div>
        </ScrollView>
        {countdown && (
          <div
            title="The party moves on when the clock runs out"
            style={{ fontSize: 11, marginTop: 3, textAlign: "center", whiteSpace: "nowrap" }}
          >
            leaves in {countdown}
          </div>
        )}
      </GroupBox>

      <GroupBox
        label={isSaved ? (isDirty ? "Sheet *" : "Sheet") : "New sheet"}
        style={{ flex: "3 1 250px", minWidth: 0, padding: 6 }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
          <div
            title={listGear(draft)}
            style={{
              border: "2px solid",
              borderColor: "#808080 #ffffff #ffffff #808080",
              padding: 2,
              background: "#000000",
              flex: "0 0 auto",
            }}
          >
            <DndPortrait character={draft} size={80} />
          </div>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <TextInput
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="who are you?"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            <div
              style={{
                fontSize: 11,
                marginTop: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {draft.race} {draft.cls} · {draft.alignment}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 6px", alignItems: "center" }}>
          <span style={LABEL_STYLE}>Race</span>
          <Select<string>
            value={draft.race}
            options={RACES.map((r) => ({ value: r, label: r }))}
            onChange={(opt) => patch({ race: opt.value })}
            menuMaxHeight={140}
            width="100%"
          />

          <span style={LABEL_STYLE}>Class</span>
          <Select<string>
            value={draft.cls}
            options={CLASS_NAMES.map((c) => ({ value: c, label: `${c} (d${CLASSES[c]})` }))}
            onChange={(opt) => patch({ cls: opt.value })}
            menuMaxHeight={140}
            width="100%"
          />

          <span style={LABEL_STYLE}>Alignment</span>
          <Select<string>
            value={draft.alignment}
            options={ALIGNMENTS.map((a) => ({ value: a, label: a }))}
            onChange={(opt) => patch({ alignment: opt.value })}
            menuMaxHeight={140}
            width="100%"
          />

          <span style={LABEL_STYLE}>Level</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <NumberInput
              value={draft.level}
              min={1}
              max={20}
              width={84}
              onChange={(v) => patch({ level: Math.max(1, Math.min(20, Math.round(v || 1))) })}
            />
            <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
              prof {signed(proficiency(draft.level))} · HP {hp}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
            gap: "4px 10px",
            marginTop: 8,
          }}
        >
          {ABILITIES.map((ab) => (
            <label
              key={ab}
              style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}
            >
              <span style={{ ...LABEL_STYLE, width: 28 }}>{ABILITY_LABEL[ab]}</span>
              <NumberInput
                value={draft.scores[ab]}
                min={1}
                max={30}
                width={92}
                onChange={(v) => setScore(ab, v || 1)}
              />
              <span style={{ fontSize: 11, width: 22, textAlign: "right" }}>
                {signed(modifier(draft.scores[ab]))}
              </span>
            </label>
          ))}
        </div>
      </GroupBox>

      {departing &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden
            style={{
              position: "fixed",
              inset: 0,
              // Between the desktop and the windows, so they set out from
              // behind this one.
              zIndex: 5,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <style>{`
              @keyframes dnd-walk-right { from { transform: translateX(0); } to { transform: translateX(100vw); } }
              @keyframes dnd-walk-left { from { transform: translateX(0) scaleX(-1); } to { transform: translateX(-100vw) scaleX(-1); } }
              @keyframes dnd-bob { from { transform: translateY(0); } to { transform: translateY(-3px); } }
            `}</style>
            {departing.members.map((c, i) => {
              const goesRight = i % 2 === 0;
              return (
                <div
                  key={c.id}
                  style={{
                    position: "absolute",
                    left: departing.from.x - 24,
                    top: departing.from.y + (i % 3) * 6 - 6,
                    animation: `${goesRight ? "dnd-walk-right" : "dnd-walk-left"} ${WALK_MS}ms linear ${i * WALK_STAGGER_MS}ms both`,
                  }}
                >
                  <div style={{ animation: "dnd-bob 160ms steps(1) infinite alternate" }}>
                    <DndPortrait character={c} size={48} />
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
});

export default DndWindow;
