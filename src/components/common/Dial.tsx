"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Rotary knobs bevelled like Win98 controls, after midi.exe's: a `Dial` for a
 * number (drag up and down, the wheel, or the arrow keys; Shift drags fine;
 * double-click for its default), and a `Selector` that clicks between a few
 * named positions printed around it, like an amp's channel switch.
 */

const C = {
  material: "#c0c0c0",
  light: "#ffffff",
  shadow: "#808080",
  darkest: "#0a0a0a",
  dim: "#404040",
  accent: "#000080",
  hot: "#b01e10",
} as const;

/** Degrees either side of top dead centre a bounded dial sweeps. */
const SWEEP = 135;
const SIZE = 32;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/** The cap: light from the top left, shadow to the bottom right, a line pointing at `angle`. */
function Cap({ angle, pointer = C.darkest }: { angle: number; pointer?: string }) {
  const c = SIZE / 2;
  const r = 11;
  const tip = polar(c, c, r - 2, angle);
  const base = polar(c, c, 3.5, angle);
  return (
    <>
      <circle cx={c} cy={c} r={r} fill={C.material} />
      <path d={arc(c, c, r, -180, 0)} fill="none" stroke={C.light} strokeWidth={1.5} />
      <path d={arc(c, c, r, 0, 180)} fill="none" stroke={C.darkest} strokeWidth={1.5} />
      <path d={arc(c, c, r - 1.5, 0, 180)} fill="none" stroke={C.shadow} strokeWidth={1.5} />
      <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={pointer} strokeWidth={2} />
    </>
  );
}

