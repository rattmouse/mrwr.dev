"use client";

// Faceplate parts for midi.exe — the window is laid out like an AKAI MPK mini
// PLUS (eight knobs, eight pads, a display, a thumbstick, a mini keybed) but
// built out of Windows 98 controls rather than black rubber and aluminium.
// Everything here is presentation only; MidiWindow owns the MIDI that drives it.

import React, { useRef } from "react";
import { Button } from "react95";
import { DRUM_BASE_NOTE, DRUM_CHANNEL } from "@/lib/midiSynth";

export const PANEL = {
  material: "#c0c0c0",
  light: "#ffffff",
  faceLight: "#dfdfdf",
  shadow: "#808080",
  darkest: "#0a0a0a",
  text: "#0a0a0a",
  dim: "#404040",
  accent: "#000080",
  canvas: "#ffffff",
  // The window's own face, a shade lighter than the controls sitting on it.
  // Matches react95's material so a caption can sit flush on the window.
  surface: "#c6c6c6",
} as const;

// The MPC pad grid: pads 1–8 on channel 10, laid out with pads 5–8 on the top
// row the way the hardware is. Two banks, as the hardware ships them — A is
// notes 36–43, B carries on from 44. Those notes are the drum kit's, so the
// numbers come from the synth rather than being repeated here.
export const PAD_BASE_NOTE = DRUM_BASE_NOTE;
export const PAD_CHANNEL = DRUM_CHANNEL;
export const PAD_BANK_SIZE = 8;
export const PAD_BANKS = ["A", "B"] as const;

export function padBankBase(bank: number): number {
  return PAD_BASE_NOTE + bank * PAD_BANK_SIZE;
}

// K1–K8 send CC 70–77, the MPK's own factory assignment.
export const KNOB_CC_BASE = 70;
// The thumbstick is assignable on the hardware; here each axis sends its own
// general-purpose CC (16 = X, 17 = Y) so it stays clear of the Bend and Mod
// faders beside it. Both axes rest at 64 and spring back there on release.
export const STICK_CC_X = 16;
export const STICK_CC_Y = 17;
export const STICK_CENTRE = 64;

// Pad lamps. Win98 only ever had sixteen colours to spare, so the pads light in
// the VGA palette rather than the hardware's full RGB.
const PAD_COLORS = [
  "#ff0000",
  "#ff8000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0080ff",
  "#8000ff",
  "#ff00ff",
];

export function padColor(index: number): string {
  return PAD_COLORS[index % PAD_COLORS.length];
}

// The two bevels every Win98 control is made of.
export const RAISED: React.CSSProperties = {
  border: "2px solid",
  borderColor: `${PANEL.light} ${PANEL.darkest} ${PANEL.darkest} ${PANEL.light}`,
  boxShadow: `inset 1px 1px 0 ${PANEL.faceLight}, inset -1px -1px 0 ${PANEL.shadow}`,
};

export const SUNKEN: React.CSSProperties = {
  border: "2px solid",
  borderColor: `${PANEL.shadow} ${PANEL.light} ${PANEL.light} ${PANEL.shadow}`,
};

export function Chassis({
  children,
  containerRef,
}: {
  children: React.ReactNode;
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={containerRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {children}
    </div>
  );
}

// The silkscreen along the top edge of the real thing, set in the system font.
export function BrandBar({ right }: { right?: React.ReactNode }) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingBottom: 2,
        borderBottom: `1px solid ${PANEL.shadow}`,
        boxShadow: `0 1px 0 ${PANEL.light}`,
        marginBottom: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
        <span style={{ fontWeight: "bold", letterSpacing: 1.5 }}>AKAI</span>
        <span style={{ fontSize: 11, color: PANEL.dim }}>professional</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {right}
        <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
          MPK mini <span style={{ fontWeight: "bold" }}>PLUS</span>
        </span>
      </div>
    </div>
  );
}

export function Legend({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: PANEL.dim, lineHeight: 1.25 }}>{children}</div>
  );
}

