"use client";

import React, { useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import TreesWindow, { TreesMode } from "@/components/windows/TreesWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

const MODES: { id: TreesMode; label: string; title: string }[] = [
  { id: "season", label: "Season", title: "Every tree as it looks on a day of the year" },
  { id: "planted", label: "Planted", title: "The trees standing by a given year, newest lit up" },
  { id: "species", label: "Species", title: "The commonest kinds of tree, by color" },
];

export default function TreesProgram(props: ProgramProps) {
  const [mode, setMode] = useState<TreesMode>("season");
  // Bumped to put the whole city back in view.
  const [fitSignal, setFitSignal] = useState(0);

  const toolbar = (
    <>
      {MODES.map((m) => (
        <Button key={m.id} variant="menu" size="sm" active={mode === m.id} title={m.title} onClick={() => setMode(m.id)}>
          {m.label}
        </Button>
      ))}
      <Button variant="menu" size="sm" title="Show the whole city" onClick={() => setFitSignal((n) => n + 1)} style={{ marginLeft: 6 }}>
        Fit
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("trees", props)} toolbar={toolbar}>
      <TreesWindow
        mode={mode}
        active={props.active ?? true}
        paused={props.layout === "minimized"}
        fitSignal={fitSignal}
      />
    </DesktopWindow>
  );
}
