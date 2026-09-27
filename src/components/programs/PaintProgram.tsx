"use client";

import React, { useRef, useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import PaintWindow, { PaintWindowHandle } from "@/components/windows/PaintWindow";
import { ProgramProps, downloadBlob, windowFrame } from "@/components/programs/programFrame";

// Paint's fixed palette and the three pencil widths, in CSS px.
const PAINT_COLORS = [
  "#000000",
  "#7f7f7f",
  "#a80000",
  "#ff7f00",
  "#ffd400",
  "#008000",
  "#0000c0",
  "#7f007f",
] as const;
const PAINT_SIZES = [2, 6, 14] as const;

export default function PaintProgram(props: ProgramProps) {
  const paintRef = useRef<PaintWindowHandle>(null);
  const paintFileInputRef = useRef<HTMLInputElement | null>(null);
  const [paintColor, setPaintColor] = useState<string>(PAINT_COLORS[0]);
  const [paintBrush, setPaintBrush] = useState<number>(6);

  const toolbar = (
    <>
      <FileMenu
        items={[
          { label: "New", title: "Start a blank sheet", onClick: () => paintRef.current?.newFile() },
          {
            label: <>Open&hellip;</>,
            title: "Open a picture from your computer",
            onClick: () => paintFileInputRef.current?.click(),
          },
          {
            label: "Save",
            title: "Download this sheet as a PNG",
            onClick: () => {
              void paintRef.current?.save().then((file) => {
                if (file) downloadBlob(file.blob, file.name);
              });
            },
          },
        ]}
      />
      <input
        ref={paintFileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void paintRef.current?.openFile(file);
        }}
      />
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      {PAINT_COLORS.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={`Colour ${swatch}`}
          aria-pressed={paintColor === swatch}
          title={swatch}
          onClick={() => setPaintColor(swatch)}
          style={{
            width: 18,
            height: 18,
            padding: 0,
            flex: "0 0 auto",
            background: swatch,
            border: "2px solid",
            borderColor:
              paintColor === swatch
                ? "#000000 #ffffff #ffffff #000000"
                : "#ffffff #808080 #808080 #ffffff",
            cursor: "pointer",
          }}
        />
      ))}
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      {PAINT_SIZES.map((size) => (
        <Button
          key={size}
          variant="menu"
          size="sm"
          active={paintBrush === size}
          aria-label={`Brush ${size}px`}
          title={`${size}px brush`}
          onClick={() => setPaintBrush(size)}
        >
          <span
            style={{
              display: "inline-block",
              width: Math.min(size, 14),
              height: Math.min(size, 14),
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
        </Button>
      ))}
      <Button variant="menu" size="sm" onClick={() => paintRef.current?.clear()}>
        Clear
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("paint", props)} toolbar={toolbar}>
      <PaintWindow ref={paintRef} color={paintColor} brushSize={paintBrush} />
    </DesktopWindow>
  );
}
