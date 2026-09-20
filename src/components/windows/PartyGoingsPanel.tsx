"use client";

import React from "react";
import type { Going, Goings, Standing } from "@/lib/partyExchanges";

/**
 * party.webp's Goings-on panel: what is happening on the canvas at this moment,
 * while it is still happening.
 *
 * The Encounters panel is a record of what has turned up — a list of things
 * that were rolled, oldest at the bottom. This is the other half of that: who
 * is out there now, who they have got hold of, how much of them is left, and
 * how the party and the crowd are bearing it. Everything here is read off the
 * canvas four times a second rather than driven by it, so the panel is a window
 * onto the fight and never the thing deciding it.
 */
export default function PartyGoingsPanel({ goings, accent }: { goings: Goings; accent: string }) {
  const { visits, party, crowd } = goings;
  const laidOut = party.filter((member) => member.down).length;

  return (
    <>
      <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
        What is going on out there right now. Nobody is killed — the worst of it
        is being knocked flat and lying there until you come round.
      </p>

      <Heading>Happening now</Heading>
      {visits.length === 0 ? (
        <Empty>nothing is going on — roll an encounter</Empty>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {visits.map((visit) => (
            <Visit key={visit.id} visit={visit} accent={accent} />
          ))}
        </div>
      )}

      <Heading>The party</Heading>
      {party.length === 0 ? (
        <Empty>nobody on the roster</Empty>
      ) : (
        <div style={{ display: "grid", gap: 5 }}>
          {party.map((member) => (
            <Member key={member.id} member={member} />
          ))}
        </div>
      )}

      <Heading>The crowd</Heading>
      <Empty>
        {crowd.all} walking about
        {crowd.down > 0 ? ` · ${crowd.down} laid out` : ""}
        {crowd.hurt > 0 ? ` · ${crowd.hurt} nursing something` : ""}
        {crowd.down === 0 && crowd.hurt === 0 ? " · nobody has laid a hand on them" : ""}
      </Empty>

      {laidOut > 0 && (
        <p style={{ margin: 0, fontSize: 11, color: "rgba(232, 236, 244, 0.45)" }}>
          {laidOut === 1 ? "One of the party is" : `${laidOut} of the party are`} flat out.
          They get back up on their own — or sooner, if something friendly wanders in.
        </p>
      )}
    </>
  );
}

/** One thing that has wandered in, and what it has been doing since. */
function Visit({ visit, accent }: { visit: Going; accent: string }) {
  const welcome = visit.kind === "welcome";
  const left = visit.max > 0 ? visit.hp / visit.max : 1;

  return (
    <div
      style={{
        display: "grid",
        gap: 5,
        padding: "8px 10px",
        borderRadius: 9,
        background: "rgba(255, 255, 255, 0.05)",
        // A guest is marked off down the side in the palette's own colour; a
        // monster in the colour of what it is doing to everybody.
        borderLeft: `2px solid ${welcome ? accent : "#fb7185"}`,
        opacity: visit.beaten ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span aria-hidden style={{ fontSize: 14 }}>
          {visit.face}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e8ecf4" }}>{visit.who}</span>
        <span style={{ fontSize: 10, color: "rgba(232, 236, 244, 0.4)" }}>
          {welcome ? "guest" : "monster"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(232, 236, 244, 0.4)" }}>
          {visit.beaten ? "driven off" : `${visit.leaves}s left`}
        </span>
      </div>

      {/* A guest is never hit, so there is nothing to show of them. */}
      {!welcome && <Meter left={left} />}

      <span style={{ fontSize: 12, color: "rgba(232, 236, 244, 0.78)" }}>{visit.last}</span>

      <span style={{ fontSize: 10, color: "rgba(232, 236, 244, 0.45)" }}>
        {visit.with ? `with ${visit.with}` : "nobody yet"} · {visit.turns}{" "}
        {visit.turns === 1 ? "exchange" : "exchanges"}
        {welcome
          ? visit.dealt > 0
            ? ` · ${visit.dealt} put right`
            : ""
          : ` · ${visit.dealt} dealt · ${visit.taken} taken`}
      </span>
    </div>
  );
}

/** One party member, and how they are bearing it. */
function Member({ member }: { member: Standing }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          flex: "1 1 auto",
          fontSize: 12,
          color: member.down ? "rgba(232, 236, 244, 0.45)" : "rgba(232, 236, 244, 0.85)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {member.name}
        {member.down && <span style={{ color: "#fb7185" }}> · down</span>}
      </span>
      <span style={{ flex: "0 0 74px" }}>
        <Meter left={member.max > 0 ? member.hp / member.max : 1} />
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          color: "rgba(232, 236, 244, 0.5)",
        }}
      >
        {member.hp}/{member.max}
      </span>
    </div>
  );
}

// The same three tones the numbers on the canvas use, so a bar in here and a
// bar out there say the same thing about somebody.
const WELL = "#4ade80";
const FAIR = "#fbbf24";
const POOR = "#fb7185";

function Meter({ left }: { left: number }) {
  const share = Math.max(0, Math.min(1, left));
  return (
    <span
      style={{
        display: "block",
        height: 4,
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255, 255, 255, 0.12)",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${share * 100}%`,
          background: share > 0.6 ? WELL : share > 0.3 ? FAIR : POOR,
          transition: "width 220ms linear",
        }}
      />
    </span>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: "rgba(232, 236, 244, 0.5)",
      }}
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: "rgba(232, 236, 244, 0.38)" }}>{children}</span>
  );
}
