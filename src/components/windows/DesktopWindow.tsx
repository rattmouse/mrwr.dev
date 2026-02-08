"use client";

import { useEffect, useState } from "react";
import { Anchor, Button, ScrollView, Window, WindowHeader, WindowContent } from "react95";
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


  const title =
    id === "contact" ? "Contact" :
      id === "about" ? "About" :
        id === "projects" ? "Projects" :
          "mrwr.dev";

  const isMax = layout === "maximized";
  const isDocked = layout === "docked";
  const isDocument = id === "contact" || id === "about";

  const WINDOW_W = 280;
  const DOCK_W = 200;
  const WINDOW_H = isDocument ? 200 : 100;
  const DOCK_H = 60;
  const TASKBAR_H = 50;
  const GAP = 16;

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
        left: GAP,
        bottom: GAP,
        width: DOCK_W,
        height: DOCK_H,
        zIndex: Z.WINDOW,
      }
      : {
        position: "absolute",
        left: "50%",
        top: `calc(50% + ${TASKBAR_H / 2}px)`, // shifts center down a bit
        transform: "translate(-50%, -50%)",
        width: WINDOW_W,
        height: WINDOW_H,
        zIndex: Z.WINDOW,
      };

  return (

    <Window style={style}>
      <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{title}</span>

        <div style={{ display: "flex", gap: 2 }}>
          <Button onClick={() => {
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
        {id === "welcome" && 
        <div>
          coming soon…
          <Anchor href='https://buymeacoffee.com/rattmouse' target='_blank'>
            ☕
          </Anchor>
        </div>}
        {id === "about" &&
          <div>
            <ScrollView style={{ width: WINDOW_W - 44, height: WINDOW_H - 80}}>
            <h1>web app created by Matt Rouse</h1>
            <ul>
              <li> - ui created with {' '}
              <Anchor href='https://react95.io/' target='_blank'>
                react95
              </Anchor>
              </li>
              <li> - built with {' '}
              <Anchor href='https://nextjs.org/' target='_blank'>
                Next.js
              </Anchor> & {' '}
              <Anchor href='https://react.dev/' target='_blank'>
                React
              </Anchor>
              </li>
              <li> - deployed on {' '}
              <Anchor href='https://www.digitalocean.com/' target='_blank'>
                DigitalOcean
              </Anchor>
              </li>
            </ul>
          </ScrollView>
          </div>}
        {id === "projects" && <div>github.com/rattmouse</div>}
        {id === "contact" &&
          <div>
            <ScrollView style={{ width: WINDOW_W - 44, height: WINDOW_H - 80}}>
            <h1>contact links:</h1>
            <ul>
              <li> - {' '}
              <Anchor href='https://t.me/rattmouse' target='_blank'>
                Telegram
              </Anchor>
              </li>
              <li> - {' '}
              <Anchor href='https://signal.me/#eu/rattmouse.113' target='_blank'>
                Signal
              </Anchor>
              </li>
              <li> - {' '}
              <Anchor href='mailto:rattmouse@pm.me' target='_blank'>
                rattmouse@pm.me
              </Anchor>
              </li>
            </ul>
            <br />
            <h1>social links:</h1>
            <ul>
              <li> - {' '}
              <Anchor href='https://instagram.com/ratt.mouse' target='_blank'>
                Instagram
              </Anchor>
              </li>
              <li> - {' '}
              <Anchor href='https://www.linkedin.com/in/rattmouse/' target='_blank'>
                LinkedIn
              </Anchor>
              </li>
              <li> - {' '}
              <Anchor href='https://discord.com/channels/@rattmouse' target='_blank'>
                Discord
              </Anchor>
              </li>
            </ul>
            </ScrollView>
          </div>}
      </WindowContent>
    </Window>

  );
}
