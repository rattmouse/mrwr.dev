"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Z } from "@/constants/zIndex";
import { programDef } from "@/components/windows/programs";
import { WindowId } from "@/components/windows/windowTypes";
import { Ghost, connectGhosts, currentGhosts, ghostStatusStore, subscribeGhosts } from "@/lib/ghosts";

// How long a ghost has to sit still before it fades back.
const STILL_MS = 4000;
// The ghosts trail their real pointers by about this much, to hide the gaps
// between the server's ten-a-second updates.
const SMOOTH_MS = 70;

// Ashen, like a phantom in Dark Souls: pale grey with a faint glow, wavering a
// little, all of them alike.
const ASH_FILL = "#eeebe4";
const ASH_OUTLINE = "#3d3a35";
const ASH_GLOW = "drop-shadow(0 0 2px rgba(245, 242, 235, 0.95)) drop-shadow(0 0 6px rgba(220, 215, 205, 0.7))";
const ASH_STYLE = `
@keyframes ghost-waver {
  0%, 100% { opacity: 1; transform: translate(0, 0); }
  30% { opacity: 0.7; transform: translate(0.5px, -0.5px); }
  55% { opacity: 0.9; transform: translate(-0.5px, 0); }
  80% { opacity: 0.65; transform: translate(0, 0.5px); }
}
.ghost-cursor {
  animation: ghost-waver 2.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ghost-cursor {
    animation: none;
  }
}
`;

/** Where in the waver a ghost starts, from its id, so they don't all waver together. */
function waverDelay(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `-${(hash % 2400) / 1000}s`;
}

/** Where a ghost belongs on this screen: inside the window it's over, if that's open here too. */
function placeOf(ghost: Ghost, windows: Map<string, DOMRect>): { x: number; y: number } {
  const rect = ghost.window ? windows.get(ghost.window) : undefined;
  if (rect && ghost.wx !== undefined && ghost.wy !== undefined) {
    return { x: rect.left + ghost.wx * rect.width, y: rect.top + ghost.wy * rect.height };
  }
  return { x: ghost.x * window.innerWidth, y: ghost.y * window.innerHeight };
}

type Shown = { id: string; window?: WindowId };

/**
 * Everyone else's pointer, drifting over the desktop. Above the windows,
 * under the taskbar and anything floating, and never in the way of a click.
 */
export default function GhostCursors() {
  const { enabled } = useSyncExternalStore(ghostStatusStore.subscribe, ghostStatusStore.get, ghostStatusStore.onServer);
  const [shown, setShown] = useState<Shown[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const places = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => connectGhosts(), []);

  // Which ghosts there are, and which window each wears the icon of. Positions
  // don't go through React; the loop below moves the nodes itself.
  useEffect(() => {
    const sync = () => {
      const next = Array.from(currentGhosts(), ([id, ghost]) => ({ id, window: ghost.window }));
      setShown((prev) =>
        prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.window === next[i].window)
          ? prev
          : next,
      );
    };
    sync();
    return subscribeGhosts(sync);
  }, []);

  useEffect(() => {
    if (!enabled || !shown.length) {
      places.current.clear();
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(200, now - last);
      last = now;
      const windows = new Map<string, DOMRect>();
      document.querySelectorAll<HTMLElement>("[data-window-id]").forEach((el) => {
        if (el.dataset.windowId) windows.set(el.dataset.windowId, el.getBoundingClientRect());
      });
      const k = reduceMotion ? 1 : 1 - Math.exp(-dt / SMOOTH_MS);
      for (const [id, ghost] of currentGhosts()) {
        const node = nodes.current.get(id);
        if (!node) continue;
        const target = placeOf(ghost, windows);
        const prev = places.current.get(id);
        const place = prev ? { x: prev.x + (target.x - prev.x) * k, y: prev.y + (target.y - prev.y) * k } : target;
        places.current.set(id, place);
        node.style.transform = `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px)`;
        node.style.opacity = now - ghost.movedAt > STILL_MS ? "0.35" : "0.85";
      }
      for (const id of places.current.keys()) {
        if (!currentGhosts().has(id)) places.current.delete(id);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [enabled, shown]);

  if (!enabled || !shown.length) return null;

  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: Z.GHOSTS }}
    >
      <style>{ASH_STYLE}</style>
      {shown.map(({ id, window: windowId }) => (
        <div
          key={id}
          ref={(node) => {
            if (node) nodes.current.set(id, node);
            else nodes.current.delete(id);
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            opacity: 0,
            transition: "opacity 600ms",
            willChange: "transform",
          }}
        >
          <div className="ghost-cursor" style={{ animationDelay: waverDelay(id), filter: ASH_GLOW }}>
            <GhostArrow color={ASH_FILL} outline={ASH_OUTLINE} />
            {windowId ? (
              <img
                src={programDef(windowId).icon}
                alt=""
                width={14}
                height={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: 15,
                  imageRendering: "pixelated",
                  filter: "grayscale(1) sepia(0.15) brightness(1.15)",
                  opacity: 0.8,
                }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// The Windows arrow pointer, pixel for pixel: B is its outline, W its fill.
const ARROW = [
  "B...........",
  "BB..........",
  "BWB.........",
  "BWWB........",
  "BWWWB.......",
  "BWWWWB......",
  "BWWWWWB.....",
  "BWWWWWWB....",
  "BWWWWWWWB...",
  "BWWWWWWWWB..",
  "BWWWWWWWWWB.",
  "BWWWWWWBBBBB",
  "BWWWBWWB....",
  "BWWBBWWB....",
  "BWB..BWWB...",
  "BB...BWWB...",
  "B.....BWWB..",
  "......BWWB..",
  ".......BB...",
];

/** Each row's runs of one pixel kind, as SVG path commands. */
function arrowPath(kind: "B" | "W"): string {
  let d = "";
  ARROW.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== kind) continue;
      let end = x;
      while (row[end + 1] === kind) end += 1;
      d += `M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`;
      x = end;
    }
  });
  return d;
}

const ARROW_OUTLINE = arrowPath("B");
const ARROW_FILL = arrowPath("W");

/** The arrow pointer, filled with `color`. */
export function GhostArrow({ color, outline = "#000" }: { color: string; outline?: string }) {
  return (
    <svg width={12} height={19} viewBox="0 0 12 19" shapeRendering="crispEdges" style={{ display: "block" }}>
      <path d={ARROW_OUTLINE} fill={outline} />
      <path d={ARROW_FILL} fill={color} />
    </svg>
  );
}
