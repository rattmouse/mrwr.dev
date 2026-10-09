"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { Dial, Selector } from "@/components/common/Dial";
import { Glyph, PAUSE_PATH, PLAY_PATH } from "@/components/common/MediaGlyphs";
import TreesWindow, { TreesMode, TreesMenuState } from "@/components/windows/TreesWindow";
import TreesRingMenu, { CHAR_WIDTH, RingNode } from "@/components/windows/TreesRingMenu";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { Heading, HEADING_NAMES, headingName, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from "@/lib/treesTilt";
import { clockLabel, seattleMinutesNow } from "@/lib/sun";
import { dayLabel, doy } from "@/lib/treeSeasons";

/** The Open dial: how the trees are colored, each marked by its own coloring of the tree icon. */
const MODES: { id: TreesMode; label: string; title: string; icon: string; mark: React.ReactNode }[] = (
  [
    ["season", "Season", "Every tree as it looks on a day of the year", "../w95_tree_season.ico"],
    ["species", "Type", "The commonest kinds of tree, by color", "../w95_tree_type.ico"],
    ["planted", "Age", "The trees standing by a given year, newest lit up", "../w95_tree_age.ico"],
  ] as const
).map(([id, label, title, icon]) => ({
  id,
  label,
  title: `${label}: ${title}`,
  icon,
  mark: <img src={icon} alt="" width={16} height={16} style={{ display: "block", imageRendering: "pixelated" }} />,
}));

/** The Show dial: straight down, from an angle on the hills, and that lit by the sun — which runs hot. */
const VIEWS: { label: string; title: string; tilt: boolean; sun: boolean; hot?: boolean }[] = [
  { label: "2D", title: "Straight down", tilt: false, sun: false },
  { label: "2.5D", title: "The city from an angle, standing on its hills", tilt: true, sun: false },
  {
    label: "2.5D+",
    title:
      "Overdrive: 2.5D with the hills and every tree lit and shadowed by the sun at the Sun dial's hour, on the day shown. Heavy — expect it to run slowly",
    tilt: true,
    sun: true,
    hot: true,
  },
];

/** Pixel rectangles [x, y, w, h] on the 12px glyph grid, as one path. */
const rects = (list: [number, number, number, number][]) => list.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join("");

/**
 * The layer buttons' icons, for when the panel is too narrow for their
 * names, and on the right-click menu's Layers ring: a street tree by the curb, a clump of canopy, a park bench, water,
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

/** The panel's buttons are Sounds' (strudel.cc's): raised, bold, pressed in while on. */
const BOLD: React.CSSProperties = { fontWeight: "bold" };

/** The Open and Show knobs' boxes, the same so the two line up down the window's left edge. */
const SELECTOR_WIDTH = 92;

/** The least room between two layer buttons, pixels. */
const LAYER_GAP = 2;

/** Degrees Q and E turn Tilt by. */
const TURN_STEP = 15;

/** The right-click menu's Day ring: each month's first day of the year. */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_STARTS = MONTH_NAMES.map((_, k) => doy(k + 1, 1));

/** A kind of tree's name, short enough for the Types ring: "Cherries & plums" is Cherries, "Everything else" Other. */
const shortGroupLabel = (label: string) => (label === "Everything else" ? "Other" : label.split(" ")[0]);

/** The Tilt ring's stops, degrees. */
const PITCH_STOP = 15;

/** Seattle's time now, to the sun slider's quarter hour. */
const nowMinutes = () => Math.round(seattleMinutesNow() / 15) * 15;

export default function TreesProgram(props: ProgramProps) {
  const [mode, setMode] = useState<TreesMode>("season");
  const [tilt, setTilt] = useState(false);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  // Which way Tilt faces, degrees clockwise from north: the Rotate dial, or Q and E a step at a time.
  const [heading, setHeading] = useState<Heading>(0);
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

  const divider = <span aria-hidden style={{ alignSelf: "stretch", width: 0, margin: "4px 0", borderLeft: "1px solid #808080", borderRight: "1px solid #fff" }} />;

  // The layer buttons spread out over whatever the panel leaves right of
  // Reset: with their names when they fit there, as icons when they don't, and
  // wrapped onto a line under the rest only when even the icons don't fit —
  // still icons there, or the names would fit that line and jump back up top.
  // Their width with names is measured whenever they're showing them, and
  // the room watched against it.
  const layersRef = useRef<HTMLSpanElement>(null);
  const namedWidth = useRef(0);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const room = layersRef.current;
    if (!room) return;
    const check = () => {
      if (!compact) {
        const buttons = Array.from(room.children as HTMLCollectionOf<HTMLElement>);
        namedWidth.current = buttons.reduce((w, b) => w + b.offsetWidth, 0) + LAYER_GAP * (buttons.length - 1);
      }
      const first = room.parentElement?.firstElementChild as HTMLElement | null;
      // Below the whole of the first knob, not just lower: the row centres the shorter buttons on it.
      const wrapped = !!first && room.offsetTop >= first.offsetTop + first.offsetHeight;
      setCompact((compact && wrapped) || namedWidth.current > room.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(room);
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

  const view = VIEWS.findIndex((v) => v.tilt === tilt && (!tilt || v.sun === sun));
  const overdrive = tilt && sun;

  const reset = () => {
    setPitch(PITCH_DEFAULT);
    setHeading(0);
    setMinutes(nowMinutes());
    setFitSignal((n) => n + 1);
  };
  const pickView = (k: number) => {
    setTilt(VIEWS[k].tilt);
    setSun(VIEWS[k].sun);
  };

  // The right-click menu, as a cut through a trunk: Trees on the left — how
  // they're colored, and the timeline — and Map on the right, everything else.
  // On Map's ring, Rotate's ring is a compass with north at the top, Sun's a
  // 24-hour clock face with 0 there, and Tilt's a protractor: each angle sits
  // that many degrees up from the horizon at 3 o'clock, so Tilt goes top right.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuWedges = (pb: TreesMenuState): RingNode[] => {
    // Season's months round a year with January at the top; Age's decades round the same way.
    const decades = Array.from({ length: Math.floor(pb.yearMax / 10) - pb.yearMin / 10 + 1 }, (_, k) => pb.yearMin + k * 10);
    const month = MONTH_STARTS.findLastIndex((d) => d <= pb.day);
    const when: RingNode =
      mode === "planted"
        ? {
            label: "Year",
            value: String(pb.year),
            title: "Jump to a decade",
            disabled: !pb.canPlay,
            ring: {
              step: 360 / decades.length,
              start: -90 - 180 / decades.length,
              items: decades.map((d) => ({
                label: `${d}s`,
                title: `The trees standing in ${d}`,
                role: "menuitemradio",
                on: Math.floor(pb.year / 10) * 10 === d,
                keepOpen: true,
                onSelect: () => pb.setYear(d),
              })),
            },
          }
        : mode === "species"
          ? {
              label: "Types",
              value: pb.group === null ? "All" : shortGroupLabel(pb.groups[pb.group]?.label ?? ""),
              title: "Pick out one kind of tree",
              disabled: !pb.groups.length,
              ring: {
                step: 360 / Math.max(1, pb.groups.length),
                start: -90,
                // Each kind gets room for its name and swatch.
                weights: pb.groups.map((g) => shortGroupLabel(g.label).length * CHAR_WIDTH + 24),
                items: pb.groups.map((g, k) => ({
                  label: shortGroupLabel(g.label),
                  title: pb.group === k ? "Show every tree again" : `Show only ${g.label.toLowerCase()}`,
                  swatch: g.color,
                  role: "menuitemcheckbox",
                  on: pb.group === k,
                  keepOpen: true,
                  onSelect: () => pb.setGroup(pb.group === k ? null : k),
                })),
              },
            }
          : {
              label: "Day",
              value: dayLabel(pb.day),
              title: "Jump to a month",
              disabled: !pb.canPlay,
              ring: {
                step: 30,
                start: -90 - 15,
                items: MONTH_NAMES.map((name, k) => ({
                  label: name,
                  title: `${name} 1`,
                  role: "menuitemradio",
                  on: month === k,
                  keepOpen: true,
                  onSelect: () => pb.setDay(MONTH_STARTS[k]),
                })),
              },
            };
    return [
      {
        label: "Trees",
        value: MODES.find((m) => m.id === mode)?.label,
        ring: {
          step: 36,
          items: [
            {
              label: pb.playing ? "Pause" : "Play",
              title: pb.canPlay ? (pb.playing ? "Pause" : mode === "planted" ? "Play the years" : "Play the year") : "Play: Season and Age only",
              glyph: pb.playing ? PAUSE_PATH : PLAY_PATH,
              role: "menuitemcheckbox",
              on: pb.playing,
              disabled: !pb.canPlay,
              keepOpen: true,
              onSelect: pb.toggle,
            },
            when,
            ...MODES.map(
              (m): RingNode => ({
                label: m.label,
                title: m.title,
                image: m.icon,
                role: "menuitemradio",
                on: m.id === mode,
                onSelect: () => setMode(m.id),
              }),
            ),
          ],
        },
      },
      {
        label: "Map",
        value: VIEWS[view < 0 ? 0 : view].label,
        ring: {
          step: 30,
          start: -90,
          items: [
            {
              label: "View",
              value: VIEWS[view < 0 ? 0 : view].label,
              ring: {
                step: 30,
                items: VIEWS.map((v, k) => ({
                  label: v.label,
                  title: v.title,
                  hot: v.hot,
                  role: "menuitemradio",
                  on: k === view,
                  onSelect: () => pickView(k),
                })),
              },
            },
            {
              label: "Tilt",
              value: `${pitch}°`,
              disabled: !tilt,
              title: tilt ? undefined : "Tilt: 2.5D only",
              ring: {
                // Steepest first: clockwise from near the top down to near 3 o'clock.
                step: PITCH_STOP,
                start: -PITCH_MAX - PITCH_STOP / 2,
                items: Array.from({ length: (PITCH_MAX - PITCH_MIN) / PITCH_STOP + 1 }, (_, k) => PITCH_MAX - k * PITCH_STOP).map((p) => ({
                  label: `${p}°`,
                  title: `Look down from ${p}°`,
                  role: "menuitemradio",
                  on: Math.round(pitch / PITCH_STOP) * PITCH_STOP === p,
                  onSelect: () => setPitch(p),
                })),
              },
            },
            {
              label: "Rotate",
              value: `${heading}°`,
              disabled: !tilt,
              title: tilt ? `Facing ${headingName(heading)}` : "Rotate: 2.5D only",
              ring: {
                step: 45,
                start: -90 - 45 / 2,
                items: HEADING_NAMES.map((name, k) => ({
                  label: name,
                  title: `Face ${name}, ${k * 45}°`,
                  role: "menuitemradio",
                  on: (Math.round(heading / 45) % 8 + 8) % 8 === k,
                  onSelect: () => setHeading(k * 45),
                })),
              },
            },
            {
              label: "Sun",
              value: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
              disabled: !overdrive,
              title: overdrive ? `${clockLabel(minutes)}, Seattle time` : "Sun: 2.5D+ only",
              ring: {
                step: 15,
                start: -90 - 15 / 2,
                items: Array.from({ length: 24 }, (_, h) => ({
                  label: String(h),
                  title: `${clockLabel(h * 60)}, Seattle time`,
                  role: "menuitemradio",
                  on: Math.floor(minutes / 60) === h,
                  onSelect: () => setMinutes(h * 60),
                })),
              },
            },
            {
              label: "Layers",
              value: `${LAYERS.filter((l) => l.on).length}/${LAYERS.length}`,
              ring: {
                step: 30,
                items: LAYERS.map((l) => ({
                  label: l.label,
                  title: `${l.label}: ${l.title}`,
                  glyph: LAYER_ICONS[l.label],
                  role: "menuitemcheckbox",
                  on: l.on,
                  disabled: l.disabled,
                  keepOpen: true,
                  onSelect: () => l.set((on) => !on),
                })),
              },
            },
            { label: "Reset", title: "Show the whole city, and put the dials back", onSelect: reset },
          ],
        },
      },
    ];
  };

  // How the trees are colored: beside the view's own controls, the day or year
  // slider or the Type legend.
  const modeKnob = (
    <>
      <Selector
        label="Open"
        width={SELECTOR_WIDTH}
        options={MODES}
        index={MODES.findIndex((m) => m.id === mode)}
        onChange={(k) => setMode(MODES[k].id)}
      />
      {divider}
    </>
  );

  // Under the map: what's shown, then Tilt's three dials — which way it faces
  // (the pointer is the bearing), how far it leans, and with the sun on, the
  // hour — and Reset with them; then the layers. 2.5D+ is printed red: it runs hot.
  const panel = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-start",
        columnGap: 10,
        rowGap: 4,
        paddingTop: 2,
      }}
    >
      <Selector
        label="Show"
        width={SELECTOR_WIDTH}
        options={VIEWS}
        index={view < 0 ? 0 : view}
        onChange={pickView}
      />
      {divider}
      <Dial
        label="Rotate"
        min={0}
        max={360}
        step={5}
        endless
        value={heading}
        onChange={setHeading}
        defaultValue={0}
        disabled={!tilt}
        readout={`${headingName(heading)} ${heading}°`}
        title={tilt ? `Facing ${heading}° — Q and E turn it ${TURN_STEP}° at a time` : "Rotate: 2.5D only"}
      />
      <Dial
        label="Tilt"
        min={PITCH_MIN}
        max={PITCH_MAX}
        value={pitch}
        onChange={setPitch}
        defaultValue={PITCH_DEFAULT}
        disabled={!tilt}
        readout={`${pitch}°`}
        title={tilt ? `Looking down from ${pitch}° — lower to see the hills and trees stand up` : "Tilt: 2.5D only"}
      />
      <Dial
        label="Sun"
        min={0}
        max={1425}
        step={15}
        value={minutes}
        onChange={setMinutes}
        disabled={!overdrive}
        readout={clockLabel(minutes)}
        title={overdrive ? `${clockLabel(minutes)}, Seattle time` : "Sun: 2.5D+ only"}
      />
      <Button
        size="sm"
        style={BOLD}
        title="Show the whole city, and put the dials back: the angle, facing north, the sun to now, the day and year to today"
        onClick={reset}
      >
        Reset
      </Button>
      {divider}
      {/* What's drawn, in whatever's left of the row: toggle buttons, pressed in while on. */}
      <span
        ref={layersRef}
        style={{
          flex: "1 1 0",
          minWidth: compact ? "min-content" : 0,
          display: "flex",
          justifyContent: "space-evenly",
          gap: LAYER_GAP,
        }}
      >
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
    </div>
  );

  return (
    <DesktopWindow {...windowFrame("trees", props)}>
      <TreesWindow
        mode={mode}
        tilt={tilt}
        pitch={pitch}
        heading={heading}
        onTurn={turn}
        active={props.active ?? true}
        paused={props.layout === "minimized"}
        fitSignal={fitSignal}
        street={street}
        canopy={canopy}
        onNow={() => setMinutes(nowMinutes())}
        onMenu={(x, y) => setMenu({ x, y })}
        menu={menu ? (pb) => <TreesRingMenu x={menu.x} y={menu.y} start={90} wedges={menuWedges(pb)} onDismiss={closeMenu} /> : undefined}
        controls={panel}
        modeKnob={modeKnob}
        parks={parks}
        water={water}
        underground={underground}
        sun={sun}
        minutes={minutes}
      />
    </DesktopWindow>
  );
}