/** The wheel turns a knob a notch at a time; React's wheel listener is passive, so the page would scroll too. */
function useWheel(ref: React.RefObject<Element | null>, onNotch: (dir: 1 | -1) => void, disabled?: boolean) {
  const notch = useRef(onNotch);
  notch.current = onNotch;
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const wheel = (e: Event) => {
      const w = e as WheelEvent;
      if (!w.deltaY) return;
      w.preventDefault();
      notch.current(w.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [ref, disabled]);
}

/** Take the keyboard without the ring a mouse-down focus would draw; a Tab still gets one. */
function grab(el: SVGSVGElement) {
  el.style.outline = "none";
  const ring = () => {
    el.style.outline = "";
    el.removeEventListener("keydown", ring);
    el.removeEventListener("blur", ring);
  };
  el.addEventListener("keydown", ring);
  el.addEventListener("blur", ring);
  el.focus({ preventScroll: true });
}

const FOCUS: React.CSSProperties = { outlineOffset: 1, borderRadius: "50%" };

export function Dial({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  readout,
  title,
  disabled,
  endless,
  defaultValue,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** The caption under it. */
  label: string;
  /** The value as it should read, bold, between the knob and its caption. */
  readout: React.ReactNode;
  title?: string;
  disabled?: boolean;
  /** Turns all the way round and on past `max` back to `min`, its pointer showing the value as a bearing. */
  endless?: boolean;
  /** Double-click goes back to it. */
  defaultValue?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const span = max - min;
  const t = (value - min) / span;
  const angle = endless ? t * 360 : -SWEEP + t * SWEEP * 2;

  const set = (v: number) => {
    let next = Math.round(v / step) * step;
    if (endless) next = ((((next - min) % span) + span) % span) + min;
    else next = Math.max(min, Math.min(max, next));
    if (next !== value) onChange(next);
  };
  useWheel(ref, (dir) => set(value + dir * step), disabled);

  const c = SIZE / 2;
  return (
    <div
      title={title}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 52, opacity: disabled ? 0.45 : 1 }}
    >
      <svg
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={typeof readout === "string" ? readout : undefined}
        aria-disabled={disabled || undefined}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          grab(e.currentTarget);
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // A full sweep in about 140px of travel, a quarter as fast with Shift.
          const perPx = (span / 140) * (e.shiftKey ? 0.25 : 1);
          set(d.value + (d.y - e.clientY) * perPx);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => !disabled && defaultValue !== undefined && set(defaultValue)}
        onKeyDown={(e) => {
          if (disabled) return;
          const big = Math.max(step, Math.round(span / 12 / step) * step);
          const moves: Record<string, number> = {
            ArrowUp: step,
            ArrowRight: step,
            ArrowDown: -step,
            ArrowLeft: -step,
            PageUp: big,
            PageDown: -big,
          };
          if (e.key in moves) set(value + moves[e.key]);
          else if (e.key === "Home" && !endless) set(min);
          else if (e.key === "End" && !endless) set(max);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{ ...FOCUS, display: "block", touchAction: "none", cursor: disabled ? "default" : "ns-resize" }}
      >
        {endless ? (
          <>
            <circle cx={c} cy={c} r={14.5} fill="none" stroke={C.shadow} strokeWidth={1} />
            {[0, 90, 180, 270].map((a) => {
              const p = polar(c, c, 13, a);
              const q = polar(c, c, 16, a);
              return <line key={a} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={a ? C.shadow : C.accent} strokeWidth={a ? 1 : 2} />;
            })}
          </>
        ) : (
          <>
            <path d={arc(c, c, 14.5, -SWEEP, SWEEP)} fill="none" stroke={C.shadow} strokeWidth={2} />
            {t > 0 && <path d={arc(c, c, 14.5, -SWEEP, angle)} fill="none" stroke={C.accent} strokeWidth={2} />}
          </>
        )}
        <Cap angle={angle} />
      </svg>
      <span style={{ fontSize: 11, fontWeight: "bold", lineHeight: "13px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {readout}
      </span>
      <span style={{ fontSize: 10, lineHeight: "12px", color: C.dim, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/**
 * A knob that's pushed, not turned: the same cap as a Dial's, a turn-back
 * arrow where the pointer would be, its bevel sinking in while it's held.
 */
export function KnobButton({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  const [down, setDown] = useState(false);
  const c = SIZE / 2;
  const r = 11;
  // Three-quarters of a circle round the centre, its head pointing back the other way, top left.
  const tip = polar(c, c, 5, -75);
  const barbIn = polar(c, c, 2, -30);
  const barbOut = polar(c, c, 8, -30);
  return (
    <div title={title} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 52 }}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        onPointerDown={() => setDown(true)}
        onPointerUp={() => setDown(false)}
        onPointerLeave={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setDown(true)}
        onKeyUp={() => setDown(false)}
        onBlur={() => setDown(false)}
        style={{ ...FOCUS, display: "block", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: "block" }} aria-hidden>
          <circle cx={c} cy={c} r={14.5} fill="none" stroke={C.shadow} strokeWidth={1} />
          <circle cx={c} cy={c} r={r} fill={C.material} />
          <path d={arc(c, c, r, -180, 0)} fill="none" stroke={down ? C.darkest : C.light} strokeWidth={1.5} />
          <path d={arc(c, c, r, 0, 180)} fill="none" stroke={down ? C.light : C.darkest} strokeWidth={1.5} />
          <path d={arc(c, c, r - 1.5, down ? -180 : 0, down ? 0 : 180)} fill="none" stroke={C.shadow} strokeWidth={1.5} />
          <g transform={down ? "translate(0.75 0.75)" : undefined}>
            <path d={arc(c, c, 5, -30, 240)} fill="none" stroke={C.darkest} strokeWidth={1.75} />
            <path
              d={`M ${tip.x} ${tip.y} L ${barbIn.x} ${barbIn.y} L ${barbOut.x} ${barbOut.y} Z`}
              fill={C.darkest}
            />
          </g>
        </svg>
      </button>
      <span style={{ fontSize: 10, lineHeight: "12px", color: C.dim, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

export type SelectorOption = {
  label: string;
  title: string;
  /** Printed in place of the label: an icon, say. */
  mark?: React.ReactNode;
  /** Printed in red, its stretch of the dial red: a setting that runs hot. */
  hot?: boolean;
};

/** Pixels of drag per click of a selector. */
const CLICK_PX = 18;

export function Selector({
  options,
  index,
  onChange,
  label,
  width = 118,
  caption,
}: {
  options: SelectorOption[];
  index: number;
  onChange: (index: number) => void;
  /** Its name, for screen readers; nothing's printed under it unless it's `caption`ed. */
  label: string;
  /** The box the knob and its labels sit in, pixels. */
  width?: number;
  /**
   * Laid out like a Dial instead, as narrow: the positions only ticked round
   * the knob, the one it's at printed bold under it, and this under that.
   */
  caption?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ y: number; index: number; moved: boolean } | null>(null);
  const n = options.length;
  // The positions fan across the top of the dial, 60° apart for three.
  const fan = Math.min(120, 60 * (n - 1));
  const at = (k: number) => (n === 1 ? 0 : -fan / 2 + (k / (n - 1)) * fan);
  const set = (k: number) => {
    const next = Math.max(0, Math.min(n - 1, k));
    if (next !== index) onChange(next);
  };
  useWheel(ref, (dir) => set(index + dir));

  const c = SIZE / 2;
  // The knob's centre in the box; the labels sit round it at `R`, with room over it for a 16px icon.
  const cx = width / 2;
  const cy = options.some((o) => o.mark) ? 40 : 30;
  const R = 22;
  const top = cy - SIZE / 2;
  const current = options[index];
  const knob = (
    <svg
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={index}
      aria-valuetext={current?.label}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      onPointerDown={(e) => {
        e.preventDefault();
        grab(e.currentTarget);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, index, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const clicks = Math.round((d.y - e.clientY) / CLICK_PX);
        if (clicks) d.moved = true;
        set(d.index + clicks);
      }}
      onPointerUp={() => {
        // A click without a drag steps it round to the next position.
        if (drag.current && !drag.current.moved) onChange((index + 1) % n);
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const moves: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
        if (e.key in moves) set(index + moves[e.key]);
        else if (e.key === "Home") set(0);
        else if (e.key === "End") set(n - 1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        ...FOCUS,
        ...(caption ? {} : { position: "absolute", left: cx - c, top }),
        display: "block",
        touchAction: "none",
        cursor: "pointer",
      }}
    >
      {options.map((o, k) => {
        const p = polar(c, c, 13, at(k));
        const q = polar(c, c, 16, at(k));
        return <line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={o.hot ? C.hot : C.darkest} strokeWidth={k === index ? 2.5 : 1.5} />;
      })}
      <Cap angle={at(index)} pointer={current?.hot ? C.hot : C.darkest} />
    </svg>
  );
  if (caption)
    return (
      <div title={current?.title} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 52 }}>
        {knob}
        <span
          style={{ fontSize: 11, fontWeight: "bold", lineHeight: "13px", whiteSpace: "nowrap", color: current?.hot ? C.hot : undefined }}
        >
          {current?.label}
        </span>
        <span style={{ fontSize: 10, lineHeight: "12px", color: C.dim, whiteSpace: "nowrap" }}>{label}</span>
      </div>
    );
  return (
    <div style={{ position: "relative", flex: "none", width, height: top + SIZE }}>
      {options.map((o, k) => {
        const a = at(k);
        const p = polar(cx, cy, R, a);
        const shift = a < -1 ? "translate(-100%, -50%)" : a > 1 ? "translate(0, -50%)" : "translate(-50%, -100%)";
        const on = k === index;
        return (
          <button
            key={o.label}
            type="button"
            title={o.title}
            aria-hidden
            tabIndex={-1}
            onClick={() => set(k)}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              transform: shift,
              padding: o.mark ? 1 : "0 2px",
              border: 0,
              background: "transparent",
              outline: on ? "1px dashed currentColor" : "none",
              outlineOffset: -1,
              color: o.hot ? C.hot : on ? C.darkest : C.dim,
              font: "inherit",
              fontSize: 10,
              fontWeight: on ? "bold" : "normal",
              lineHeight: o.mark ? 0 : "12px",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {o.mark ?? o.label}
          </button>
        );
      })}
      {knob}
    </div>
  );
}
