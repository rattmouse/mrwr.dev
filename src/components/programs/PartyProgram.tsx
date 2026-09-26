"use client";

import React, { useCallback, useState } from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import PartyWindow, { NO_FRAME, FrameSettings } from "@/components/windows/PartyWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function PartyProgram(props: ProgramProps) {
  // party.webp reaches back out through its Frame panel and works on the
  // window around it, so the melt lives out here with the frame rather than
  // inside the window's content. It lasts as long as this window does —
  // closing it puts the frame back together.
  const [frame, setFrame] = useState<FrameSettings>(NO_FRAME);
  const patchFrame = useCallback(
    (patch: Partial<FrameSettings>) => setFrame((prev) => ({ ...prev, ...patch })),
    [],
  );

  return (
    <DesktopWindow {...windowFrame("party", props)} melt={frame.melt} lights={frame.lights}>
      <PartyWindow frame={frame} onFrameChange={patchFrame} />
    </DesktopWindow>
  );
}