// A sunken area of the panel — the display, the keybed and the log all sit in
// one, the way a Win98 dialog frames its readouts.
export function Well({
  children,
  grow = false,
  style,
}: {
  children: React.ReactNode;
  grow?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        flex: grow ? "1 1 auto" : "0 0 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        padding: 3,
        background: PANEL.material,
        ...SUNKEN,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// A labelled cluster of controls, like the group boxes in a Control Panel page.
// react95's GroupBox positions its caption absolutely, at the window's full
// 16px, so on the narrow clusters here the caption overhangs the frame and runs
// into the box next door. A plain fieldset/legend instead: the frame widens to
// fit its caption and the caption punches a gap in the frame, the way a Win98
// group box actually looks.
export function Cluster({
  label,
  children,
  style,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <fieldset
      style={{
        margin: 0,
        padding: "1px 5px 4px",
        border: "none",
        // The etched groove, drawn as two 1px frames like the real control.
        boxShadow: [
          `inset 1px 1px 0 ${PANEL.shadow}`,
          `inset -1px -1px 0 ${PANEL.light}`,
          `inset 2px 2px 0 ${PANEL.light}`,
          `inset -2px -2px 0 ${PANEL.shadow}`,
        ].join(", "),
        ...style,
      }}
    >
      <legend
        style={{
          padding: "0 3px",
          marginLeft: 2,
          fontSize: 11,
          color: PANEL.text,
          background: PANEL.surface,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

const KNOB_SWEEP = 135; // degrees either side of top dead centre

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

// One of the eight knobs, bevelled like a Win98 control. Drag up/down to sweep
// 0–127 (hold Shift for a fine sweep); the navy arc is the current value.
export function Knob({
  id,
  name,
  label,
  cc,
  value,
  size = 32,
  disabled,
  onChange,
}: {
  /** The knob's silkscreened number — K1–K8. Caption space goes to `label`. */
  id: string;
  /** What the knob does, spelled out. */
  name: string;
  /** The abbreviation that fits under the cap. */
  label: string;
  cc: number;
  value: number;
  size?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const angle = -KNOB_SWEEP + (value / 127) * KNOB_SWEEP * 2;
  const c = 16;
  const r = 11;
  const tip = polar(c, c, r - 2, angle);
  const base = polar(c, c, 3.5, angle);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const scale = e.shiftKey ? 0.35 : 1.1;
    const next = Math.max(0, Math.min(127, Math.round(d.value + (d.y - e.clientY) * scale)));
    if (next !== value) onChange(next);
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg
        role="slider"
        aria-label={`Knob ${id} ${name} — CC ${cc}`}
        aria-valuemin={0}
        aria-valuemax={127}
        aria-valuenow={value}
        viewBox="0 0 32 32"
        width={size}
        height={size}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ touchAction: "none", cursor: disabled ? "default" : "ns-resize", display: "block" }}
      >
        {/* value ring */}
        <path
          d={arc(c, c, 14.5, -KNOB_SWEEP, KNOB_SWEEP)}
          fill="none"
          stroke={PANEL.shadow}
          strokeWidth={2}
        />
        {value > 0 && (
          <path
            d={arc(c, c, 14.5, -KNOB_SWEEP, angle)}
            fill="none"
            stroke={PANEL.accent}
            strokeWidth={2}
          />
        )}
        {/* bevelled cap: light from the top left, shadow from the bottom right */}
        <circle cx={c} cy={c} r={r} fill={PANEL.material} />
        <path d={arc(c, c, r, -180, 0)} fill="none" stroke={PANEL.light} strokeWidth={1.5} />
        <path d={arc(c, c, r, 0, 180)} fill="none" stroke={PANEL.darkest} strokeWidth={1.5} />
        <path d={arc(c, c, r - 1.5, 0, 180)} fill="none" stroke={PANEL.shadow} strokeWidth={1.5} />
        <line
          x1={base.x}
          y1={base.y}
          x2={tip.x}
          y2={tip.y}
          stroke={PANEL.darkest}
          strokeWidth={2}
        />
      </svg>
      <span
        title={`${id} · ${name} · CC ${cc}`}
        style={{ fontSize: 10, color: PANEL.dim, whiteSpace: "nowrap" }}
      >
        {label}
      </span>
    </div>
  );
}

// A pad: a raised Win98 button that goes in and lights up when it's struck.
export function Pad({
  index,
  label,
  name,
  sub,
  active,
  height,
  disabled,
  onDown,
  onUp,
}: {
  index: number;
  label: string;
  /** The kit piece this pad fires, spelled out. */
  name?: string;
  /** The same piece, abbreviated to what fits silkscreened across the pad. */
  sub?: string;
  active: boolean;
  height: number;
  disabled?: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <div
      role="button"
      aria-label={name ? `Pad ${index + 1} — ${name}` : `Pad ${index + 1}`}
      title={name}
      aria-pressed={active}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        height,
        boxSizing: "border-box",
        background: active ? padColor(index) : PANEL.material,
        ...(active
          ? {
              border: "2px solid",
              borderColor: `${PANEL.darkest} ${PANEL.light} ${PANEL.light} ${PANEL.darkest}`,
              boxShadow: `inset 1px 1px 0 ${PANEL.shadow}`,
            }
          : RAISED),
        color: PANEL.text,
        fontSize: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "1px 0 1px 3px",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          fontSize: 9,
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: active ? PANEL.darkest : PANEL.dim,
          whiteSpace: "nowrap",
        }}
      >
        {sub}
      </span>
      <span style={{ lineHeight: 1 }}>{label}</span>
    </div>
  );
}

// A function button. `sub` is the small legend the hardware silkscreens under
// each one; here it doubles as the button's current setting.
export function PanelButton({
  label,
  sub,
  active,
  disabled,
  weight = 1,
  onClick,
}: {
  label: string;
  sub?: string;
  active?: boolean;
  disabled?: boolean;
  /** Share of the button row this one takes, for legends longer than the rest. */
  weight?: number;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      active={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: `${weight} 1 0`,
        minWidth: 0,
        padding: "0 4px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
      {sub && <span style={{ color: PANEL.dim, marginLeft: 4 }}>{sub}</span>}
    </Button>
  );
}

// A single-axis control: pitch bend (springs back to centre) or the mod wheel
// (stays where it's left). react95's own Slider still calls findDOMNode, which
// React 19 removed, so this is the same control drawn out of the two bevels.
export function Fader({
  value,
  min,
  max,
  size = 84,
  disabled,
  readout,
  ariaLabel,
  onChange,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  size?: number;
  disabled?: boolean;
  readout: string;
  ariaLabel: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const thumbH = 11;
  const span = Math.max(1, max - min);
  const travel = Math.max(1, size - thumbH);
  const fraction = Math.max(0, Math.min(1, (value - min) / span));

  const valueAt = (clientY: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return value;
    // The thumb's centre can only reach half its height from either end.
    const y = clientY - box.top - thumbH / 2;
    const f = 1 - Math.max(0, Math.min(1, y / travel));
    return Math.round(min + f * span);
  };

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragging.current = true;
    onChange(valueAt(e.clientY));
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onChange(valueAt(e.clientY));
  };
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? Math.max(1, Math.round(span / 8)) : Math.max(1, Math.round(span / 64));
    if (e.key === "ArrowUp") onChange(Math.min(max, value + step));
    else if (e.key === "ArrowDown") onChange(Math.max(min, value - step));
    else if (e.key === "Home") onChange(max);
    else if (e.key === "End") onChange(min);
    else return;
    e.preventDefault();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div
        ref={track}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          width: 22,
          height: size,
          touchAction: "none",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {/* the groove */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            marginLeft: -2,
            top: thumbH / 2 - 1,
            width: 4,
            height: travel + 2,
            boxSizing: "border-box",
            background: PANEL.material,
            ...SUNKEN,
          }}
        />
        {/* the thumb */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: (1 - fraction) * travel,
            width: 22,
            height: thumbH,
            boxSizing: "border-box",
            background: PANEL.material,
            ...RAISED,
          }}
        />
      </div>
      <Legend>{readout}</Legend>
    </div>
  );
}

