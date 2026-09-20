"use client";

import React, { useEffect, useRef } from "react";
import { Field, panelButton, Segmented } from "@/components/windows/PartyControls";
import { readRoll, type DieKind, type Luck, type Roll } from "@/lib/partyDice";
import { logTime } from "@/lib/usePartyLog";

/**
 * party.webp's Dice panel. The roster downstairs is a D&D party, so there is
 * something to roll: pick a die, pick your luck, and throw it across the canvas
 * — it tumbles through the crowd, shoves people aside and comes to rest showing
 * a number. Roll for initiative and the party lines up in the order it rolled.
 *
 * The log keeps both numbers when a roll was made with advantage or
 * disadvantage, because which one was thrown away is half of what happened.
 */
export default function PartyDicePanel({
  die,
  luck,
  rolls,
  accent,
  party,
  liningUp,
  onDie,
  onLuck,
  onRoll,
  onInitiative,
}: {
  die: DieKind;
  luck: Luck;
  rolls: Roll[];
  accent: string;
  /** How many are on the roster — with nobody there, nobody rolls initiative. */
  party: number;
  liningUp: boolean;
  onDie: (die: DieKind) => void;
  onLuck: (luck: Luck) => void;
  onRoll: () => void;
  onInitiative: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = ref.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [rolls]);

  const last = rolls[rolls.length - 1];

  return (
    <>
      <Field label="Die">
        <Segmented
          options={[
            { label: "d20", value: "d20" },
            { label: "d6", value: "d6" },
            { label: "d100", value: "d100" },
          ]}
          value={die}
          accent={accent}
          onChange={(value) => onDie(value as DieKind)}
        />
      </Field>
      <Field label="Luck">
        <Segmented
          options={[
            { label: "Disadv.", value: "disadvantage" },
            { label: "Straight", value: "normal" },
            { label: "Advant.", value: "advantage" },
          ]}
          value={luck}
          accent={accent}
          onChange={(value) => onLuck(value as Luck)}
        />
      </Field>

      {/* The number last thrown, big — the panel is a pair of dice and this is
          the face they came up. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
          gap: 8,
          padding: "10px 0 4px",
          minHeight: 44,
        }}
      >
        <span style={{ fontSize: 30, lineHeight: 1, fontWeight: 700, color: last ? accent : "rgba(232, 236, 244, 0.22)" }}>
          {last ? last.value : "—"}
        </span>
        {last && (
          <span style={{ fontSize: 11, color: "rgba(232, 236, 244, 0.45)" }}>
            {last.kind}
            {last.luck === "advantage" ? " adv." : last.luck === "disadvantage" ? " disadv." : ""}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRoll}
        style={{
          ...panelButton,
          border: `1px solid ${accent}`,
          background: accent,
          color: "#0b0e14",
          fontWeight: 600,
        }}
      >
        Roll
      </button>
      <button
        type="button"
        onClick={onInitiative}
        disabled={party === 0}
        title={
          party === 0
            ? "Nobody on the roster to line up — save a character first"
            : "Every member rolls a d20 and lines up in order"
        }
        style={{
          ...panelButton,
          cursor: party === 0 ? "default" : "pointer",
          opacity: party === 0 ? 0.38 : 1,
        }}
      >
        {liningUp ? "Lining up…" : "Roll for initiative"}
      </button>

      <div
        ref={ref}
        style={{
          height: 118,
          overflowY: "auto",
          padding: "6px 9px",
          borderRadius: 9,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(0, 0, 0, 0.32)",
          font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          color: "rgba(232, 236, 244, 0.8)",
        }}
      >
        {rolls.length === 0 ? (
          <span style={{ color: "rgba(232, 236, 244, 0.35)" }}>nothing rolled yet</span>
        ) : (
          rolls.map((entry) => (
            <div key={entry.id} style={{ display: "flex", gap: 7 }}>
              <span style={{ color: "rgba(232, 236, 244, 0.35)", flex: "0 0 auto" }}>
                {logTime(entry.at)}
              </span>
              <span>{readRoll(entry)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
