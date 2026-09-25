"use client";

import React from "react";
import { Button, Window, WindowContent, WindowHeader } from "react95";

/**
 * What the keys do, and the two or three rules of the game — everything that
 * used to be strung along the toolbar in small grey type, where it made the
 * controls look like a sentence. It is a help window now, which is where a
 * program of this vintage would have put it in the first place.
 */

const KEYS: [string, string][] = [
  ["Arrows or W A S D", "roll, whichever way the camera is looking"],
  ["Space", "jump"],
  ["Q and E, or drag", "swing the camera round the ball"],
  ["R", "put the ball back and start the run over"],
];

const RULES = [
  "Spin during the countdown to gain speed.",
  "Falling off the edge does not stop the timer.",
  "The lit pad at the end is the finish.",
  "Ghost moon shows the quickest run known on this course.",
  "Use Code to share your ghost or race against another ghost.",
];

export default function MarblesHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Window style={{ width: "min(420px, 94%)", pointerEvents: "auto" }}>
      <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>How to play</span>
        <Button size="sm" square onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </WindowHeader>
      <WindowContent>
        <table style={{ borderSpacing: 0, fontSize: 12, marginBottom: 8 }}>
          <tbody>
            {KEYS.map(([key, what]) => (
              <tr key={key}>
                <th
                  scope="row"
                  style={{ textAlign: "left", fontWeight: "bold", padding: "1px 10px 1px 0", whiteSpace: "nowrap" }}
                >
                  {key}
                </th>
                <td style={{ padding: "1px 0" }}>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {RULES.map((rule) => (
          <p key={rule} style={{ fontSize: 11, lineHeight: 1.4, margin: "0 0 6px" }}>
            {rule}
          </p>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <Button onClick={onClose}>Close</Button>
        </div>
      </WindowContent>
    </Window>
  );
}
