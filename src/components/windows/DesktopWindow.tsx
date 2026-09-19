"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, Toolbar, Window, WindowContent, WindowHeader } from "react95";
import { Z } from "@/constants/zIndex";
import MeltFilter, { MELT_FILTER_ID, meltStyle } from "@/components/windows/MeltFilter";
import FrameLightsStyle, { framesLit, lightStyles, type FrameLights } from "@/components/windows/FrameLights";
import { Layout } from "@/components/windows/windowTypes";

type DesktopWindowProps = {
  title: string;
  titleIcon?: string;
  layout: Layout;
  normalWidth?: number;
  normalHeight: number;
  normalPosition?: "center" | "topRightQuadrantCenter";
  effectOutline?: number;
  jitterX?: number;
  jitterY?: number;
  titleJitterX?: number;
  titleJitterY?: number;
  toolbarJitterX?: number;
  toolbarJitterY?: number;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
  controlsDisabled?: boolean;
  /**
   * 0–1: pulls the whole frame out of true, corners first — driven by
   * interface.exe's Frame panel.
   */
  melt?: number;
  /**
   * Colour, breath and flash on the frame's own chrome — also the Frame
   * panel's doing. Undefined, or dark, leaves it as plain Windows 95.
   */
  lights?: FrameLights;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
};

