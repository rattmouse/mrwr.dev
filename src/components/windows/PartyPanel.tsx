"use client";

import React from "react";
import DndPortrait, { listGear } from "@/components/windows/DndPortrait";
import {
  ABILITIES,
  ALIGNMENTS,
  CLASSES,
  CLASS_NAMES,
  RACES,
  hitPoints,
  modifier,
  proficiency,
  signed,
  type Ability,
  type Character,
} from "@/lib/dnd";
import type { Party } from "@/lib/useParty";

const ABILITY_LABEL: Record<Ability, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

const MUTED = "rgba(232, 236, 244, 0.55)";
const SUNKEN = "rgba(255, 255, 255, 0.06)";
const EDGE = "1px solid rgba(255, 255, 255, 0.12)";

type PartyPanelProps = {
  party: Party;
  accent: string;
  /** Called when a row is clicked, so the canvas can ring that member too. */
  onPick: (character: Character) => void;
};

/**
 * The Party tool window: the roster on the left of the canvas' crowd, the sheet
 * below it, and the five things you can do to a character. Everyone saved here
 * walks out onto party.webp's canvas and drifts with the rest of them.
 *
 * The controls are the panel's own rather than the desktop's Windows 95 ones —
 * this window floats above the frame, and everything up here is modern.
 */
export default function PartyPanel({ party, accent, onPick }: PartyPanelProps) {
  const { draft, roster, stash, pending, saved, dirty } = party;
  const hp = hitPoints(draft);

  const unsaved = saved ? [pending] : [pending, draft];

  return (
    <>
      <div style={{ display: "grid", gap: 7 }}>
        <div
          style={{
            maxHeight: 122,
            overflowY: "auto",
            borderRadius: 9,
            border: EDGE,
            background: "rgba(0, 0, 0, 0.22)",
          }}
        >
          <div role="listbox" aria-label="Party" style={{ fontSize: 12, lineHeight: 1.35 }}>
            {roster.length === 0 && unsaved.every((c) => !c) && (
              <div style={{ padding: "7px 9px", color: MUTED }}>
                {party.departed
                  ? "the party has moved on — roll up a new one and Save"
                  : "no one yet — roll one up and Save"}
              </div>
            )}
            {roster.map((c) => (
              <Row
                key={c.id}
                character={c}
                accent={accent}
                selected={c.id === draft.id}
                marked={c.id === draft.id ? dirty : c.id in stash}
                onClick={() => onPick(c)}
              />
            ))}
            {unsaved.map((c) =>
              c ? (
                <Row
                  key={c.id}
                  character={c}
                  accent={accent}
                  selected={c.id === draft.id}
                  onClick={() => onPick(c)}
                  italic
                />
              ) : null,
            )}
          </div>
        </div>
        {party.countdown && (
          <div
            title="The party moves on when the clock runs out"
            style={{ fontSize: 11, textAlign: "center", color: MUTED }}
          >
            leaves in <span style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{party.countdown}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        <div
          title={listGear(draft)}
          style={{ border: EDGE, borderRadius: 7, padding: 3, background: "#000", flex: "0 0 auto" }}
        >
          <DndPortrait character={draft} size={58} tint={accent} />
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "grid", gap: 5 }}>
          <input
            value={draft.name}
            onChange={(e) => party.patch({ name: e.target.value })}
            placeholder="who are you?"
            aria-label="Name"
            style={{ ...inputStyle, width: "100%" }}
          />
          <span
            style={{
              fontSize: 11,
              color: MUTED,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {draft.race} {draft.cls} · {draft.alignment}
          </span>
          <span style={{ fontSize: 11, color: MUTED }}>
            prof <Value accent={accent}>{signed(proficiency(draft.level))}</Value> · HP{" "}
            <Value accent={accent}>{hp}</Value>
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center" }}>
        <Label>Race</Label>
        <Picker value={draft.race} options={RACES} onChange={(v) => party.patch({ race: v })} />
        <Label>Class</Label>
        <Picker
          value={draft.cls}
          options={CLASS_NAMES}
          label={(c) => `${c} (d${CLASSES[c]})`}
          onChange={(v) => party.patch({ cls: v })}
        />
        <Label>Align</Label>
        <Picker value={draft.alignment} options={ALIGNMENTS} onChange={(v) => party.patch({ alignment: v })} />
        <Label>Level</Label>
        <input
          type="number"
          min={1}
          max={20}
          value={draft.level}
          aria-label="Level"
          onChange={(e) =>
            party.patch({ level: Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))) })
          }
          style={{ ...inputStyle, width: 66 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "5px 9px" }}>
        {ABILITIES.map((ab) => (
          <label key={ab} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: MUTED, width: 26 }}>
              {ABILITY_LABEL[ab]}
            </span>
            <input
              type="number"
              min={1}
              max={30}
              value={draft.scores[ab]}
              onChange={(e) => party.setScore(ab, Number(e.target.value) || 1)}
              style={{ ...inputStyle, width: 56, flex: "0 0 auto" }}
            />
            <span style={{ fontSize: 11, color: accent, fontVariantNumeric: "tabular-nums" }}>
              {signed(modifier(draft.scores[ab]))}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Action title="Roll up a new adventurer" onClick={party.newCharacter}>
          New
        </Action>
        <Action title="Re-roll ability scores (4d6, drop lowest)" onClick={party.rollScores}>
          Roll
        </Action>
        <Action
          title={saved ? "Save changes to this sheet" : "Add this sheet to the party"}
          disabled={!dirty}
          accent={accent}
          onClick={party.save}
        >
          Save
        </Action>
        <Action title="Strike this character from the party" disabled={!saved} onClick={party.remove}>
          Delete
        </Action>
        <Action
          title="Send the whole party on its way now"
          disabled={roster.length === 0}
          onClick={party.depart}
        >
          Depart
        </Action>
      </div>
    </>
  );
}

