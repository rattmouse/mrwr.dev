"use client";

import React, { useEffect, useRef } from "react";
import { panelButton } from "@/components/windows/PartyControls";
import type { Encounter } from "@/lib/partyEncounters";

/**
 * party.webp's Encounters panel. The roster is a party and the canvas is
 * somewhere for it to be; this is the thing that happens to it. Roll one and a
 * monster walks in — the party moves towards it and everybody else moves away —
 * along with a hook to explain why it is there and the loot for afterwards.
 *
 * Nothing here is fought or won. It is a prompt, not a game.
 */
export default function PartyEncountersPanel({
  encounters,
  accent,
  prowling,
  party,
  onRoll,
  onClear,
}: {
  encounters: Encounter[];
  accent: string;
  /** How many monsters are on the canvas right now. */
  prowling: number;
  /** How many are on the roster, so the panel can say who is converging. */
  party: number;
  onRoll: () => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = ref.current;
    if (box) box.scrollTop = 0;
  }, [encounters]);

  const latest = encounters[0];

  return (
    <>
      <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
        {party === 0
          ? "Roll something in. With nobody on the roster, only the crowd will react to it."
          : `Roll something in. The party closes on it; everybody else gets out of the way.`}
      </p>

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
        Roll an encounter
      </button>

      {latest && (
        <div style={{ display: "grid", gap: 6, padding: "9px 10px", borderRadius: 9, background: "rgba(255, 255, 255, 0.05)" }}>
          <span style={{ fontSize: 14, color: accent, fontWeight: 600 }}>{latest.monster}</span>
          <span style={{ fontSize: 12, color: "rgba(232, 236, 244, 0.78)" }}>{latest.hook}</span>
          <span style={{ fontSize: 11, color: "rgba(232, 236, 244, 0.5)" }}>
            <span style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 10 }}>Loot</span>{" "}
            · {latest.loot}
          </span>
        </div>
      )}

      <div
        ref={ref}
        style={{
          maxHeight: 132,
          overflowY: "auto",
          padding: "6px 9px",
          borderRadius: 9,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(0, 0, 0, 0.3)",
          fontSize: 11,
          lineHeight: 1.5,
          color: "rgba(232, 236, 244, 0.62)",
        }}
      >
        {encounters.length <= 1 ? (
          <span style={{ color: "rgba(232, 236, 244, 0.35)" }}>
            {encounters.length === 0 ? "nothing has happened yet" : "nothing else yet"}
          </span>
        ) : (
          encounters.slice(1).map((entry) => (
            <div key={entry.id}>
              {entry.monster} — {entry.hook}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        title="Send whatever is prowling about on its way"
        style={{ ...panelButton, opacity: prowling > 0 ? 1 : 0.4 }}
      >
        {prowling > 1 ? `Send all ${prowling} away` : "Send it away"}
      </button>
    </>
  );
}
