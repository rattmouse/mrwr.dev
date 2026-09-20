"use client";

import React from "react";
import { ABILITIES, hitPoints, modifier, proficiency, signed, type Character } from "@/lib/dnd";
import type { Going } from "@/lib/partyExchanges";

/**
 * party.webp's Info panel: everything the window knows about whatever you have
 * just clicked on.
 *
 * Every other panel points at the canvas as a whole — the Palette dresses the
 * crowd, the Forces push it about, Goings-on watches the room. This one points
 * at one figure. Click one of the crowd and it tells you which of the painted
 * figures he is and how fast he is walking; click somebody from the party and
 * it reads their sheet back at you without letting you edit it; click whatever
 * has wandered in and it tells you why it came and what it is carrying.
 *
 * It is a read-out and nothing else: there is not a control in here, and
 * nothing in it changes anything.
 */
export type Picked = {
  id: number;
  /** Set when the thing picked is standing in for somebody on the roster. */
  charId?: string;
  /** Which of the painted figures he is, and how many there are to be. */
  guy: number;
  guys: number;
  flip: boolean;
  /** His own size roll, where 1 is the ordinary height for his sort. */
  size: number;
  x: number;
  y: number;
  /** px a frame, which is the unit everything else on this canvas is in. */
  speed: number;
  /** How many others stand close enough to have a line strung to him. */
  links: number;
  hp: number;
  max: number;
  down: boolean;
  /** False until something has picked a fight: there are no vitals before that. */
  scrapped: boolean;
  /** What this one has been told to be, where it differs from the crowd. */
  shape: string;
  dressed: boolean;
};

export default function PartyInfoPanel({
  picked,
  member,
  arrival,
  accent,
}: {
  /** The node under the last click, as the canvas has it this instant. */
  picked: Picked | null;
  /** Their sheet, when the node picked was a party member. */
  member: Character | null;
  /** The visitor picked, when what was clicked had wandered in. */
  arrival: Going | null;
  accent: string;
}) {
  if (arrival) return <AboutArrival arrival={arrival} accent={accent} />;
  if (picked && member) return <AboutMember picked={picked} member={member} accent={accent} />;
  if (picked) return <AboutGuy picked={picked} accent={accent} />;

  return (
    <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.55)" }}>
      Nothing picked. Click anybody on the canvas — one of the crowd, somebody
      from the party, or whatever has wandered in — and this is where they are
      described.
    </p>
  );
}

/* ---------------------------------------------------------------- visitors */

function AboutArrival({ arrival, accent }: { arrival: Going; accent: string }) {
  const welcome = arrival.kind === "welcome";
  return (
    <>
      <Title accent={accent} face={arrival.face} name={arrival.who} under={welcome ? "a guest" : "a monster"} />

      <p style={{ margin: 0, fontSize: 12, color: "rgba(232, 236, 244, 0.78)" }}>{arrival.hook}</p>

      {/* A guest is never hit, so there is nothing of them to show. */}
      {!welcome && (
        <Field label="Condition">
          <Bar left={arrival.max > 0 ? arrival.hp / arrival.max : 1} />
          <Note>
            {arrival.beaten
              ? "driven off"
              : `${arrival.hp} of ${arrival.max} — ${arrival.taken} taken off it so far`}
          </Note>
        </Field>
      )}

      <Rows>
        <Row label="Size" value={`${Math.round(arrival.size * 100)}% of the biggest thing that comes`} />
        <Row label="Dealing with" value={arrival.with || "nobody yet"} />
        <Row label="Exchanges" value={`${arrival.turns}`} />
        <Row
          label={welcome ? "Put right" : "Damage done"}
          value={`${arrival.dealt}`}
        />
        <Row label="Been here" value={`${arrival.here}s`} />
        <Row label="Leaves in" value={arrival.beaten ? "going now" : `${arrival.leaves}s`} />
      </Rows>

      <Field label={welcome ? "Gift" : "Loot"}>
        <Note>{arrival.reward}</Note>
      </Field>

      <Note>{arrival.last}</Note>
    </>
  );
}

/* ------------------------------------------------------------------ people */

