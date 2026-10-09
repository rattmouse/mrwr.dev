"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { Dial, KnobButton, Selector } from "@/components/common/Dial";
import { Glyph } from "@/components/common/MediaGlyphs";
import TreesWindow, { TreesMode, TreesMenuState } from "@/components/windows/TreesWindow";
import TreesRingMenu, { RingNode } from "@/components/windows/TreesRingMenu";
import { COLORINGS, coloringItems, dayItem, LAYER_ICONS, layerItems, playItem, treesRing } from "@/components/windows/treesMenu";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { Heading, HEADING_NAMES, headingName, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from "@/lib/treesTilt";
import { clockLabel, seattleMinutesNow } from "@/lib/sun";
import { walkerChannel, WalkerMessage } from "@/lib/treesWalker";

/** The Open dial: how the trees are colored, each marked by its own coloring of the tree icon. */
const MODES = COLORINGS.map((m) => ({
  ...m,
  mark: <img src={m.icon} alt="" width={16} height={16} style={{ display: "block", imageRendering: "pixelated" }} />,
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

/** The panel's buttons are Sounds' (strudel.cc's): raised, bold, pressed in while on. */
const BOLD: React.CSSProperties = { fontWeight: "bold" };

/** The Open knob's box. */
const SELECTOR_WIDTH = 92;

/** Degrees Q and E turn Tilt by. */
const TURN_STEP = 15;

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
  // What's under the trees: parks (with their restoration zones and gardens), creeks, and what's under the streets.
  const [parks, setParks] = useState(true);
  const [water, setWater] = useState(true);
  const [underground, setUnderground] = useState(true);
  const [rats, setRats] = useState(true);
  // The pipes are the walk's layer: no button here, but shown while the walk has them on.
  const [pipes, setPipes] = useState(false);
  // Tilt lit by the sun at an hour of the day, Seattle time — now, to begin with.
  const [sun, setSun] = useState(false);
  const [minutes, setMinutes] = useState(nowMinutes);

  // Out walking the city from cubicles.exe, the walk's right-click menu sets
  // its layers, its Sun's hour and its coloring; this map follows suit. The
  // rest of the trees' settings are TreesWindow's to take up.
  useEffect(() => {
    const channel = walkerChannel();
    if (!channel) return;
    const onMessage = (event: MessageEvent<WalkerMessage>) => {
      const message = event.data;
      if (message?.type !== "map") return;
      if (message.layers) {
        setStreet(message.layers.street);
        setCanopy(message.layers.canopy);
        setParks(message.layers.parks);
        setWater(message.layers.water);
        setUnderground(message.layers.underground);
        // A walk from before Rats was a layer doesn't say.
        setRats(message.layers.rats ?? true);
        setPipes(message.layers.pipes ?? false);
      }
      if (message.sunHour !== undefined) setMinutes(message.sunHour * 60);
      if (message.trees?.mode) setMode(message.trees.mode);
    };
    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
    };
  }, []);

  const divider = <span aria-hidden style={{ alignSelf: "stretch", width: 0, margin: "4px 0", borderLeft: "1px solid #808080", borderRight: "1px solid #fff" }} />;
  const rule = <span aria-hidden style={{ alignSelf: "stretch", height: 0, margin: "2px 4px", borderTop: "1px solid #808080", borderBottom: "1px solid #fff" }} />;

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
        "The areaways — hollow sidewalks, mostly Pioneer Square's, left when the streets were raised after the 1889 fire — Link light rail, dashed in its tunnels, and SPU's drainage vaults, drilled drains and outfalls",
      on: underground,
      set: setUnderground,
    },
    {
      label: "Rats",
      title: "Rats Seattle Public Utilities' sewer cameras have caught on video, each down at its pipe's depth",
      on: rats,
      set: setRats,
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
    // Age's slider is ticked at each decade.
    const decades = Array.from({ length: Math.floor(pb.yearMax / 10) - pb.yearMin / 10 + 1 }, (_, k) => pb.yearMin + k * 10);
    // The timeline as a slider bent round the ring: Season's year ticked by its months, Age's years by decade.
    const when: RingNode =
      mode === "planted"
        ? {
            label: "Year",
            value: String(pb.year),
            title: "Drag along the arc to move through the years",
            disabled: !pb.canPlay,
            keepOpen: true,
            scrub: { value: pb.year, min: pb.yearMin, max: pb.yearMax, step: 1, ticks: decades, onChange: pb.setYear },
          }
        : mode === "species"
          ? {
              label: "Types",
              title: "Pick out one kind of tree",
              disabled: !pb.groups.length,
              ring: {
                step: 360 / Math.max(1, pb.groups.length),
                start: -90,
                // Painted the legend's colors, with the names left to the tooltips.
                items: pb.groups.map((g, k) => ({
                  label: g.label,
                  title: pb.group === k ? `${g.label}: show every tree again` : `${g.label}: show only these`,
                  paint: g.color,
                  faded: pb.group !== null && pb.group !== k,
                  role: "menuitemcheckbox",
                  on: pb.group === k,
                  keepOpen: true,
                  onSelect: () => pb.setGroup(pb.group === k ? null : k),
                })),
              },
            }
          : dayItem(pb.day, pb.setDay, pb.canPlay);
    const play = playItem(
      pb.playing,
      pb.toggle,
      pb.canPlay,
      pb.canPlay ? (pb.playing ? "Pause" : mode === "planted" ? "Play the years" : "Play the year") : "Play: Season and Age only",
    );
    return [
      {
        label: "Trees",
        value: MODES.find((m) => m.id === mode)?.label,
        ring: treesRing(coloringItems(mode, setMode), play, when),
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
              ring: { step: 30, items: layerItems(LAYERS.map((l) => ({ ...l, toggle: () => l.set((on) => !on) }))) },
            },
            ...(pb.walker
              ? [
                  {
                    label: "Guy",
                    value: pb.walker.following ? "Follow" : undefined,
                    ring: {
                      step: 30,
                      items: [
                        { label: "Here", title: "Move the guy here", onSelect: pb.walker.here },
                        {
                          label: "Follow",
                          title: pb.walker.following ? "Stop following the guy" : "Keep the map on the guy wherever they go",
                          role: "menuitemcheckbox",
                          on: pb.walker.following,
                          onSelect: pb.walker.toggleFollow,
                        },
                      ],
                    },
                  } satisfies RingNode,
                ]
              : []),
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

  // Right of the map: what's shown, then Tilt's three dials — which way it
  // faces (the pointer is the bearing), how far it leans, and with the sun on,
  // the hour — and the Reset knob with them. 2.5D+ is printed red: it runs hot.
  const panel = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
      <Selector
        label="Show"
        caption
        options={VIEWS}
        index={view < 0 ? 0 : view}
        onChange={pickView}
      />
      {rule}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
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
        <KnobButton
          label="Reset"
          title="Show the whole city, and put the dials back: the angle, facing north, the sun to now, the day and year to today"
          onClick={reset}
        />
      </div>
    </div>
  );

  // Left of the map, what's drawn: toggle buttons, pressed in while on, named
  // beside their icons — or the icons alone, when the window's too narrow.
  const layersPanel = (compact: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 2 }}>
      {LAYERS.map((l) => (
        <Button
          key={l.label}
          size="sm"
          square={compact}
          style={{ ...BOLD, justifyContent: compact ? "center" : "flex-start", gap: 6 }}
          active={l.on}
          aria-pressed={l.on}
          aria-label={l.label}
          disabled={l.disabled}
          title={compact ? `${l.label}: ${l.title}` : l.title}
          onClick={() => l.set((on) => !on)}
        >
          <Glyph>
            <path d={LAYER_ICONS[l.label]} fill="currentColor" />
          </Glyph>
          {!compact && l.label}
        </Button>
      ))}
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
        layers={layersPanel}
        modeKnob={modeKnob}
        parks={parks}
        water={water}
        underground={underground}
        rats={rats}
        pipes={pipes}
        sun={sun}
        minutes={minutes}
      />
    </DesktopWindow>
  );
}
