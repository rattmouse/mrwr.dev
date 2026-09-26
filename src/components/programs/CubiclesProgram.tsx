"use client";

import React from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import CubiclesWindow from "@/components/windows/CubiclesWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function CubiclesProgram(props: ProgramProps) {
  return (
    <DesktopWindow {...windowFrame("cubicles", props)}>
      <CubiclesWindow active={props.active ?? true} />
    </DesktopWindow>
  );
}
