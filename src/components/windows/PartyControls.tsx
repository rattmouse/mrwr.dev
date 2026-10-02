"use client";

import React, { useCallback, useRef } from "react";

/**
 * The controls party.webp's tool windows are built out of. They live together
 * out here because every panel wants the same ones, and because the window
 * itself is long enough already.
 *
 * All of it is deliberately modern: these sit inside a Windows 95 frame, and
 * the joke only works if what's inside it isn't.
 */

export const panelButton: React.CSSProperties = {
  cursor: "pointer",
  borderRadius: 8,
  border: "1px solid rgba(255, 255, 255, 0.16)",
  background: "rgba(255, 255, 255, 0.06)",
  color: "#e8ecf4",
  font: "inherit",
  fontSize: 12,
  padding: "8px 0",
};

/**
 * The little ↺ that puts a section back to how it started, straight after the
 * section's title — or the panel's, for whatever in it has no section. Whoever
 * draws it only hands it an `onReset` while what it covers is off its default,
 * so a panel left alone shows none of them. It is only ever added next to a
 * title, never wrapped round a control, so one appearing mid-drag can't
 * rebuild the slider out from under the pointer.
 */
export function ResetIcon({
  label,
  onReset,
  style,
}: {
  label: string;
  onReset: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={`Reset ${label}`}
      title={`${label} back to default`}
      onClick={onReset}
      style={{
        width: 16,
        height: 16,
        padding: 0,
        border: "none",
        borderRadius: 4,
        background: "transparent",
        color: "rgba(232, 236, 244, 0.6)",
        cursor: "pointer",
        font: "inherit",
        fontSize: 13,
        lineHeight: "16px",
        flex: "0 0 auto",
        ...style,
      }}
    >
      ↺
    </button>
  );
}

// A section's title, with its ↺ straight after it when it has one. The row is
// held at the title's own height and the ↺ hangs over it, so one appearing
// mid-drag doesn't nudge everything below it down the panel.
function SectionTitle({ label, onReset }: { label: string; onReset?: () => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, height: 12 }}>
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
      {onReset && <ResetIcon label={label} onReset={onReset} />}
    </span>
  );
}

/**
 * A titled control. Not a <label>: every control it holds is a row of
 * buttons, and a label hands a click on its text to the first of them — so a
 * click on "Surface" would have picked Ink, and a click on a ↺ beside the
 * title would have been the ↺ every time the title was clicked.
 */
export function Field({
  label,
  onReset,
  children,
}: {
  label: string;
  /** Put this section back to its default; left off while it already is. */
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gap: 7 }}>
      <SectionTitle label={label} onReset={onReset} />
      {children}
    </div>
  );
}

/**
 * A titled run of controls. Field is a label and so can only hold things that
 * aren't — this is for the sliders, which bring their own.
 */
export function Group({
  label,
  dim,
  onReset,
  children,
}: {
  /** Left off where the controls under it need no heading of their own. */
  label?: string;
  /** Dimmed when the switch above it leaves these with nothing to work on. */
  dim?: boolean;
  /** Put this section back to its default; left off while it already is. Needs a label. */
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 7, opacity: dim ? 0.4 : 1 }}>
      {label && <SectionTitle label={label} onReset={onReset} />}
      {children}
    </div>
  );
}

