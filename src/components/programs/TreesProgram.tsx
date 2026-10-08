"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import KnobSlider from "@/components/common/KnobSlider";
import { Glyph } from "@/components/common/MediaGlyphs";
import TreesWindow, { TreesMode } from "@/components/windows/TreesWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { Heading, headingName, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from "@/lib/treesTilt";
import { clockLabel, seattleMinutesNow } from "@/lib/sun";

/**
 * File > Open: how the trees are colored, named like the program's own
 * command-line flags, each with its own coloring of the tree icon.
 */
const MODES: { id: TreesMode; label: string; title: string; icon: string }[] = [
  { id: "season", label: "-s, --season", title: "Every tree as it looks on a day of the year", icon: "../w95_tree_season.ico" },
  { id: "species", label: "-t, --type", title: "The commonest kinds of tree, by color", icon: "../w95_tree_type.ico" },
  { id: "planted", label: "-a, --age", title: "The trees standing by a given year, newest lit up", icon: "../w95_tree_age.ico" },
];

/** File > Show: straight down, from an angle on the hills, and that lit by the sun. */
const VIEWS: { label: string; title: string; tilt: boolean; sun: boolean }[] = [
  { label: "2D", title: "Straight down", tilt: false, sun: false },
  { label: "2.5D", title: "The city from an angle, standing on its hills", tilt: true, sun: false },
  {
    label: "2.5D+",
    title: "The city from an angle, its hills and trees lit by the sun at the hour on the time slider, on the day shown",
    tilt: true,
    sun: true,
  },
];

/** A sun on the media glyphs' 12px grid, for the time-of-day slider's knob: the time itself is in the status line. */
function SunIcon() {
  return (
    <Glyph>
      <path d="M4 4h4v4H4zM5 3h2v1H5zM5 8h2v1H5zM3 5h1v2H3zM8 5h1v2H8z" fill="#c08000" />
      <path d="M5 0h2v2H5zM5 10h2v2H5zM0 5h2v2H0zM10 5h2v2h-2zM1 1h2v2H1zM9 1h2v2H9zM1 9h2v2H1zM9 9h2v2H9z" fill="#c08000" />
    </Glyph>
  );
}

/** Pixel rectangles [x, y, w, h] on the 12px glyph grid, as one path. */
const rects = (list: [number, number, number, number][]) => list.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join("");

/**
 * The layer buttons' icons, for when the toolbar is too narrow for their
 * names: a street tree by the curb, a clump of canopy, a park bench, water,
 * and a pit under the pavement.
 */
const LAYER_ICONS: Record<string, string> = {
  Street: "M4 1h4v1h1v1h1v3H9v1H3V6H2V3h1V2h1z" + rects([[5, 7, 2, 3], [0, 10, 12, 1]]),
  Canopy:
    "M1 4h4v1h1v3H0V5h1zM7 4h4v1h1v3H6V5h1zM4 1h4v1h1v3H3V2h1z" + rects([[2, 8, 1, 3], [9, 8, 1, 3], [5, 5, 2, 6]]),
  Parks: rects([[1, 2, 10, 2], [0, 5, 12, 2], [1, 7, 1, 4], [10, 7, 1, 4], [2, 4, 1, 1], [9, 4, 1, 1]]),
  Water: rects(
    [1, 5, 9].flatMap((y): [number, number, number, number][] => [
      [0, y + 1, 2, 1],
      [2, y, 3, 1],
      [5, y + 1, 3, 1],
      [8, y, 3, 1],
      [11, y + 1, 1, 1],
    ]),
  ),
  Underground: rects([[0, 2, 12, 1], [2, 3, 1, 8], [9, 3, 1, 8], [3, 10, 6, 1], [4, 5, 1, 1], [7, 7, 1, 1], [5, 8, 1, 1]]),
};

/** The toolbar's buttons are Sounds' (strudel.cc's): raised, bold, pressed in while on. */
const BOLD: React.CSSProperties = { fontWeight: "bold" };

/** Degrees Q and E turn Tilt by. */
const TURN_STEP = 15;

/** Seattle's time now, to the sun slider's quarter hour. */
const nowMinutes = () => Math.round(seattleMinutesNow() / 15) * 15;

