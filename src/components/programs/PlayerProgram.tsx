"use client";

import React, { useRef, useState } from "react";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import PlayerWindow, { PLAYER_ACCEPT, PlayerWindowHandle, VizMode, VIZ_MODES } from "@/components/windows/PlayerWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function PlayerProgram(props: ProgramProps) {
  const playerRef = useRef<PlayerWindowHandle>(null);
  const playerFileInputRef = useRef<HTMLInputElement | null>(null);
  const playerFolderInputRef = useRef<HTMLInputElement | null>(null);
  const playerAddInputRef = useRef<HTMLInputElement | null>(null);
  const [playerViz, setPlayerViz] = useState<VizMode>("bars");

  const toolbar = (
    <>
      <FileMenu
        items={[
          {
            label: <>Open&hellip;</>,
            title: "Play media files from your computer",
            onClick: () => playerFileInputRef.current?.click(),
          },
          {
            label: <>Open folder&hellip;</>,
            title: "Play every audio and video file in a folder",
            onClick: () => playerFolderInputRef.current?.click(),
          },
          {
            label: <>Add to playlist&hellip;</>,
            title: "Queue more files after the ones already listed",
            onClick: () => playerAddInputRef.current?.click(),
          },
          { label: "Clear playlist", title: "Empty the playlist", onClick: () => playerRef.current?.clear() },
        ]}
      />
      {/* View: which visualiser a song is drawn with, ticked as picked. */}
      <FileMenu
        name="View"
        items={VIZ_MODES.map((option) => ({
          label: option.label,
          title: option.title,
          checked: playerViz === option.id,
          onClick: () => setPlayerViz(option.id),
        }))}
      />
      {(
        [
          [playerFileInputRef, false, false],
          [playerFolderInputRef, true, false],
          [playerAddInputRef, false, true],
        ] as const
      ).map(([inputRef, folder, add], index) => (
        <input
          key={index}
          ref={inputRef}
          type="file"
          accept={folder ? undefined : PLAYER_ACCEPT}
          multiple
          hidden
          // Folder pick: the browser hands back every file under it.
          {...(folder ? { webkitdirectory: "" } : {})}
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            if (!files.length) return;
            if (add) playerRef.current?.addFiles(files);
            else playerRef.current?.openFiles(files);
          }}
        />
      ))}
    </>
  );

  return (
    <DesktopWindow {...windowFrame("player", props)} toolbar={toolbar}>
      <PlayerWindow ref={playerRef} viz={playerViz} />
    </DesktopWindow>
  );
}
