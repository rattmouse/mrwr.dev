"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import PaintWindow, { PaintStatus, PaintTool, PaintWindowHandle } from "@/components/windows/PaintWindow";
import { ProgramProps, downloadBlob, windowFrame } from "@/components/programs/programFrame";
import { loadSettings, saveSettings } from "@/lib/savedSettings";
import { Turn, UPRIGHT, flipHorizontal, flipVertical, normalizeTurn, rotateRight } from "@/lib/windowTurn";

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

// Which way round the window was left turned, kept alongside the sheet itself.
const TURN_KEY = "mrwr:paint-turn";

// The rotate and flip buttons' faces: an arrow bending round, and a pair of
// arrows pointing apart along the way the flip goes.
const ICON = { width: 12, height: 12, viewBox: "0 0 12 12", role: "presentation" } as const;
const RotateIcon = () => (
  <svg {...ICON}>
    <path d="M2 7a4 4 0 1 0 1.2-2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M1 1.5v4h4z" fill="currentColor" />
  </svg>
);
const FlipVerticalIcon = () => (
  <svg {...ICON}>
    <path d="M6 0l3.5 4h-7zM6 12l3.5-4h-7z" fill="currentColor" />
    <path d="M0 6h12" stroke="currentColor" strokeDasharray="2 1" />
  </svg>
);
const FlipHorizontalIcon = () => (
  <svg {...ICON}>
    <path d="M0 6l4-3.5v7zM12 6l-4-3.5v7z" fill="currentColor" />
    <path d="M6 0v12" stroke="currentColor" strokeDasharray="2 1" />
  </svg>
);

// Paint's tool box: what the pointer does, and the little glyph that says so.
const PAINT_TOOLS: { id: PaintTool; name: string; title: string; icon: React.ReactNode }[] = [
  {
    id: "pencil",
    name: "Pencil",
    title: "Pencil — draw freehand (P)",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
        <path d="M1 11l.7-2.5L8.2 2l1.8 1.8-6.5 6.5L1 11z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "select",
    name: "Select",
    title: "Select a rectangle (M)",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
        <rect
          x="1.5"
          y="2.5"
          width="9"
          height="7"
          fill="none"
          stroke="currentColor"
          strokeDasharray="2 1.5"
        />
      </svg>
    ),
  },
  {
    id: "lasso",
    name: "Free-form select",
    title: "Free-form select — draw a line round it (F)",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
        <path
          d="M6 1.5C3.2 1.5 1.5 3.1 1.5 5s1.7 3.5 4.5 3.5c1 0 1.9-.2 2.6-.6l1.4 2.1"
          fill="none"
          stroke="currentColor"
          strokeDasharray="2 1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "wand",
    name: "Magic wand",
    title: "Magic wand — select everything this color; hold and drag right or down for more, left or up for less (Q)",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
        <path d="M1.5 10.5l5.2-5.2 1.3 1.3-5.2 5.2z" fill="currentColor" />
        <path
          d="M8.4 1v2.4M7.2 2.2h2.4M10.4 4.6v1.8M9.5 5.5h1.8"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "dropper",
    name: "Pick color",
    title: "Dropper — take a color off the picture; hold and slide to the pixel you want (K)",
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
        <path d="M1 11l.4-1.9 5-5 1.5 1.5-5 5L1 11z" fill="currentColor" />
        <path d="M6.8 2.7l1.3-1.3a1.35 1.35 0 011.9 1.9L8.7 4.6z" fill="currentColor" />
      </svg>
    ),
  },
];

// Grab sits in the tool box but isn't a tool the sheet keeps: it takes one
// box of the page, anywhere on it, and hands back to the select tool.
const GrabIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
    <path d="M.5 3.5v-3h3M8.5.5h3v3M11.5 8.5v3h-3M3.5 11.5h-3v-3" fill="none" stroke="currentColor" />
    <path d="M6 3.5v5M3.5 6h5" stroke="currentColor" />
  </svg>
);

