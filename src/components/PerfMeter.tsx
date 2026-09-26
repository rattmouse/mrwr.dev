"use client";

import React, { useEffect, useRef, useState } from "react";
import { Frame } from "react95";
import { Z } from "@/constants/zIndex";

// How many frames the graph remembers, and how often the numbers are redrawn.
// The graph paints straight from the animation loop; only the text goes through
// React, and only a couple of times a second, so the meter doesn't become the
// thing slowing the page down.
const HISTORY = 60;
const READOUT_MS = 500;
// A frame over this long is one you'd notice — a hitch, not just a slow patch.
const LONG_FRAME_MS = 50;
const GRAPH_W = 44;
const GRAPH_H = 18;

type Readout = {
  fps: number;
  avgMs: number;
  worstMs: number;
  longFrames: number;
  heapMb: number | null;
  heapLimitMb: number | null;
  domNodes: number;
};

// Chromium alone reports the JS heap; everywhere else that row just says so.
type MemoryInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number };

function health(fps: number): { color: string; label: string } {
  if (fps >= 50) return { color: "#008000", label: "smooth" };
  if (fps >= 30) return { color: "#b07800", label: "slowing" };
  return { color: "#c00000", label: "struggling" };
}

/**
 * The taskbar's tray gauge: frames per second, with a little graph of how long
 * each recent frame took. Click it for the rest — frame times, hitches, memory,
 * how much page there is — so it's easy to tell when a deskful of windows has
 * started to drag.
 */
export default function PerfMeter({ windowCount }: { windowCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frames: number[] = [];
    let last = performance.now();
    let lastReadout = last;
    let raf = 0;
    let tick = 0;

    const paint = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, GRAPH_W, GRAPH_H);
      // One bar per frame, scaled so a 60fps frame sits a third of the way up
      // and anything past 50ms hits the ceiling.
      const barW = GRAPH_W / HISTORY;
      frames.forEach((ms, i) => {
        const h = Math.min(GRAPH_H, (ms / LONG_FRAME_MS) * GRAPH_H);
        ctx.fillStyle = ms > LONG_FRAME_MS ? "#ff3030" : ms > 33.4 ? "#ffc000" : "#00e060";
        ctx.fillRect(i * barW, GRAPH_H - h, Math.max(1, barW), h);
      });
    };

    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      // A backgrounded tab stops the loop for as long as it's hidden; that gap
      // is the browser resting, not the page stalling, so it isn't counted.
      if (dt < 1000) {
        frames.push(dt);
        if (frames.length > HISTORY) frames.shift();
      }
      tick += 1;
      if (tick % 4 === 0) paint();

      if (now - lastReadout >= READOUT_MS && frames.length > 0) {
        lastReadout = now;
        const total = frames.reduce((a, b) => a + b, 0);
        const avgMs = total / frames.length;
        const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
        setReadout({
          fps: Math.round(1000 / avgMs),
          avgMs,
          worstMs: Math.max(...frames),
          longFrames: frames.filter((ms) => ms > LONG_FRAME_MS).length,
          heapMb: memory ? memory.usedJSHeapSize / 1048576 : null,
          heapLimitMb: memory ? memory.jsHeapSizeLimit / 1048576 : null,
          domNodes: document.getElementsByTagName("*").length,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const state = readout ? health(readout.fps) : null;

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 auto", marginRight: 6 }}>
      <Frame
        variant="status"
        role="button"
        tabIndex={0}
        aria-label={readout ? `${readout.fps} frames per second, ${state?.label}` : "Performance"}
        title="Performance — click for details"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          height: 30,
          padding: "0 6px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          className="perf-meter-graph"
          width={GRAPH_W}
          height={GRAPH_H}
          aria-hidden
          style={{ width: GRAPH_W, height: GRAPH_H, imageRendering: "pixelated" }}
        />
        <span
          style={{
            textAlign: "right",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            color: state?.color,
            fontWeight: "bold",
          }}
        >
          {readout ? `${readout.fps} fps` : "-- fps"}
        </span>
      </Frame>

      {open && readout && (
        <Frame
          variant="window"
          shadow
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: Z.START_MENU,
            padding: 8,
            width: 220,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            Performance · <span style={{ color: state?.color }}>{state?.label}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
            <tbody>
              {[
                ["Frame rate", `${readout.fps} fps`],
                ["Avg frame", `${readout.avgMs.toFixed(1)} ms`],
                ["Worst frame", `${readout.worstMs.toFixed(1)} ms`],
                [`Hitches (>${LONG_FRAME_MS}ms)`, `${readout.longFrames} / ${HISTORY}`],
                [
                  "JS heap",
                  readout.heapMb == null
                    ? "n/a in this browser"
                    : `${readout.heapMb.toFixed(0)} / ${readout.heapLimitMb?.toFixed(0)} MB`,
                ],
                ["Page elements", readout.domNodes.toLocaleString()],
                ["Open windows", String(windowCount)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "1px 0" }}>{k}</td>
                  <td style={{ padding: "1px 0", textAlign: "right" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
      )}
    </div>
  );
}
