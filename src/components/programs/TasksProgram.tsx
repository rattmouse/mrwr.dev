"use client";

import React from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import TasksWindow from "@/components/windows/TasksWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function TasksProgram(props: ProgramProps) {
  return (
    <DesktopWindow {...windowFrame("tasks", props)}>
      <TasksWindow active={props.active ?? true} />
    </DesktopWindow>
  );
}
