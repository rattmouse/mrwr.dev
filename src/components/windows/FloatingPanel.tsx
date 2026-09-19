"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Window, WindowHeader } from "react95";
import { framesLit, lightStyles, type FrameLights } from "@/components/windows/FrameLights";
import { meltStyle } from "@/components/windows/MeltFilter";
import { Z } from "@/constants/zIndex";

const TASKBAR_H = 50;
const MARGIN = 8;

export type FloatingPanelProps = {
  title: string;
  /** Where the panel first appears, in viewport px. */
  initial: { x: number; y: number };
  width: number;
  /** Higher panels sit on top of lower ones; all of them sit above the window. */
  stackIndex: number;
  onFocus: () => void;
  onClose: () => void;
  /**
   * Put the tool window in the same frame the desktop's programs wear — border
   * and title bar both. Only the frame: what sits inside it stays modern.
   */
  dressed?: boolean;
  /** The frame's lights, so a dressed panel lights up on the same beat as it does. */
  lights?: FrameLights;
  /** 0–1 of the frame's warp, so a dressed panel goes out of true along with it. */
  melt?: number;
  /**
   * Where the panel ended up after a drag. The window that opened it keeps
   * these, so closing a panel and opening it again brings it back where it was
   * left rather than back to the slot it started in.
   */
  onMoved?: (at: { x: number; y: number }) => void;
  children: React.ReactNode;
};

/**
 * A tool window for interface.exe. It escapes its parent window entirely — it
 * portals to the document body, so it drags anywhere on the desktop and always
 * paints over the window that opened it. Unlike the Windows 95 frames, it moves
 * live under the pointer rather than trailing a dotted outline: the chrome in
 * here is modern, so the handling is too.
 *
 * `dressed` puts it in the desktop's own frame — the 95 border and title bar,
 * square corners, control button and all — and stops at the frame: the sliders,
 * swatches and readouts inside it stay modern whichever frame is around them.
 * The window it came out of is the same trick in reverse, and the toggle for it
 * is in that window's Frame panel. A panel wearing the frame does whatever the
 * frame does — it lights up with it, and it warps with it.
 */
export default function FloatingPanel({
  title,
  initial,
  width,
  stackIndex,
  onFocus,
  onClose,
  dressed = false,
  lights,
  melt = 0,
  onMoved,
  children,
}: FloatingPanelProps) {
  const [pos, setPos] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const clampToDesktop = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const el = panelRef.current;
    const w = el?.offsetWidth ?? width;
    const h = el?.offsetHeight ?? 0;

    // The whole panel stays on the desktop whenever it fits there; when it is
    // taller or wider than the space left, it pins to the top-left of it rather
    // than sliding out of reach.
    const minX = MARGIN;
    const maxX = Math.max(MARGIN, window.innerWidth - MARGIN - w);
    const minY = TASKBAR_H + MARGIN;
    const maxY = Math.max(minY, window.innerHeight - MARGIN - h);
    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  }, [width]);

  // Nothing can be clamped until the panel has been measured, so the same
  // observer does both jobs: it settles a panel that opened near an edge, and it
  // pulls one back into view when the desktop — or the panel — changes size
  // under it.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const reclamp = () => setPos((p) => clampToDesktop(p.x, p.y));
    const observer = new ResizeObserver(reclamp);
    observer.observe(el);
    window.addEventListener("resize", reclamp);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, [clampToDesktop]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    onFocus();
    setDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const base = { ...pos };
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    // Where the drag has got to, kept alongside the state so that finishing can
    // report the landing spot without waiting for a render to read it back.
    let latest = base;
    const onMove = (ev: PointerEvent) => {
      latest = clampToDesktop(base.x + ev.clientX - startX, base.y + ev.clientY - startY);
      setPos(latest);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.body.style.userSelect = prevSelect;
      setDragging(false);
      if (!commit) {
        setPos(base);
        return;
      }
      // A click on the title bar that never moved is not worth remembering.
      if (latest.x !== base.x || latest.y !== base.y) onMoved?.(latest);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  };

  // Same guard the rest of the desktop's portals use: nothing here is ever part
  // of the server-rendered page.
  if (typeof document === "undefined") return null;

  // Its own soft edge, worn only when it is not in the desktop's frame.
  const softSkin: React.CSSProperties = {
    borderRadius: 12,
    overflow: "hidden",
    background: "rgba(18, 20, 27, 0.86)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: dragging ? "0 24px 60px rgba(0, 0, 0, 0.55)" : "0 12px 32px rgba(0, 0, 0, 0.4)",
    transition: dragging ? undefined : "box-shadow 140ms ease",
  };

  const softHeader = (
    <header
        onPointerDown={startDrag}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "9px 10px 9px 13px",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.03)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: "rgba(232, 236, 244, 0.72)",
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          style={{
            width: 22,
            height: 22,
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            border: "1px solid transparent",
            background: "transparent",
            color: "rgba(232, 236, 244, 0.6)",
            cursor: "pointer",
            font: "inherit",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(232, 236, 244, 0.6)";
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
    </header>
  );

  const body = (
    <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 13 }}>{children}</div>
  );

  // Dressed, the 95 frame is the whole of the borrowed costume — and it is lit
  // exactly as the window's own is, or a panel sitting on a flashing desktop
  // would be the one dead thing on it. Inside, the panel keeps its own dark
  // interior: nothing in here turns into a grey dialog.
  const light = dressed && framesLit(lights) && lights ? lightStyles(lights) : null;

  const framed = (
    <Window
      style={{
        width: "100%",
        padding: 2,
        boxShadow: light?.frame.boxShadow,
        ...(dressed ? meltStyle(melt) : null),
      }}
    >
      <WindowHeader
        onPointerDown={startDrag}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          ...light?.header,
        }}
      >
        <span>{title}</span>
        <Button square size="sm" onClick={onClose} aria-label={`Close ${title}`}>
          <span className="close-icon" />
        </Button>
      </WindowHeader>
      <div style={{ overflow: "hidden", background: "#12141b" }}>{body}</div>
    </Window>
  );

  return createPortal(
    <section
      ref={panelRef}
      onPointerDown={onFocus}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width,
        maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
        zIndex: Z.FLOATING + stackIndex,
        boxSizing: "border-box",
        color: "#e8ecf4",
        font: "13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        ...(dressed ? null : softSkin),
      }}
    >
      {dressed ? (
        framed
      ) : (
        <>
          {softHeader}
          {body}
        </>
      )}
    </section>,
    document.body,
  );
}
