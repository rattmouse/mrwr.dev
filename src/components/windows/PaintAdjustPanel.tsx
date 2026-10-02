"use client";

import React, { useState } from "react";
import { Button } from "react95";
import { ColorAdjust, NO_ADJUST, isNoAdjust } from "@/lib/colorAdjust";

const ROWS: { key: keyof ColorAdjust; label: string; min: number; max: number; unit: string }[] = [
  { key: "hue", label: "Hue", min: -180, max: 180, unit: "°" },
  { key: "saturation", label: "Saturation", min: 0, max: 200, unit: "%" },
  { key: "brightness", label: "Brightness", min: -100, max: 100, unit: "" },
  { key: "red", label: "Red", min: -255, max: 255, unit: "" },
  { key: "green", label: "Green", min: -255, max: 255, unit: "" },
  { key: "blue", label: "Blue", min: -255, max: 255, unit: "" },
];

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * paint.exe's Adjust colors box, floating over the sheet while a selection is
 * being adjusted. It owns the slider values, so dragging one re-renders only
 * this little box, and hands each new set up for the sheet to redraw from.
 */
export default function PaintAdjustPanel({
  onChange,
  onDone,
}: {
  onChange: (adjust: ColorAdjust) => void;
  /** OK keeps what the sliders did; Cancel puts the selection back as it was. */
  onDone: (keep: boolean) => void;
}) {
  const [adjust, setAdjust] = useState<ColorAdjust>(NO_ADJUST);

  const set = (next: ColorAdjust) => {
    setAdjust(next);
    onChange(next);
  };

  return (
    <div
      data-paint-panel
      role="dialog"
      aria-label="Adjust colors"
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        width: 232,
        background: "#c0c0c0",
        border: "2px solid",
        borderColor: "#ffffff #808080 #808080 #ffffff",
        boxShadow: "1px 1px 0 #000000",
        fontSize: 12,
        zIndex: 3,
      }}
    >
      <div
        style={{
          background: "#000080",
          color: "#ffffff",
          fontWeight: "bold",
          padding: "2px 4px",
          userSelect: "none",
        }}
      >
        Adjust colors
      </div>
      <div style={{ padding: "6px 6px 4px", display: "grid", gridTemplateColumns: "auto 1fr 40px", gap: "3px 6px", alignItems: "center" }}>
        {ROWS.map((row) => {
          const value = adjust[row.key];
          const id = `paint-adjust-${row.key}`;
          return (
            <React.Fragment key={row.key}>
              <label htmlFor={id}>{row.label}</label>
              <input
                id={id}
                type="range"
                min={row.min}
                max={row.max}
                step={1}
                value={value}
                onChange={(event) => set({ ...adjust, [row.key]: Number(event.target.value) })}
                // A double-click puts one slider back where it started.
                onDoubleClick={() => set({ ...adjust, [row.key]: NO_ADJUST[row.key] })}
                style={{ width: "100%", margin: 0, accentColor: "#000080" }}
              />
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.key === "saturation" ? value : signed(value)}
                {row.unit}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, padding: "0 6px 6px" }}>
        <Button size="sm" disabled={isNoAdjust(adjust)} onClick={() => set(NO_ADJUST)}>
          Reset
        </Button>
        <Button size="sm" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button size="sm" primary onClick={() => onDone(true)}>
          OK
        </Button>
      </div>
    </div>
  );
}
