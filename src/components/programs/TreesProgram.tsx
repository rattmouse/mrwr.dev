"use client";

import React, { useCallback, useState } from "react";
import { Button, Slider } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import TreesWindow, { TreesMode } from "@/components/windows/TreesWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { Heading, headingName, PITCH_DEFAULT, PITCH_MAX, PITCH_MIN } from "@/lib/treesTilt";
import { clockLabel, seattleMinutesNow } from "@/lib/sun";

/** View > Trees: how the trees are colored. */
const MODES: { id: TreesMode; label: string; title: string }[] = [
  { id: "season", label: "Season", title: "Every tree as it looks on a day of the year" },
  { id: "species", label: "Type", title: "The commonest kinds of tree, by color" },
  { id: "planted", label: "Age", title: "The trees standing by a given year, newest lit up" },
];

/** The toolbar's buttons are Sounds' (strudel.cc's): raised, bold, pressed in while on. */
const BOLD: React.CSSProperties = { fontWeight: "bold" };

// react95's Slider centres its 18px thumb on the value, so it overhangs each
// end of the track by half that — the same allowance media.exe's volume makes.
const THUMB_INSET = 9;
/** Degrees Q and E turn Tilt by. */
const TURN_STEP = 15;

/** Seattle's time now, to the sun slider's quarter hour. */
const nowMinutes = () => Math.round(seattleMinutesNow() / 15) * 15;

export default function TreesProgram(props: ProgramProps) {
  const [mode, setMode] = useState<TreesMode>("season");
  const [tilt, setTilt] = useState(false);
  const [pitch, setPitch] = useState(PITCH_DEFAULT);
  // Which way Tilt faces, degrees clockwise from north: the slider, or Q and E a step at a time.
  const [heading, setHeading] = useState<Heading>(0);
  const turn = useCallback((step: 1 | -1) => setHeading((h) => (h + step * TURN_STEP + 360) % 360), []);
  // Bumped to put the whole city back in view.
  const [fitSignal, setFitSignal] = useState(0);
  // View > Layer. The street trees; the LiDAR's other 850,000 trees under them in both views.
  const [street, setStreet] = useState(true);
  const [canopy, setCanopy] = useState(true);
  // What's under the trees: parks (with their restoration zones and gardens), and creeks.
  const [parks, setParks] = useState(true);
  const [water, setWater] = useState(true);
  // Tilt lit by the sun at an hour of the day, Seattle time — now, to begin with.
  const [sun, setSun] = useState(false);
  const [minutes, setMinutes] = useState(nowMinutes);

  const gap = <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />;

  const toolbar = (
    <>
      <FileMenu
        name="View"
        items={[
          {
            label: "Trees",
            items: MODES.map((m) => ({ label: m.label, title: m.title, checked: mode === m.id, onClick: () => setMode(m.id) })),
          },
          {
            label: "Map",
            items: [
              { label: "Flat", title: "Straight down", checked: !tilt, onClick: () => setTilt(false) },
              { label: "Tilt", title: "The city from an angle, standing on its hills", checked: tilt, onClick: () => setTilt(true) },
              {
                label: "Sun",
                title: "Light Tilt's hills and trees by the sun, at the hour on the toolbar, on the day shown",
                checked: sun,
                disabled: !tilt,
                onClick: () => setSun((on) => !on),
              },
            ],
          },
          {
            label: "Layer",
            items: [
              {
                label: "Street",
                title: "The city's street trees",
                checked: street,
                onClick: () => setStreet((on) => !on),
              },
              {
                label: "Canopy",
                title: "Every other tree in the city — parks, yards and greenbelts — from the 2021 LiDAR survey",
                checked: canopy,
                // The survey can't date its trees, so Age leaves them out anyway.
                disabled: mode === "planted",
                onClick: () => setCanopy((on) => !on),
              },
              {
                label: "Parks",
                title: "Seattle's parks and the trees Parks has inventoried in them, forest-restoration zones, and P-Patch gardens",
                checked: parks,
                onClick: () => setParks((on) => !on),
              },
              {
                label: "Water",
                title: "Seattle's creeks, dashed where they run through pipes",
                checked: water,
                onClick: () => setWater((on) => !on),
              },
            ],
          },
        ]}
      />
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
          <div
            style={{ display: "flex", alignItems: "center", gap: 4 }}
            title={`Facing ${heading}° — Q and E turn it ${TURN_STEP}° at a time`}
          >
            <div style={{ width: 110, padding: `0 ${THUMB_INSET}px` }}>
              <Slider
                size="100%"
                min={0}
                max={355}
                step={5}
                value={heading}
                onChange={setHeading}
                aria-label="Facing"
                style={{ marginBottom: 0 }}
              />
            </div>
            <span style={{ minWidth: 20, fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>{headingName(heading)}</span>
          </div>
          {sun && gap}
          {sun && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="The time of day, Seattle time">
              <div style={{ width: 110, padding: `0 ${THUMB_INSET}px` }}>
                <Slider
                  size="100%"
                  min={0}
                  max={1425}
                  step={15}
                  value={minutes}
                  onChange={setMinutes}
                  aria-label="Time of day"
                  style={{ marginBottom: 0 }}
                />
              </div>
              <span style={{ minWidth: 58, fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>{clockLabel(minutes)}</span>
            </div>
          )}
        </>
      )}
      {gap}
      <Button
        size="sm"
        style={BOLD}
        title="Show the whole city, and put the sliders back: the angle, facing north, the sun to now, the day and year to today"
        onClick={() => {
          setPitch(PITCH_DEFAULT);
          setHeading(0);
          setMinutes(nowMinutes());
          setFitSignal((n) => n + 1);
        }}
      >
        Reset
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
        street={street}
        canopy={canopy}
        onNow={() => setMinutes(nowMinutes())}
        parks={parks}
        water={water}
        sun={sun}
        minutes={minutes}
      />
    </DesktopWindow>
  );
}