export default function DesktopWindow({
  title,
  titleIcon,
  layout,
  normalWidth = 280,
  normalHeight,
  normalPosition = "center",
  effectOutline = 0,
  jitterX = 0,
  jitterY = 0,
  titleJitterX = 0,
  titleJitterY = 0,
  toolbarJitterX = 0,
  toolbarJitterY = 0,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
  controlsDisabled = false,
  melt,
  lights,
  toolbar,
  children,
}: DesktopWindowProps) {
  const isMax = layout === "maximized";
  const isDocked = layout === "docked";

  const TASKBAR_H = 50;
  const GAP = 8;
  const MIN_W = 220;
  const MIN_H = 130;

  // In the normal layout the window is centred with a transform. The first
  // finished drag — of the title bar or of the resize grip — freezes it to an
  // explicit top-left + size; this override is cleared whenever the layout
  // changes or a different window takes over the frame, so positions and sizes
  // never persist.
  type Box = { left: number; top: number; width: number; height: number };
  const [box, setBox] = useState<Box | null>(null);
  // Like Windows 95, a drag doesn't move the window itself: a dotted outline
  // follows the pointer and the window jumps there when you let go. Escape (or a
  // cancelled pointer) drops the outline and leaves the window where it was.
  const [ghost, setGhost] = useState<Box | null>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBox(null);
    setGhost(null);
  }, [layout, title, normalWidth, normalHeight]);

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  // Enough of the title bar has to stay reachable that you can always grab it
  // back — dragging a window off an edge, or up under the taskbar, would
  // strand it there.
  const KEEP_ON_SCREEN = 60;

  const trackOutline = (
    e: React.PointerEvent<HTMLDivElement>,
    frame: HTMLElement,
    cursor: string,
    place: (base: Box, dx: number, dy: number) => Box,
  ) => {
    e.preventDefault();

    const rect = frame.getBoundingClientRect();
    const base = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const startX = e.clientX;
    const startY = e.clientY;
    let latest: Box | null = null;

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = cursor;

    const onMove = (ev: PointerEvent) => {
      latest = place(base, ev.clientX - startX, ev.clientY - startY);
      setGhost(latest);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      setGhost(null);
      if (commit && latest) setBox(latest);
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

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMax || isDocked || controlsDisabled) return;
    // The title-bar controls are buttons first and drag handles never.
    if ((e.target as HTMLElement).closest("button")) return;
    const frame = headerRef.current?.parentElement;
    if (!frame) return;

    trackOutline(e, frame, "grabbing", (base, dx, dy) => {
      const minLeft = KEEP_ON_SCREEN - base.width;
      const maxLeft = window.innerWidth - KEEP_ON_SCREEN;
      const headerH = headerRef.current?.offsetHeight ?? 30;
      const maxTop = window.innerHeight - headerH;
      return {
        ...base,
        left: clamp(base.left + dx, minLeft, maxLeft),
        top: clamp(base.top + dy, TASKBAR_H, maxTop),
      };
    });
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMax || isDocked || controlsDisabled) return;
    const frame = gripRef.current?.parentElement;
    if (!frame) return;

    trackOutline(e, frame, "nwse-resize", (base, dx, dy) => {
      const maxW = Math.max(MIN_W, window.innerWidth - base.left - GAP);
      const maxH = Math.max(MIN_H, window.innerHeight - base.top - GAP);
      return {
        ...base,
        width: clamp(base.width + dx, MIN_W, maxW),
        height: clamp(base.height + dy, MIN_H, maxH),
      };
    });
  };

  const NORMAL_W = normalWidth;
  const DOCK_W = 200;
  const DOCK_H = 60;
  const TITLE_CHAR_PX = 10;
  const DOCK_BASE_CHROME_PX = 124; // tighter header padding + 3 control buttons
  const TITLE_ICON_PX = titleIcon ? 22 : 0;
  const dockWidth = Math.max(DOCK_W, DOCK_BASE_CHROME_PX + TITLE_ICON_PX + title.length * TITLE_CHAR_PX);
  const normalLeft = normalPosition === "topRightQuadrantCenter" ? "75vw" : "50%";
  const normalTop = normalPosition === "topRightQuadrantCenter" ? `calc(25vh + ${TASKBAR_H / 2}px)` : `calc(50% + ${TASKBAR_H / 2}px)`;
  const outline = Math.max(0, Math.min(1, effectOutline));
  // A melting frame loses its corners before it loses its edges, and the whole
  // thing warps out of true — the window stops being a rectangle rather than
  // growing something off the bottom of one.
  const meltAmount = Math.max(0, Math.min(1, melt ?? 0));
  const frameShadow =
    outline > 0
      ? `0 0 ${5 + 12 * outline}px rgba(0, 255, 186, ${0.2 + 0.28 * outline}), 0 0 0 1px rgba(0, 255, 186, ${0.25 + 0.5 * outline})`
      : undefined;

  // The lit frame's halo is one more shadow on the same box, so it stacks with
  // whatever the effect outline is already casting rather than replacing it.
  const isLit = framesLit(lights);
  const light = isLit && lights ? lightStyles(lights) : null;
  const boxShadow = [frameShadow, light?.frame.boxShadow].filter(Boolean).join(", ") || undefined;

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
        boxShadow,
      }
    : isDocked
      ? {
          position: "absolute",
          left: GAP,
          bottom: GAP,
          width: dockWidth,
          height: DOCK_H,
          zIndex: Z.WINDOW,
          display: "flex",
          flexDirection: "column",
          boxShadow,
        }
      : box
        ? {
            position: "absolute",
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            zIndex: Z.WINDOW,
            display: "flex",
            flexDirection: "column",
            boxShadow,
          }
        : {
            position: "absolute",
            left: normalLeft,
            top: normalTop,
            transform: `translate(calc(-50% + ${jitterX}px), calc(-50% + ${jitterY}px))`,
            width: NORMAL_W,
            height: normalHeight,
            // A window's natural size is a wish, not a promise: on a phone the
            // screen is narrower than any of them, and a window centred at its
            // full width hangs off both edges with its controls out of reach.
            maxWidth: `calc(100vw - ${GAP * 2}px)`,
            maxHeight: `calc(100vh - ${TASKBAR_H + GAP * 2}px)`,
            zIndex: Z.WINDOW,
            display: "flex",
            flexDirection: "column",
            boxShadow,
          };

  Object.assign(style, meltStyle(meltAmount));

  // The grip lives in its own corner gutter so it never lands on a scrollbar or
  // content edge. The gutter tracks the layout only (not controlsDisabled) so
  // toggling the title-bar controls doesn't reflow the window body.
  const hasResizeGutter = !isMax && !isDocked;
  // The title bar drags and the grip resizes under exactly the same conditions.
  const isDraggable = hasResizeGutter && !controlsDisabled;
  const showResizeGrip = isDraggable;

  return (
    <>
    {meltAmount > 0 && <MeltFilter id={MELT_FILTER_ID} amount={meltAmount} />}
    {isLit && lights && <FrameLightsStyle lights={lights} />}
    {ghost && (
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: ghost.left,
          top: ghost.top,
          width: ghost.width,
          height: ghost.height,
          zIndex: Z.WINDOW + 1,
          pointerEvents: "none",
          boxSizing: "border-box",
          padding: 3,
          // A hollow frame of 1px checkerboard, inverted against whatever is
          // underneath — the old XOR drag rectangle.
          background: "repeating-conic-gradient(#fff 0 25%, transparent 0 50%) 0 0 / 2px 2px",
          mixBlendMode: "difference",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
        }}
      />
    )}
    <Window style={style}>
      <WindowHeader
        ref={headerRef}
        onPointerDown={startDrag}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flex: "0 0 auto",
          cursor: isDraggable ? "grab" : undefined,
          touchAction: isDraggable ? "none" : undefined,
          ...light?.header,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            transform: `translate(${titleJitterX}px, ${titleJitterY}px)`,
          }}
        >
          {titleIcon ? <img src={titleIcon} alt="" width={14} height={14} aria-hidden /> : null}
          <span>{title}</span>
        </span>

        <div style={{ display: "flex", gap: 2 }}>
          <Button
            onClick={() => {
              if (layout === "docked") onRestore();
              else onMinimize();
            }}
            disabled={controlsDisabled}
            square
            size="sm"
            aria-label="Minimize"
            style={controlsDisabled ? { opacity: 0.5 } : undefined}
          >
            <span className="minimize-icon" />
          </Button>
          <Button
            onClick={onToggleMaximize}
            disabled={controlsDisabled}
            square
            size="sm"
            aria-label="Maximize"
            style={controlsDisabled ? { opacity: 0.5 } : undefined}
          >
            <span className="maximize-icon" />
          </Button>
          <Button onClick={onClose} disabled={controlsDisabled} square size="sm" aria-label="Close" style={controlsDisabled ? { opacity: 0.5 } : undefined}>
            <span className="close-icon" />
          </Button>
        </div>
      </WindowHeader>

      {toolbar && !isDocked && (
        <Toolbar
          style={{
            padding: "1px 1px",
            marginBottom: 0,
            gap: 2,
            flexWrap: "wrap",
            position: "relative",
            zIndex: 2,
            transform: `translate(${toolbarJitterX}px, ${toolbarJitterY}px)`,
            opacity: controlsDisabled ? (isMax ? 0.3 : 0.42) : 1,
            filter: controlsDisabled ? (isMax ? "grayscale(1) brightness(0.62)" : "grayscale(1) brightness(0.78)") : undefined,
            pointerEvents: controlsDisabled ? "none" : undefined,
          }}
        >
          {toolbar}
        </Toolbar>
      )}

      {!isDocked && (
        <WindowContent
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            padding: 6,
            paddingBottom: hasResizeGutter ? 15 : 6,
            gap: 2,
            position: "relative",
            zIndex: 1,
          }}
        >
          {children}
        </WindowContent>
      )}

      {showResizeGrip && (
        <div
          ref={gripRef}
          onPointerDown={startResize}
          aria-hidden
          title="Resize"
          style={{
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 13,
            height: 13,
            zIndex: 4,
            cursor: "nwse-resize",
            touchAction: "none",
            backgroundImage:
              "linear-gradient(135deg, transparent 0 4px, rgba(255,255,255,0.85) 4px 5px, rgba(0,0,0,0.35) 5px 6px, transparent 6px 7px, rgba(255,255,255,0.85) 7px 8px, rgba(0,0,0,0.35) 8px 9px, transparent 9px 10px, rgba(255,255,255,0.85) 10px 11px, rgba(0,0,0,0.35) 11px 12px, transparent 12px)",
          }}
        />
      )}
    </Window>
    </>
  );
}
