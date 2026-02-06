"use client";

import { useEffect, useState } from "react";
import { Button, Window, WindowHeader, WindowContent } from "react95";

export default function WelcomeWindow() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const width = 280;
    const height = 80;

    setPos({
      x: Math.max(0, (window.innerWidth - width) / 2),
      y: Math.max(0, (window.innerHeight - height) / 2),
    });
  }, []);

  if (!pos) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
      }}
    >
      <Window resizable style={{ width: 280 }}>
        <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>mrwr.dev</span>

          <div style={{ display: "flex", gap: 2 }}>
            <Button square size="sm" aria-label="Minimize">
              <span className="minimize-icon" />
            </Button>
            <Button square size="sm" aria-label="Maximize">
              <span className="maximize-icon" />
            </Button>
            <Button square size="sm" aria-label="Close">
              <span className="close-icon" />
            </Button>
          </div>
        </WindowHeader>

        <WindowContent>
          <p align='center'>
          coming soon
          </p>
        </WindowContent>
      </Window>
    </div>
  );
}