function AboutMember({
  picked,
  member,
  accent,
}: {
  picked: Picked;
  member: Character;
  accent: string;
}) {
  // Nothing has been near them yet, so the canvas is carrying no hit points for
  // them — what they would have is on the sheet.
  const max = picked.scrapped ? picked.max : hitPoints(member);
  const hp = picked.scrapped ? picked.hp : max;

  return (
    <>
      <Title
        accent={accent}
        name={member.name.trim() || "unnamed"}
        under={`level ${member.level} ${member.race} ${member.cls}`}
      />

      <Field label="Condition">
        <Bar left={max > 0 ? hp / max : 1} />
        <Note>
          {picked.down
            ? "flat out — they will come round on their own"
            : !picked.scrapped
              ? `${max} hit points, none of them spent`
              : hp === max
                ? `${hp} of ${max} — back to themselves`
                : `${hp} of ${max}`}
        </Note>
      </Field>

      <Field label="Abilities">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
          {ABILITIES.map((ability) => (
            <div
              key={ability}
              style={{
                display: "grid",
                gap: 1,
                padding: "5px 0",
                borderRadius: 7,
                textAlign: "center",
                background: "rgba(255, 255, 255, 0.05)",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  color: "rgba(232, 236, 244, 0.45)",
                }}
              >
                {ability}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e8ecf4" }}>
                {member.scores[ability]}
              </span>
              <span style={{ fontSize: 10, color: accent }}>
                {signed(modifier(member.scores[ability]))}
              </span>
            </div>
          ))}
        </div>
      </Field>

      <Rows>
        <Row label="Alignment" value={member.alignment} />
        <Row label="Proficiency" value={signed(proficiency(member.level))} />
        <Row label="Standing" value={`${Math.round(picked.x)}, ${Math.round(picked.y)}`} />
        <Row label="Walking" value={pace(picked.speed)} />
      </Rows>

      <Note>The Party panel has their sheet, and it is the only place they can be changed.</Note>
    </>
  );
}

/* ------------------------------------------------------------------- crowd */

function AboutGuy({ picked, accent }: { picked: Picked; accent: string }) {
  return (
    <>
      <Title accent={accent} name={`Node #${picked.id}`} under="one of the crowd" />

      <Rows>
        <Row
          label="Figure"
          value={
            picked.shape === "guys"
              ? picked.guys > 0
                ? `painted figure ${(picked.guy % picked.guys) + 1} of ${picked.guys}`
                : "one of the painted figures"
              : `a ${picked.shape}`
          }
        />
        <Row label="Facing" value={picked.flip ? "left" : "right"} />
        <Row label="Height" value={`${Math.round(picked.size * 100)}% of the usual`} />
        <Row label="Standing" value={`${Math.round(picked.x)}, ${Math.round(picked.y)}`} />
        <Row label="Walking" value={pace(picked.speed)} />
        <Row
          label="Linked to"
          value={picked.links === 0 ? "nobody — out on their own" : `${picked.links} of the others`}
        />
        <Row label="Dressed" value={picked.dressed ? "on their own, not as the crowd is" : "as the crowd is"} />
      </Rows>

      {picked.scrapped && (
        <Field label="Condition">
          <Bar left={picked.max > 0 ? picked.hp / picked.max : 1} />
          <Note>
            {picked.down
              ? "knocked flat — they will pick themselves up"
              : `${picked.hp} of ${picked.max}, and up`}
          </Note>
        </Field>
      )}

      <Note>
        {picked.scrapped
          ? "They got in the way of something. The Palette dresses this one alone while they are picked."
          : "Nothing has happened to this one. The Palette dresses them alone while they are picked."}
      </Note>
    </>
  );
}

/* ------------------------------------------------------------------- parts */

/** Walking speed in the only unit this canvas has: px a frame. */
const pace = (speed: number) =>
  `${speed.toFixed(2)} px a frame · ${speed < 0.3 ? "dawdling" : speed < 0.7 ? "a stroll" : speed < 1.8 ? "stepping out" : "at a fair clip"}`;

function Title({
  accent,
  face,
  name,
  under,
}: {
  accent: string;
  face?: string;
  name: string;
  under: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {face && (
        <span aria-hidden style={{ fontSize: 20 }}>
          {face}
        </span>
      )}
      <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: accent,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 11, color: "rgba(232, 236, 244, 0.45)" }}>{under}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "rgba(232, 236, 244, 0.5)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 4 }}>{children}</div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
      <span style={{ flex: "0 0 74px", color: "rgba(232, 236, 244, 0.45)" }}>{label}</span>
      <span style={{ flex: "1 1 auto", color: "rgba(232, 236, 244, 0.82)" }}>{value}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: "rgba(232, 236, 244, 0.45)" }}>{children}</span>;
}

// The same three tones the numbers on the canvas and the Goings-on bars use.
function Bar({ left }: { left: number }) {
  const share = Math.max(0, Math.min(1, left));
  return (
    <span
      style={{
        display: "block",
        height: 5,
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
          background: share > 0.6 ? "#4ade80" : share > 0.3 ? "#fbbf24" : "#fb7185",
          transition: "width 220ms linear",
        }}
      />
    </span>
  );
}
