"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "@/constants/zIndex";
import type { GrabRect } from "@/lib/desktopGrab";

/** Less of a drag than this, either way, counts as a click. */
const CLICK_SLOP = 4;

type Props = {
  /** Resolves once the picture is taken; the glass stays up, busy, until then. */
  onGrab: (rect: GrabRect) => Promise<void>;
  onCancel: () => void;
};

/** The window under a point, if there is one. */
function boxAt(x: number, y: number): GrabRect | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest("[data-paint-grab]")) continue;
    const win = el.closest("[data-desktop-window='true']");
    if (!win) break;
    const r = win.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return null;
}

const clampRect = (r: GrabRect): GrabRect => {
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  return {
    left,
    top,
    width: Math.min(window.innerWidth, r.left + r.width) - left,
    height: Math.min(window.innerHeight, r.top + r.height) - top,
  };
};

/**
 * paint.exe's Grab, while it's waiting for a box: a pane of glass over the
 * whole page. Drag a box round anything to take it; a plain click takes the
 * window under the pointer, outlined as the pointer goes over it. A click out
 * on the bare desktop does nothing — taking the whole page by accident is too
 * easy and too slow. Esc, or the right button, gives up.
 */
export default function PaintGrabOverlay({ onGrab, onCancel }: Props) {
  const [hover, setHover] = useState<GrabRect | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    // Capturing, so it's heard before paint.exe's own Escape — which deselects.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const take = (rect: GrabRect) => {
    const box = clampRect(rect);
    if (box.width < 1 || box.height < 1) return onCancel();
    setBusy(true);
    setHover(null);
    setDrag(null);
    void onGrab(box);
  };

  const shown: GrabRect | null = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : hover;

  return createPortal(
    <div
      data-paint-grab
      role="dialog"
      aria-label="Grab: drag a box round anything on the page, or click a window"
      // Kept to itself: React would otherwise carry these up to paint.exe's
      // picture and window, which render it, as if they'd happened there.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (e.button !== 0) return onCancel();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        if (busy) return;
        if (drag) setDrag({ ...drag, x1: e.clientX, y1: e.clientY });
        else setHover(boxAt(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (busy || !drag) return;
        const far = Math.abs(e.clientX - drag.x0) >= CLICK_SLOP || Math.abs(e.clientY - drag.y0) >= CLICK_SLOP;
        if (!far) {
          const win = boxAt(e.clientX, e.clientY);
          if (win) take(win);
          else setDrag(null);
          return;
        }
        take({
          left: Math.min(drag.x0, e.clientX),
          top: Math.min(drag.y0, e.clientY),
          width: Math.abs(e.clientX - drag.x0),
          height: Math.abs(e.clientY - drag.y0),
        });
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        setDrag(null);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.GRAB,
        cursor: busy ? "wait" : "crosshair",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {shown && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: shown.left,
            top: shown.top,
            width: shown.width,
            height: shown.height,
            boxSizing: "border-box",
            // Black dashes on a white line read over any color underneath.
            border: "1px dashed #000000",
            outline: "1px solid #ffffff",
            // Everything outside the box goes under a shade.
            boxShadow: drag ? "0 0 0 100vmax rgba(0, 0, 0, 0.25)" : undefined,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 12,
          transform: "translateX(-50%)",
          padding: "2px 6px",
          background: "#ffffe1",
          border: "1px solid #000000",
          fontSize: 12,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {busy ? "Grabbing…" : "Drag a box round anything, or click a window to grab it · Esc to cancel"}
      </div>
    </div>,
    document.body,
  );
}
