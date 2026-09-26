"use client";

import React from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import BashWindow from "@/components/windows/BashWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function BashProgram(props: ProgramProps) {
  return (
    <DesktopWindow {...windowFrame("bash", props)}>
      <BashWindow onOpenWindow={props.onOpenWindow} onClose={props.onClose} />
    </DesktopWindow>
  );
}
