"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Slider } from "react95";

/**
 * react95's Slider with something written on its thumb — the value, a
 * letter, a glyph — in place of a label beside it. The thumb is react95's
 * own element, so whatever's put on it moves with it however the slider lays
 * itself out; it's 18×32 lying across a horizontal track and 32×18 on a
 * vertical one. `knobWidth` widens a horizontal one for a label of a few
 * characters, still centred on the value.
 */
export default function KnobSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  knob,
  label,
  title,
  orientation = "horizontal",
  length,
  knobWidth = 18,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  knob: React.ReactNode;
  label: string;
  title?: string;
  orientation?: "horizontal" | "vertical";
  /** Pixels along the track. */
  length: number;
  /** A horizontal slider's thumb width, pixels; react95's is 18. */
  knobWidth?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<HTMLElement | null>(null);
  const vertical = orientation === "vertical";
  useLayoutEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>('[role="slider"]') ?? null;
    // react95 centres the thumb on the value with a translate, so a wider one stays centred.
    if (el && !vertical) el.style.width = `${knobWidth}px`;
    setThumb(el);
  }, [vertical, knobWidth]);
  return (
    <div
      ref={rootRef}
      title={title}
      // The thumb overhangs each end of the track by half its width; react95's room for tick labels isn't wanted.
      style={vertical ? { height: length, padding: "9px 0" } : { width: length, padding: `0 ${knobWidth / 2}px` }}
    >
      <Slider
        size="100%"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        orientation={orientation}
        aria-label={label}
        style={vertical ? { marginRight: 0 } : { marginBottom: 0 }}
      />
      {thumb &&
        createPortal(
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: "bold",
              lineHeight: 1,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {knob}
          </span>,
          thumb,
        )}
    </div>
  );
}