export default function PaintProgram(props: ProgramProps) {
  const paintRef = useRef<PaintWindowHandle>(null);
  const paintFileInputRef = useRef<HTMLInputElement | null>(null);
  const [paintColor, setPaintColor] = useState<string>(PAINT_COLORS[0]);
  const [paintBrush, setPaintBrush] = useState<number>(6);
  const [paintTool, setPaintTool] = useState<PaintTool>("pencil");
  const [paintMap, setPaintMap] = useState(true);
  const [turn, setTurn] = useState<Turn>(() => normalizeTurn(loadSettings(TURN_KEY, UPRIGHT)));

  useEffect(() => {
    saveSettings(TURN_KEY, turn);
  }, [turn]);

  // Paint tells the toolbar what it can currently do, so Edit's rows and the
  // undo arrows grey themselves out rather than doing nothing when pressed.
  const [paintStatus, setPaintStatus] = useState<PaintStatus>({
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    canPaste: false,
    zoom: 1,
  });
  const handlePaintStatus = useCallback((next: PaintStatus) => {
    setPaintStatus((prev) =>
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.hasSelection === next.hasSelection &&
      prev.canPaste === next.canPaste &&
      prev.zoom === next.zoom
        ? prev
        : next,
    );
  }, []);

  const save = () => {
    void paintRef.current?.save().then((file) => {
      if (file) downloadBlob(file.blob, file.name);
    });
  };

  // Paint's keyboard reaches back out for the things the window owns: the tool
  // box, the brush sizes and the File menu. Paint keeps these in a ref rather
  // than in any dependency list, so a fresh object each render costs nothing.
  const paintCommands = {
    setTool: setPaintTool,
    cycleBrush: (delta: number) =>
      setPaintBrush((prev) => {
        const at = PAINT_SIZES.indexOf(prev as (typeof PAINT_SIZES)[number]);
        const next = Math.max(0, Math.min(PAINT_SIZES.length - 1, (at < 0 ? 1 : at) + delta));
        return PAINT_SIZES[next];
      }),
    requestOpen: () => paintFileInputRef.current?.click(),
    requestSave: save,
    rotate: () => setTurn(rotateRight),
    flipVertical: () => setTurn(flipVertical),
    flipHorizontal: () => setTurn(flipHorizontal),
  };

  const toolbar = (
    <>
      <FileMenu
        items={[
          {
            label: "New",
            title: "Start a blank sheet",
            onClick: () => {
              paintRef.current?.newFile();
              setTurn(UPRIGHT);
            },
          },
          {
            label: <>Open&hellip;</>,
            title: "Open a picture from your computer (Ctrl+O)",
            onClick: () => paintFileInputRef.current?.click(),
          },
          {
            label: "Save",
            title: "Download this sheet as a PNG (Ctrl+S)",
            onClick: save,
          },
        ]}
      />
      <FileMenu
        name="Edit"
        items={[
          {
            label: "Undo",
            title: "Step back (Ctrl+Z)",
            disabled: !paintStatus.canUndo,
            onClick: () => paintRef.current?.undo(),
          },
          {
            label: "Redo",
            title: "Step forward again (Ctrl+Y)",
            disabled: !paintStatus.canRedo,
            onClick: () => paintRef.current?.redo(),
          },
          {
            label: "Cut",
            title: "Lift the selection out (Ctrl+X)",
            disabled: !paintStatus.hasSelection,
            onClick: () => paintRef.current?.cut(),
          },
          {
            label: "Copy",
            title: "Copy the selection (Ctrl+C)",
            disabled: !paintStatus.hasSelection,
            onClick: () => paintRef.current?.copy(),
          },
          {
            label: "Paste",
            title: "Drop the copied pixels in the middle of the view, all of them in sight (Ctrl+V)",
            disabled: !paintStatus.canPaste,
            onClick: () => paintRef.current?.paste(),
          },
          {
            label: <>Grab from the page&hellip;</>,
            title: "Freeze everything and drag a box round anything on the page — another window, the desktop — to paste it in (G)",
            onClick: () => paintRef.current?.grab(),
          },
          {
            label: "Delete",
            title: "Wipe the selection back to white (Del)",
            disabled: !paintStatus.hasSelection,
            onClick: () => paintRef.current?.deleteSelection(),
          },
          {
            label: <>Adjust colors&hellip;</>,
            title: "Change the selection's hue, saturation, brightness and red, green and blue",
            disabled: !paintStatus.hasSelection,
            onClick: () => paintRef.current?.adjustColors(),
          },
          {
            label: "Select all",
            title: "Select the whole sheet (Ctrl+A)",
            onClick: () => {
              if (paintTool === "pencil" || paintTool === "dropper") setPaintTool("select");
              paintRef.current?.selectAll();
            },
          },
          {
            label: "Deselect",
            title: "Put the selection down (Esc, or Ctrl+D)",
            disabled: !paintStatus.hasSelection,
            onClick: () => paintRef.current?.deselect(),
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
          // An opened picture comes in the right way up.
          if (file) {
            void paintRef.current?.openFile(file).then((opened) => {
              if (opened) setTurn(UPRIGHT);
            });
          }
        }}
      />
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      {PAINT_TOOLS.map((item) => (
        <Button
          key={item.id}
          variant="menu"
          size="sm"
          active={paintTool === item.id}
          aria-label={item.name}
          aria-pressed={paintTool === item.id}
          title={item.title}
          onClick={() => setPaintTool(item.id)}
        >
          {item.icon}
        </Button>
      ))}
      <Button
        variant="menu"
        size="sm"
        aria-label="Grab from the page"
        title="Grab — freeze everything and drag a box round anything on the page, or click a window, to paste it in (G)"
        onClick={() => paintRef.current?.grab()}
      >
        <GrabIcon />
      </Button>
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      <Button
        variant="menu"
        size="sm"
        disabled={!paintStatus.canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={() => paintRef.current?.undo()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
          <path d="M2 6.5a4 4 0 117 2.6" fill="none" stroke="currentColor" strokeLinecap="round" />
          <path d="M2 3.2v3.6h3.4z" fill="currentColor" />
        </svg>
      </Button>
      <Button
        variant="menu"
        size="sm"
        disabled={!paintStatus.canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        onClick={() => paintRef.current?.redo()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
          <path d="M10 6.5a4 4 0 10-7 2.6" fill="none" stroke="currentColor" strokeLinecap="round" />
          <path d="M10 3.2v3.6H6.6z" fill="currentColor" />
        </svg>
      </Button>
      <Button
        variant="menu"
        size="sm"
        disabled={!paintStatus.hasSelection}
        aria-label="Adjust colors"
        title="Adjust the selection's colors and brightness"
        onClick={() => paintRef.current?.adjustColors()}
      >
        {/* Half a sun, half its shadow: brightness and color. */}
        <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" />
          <path d="M6 1.5a4.5 4.5 0 010 9z" fill="currentColor" />
        </svg>
      </Button>
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      {PAINT_COLORS.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={`Color ${swatch}`}
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
      {/* Whatever the pencil is drawing with right now — which the dropper can
          make any color at all, not just one off the palette. */}
      <span
        aria-label={`Current color ${paintColor}`}
        title={`Current color: ${paintColor}`}
        style={{
          width: 26,
          height: 18,
          marginLeft: 4,
          flex: "0 0 auto",
          background: paintColor,
          border: "2px solid",
          borderColor: "#808080 #ffffff #ffffff #808080",
        }}
      />
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
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      <Button
        variant="menu"
        size="sm"
        aria-label="Zoom out"
        title="Zoom out (−)"
        onClick={() => paintRef.current?.zoomOut()}
      >
        &minus;
      </Button>
      <Button
        variant="menu"
        size="sm"
        aria-label={`Zoom ${Math.round(paintStatus.zoom * 100)} per cent, click for 100 per cent`}
        title="Scroll the wheel over the picture to zoom. W, A, S and D, or Space and a drag, move it about; this puts it back to 100%"
        onClick={() => paintRef.current?.zoomReset()}
      >
        <span style={{ minWidth: 34, display: "inline-block" }}>{Math.round(paintStatus.zoom * 100)}%</span>
      </Button>
      <Button
        variant="menu"
        size="sm"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={() => paintRef.current?.zoomIn()}
      >
        +
      </Button>
      <Button
        variant="menu"
        size="sm"
        active={paintMap}
        aria-pressed={paintMap}
        aria-label="Navigator"
        title="Show the whole picture in the corner whenever it doesn't all fit"
        onClick={() => setPaintMap((prev) => !prev)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" role="presentation">
          <rect x="0.5" y="1.5" width="11" height="9" fill="none" stroke="currentColor" />
          <rect x="2" y="3" width="5" height="4" fill="currentColor" />
        </svg>
      </Button>
      <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
      <Button
        variant="menu"
        size="sm"
        aria-label="Rotate"
        title="Rotate a quarter turn clockwise"
        onClick={() => setTurn(rotateRight)}
      >
        <RotateIcon />
      </Button>
      <Button
        variant="menu"
        size="sm"
        aria-label="Flip vertical"
        title="Flip upside down"
        onClick={() => setTurn(flipVertical)}
      >
        <FlipVerticalIcon />
      </Button>
      <Button
        variant="menu"
        size="sm"
        aria-label="Flip horizontal"
        title="Flip left to right"
        onClick={() => setTurn(flipHorizontal)}
      >
        <FlipHorizontalIcon />
      </Button>
    </>
  );

  return (
    <DesktopWindow {...windowFrame("paint", props)} toolbar={toolbar} turn={turn}>
      <PaintWindow
        ref={paintRef}
        color={paintColor}
        brushSize={paintBrush}
        tool={paintTool}
        onPickColor={(hex) => {
          setPaintColor(hex);
          setPaintTool("pencil");
        }}
        onStatusChange={handlePaintStatus}
        commands={paintCommands}
        map={paintMap}
        turn={turn}
      />
    </DesktopWindow>
  );
}
