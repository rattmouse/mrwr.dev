"use client";

import React from "react";
import { Anchor } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";

export default function WelcomeProgram(props: ProgramProps) {
  return (
    <DesktopWindow {...windowFrame("welcome", props)}>
      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "stretch",
        }}
      >
        <div style={{ textAlign: "center" }}>coming soon…</div>
        <div style={{ textAlign: "left", marginTop: 6 }}>
          you can help:
          <ul>
            <li>- found a bug? let me know!</li>
            <li>- type brief description in search bar</li>
            <li>
              - buy me a{" "}
              <Anchor href="https://buymeacoffee.com/rattmouse" target="_blank">
                ☕
              </Anchor>
            </li>
          </ul>
        </div>
      </div>
    </DesktopWindow>
  );
}
