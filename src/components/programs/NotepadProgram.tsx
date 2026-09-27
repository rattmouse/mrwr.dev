"use client";

import React, { useRef } from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import NotepadWindow, { NotepadWindowHandle } from "@/components/windows/NotepadWindow";
import { ProgramProps, downloadBlob, windowFrame } from "@/components/programs/programFrame";

export default function NotepadProgram(props: ProgramProps) {
  const notepadRef = useRef<NotepadWindowHandle>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toolbar = (
    <>
      <FileMenu
        items={[
          { label: "New", title: "Start a blank page", onClick: () => notepadRef.current?.newFile() },
          {
            label: <>Open&hellip;</>,
            title: "Open a text file from your computer",
            onClick: () => fileInputRef.current?.click(),
          },
          {
            label: "Save",
            title: "Download this page as a text file",
            onClick: () => {
              const file = notepadRef.current?.save();
              if (file) downloadBlob(file.blob, file.name);
            },
          },
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.csv,.json,.log,text/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void notepadRef.current?.openFile(file);
        }}
      />
    </>
  );

  return (
    <DesktopWindow {...windowFrame("notepad", props)} toolbar={toolbar}>
      <NotepadWindow ref={notepadRef} incoming={props.notepadDoc} onIncomingApplied={props.onNotepadDocApplied} />
    </DesktopWindow>
  );
}
