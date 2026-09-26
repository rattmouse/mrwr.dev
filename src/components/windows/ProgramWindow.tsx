"use client";

import React from "react";
import { ProgramWindowId } from "@/components/windows/windowTypes";
import { ProgramProps } from "@/components/programs/programFrame";
import WelcomeProgram from "@/components/programs/WelcomeProgram";
import NotepadProgram from "@/components/programs/NotepadProgram";
import IssuesProgram from "@/components/programs/IssuesProgram";
import ChangesProgram from "@/components/programs/ChangesProgram";
import MusicProgram from "@/components/programs/MusicProgram";
import MidiProgram from "@/components/programs/MidiProgram";
import PaintProgram from "@/components/programs/PaintProgram";
import PartyProgram from "@/components/programs/PartyProgram";
import PlayerProgram from "@/components/programs/PlayerProgram";
import MarblesProgram from "@/components/programs/MarblesProgram";
import TasksProgram from "@/components/programs/TasksProgram";
import CubiclesProgram from "@/components/programs/CubiclesProgram";
import BashProgram from "@/components/programs/BashProgram";

/**
 * The component behind every program in programs.ts. Each one draws its own
 * window — frame, toolbar and all — and keeps its own state, so a program is
 * one file under components/programs/. Typed against the registry: a program
 * listed there with no component here won't build.
 */
const PROGRAM_COMPONENTS: Record<ProgramWindowId, React.ComponentType<ProgramProps>> = {
  welcome: WelcomeProgram,
  notepad: NotepadProgram,
  issues: IssuesProgram,
  changes: ChangesProgram,
  music: MusicProgram,
  midi: MidiProgram,
  paint: PaintProgram,
  party: PartyProgram,
  player: PlayerProgram,
  marbles: MarblesProgram,
  tasks: TasksProgram,
  cubicles: CubiclesProgram,
  bash: BashProgram,
};

export default function ProgramWindow({ id, ...props }: ProgramProps & { id: ProgramWindowId }) {
  const Program = PROGRAM_COMPONENTS[id];
  return <Program {...props} />;
}