// The four-way thumbstick left of the keybed. Both axes send their own CC —
// STICK_CC_X / STICK_CC_Y — rather than doubling up on the bend and mod faders
// next to it, and it springs back to centre on release like the real one. The
// position is owned by the caller, the way the knobs' is, so incoming MIDI
// moves the stick too.
export function Joystick({
  size = 48,
  x,
  y,
  disabled,
  ariaLabel,
  readout,
  onMove,
  onRelease,
}: {
  size?: number;
  /** Stick position per axis, -1..1, centre 0. */
  x: number;
  y: number;
  disabled?: boolean;
  ariaLabel: string;
  readout: string;
  onMove: (x: number, y: number) => void;
  onRelease: () => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const at = (e: React.PointerEvent) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const x = Math.max(-1, Math.min(1, ((e.clientX - box.left) / box.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, 1 - ((e.clientY - box.top) / box.height) * 2));
    return { x, y };
  };

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    // preventDefault stops the click from focusing the stick, so do it here —
    // otherwise the arrow keys go nowhere until you Tab to it.
    (e.currentTarget as HTMLElement).focus();
    setDragging(true);
    const p = at(e);
    onMove(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    const p = at(e);
    onMove(p.x, p.y);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    onRelease();
  };

  // Arrow keys nudge the stick; letting go of a key springs it back, so Escape
  // (or Home) is the way to recentre from the keyboard.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.5 : 1 / 8;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    if (e.key === "ArrowLeft") onMove(clamp(x - step), y);
    else if (e.key === "ArrowRight") onMove(clamp(x + step), y);
    else if (e.key === "ArrowUp") onMove(x, clamp(y + step));
    else if (e.key === "ArrowDown") onMove(x, clamp(y - step));
    else if (e.key === "Home" || e.key === "Escape") onRelease();
    else return;
    e.preventDefault();
  };

  const travel = size / 2 - 9;
  return (
    <div
      style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
    >
      <div
        ref={wrap}
        role="group"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          width: size,
          height: size,
          boxSizing: "border-box",
          borderRadius: "50%",
          background: PANEL.material,
          ...SUNKEN,
          touchAction: "none",
          cursor: disabled ? "default" : dragging ? "grabbing" : "grab",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: size * 0.46,
            height: size * 0.46,
            boxSizing: "border-box",
            marginLeft: -(size * 0.23),
            marginTop: -(size * 0.23),
            transform: `translate(${x * travel}px, ${-y * travel}px)`,
            transition: dragging ? "none" : "transform 120ms ease-out",
            borderRadius: "50%",
            background: PANEL.material,
            ...RAISED,
          }}
        />
      </div>
      <Legend>{readout}</Legend>
    </div>
  );
}
