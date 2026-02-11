"use client";

import React from "react";
import { Button, Toolbar, Window, WindowContent, WindowHeader } from "react95";
import { Z } from "@/constants/zIndex";
import { Layout } from "@/components/windows/windowTypes";

type DesktopWindowProps = {
  title: string;
  layout: Layout;
  normalWidth?: number;
  normalHeight: number;
  normalPosition?: "center" | "topRightQuadrantCenter";
  effectOutline?: number;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
};

export default function DesktopWindow({
  title,
  layout,
  normalWidth = 280,
  normalHeight,
  normalPosition = "center",
  effectOutline = 0,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
  toolbar,
  children,
}: DesktopWindowProps) {
  const isMax = layout === "maximized";
  const isDocked = layout === "docked";

  const TASKBAR_H = 50;
  const GAP = 8;

  const NORMAL_W = normalWidth;
  const DOCK_W = 200;
  const DOCK_H = 60;
  const TITLE_CHAR_PX = 10;
  const DOCK_BASE_CHROME_PX = 124; // tighter header padding + 3 control buttons
  const dockWidth = Math.max(DOCK_W, DOCK_BASE_CHROME_PX + title.length * TITLE_CHAR_PX);
  const normalLeft = normalPosition === "topRightQuadrantCenter" ? "75vw" : "50%";
  const normalTop = normalPosition === "topRightQuadrantCenter" ? `calc(25vh + ${TASKBAR_H / 2}px)` : `calc(50% + ${TASKBAR_H / 2}px)`;
  const outline = Math.max(0, Math.min(1, effectOutline));
  const frameShadow =
    outline > 0
      ? `0 0 ${5 + 12 * outline}px rgba(0, 255, 186, ${0.2 + 0.28 * outline}), 0 0 0 1px rgba(0, 255, 186, ${0.25 + 0.5 * outline})`
      : undefined;

  const style: React.CSSProperties = isMax
    ? {
        position: "absolute",
        top: TASKBAR_H + GAP,
        left: GAP,
        width: `calc(100vw - ${GAP * 2}px)`,
        height: `calc(100vh - ${TASKBAR_H + GAP * 2}px)`,
        zIndex: Z.WINDOW,
        display: "flex",
        flexDirection: "column",
        boxShadow: frameShadow,
      }
    : isDocked
      ? {
          position: "absolute",
          left: GAP,
          bottom: GAP,
          width: dockWidth,
          height: DOCK_H,
          zIndex: Z.WINDOW,
          display: "flex",
          flexDirection: "column",
          boxShadow: frameShadow,
        }
      : {
          position: "absolute",
          left: normalLeft,
          top: normalTop,
          transform: "translate(-50%, -50%)",
          width: NORMAL_W,
          height: normalHeight,
          zIndex: Z.WINDOW,
          display: "flex",
          flexDirection: "column",
          boxShadow: frameShadow,
        };

  return (
    <Window style={style}>
      <WindowHeader
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flex: "0 0 auto",
        }}
      >
        <span>{title}</span>

        <div style={{ display: "flex", gap: 2 }}>
          <Button
            onClick={() => {
              if (layout === "docked") onRestore();
              else onMinimize();
            }}
            square
            size="sm"
            aria-label="Minimize"
          >
            <span className="minimize-icon" />
          </Button>
          <Button onClick={onToggleMaximize} square size="sm" aria-label="Maximize">
            <span className="maximize-icon" />
          </Button>
          <Button onClick={onClose} square size="sm" aria-label="Close">
            <span className="close-icon" />
          </Button>
        </div>
      </WindowHeader>

      {toolbar && !isDocked && (
        <Toolbar
          style={{
            padding: "1px 1px",
            marginBottom: 0,
            gap: 2,
          }}
        >
          {toolbar}
        </Toolbar>
      )}

      {!isDocked && (
        <WindowContent
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            padding: 6,
            gap: 2,
          }}
        >
          {children}
        </WindowContent>
      )}
    </Window>
  );
}
