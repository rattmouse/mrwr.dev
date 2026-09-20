"use client";

import React, { useEffect, useRef } from "react";
import { panelButton } from "@/components/windows/PartyControls";
import { logTime, type PartyLog } from "@/lib/usePartyLog";

/**
 * party.webp's Console panel: a teletype of what the window has been up to —
 * who joined the party, what you moved and where you moved it to, and when
 * everyone walked off. It reads back like a status log because that is the
 * joke: this is a real application, and real applications keep one.
 *
 * It follows the bottom of the log unless you have scrolled up to read
 * something, which would be a poor sort of log to have to fight.
 */
export default function PartyConsole({ log, accent }: { log: PartyLog; accent: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);

  useEffect(() => {
    const box = ref.current;
    if (!box || !following.current) return;
    box.scrollTop = box.scrollHeight;
  }, [log.lines]);

  return (
    <>
      <div
        ref={ref}
        onScroll={(e) => {
          const box = e.currentTarget;
          following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        }}
        style={{
          height: 188,
          overflowY: "auto",
          padding: "7px 9px",
          borderRadius: 9,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(0, 0, 0, 0.32)",
          font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          color: "rgba(232, 236, 244, 0.82)",
          overflowWrap: "anywhere",
        }}
      >
        <style>{`
          @keyframes party-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
          @media (prefers-reduced-motion: reduce) {
            .party-caret { animation: none !important; }
          }
        `}</style>
        {log.lines.map((line) => (
          <div key={line.id} style={{ display: "flex", gap: 7 }}>
            <span style={{ color: "rgba(232, 236, 244, 0.35)", flex: "0 0 auto" }}>
              {logTime(line.at)}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
        <span
          className="party-caret"
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 11,
            verticalAlign: "-1px",
            background: accent,
            animation: "party-caret 1060ms steps(1) infinite",
          }}
        />
      </div>
      <button
        type="button"
        onClick={log.clear}
        style={{ ...panelButton, opacity: log.lines.length > 0 ? 1 : 0.4 }}
      >
        Clear log
      </button>
    </>
  );
}
