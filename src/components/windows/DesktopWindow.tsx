"use client";

import React from "react";
import {
  Anchor,
  Button,
  ScrollView,
  Window,
  WindowHeader,
  WindowContent,
} from "react95";
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
    id === "contact"
      ? "Contact"
      : id === "about"
        ? "About"
        : id === "projects"
          ? "Projects"
          : "mrwr.dev";

  const isMax = layout === "maximized";
  const isDocked = layout === "docked";
  const isDocument = id === "contact" || id === "about";

  // Tune these to match your real taskbar size + desired margins
  const TASKBAR_H = 50;
  const GAP = 16;

  const NORMAL_W = 280;
  const NORMAL_H = isDocument ? 200 : 100;

  const DOCK_W = 200;
  const DOCK_H = 60;

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
    }
    : isDocked
      ? {
        position: "absolute",
        left: GAP,
        bottom: GAP,
        width: DOCK_W,
        height: DOCK_H,
        zIndex: Z.WINDOW,
        display: "flex",
        flexDirection: "column",
      }
      : {
        position: "absolute",
        left: "50%",
        top: `calc(50% + ${TASKBAR_H / 2}px)`,
        transform: "translate(-50%, -50%)",
        width: NORMAL_W,
        height: NORMAL_H,
        zIndex: Z.WINDOW,
        display: "flex",
        flexDirection: "column",
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

      {!isDocked && (
        <WindowContent
          // Key: let content be the remaining height, and allow it to shrink
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {id === "welcome" && (
            <div>
              coming soon…{" "}
              <Anchor href="https://buymeacoffee.com/rattmouse" target="_blank">
                ☕
              </Anchor>
            </div>
          )}

          {id === "projects" && <div>github.com/rattmouse</div>}

          {(id === "about" || id === "contact") && (
            // This wrapper is what actually controls the scroll area size
            <div style={{ flex: "1 1 auto", minHeight: 0 }}>
              <ScrollView style={{ width: "100%", height: "100%" }}>
                {id === "about" && (
                  <>
                    <h1>web app created by Matt Rouse</h1>
                    <ul>
                      <li>
                        - ui created with{" "}
                        <Anchor href="https://react95.io/" target="_blank">
                          react95
                        </Anchor>
                      </li>
                      <li>
                        - built with{" "}
                        <Anchor href="https://nextjs.org/" target="_blank">
                          Next.js
                        </Anchor>{" "}
                        &{" "}
                        <Anchor href="https://react.dev/" target="_blank">
                          React
                        </Anchor>
                      </li>
                      <li>
                        - deployed on{" "}
                        <Anchor href="https://www.digitalocean.com/" target="_blank">
                          DigitalOcean
                        </Anchor>
                      </li>
                                            <li>
                        - some help from{" "}
                        <Anchor href="https://chatgpt.com/" target="_blank">
                          Chat GPT
                        </Anchor>
                      </li>
                    </ul>
                  </>
                )}

                {id === "contact" && (
                  <>
                    <h1>contact links:</h1>
                    <ul>
                      <li>
                        -{" "}
                        <Anchor href="https://t.me/rattmouse" target="_blank">
                          Telegram
                        </Anchor>
                      </li>
                      <li>
                        -{" "}
                        <Anchor href="https://signal.me/#eu/rattmouse.113" target="_blank">
                          Signal
                        </Anchor>
                      </li>
                      <li>
                        -{" "}
                        <Anchor href="mailto:rattmouse@pm.me" target="_blank">
                          rattmouse@pm.me
                        </Anchor>
                      </li>
                    </ul>
                    <br />
                    <h1>social links:</h1>
                    <ul>
                      <li>
                        -{" "}
                        <Anchor href="https://instagram.com/ratt.mouse" target="_blank">
                          Instagram
                        </Anchor>
                      </li>
                      <li>
                        -{" "}
                        <Anchor href="https://www.linkedin.com/in/rattmouse/" target="_blank">
                          LinkedIn
                        </Anchor>
                      </li>
                      <li>
                        -{" "}
                        <Anchor href="https://discord.com/channels/@rattmouse" target="_blank">
                          Discord
                        </Anchor>
                      </li>
                    </ul>
                  </>
                )}
              </ScrollView>
            </div>
          )}
        </WindowContent>
      )}
    </Window>
  );
}