export function Segmented({
  options,
  value,
  accent,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  accent: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        padding: 3,
        gap: 3,
        borderRadius: 9,
        background: "rgba(255, 255, 255, 0.06)",
      }}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            style={{
              flex: 1,
              cursor: "pointer",
              borderRadius: 7,
              border: "none",
              padding: "5px 0",
              font: "inherit",
              fontSize: 12,
              background: on ? accent : "transparent",
              color: on ? "#0b0e14" : "rgba(232, 236, 244, 0.72)",
              transition: "background 120ms ease",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  accent,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: string;
  /** What to show instead of the number — "all", say, at the top of a cap. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "rgba(232, 236, 244, 0.6)" }}>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: accent }}>
          {format ? format(value) : step < 1 ? value.toFixed(2) : value}
        </span>
      </span>
      <input
        type="range"
        className="ui-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "100%",
          height: 4,
          borderRadius: 999,
          outline: "none",
          cursor: "pointer",
          background:
            min < 0
              ? // A slider that runs either way is filled from the middle out,
                // so which side of nothing it is on reads at a glance.
                `linear-gradient(to right, rgba(255, 255, 255, 0.14) ${Math.min(pct, 50)}%, ${accent} ${Math.min(pct, 50)}%, ${accent} ${Math.max(pct, 50)}%, rgba(255, 255, 255, 0.14) ${Math.max(pct, 50)}%)`
              : `linear-gradient(to right, ${accent} ${pct}%, rgba(255, 255, 255, 0.14) ${pct}%)`,
        }}
      />
    </label>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "7px 10px",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.05)",
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: "0.05em", color: "rgba(232, 236, 244, 0.55)" }}>
        {label}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: accent }}>{value}</span>
    </div>
  );
}

/** A line of text in a panel — the one control here the others aren't built on. */
export function TextField({
  value,
  placeholder,
  label,
  onChange,
}: {
  value: string;
  placeholder?: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      style={{
        boxSizing: "border-box",
        width: "100%",
        borderRadius: 8,
        border: "1px solid rgba(255, 255, 255, 0.16)",
        background: "rgba(255, 255, 255, 0.06)",
        color: "#e8ecf4",
        font: "inherit",
        fontSize: 12,
        padding: "7px 9px",
        outline: "none",
      }}
    />
  );
}

const DIAL_SIZE = 74;

/**
 * A direction dial: drag the handle round to point it somewhere. Degrees run
 * clockwise from straight up, which is how you'd describe a direction out loud
 * — and 180, straight down, is where gravity starts.
 *
 * It is a slider as far as anything reading the page is concerned, so the arrow
 * keys turn it a degree at a time and Page Up and Down a sixteenth of a turn.
 */
export function Dial({
  label,
  value,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  accent: string;
  onChange: (degrees: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const aim = useCallback(
    (clientX: number, clientY: number) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const dx = clientX - (box.left + box.width / 2);
      const dy = clientY - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) < 4) return;
      const degrees = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
      onChange((degrees + 360) % 360);
    },
    [onChange],
  );

  const radians = (value * Math.PI) / 180;
  const radius = DIAL_SIZE / 2 - 9;
  const handleX = Math.sin(radians) * radius;
  const handleY = -Math.cos(radians) * radius;

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
      <span style={{ fontSize: 12, color: "rgba(232, 236, 244, 0.6)" }}>{label}</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${Math.round(value)} degrees`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          aim(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) aim(e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          const by =
            e.key === "ArrowRight" || e.key === "ArrowUp"
              ? 1
              : e.key === "ArrowLeft" || e.key === "ArrowDown"
                ? -1
                : e.key === "PageUp"
                  ? 22.5
                  : e.key === "PageDown"
                    ? -22.5
                    : 0;
          if (by === 0) return;
          e.preventDefault();
          onChange((Math.round(value + by) + 360) % 360);
        }}
        style={{
          position: "relative",
          width: DIAL_SIZE,
          height: DIAL_SIZE,
          borderRadius: "50%",
          cursor: "grab",
          touchAction: "none",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          background:
            "radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03))",
        }}
      >
        {/* The needle, from the middle out to wherever it is pointing. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: radius,
            height: 2,
            borderRadius: 2,
            background: accent,
            transformOrigin: "0 50%",
            transform: `translate(0, -1px) rotate(${value - 90}deg)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(50% + ${handleX}px)`,
            top: `calc(50% + ${handleY}px)`,
            width: 11,
            height: 11,
            marginLeft: -5.5,
            marginTop: -5.5,
            borderRadius: "50%",
            background: accent,
            boxShadow: "0 0 0 2px rgba(11, 14, 20, 0.5)",
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: accent }}>
        {Math.round(value)}°
      </span>
    </div>
  );
}