function Row({
  character,
  accent,
  selected,
  marked,
  italic,
  onClick,
}: {
  character: Character;
  accent: string;
  selected: boolean;
  marked?: boolean;
  italic?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onClick}
      title={`${character.name} — ${character.race} ${character.cls} ${character.level}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        cursor: selected ? "default" : "pointer",
        background: selected ? "rgba(255, 255, 255, 0.1)" : "transparent",
        boxShadow: selected ? `inset 2px 0 0 ${accent}` : undefined,
        fontStyle: italic ? "italic" : undefined,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <DndPortrait character={character} size={17} tint={accent} style={{ flex: "0 0 auto" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {character.name.trim() || "unnamed"}
        {marked && " *"}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>
        {italic ? "unsaved" : `${character.cls} ${character.level}`}
      </span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 7,
  border: EDGE,
  background: SUNKEN,
  color: "#e8ecf4",
  font: "inherit",
  fontSize: 12,
  padding: "5px 7px",
  outline: "none",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: MUTED,
      }}
    >
      {children}
    </span>
  );
}

function Value({ accent, children }: { accent: string; children: React.ReactNode }) {
  return <span style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{children}</span>;
}

function Picker<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: readonly T[];
  label?: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ ...inputStyle, width: "100%", cursor: "pointer", appearance: "none" }}
    >
      {options.map((option) => (
        // The menu itself is the browser's, drawn on the page's own background.
        <option key={option} value={option} style={{ background: "#12141b" }}>
          {label ? label(option) : option}
        </option>
      ))}
    </select>
  );
}

function Action({
  children,
  title,
  disabled,
  accent,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  accent?: string;
  onClick: () => void;
}) {
  const lit = Boolean(accent) && !disabled;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: "1 1 auto",
        cursor: disabled ? "default" : "pointer",
        borderRadius: 7,
        border: lit ? `1px solid ${accent}` : EDGE,
        background: lit ? accent : SUNKEN,
        color: lit ? "#0b0e14" : "#e8ecf4",
        opacity: disabled ? 0.38 : 1,
        font: "inherit",
        fontSize: 12,
        padding: "6px 4px",
      }}
    >
      {children}
    </button>
  );
}
