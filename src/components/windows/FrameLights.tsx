"use client";

import React from "react";

/**
 * The lights party.webp's Frame panel can put on the window around it: the
 * title bar and the frame's halo run through the spectrum, breathe in and out,
 * and flash. Nothing in here touches the window's contents — it is the chrome
 * that lights up, the way a machine in a shop window does.
 *
 * `colour` is how brightly the whole thing is lit and is the master switch:
 * at 0 the frame is ordinary Windows 95 and none of the rest of it runs.
 * `cycle`, `pulse` and `strobe` are each a speed — 0 holds that one still.
 */
export type FrameLights = {
  /** 0–1: how strongly the frame is lit at all. 0 is the plain grey frame. */
  colour: number;
  /** 0–1: how fast the colour travels round the spectrum. */
  cycle: number;
  /** 0–1: how fast it breathes in and out. */
  pulse: number;
  /** 0–1: how fast it flashes, up to the 3-a-second ceiling. */
  strobe: number;
};

export const NO_LIGHTS: FrameLights = { colour: 0, cycle: 0, pulse: 0, strobe: 0 };

/** Whether any of it is on, and so whether the stylesheet is worth rendering. */
export const framesLit = (lights?: FrameLights) => (lights?.colour ?? 0) > 0;

const clamp = (n: number) => Math.max(0, Math.min(1, n));

// A full turn of the spectrum, slowest to fastest.
const CYCLE_MS = [14000, 1200];
// One breath in and out.
const PULSE_MS = [3600, 620];
// One flash. The fast end is 3 a second, which is where the guidance on
// flashing content draws its line, so the slider cannot ask for more however
// far it is pushed.
const STROBE_MS = [1000, 334];

const between = ([slow, fast]: number[], speed: number) => Math.round(slow + (fast - slow) * clamp(speed));

/**
 * The style block the lit frame needs. The moving parts are three custom
 * properties rather than three animated colours, so one animation can drive the
 * hue while another dims it and a third chops it up, and every place that wants
 * a colour — halo, edge, title bar — works the same three numbers out for
 * itself. Registering them with @property is what lets the browser interpolate
 * them; without it they would jump from keyframe to keyframe instead.
 *
 * The animations run on the root element rather than on the window, because the
 * tool panels portal out to the document body: hanging the clock on their
 * nearest common ancestor is what keeps a dressed panel flashing on the same
 * beat as the frame it belongs to instead of drifting out of step with it.
 */
export function FrameLightsStyle({ lights }: { lights: FrameLights }) {
  const running: string[] = [];
  if (lights.cycle > 0) running.push(`fl-cycle ${between(CYCLE_MS, lights.cycle)}ms linear infinite`);
  if (lights.pulse > 0) running.push(`fl-pulse ${between(PULSE_MS, lights.pulse)}ms ease-in-out infinite`);
  if (lights.strobe > 0) running.push(`fl-strobe ${between(STROBE_MS, lights.strobe)}ms steps(1, end) infinite`);

  return (
    <style>{`
      @property --fl-hue { syntax: "<angle>"; initial-value: 210deg; inherits: true; }
      @property --fl-pulse { syntax: "<number>"; initial-value: 1; inherits: true; }
      @property --fl-strobe { syntax: "<number>"; initial-value: 1; inherits: true; }

      @keyframes fl-cycle { from { --fl-hue: 0deg; } to { --fl-hue: 360deg; } }
      @keyframes fl-pulse { 0%, 100% { --fl-pulse: 1; } 50% { --fl-pulse: 0.2; } }
      @keyframes fl-strobe { 0%, 38% { --fl-strobe: 1; } 39%, 100% { --fl-strobe: 0.06; } }

      ${running.length > 0 ? `:root { animation: ${running.join(", ")}; }` : ""}

      /* Somebody who has asked for less movement gets the colour and none of
         the flashing: everything stays lit, at its resting hue, holding still. */
      @media (prefers-reduced-motion: reduce) {
        :root { animation: none !important; }
      }
    `}</style>
  );
}

/**
 * How a lit frame is dressed: what the window itself wears, and what its title
 * bar wears over the top. Both are ordinary inline styles built out of the
 * three animating properties, so nothing here has to run every frame.
 */
export function lightStyles(lights: FrameLights): {
  frame: React.CSSProperties;
  header: React.CSSProperties;
} {
  const lit = clamp(lights.colour);
  // Every colour is dimmed by the breath and cut by the flash, together.
  const level = "var(--fl-pulse) * var(--fl-strobe)";

  return {
    frame: {
      // Two halos a half-turn apart, the second wider and softer, so the light
      // spilling off the frame is fringed rather than one flat colour.
      boxShadow: [
        `0 0 ${Math.round(9 + 25 * lit)}px ${Math.round(1 + 5 * lit)}px hsl(var(--fl-hue) 96% 58% / calc(${(0.22 + 0.55 * lit).toFixed(3)} * ${level}))`,
        `0 0 ${Math.round(18 + 52 * lit)}px ${Math.round(2 + 10 * lit)}px hsl(calc(var(--fl-hue) + 180deg) 92% 55% / calc(${(0.1 + 0.3 * lit).toFixed(3)} * ${level}))`,
        `inset 0 0 0 2px hsl(calc(var(--fl-hue) + 40deg) 92% 62% / calc(${(0.3 + 0.55 * lit).toFixed(3)} * ${level}))`,
      ].join(", "),
    },
    header: {
      // Three stops rather than two: at any one instant the bar is already
      // several colours, and the cycle then walks all three along together.
      background: `linear-gradient(90deg,
        hsl(var(--fl-hue) 88% 40%),
        hsl(calc(var(--fl-hue) + 60deg) 92% 52%),
        hsl(calc(var(--fl-hue) + 130deg) 88% 44%))`,
      filter: `brightness(calc(0.42 + ${(0.35 + 0.45 * lit).toFixed(3)} * ${level}))`,
    },
  };
}

export default FrameLightsStyle;