export default function TreesProgram(props: ProgramProps) {
  const [mode, setMode] = useState<TreesMode>("season");
  const [tilt, setTilt] = useState(false);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  // Which way Tilt faces, degrees clockwise from north: the slider, or Q and E a step at a time.
  // The slider runs 0–360, north at both ends, and starts at the right one.
  const [heading, setHeading] = useState<Heading>(360);
  const facing = heading % 360;
  const turn = useCallback((step: 1 | -1) => setHeading((h) => ((h % 360) + step * TURN_STEP + 360) % 360), []);
  // Bumped to put the whole city back in view.
  const [fitSignal, setFitSignal] = useState(0);
  // The layer buttons. The street trees; the LiDAR's other 850,000 trees under them in both views.
  const [street, setStreet] = useState(true);
  const [canopy, setCanopy] = useState(true);
  // What's under the trees: parks (with their restoration zones and gardens), creeks, and the areaways under the sidewalks.
  const [parks, setParks] = useState(true);
  const [water, setWater] = useState(true);
  const [underground, setUnderground] = useState(true);
  // Tilt lit by the sun at an hour of the day, Seattle time — now, to begin with.
  const [sun, setSun] = useState(false);
  const [minutes, setMinutes] = useState(nowMinutes);

  const gap = <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />;

  // The layer buttons go to icons when the toolbar is too narrow for File and
  // all their names on one line. Their width with names is measured whenever
  // they're showing them, and the toolbar's width watched against it.
  const fileRef = useRef<HTMLSpanElement>(null);
  const layersRef = useRef<HTMLSpanElement>(null);
  const namedWidth = useRef(0);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const layers = layersRef.current;
    const bar = layers?.parentElement;
    if (!layers || !bar) return;
    const check = () => {
      if (!compact) namedWidth.current = layers.scrollWidth;
      const style = getComputedStyle(bar);
      const room = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // File, the 6px gap after it and the toolbar's 2px gaps either side of that.
      const need = (fileRef.current?.offsetWidth ?? 0) + 6 + 4 + namedWidth.current;
      setCompact(need > room);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [compact]);
  // What's drawn: toggle buttons, pressed in while on.
  const LAYERS: {
    label: string;
    title: string;
    on: boolean;
    set: React.Dispatch<React.SetStateAction<boolean>>;
    disabled?: boolean;
  }[] = [
    { label: "Street", title: "The city's street trees", on: street, set: setStreet },
    {
      label: "Canopy",
      title: "Every other tree in the city — parks, yards and greenbelts — from the 2021 LiDAR survey",
      on: canopy,
      set: setCanopy,
      // The survey can't date its trees, so Age leaves them out anyway.
      disabled: mode === "planted",
    },
    {
      label: "Parks",
      title: "Seattle's parks and the trees Parks has inventoried in them, forest-restoration zones, and P-Patch gardens",
      on: parks,
      set: setParks,
    },
    { label: "Water", title: "Seattle's creeks, dashed where they run through pipes", on: water, set: setWater },
    {
      label: "Underground",
      title:
        "The areaways — hollow sidewalks, mostly Pioneer Square's, left when the streets were raised after the 1889 fire — and Link light rail, dashed in its tunnels",
      on: underground,
      set: setUnderground,
    },
  ];

  // Over the map's bottom-right corner, one under another: in Tilt, with the
  // Sun on, the hour (its time is in the status line, so the knob carries a
  // sun), which way it faces (the compass letter) and how far it leans (the
  // angle on the knob); and under them, in both views, Reset.
  const corner = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      {tilt && sun && (
        <KnobSlider
          length={140}
          min={0}
          max={1425}
          step={15}
          value={minutes}
          onChange={setMinutes}
          knob={<SunIcon />}
          label="Time of day"
          title={`${clockLabel(minutes)}, Seattle time`}
        />
      )}
      {tilt && (
        <KnobSlider
          length={140}
          min={0}
          max={360}
          step={5}
          value={heading}
          onChange={setHeading}
          knob={headingName(facing).charAt(0)}
          label="Facing"
          title={`Facing ${facing}° — Q and E turn it ${TURN_STEP}° at a time`}
        />
      )}
      {tilt && (
        <KnobSlider
          length={140}
          min={PITCH_MIN}
          max={PITCH_MAX}
          value={pitch}
          onChange={setPitch}
          knob={`${pitch}°`}
          knobWidth={28}
          label="Tilt angle"
          title={`Looking down from ${pitch}° — lower to see the hills and trees stand up`}
        />
      )}
      <Button
        size="sm"
        style={{ ...BOLD, marginTop: tilt ? 2 : 0 }}
        title="Show the whole city, and put the sliders back: the angle, facing north, the sun to now, the day and year to today"
        onClick={() => {
          setPitch(PITCH_DEFAULT);
          setHeading(360);
          setMinutes(nowMinutes());
          setFitSignal((n) => n + 1);
        }}
      >
        Reset
      </Button>
    </div>
  );

  const toolbar = (
    <>
      <span ref={fileRef} style={{ display: "inline-flex" }}>
        <FileMenu
          items={[
            {
              label: "Open",
              items: MODES.map((m) => ({
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <img
                      src={m.icon}
                      alt=""
                      aria-hidden
                      width={16}
                      height={16}
                      style={{ display: "inline-block", imageRendering: "pixelated" }}
                    />
                    <span>{m.label}</span>
                  </span>
                ),
                title: m.title,
                checked: mode === m.id,
                onClick: () => setMode(m.id),
              })),
            },
            {
              label: "Show",
              items: VIEWS.map((v) => ({
                label: v.label,
                title: v.title,
                checked: tilt === v.tilt && (!tilt || sun === v.sun),
                onClick: () => {
                  setTilt(v.tilt);
                  setSun(v.sun);
                },
              })),
            },
          ]}
        />
      </span>
      {gap}
      <span ref={layersRef} style={{ display: "inline-flex", gap: 2, flex: "0 0 auto" }}>
        {LAYERS.map((l) => (
          <Button
            key={l.label}
            size="sm"
            square={compact}
            style={BOLD}
            active={l.on}
            aria-pressed={l.on}
            aria-label={l.label}
            disabled={l.disabled}
            title={compact ? `${l.label}: ${l.title}` : l.title}
            onClick={() => l.set((on) => !on)}
          >
            {compact ? (
              <Glyph>
                <path d={LAYER_ICONS[l.label]} fill="currentColor" />
              </Glyph>
            ) : (
              l.label
            )}
          </Button>
        ))}
      </span>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("trees", props)} toolbar={toolbar}>
      <TreesWindow
        mode={mode}
        tilt={tilt}
        pitch={pitch}
        heading={facing}
        onTurn={turn}
        active={props.active ?? true}
        paused={props.layout === "minimized"}
        fitSignal={fitSignal}
        street={street}
        canopy={canopy}
        onNow={() => setMinutes(nowMinutes())}
        overlay={corner}
        parks={parks}
        water={water}
        underground={underground}
        sun={sun}
        minutes={minutes}
      />
    </DesktopWindow>
  );
}
