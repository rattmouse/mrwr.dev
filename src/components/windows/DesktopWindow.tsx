"use client";

import { useEffect, useState } from "react";
import { Button, Window, WindowHeader, WindowContent } from "react95";
import { Z } from "@/constants/zIndex";

type WindowId = "welcome" | "about" | "projects" | "contact";
type Layout = "normal" | "docked" | "maximized";

export default function DesktopWindow({
    id,
    layout,
    onClose,
    onMinimize,
    onRestore,
    onToggleMaximize,
  }: {
    id: WindowId;
    layout: Layout;
    onClose: () => void;
    onMinimize: () => void;
    onRestore: () => void;
    onToggleMaximize: () => void;
  }) {
  const TASKBAR_H = 50;
  const GAP = 8;

    const title =
      id === "contact" ? "Contact" :
      id === "about" ? "About" :
      id === "projects" ? "Projects" :
      "mrwr.dev";

    const isMax = layout === "maximized";
    const isDocked = layout === "docked";

    const style: React.CSSProperties = isMax
  ? {
      position: "absolute",
      top: TASKBAR_H,
      left: 0,
      width: "100vw",
      height: `calc(100vh - ${TASKBAR_H}px)`,
      zIndex: Z.WINDOW,
    }
  : isDocked
  ? {
      position: "absolute",
      right: GAP,
      bottom: GAP,
      width: 200,
      height: 60,
      zIndex: Z.WINDOW,
    }
  : {
      position: "absolute",
      left: "50%",
      top: `calc(50% + ${TASKBAR_H / 2}px)`, // shifts center down a bit
      transform: "translate(-50%, -50%)",
      width: 280,
      height: 100,
      zIndex: Z.WINDOW,
    };

  return (

      <Window style={style}>
        <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{title}</span>

          <div style={{ display: "flex", gap: 2 }}>
            <Button   onClick={() => {
    // if already docked, restore; otherwise dock
    if (layout === "docked") onRestore();
    else onMinimize();
  }} square size="sm" aria-label="Minimize">
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
        <WindowContent>
          {id === "welcome" && <div>coming soon…</div>}
          {id === "about" &&
            <div>
            web app created by Matt Rouse
            </div>}
          {id === "projects" && <div>github.com/rattmouse</div>}
          {id === "contact" && <div>rattmouse@pm.me</div>}
        </WindowContent>
      </Window>

  );
}
