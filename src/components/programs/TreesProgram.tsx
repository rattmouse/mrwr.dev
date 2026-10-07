"use client";

import React, { useCallback, useState } from "react";
import { Button, Slider } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import TreesWindow, { TreesMode } from "@/components/windows/TreesWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { Glyph } from "@/components/common/MediaGlyphs";
import { Heading, headingName, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from "@/lib/treesTilt";

const MODES: { id: TreesMode; label: string; title: string }[] = [
  { id: "season", label: "Season", title: "Every tree as it looks on a day of the year" },
  { id: "planted", label: "Planted", title: "The trees standing by a given year, newest lit up" },
  { id: "species", label: "Species", title: "The commonest kinds of tree, by color" },
];

/** A turning arrow on the media glyphs' 12px grid; flipped for the other way. */
function TurnIcon({ flip }: { flip?: boolean }) {
  return (
    <span style={{ display: "block", transform: flip ? "scaleX(-1)" : undefined }}>
      <Glyph>
        <path d="M4 2h4v1h1v1h1v4H9v1H8v1H6V9h2V8h1V4H8V3H4z" fill="currentColor" />
        <path d="M4 0h1v6H4zM3 1h1v4H3zM2 2h1v2H2z" fill="currentColor" />
      </Glyph>
    </span>
  );
}

/** The toolbar's buttons are Sounds' (strudel.cc's): raised, bold, pressed in while on. */
const BOLD: React.CSSProperties = { fontWeight: "bold" };

// react95's Slider centres its 18px thumb on the value, so it overhangs each
// end of the track by half that — the same allowance media.exe's volume makes.
const THUMB_INSET = 9;

export default function TreesProgram(props: ProgramProps) {
  const [mode, setMode] = useState<TreesMode>("season");
  const [tilt, setTilt] = useState(false);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  // One of the eight compass points, in degrees clockwise from north.
  const [heading, setHeading] = useState<Heading>(0);
  const turn = useCallback((step: 1 | -1) => setHeading((h) => (h + step * 45 + 360) % 360), []);
  // Bumped to put the whole city back in view.
  const [fitSignal, setFitSignal] = useState(0);
  // The LiDAR's other 850,000 trees, under the street trees in both views.
  const [canopy, setCanopy] = useState(true);

  const gap = <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />;

  const toolbar = (
    <>
      {MODES.map((m) => (
        <Button
          key={m.id}
          size="sm"
          style={BOLD}
          active={mode === m.id}
          aria-pressed={mode === m.id}
          title={m.title}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </Button>
      ))}
      {gap}
      <Button size="sm" style={BOLD} active={!tilt} aria-pressed={!tilt} title="Straight down" onClick={() => setTilt(false)}>
        Flat
      </Button>
      <Button
        size="sm"
        style={BOLD}
        active={tilt}
        aria-pressed={tilt}
        title="The city from an angle, standing on its hills"
        onClick={() => setTilt(true)}
      >
        Tilt
      </Button>
      <Button
        size="sm"
        style={BOLD}
        active={canopy}
        aria-pressed={canopy}
        title="Every other tree in the city — parks, yards and greenbelts — from the 2021 LiDAR survey"
        onClick={() => setCanopy((on) => !on)}
      >
        Canopy
      </Button>
      {tilt && (
        <>
          {gap}
          <div
            style={{ display: "flex", alignItems: "center", gap: 4 }}
            title={`Looking down from ${pitch}° — lower to see the hills and trees stand up`}
          >
            <div style={{ width: 90, padding: `0 ${THUMB_INSET}px` }}>
              <Slider
                size="100%"
                min={PITCH_MIN}
                max={PITCH_MAX}
                step={1}
                value={pitch}
                onChange={setPitch}
                aria-label="Tilt angle"
                // react95 leaves room under the track for tick labels; there are none.
                style={{ marginBottom: 0 }}
              />
            </div>
            <span style={{ minWidth: 26, fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>{pitch}°</span>
          </div>
          {gap}
          <Button size="sm" square title="Turn left (Q)" aria-label="Turn left" onClick={() => turn(-1)}>
            <TurnIcon flip />
          </Button>
          <span
            title="The way the view faces"
            style={{ minWidth: 20, textAlign: "center", fontSize: 12, fontFamily: "monospace" }}
          >
            {headingName(heading)}
          </span>
          <Button size="sm" square title="Turn right (E)" aria-label="Turn right" onClick={() => turn(1)}>
            <TurnIcon />
          </Button>
        </>
      )}
      {gap}
      <Button size="sm" style={BOLD} title="Show the whole city" onClick={() => setFitSignal((n) => n + 1)}>
        Fit
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("trees", props)} toolbar={toolbar}>
      <TreesWindow
        mode={mode}
        tilt={tilt}
        pitch={pitch}
        heading={heading}
        onTurn={turn}
        active={props.active ?? true}
        paused={props.layout === "minimized"}
        fitSignal={fitSignal}
        canopy={canopy}
      />
    </DesktopWindow>
  );
}
