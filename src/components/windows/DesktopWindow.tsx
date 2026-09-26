"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Toolbar, Window, WindowContent, WindowHeader } from "react95";
import { Z } from "@/constants/zIndex";
import MeltFilter, { MELT_FILTER_ID, meltStyle } from "@/components/windows/MeltFilter";
import FrameLightsStyle, { framesLit, lightStyles, type FrameLights } from "@/components/windows/FrameLights";
import { Layout, WindowBox } from "@/components/windows/windowTypes";

type DesktopWindowProps = {
  title: string;
  titleIcon?: string;
  layout: Layout;
  /**
   * Where this window sits in the desktop's stack — 0 is the bottom. Only the
   * focused window is on top, and focusing one raises it.
   */
  stackIndex?: number;
  /** Whether this is the one window taking the keyboard and wearing a lit title bar. */
  active?: boolean;
  /** A click anywhere in the frame asks the desktop to bring this window forward. */
  onFocus?: () => void;
  /**
   * How far down and right to step this window from the middle, so a second
   * window opened on top of a first doesn't land exactly on it.
   */
  cascadeX?: number;
  cascadeY?: number;
  /**
   * Where the window has been dragged to and how big it has been made. Held by
   * the desktop, not the window, so it can be saved and brought back.
   */
  box?: WindowBox | null;
  onBoxChange?: (box: WindowBox) => void;
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
  onToggleMaximize: () => void;
  controlsDisabled?: boolean;
  /**
   * 0–1: pulls the whole frame out of true, corners first — driven by
   * party.webp's Frame panel.
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
  stackIndex = 0,
  active = true,
  onFocus,
  cascadeX = 0,
  cascadeY = 0,
  box = null,
  onBoxChange,
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
  onToggleMaximize,
  controlsDisabled = false,
  melt,
  lights,
  toolbar,
  children,
}: DesktopWindowProps) {
  const isMax = layout === "maximized";
  const isMinimized = layout === "minimized";
  // Minimizing must not cost the window its contents — a tune mid-play, a game
  // mid-run — so a minimized frame stays mounted and simply stops being drawn.
  const zIndex = Z.WINDOW + stackIndex;

  const TASKBAR_H = 50;
  const GAP = 8;
  const MIN_W = 220;
  const MIN_H = 130;

  // A window opens centred (stepped along the cascade) at its natural size, and
  // the moment it's on screen that spot is pinned as an explicit top-left +
  // size. From then on it stays exactly there: resizing the browser leaves it
  // alone, and only a drag of the title bar or the resize grip moves it. That
  // box belongs to the desktop, which remembers it across visits, and it
  // outlives a trip to the taskbar or to full screen.
  type Box = WindowBox;
  // Like Windows 95, a drag doesn't move the window itself: a dotted outline
  // follows the pointer and the window jumps there when you let go. Escape (or a
  // cancelled pointer) drops the outline and leaves the window where it was.
  const [ghost, setGhost] = useState<Box | null>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGhost(null);
  }, [layout]);

  // Pin a window that hasn't got a box yet to wherever it has just been laid
  // out. It's measured before paint, so there's no visible jump — the window
  // simply stops being centred by CSS and starts being held where it is.
  useLayoutEffect(() => {
    if (box || layout !== "normal") return;
    const frame = headerRef.current?.parentElement;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    // The music window's shake rides on the same transform; take it back out
    // so the pinned spot is where the window really lives.
    onBoxChange?.({
      left: Math.round(rect.left - jitterX),
      top: Math.round(rect.top - jitterY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, layout]);

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
      if (commit && latest) onBoxChange?.(latest);
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
    if (isMax || isMinimized || controlsDisabled) return;
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
    if (isMax || isMinimized || controlsDisabled) return;
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
        zIndex,
        display: "flex",
        flexDirection: "column",
        boxShadow,
      }
    : box
      ? {
          position: "absolute",
          // Held where it was put. clamp() only steps in when the browser
          // shrinks past the window, keeping enough of it on screen to grab
          // back; it never moves a window that is still in view.
          left: `clamp(${KEEP_ON_SCREEN - box.width}px, ${box.left}px, calc(100% - ${KEEP_ON_SCREEN}px))`,
          top: `clamp(${TASKBAR_H}px, ${box.top}px, calc(100% - ${KEEP_ON_SCREEN}px))`,
          transform: jitterX || jitterY ? `translate(${jitterX}px, ${jitterY}px)` : undefined,
          width: box.width,
          height: box.height,
          maxWidth: `calc(100vw - ${GAP * 2}px)`,
          maxHeight: `calc(100vh - ${TASKBAR_H + GAP * 2}px)`,
          zIndex,
          display: "flex",
          flexDirection: "column",
          boxShadow,
        }
      : {
          position: "absolute",
          left: normalLeft,
          top: normalTop,
          // The cascade step is a desktop-sized step: on a phone a whole one would
          // walk the third window off the edge, so it shrinks with the screen.
          transform: `translate(calc(-50% + ${jitterX}px + min(${cascadeX}px, ${cascadeX * 0.1}vw)), calc(-50% + ${jitterY}px + min(${cascadeY}px, ${cascadeY * 0.1}vh)))`,
          width: NORMAL_W,
          height: normalHeight,
          // A window's natural size is a wish, not a promise: on a phone the
          // screen is narrower than any of them, and a window centred at its
          // full width hangs off both edges with its controls out of reach.
          maxWidth: `calc(100vw - ${GAP * 2}px)`,
          maxHeight: `calc(100vh - ${TASKBAR_H + GAP * 2}px)`,
          zIndex,
          display: "flex",
          flexDirection: "column",
          boxShadow,
        };

  // Sent to the taskbar, the window keeps its place and its size — it just isn't
  // painted and can't be touched. visibility rather than display so everything
  // inside keeps the box it measured itself against: canvases don't collapse to
  // nothing and then have to be re-laid-out on the way back.
  if (isMinimized) {
    style.visibility = "hidden";
    style.pointerEvents = "none";
    style.zIndex = Z.WINDOW - 1;
  }

  Object.assign(style, meltStyle(meltAmount));

  // The grip lives in its own corner gutter so it never lands on a scrollbar or
  // content edge. The gutter tracks the layout only (not controlsDisabled) so
  // toggling the title-bar controls doesn't reflow the window body.
  const hasResizeGutter = !isMax && !isMinimized;
  // The title bar drags and the grip resizes under exactly the same conditions.
  const isDraggable = hasResizeGutter && !controlsDisabled;
  const showResizeGrip = isDraggable;

  // Double-clicking the title bar throws the window between maximised and
  // normal, the way every window on this desktop's namesake does.
  const onTitleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (controlsDisabled) return;
    // The controls handle their own clicks; a stray second one isn't a resize.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    onToggleMaximize();
  };

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
          zIndex: zIndex + 1,
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
    <Window style={style} onPointerDownCapture={onFocus}>
      <WindowHeader
        ref={headerRef}
        active={active}
        onPointerDown={startDrag}
        onDoubleClick={onTitleDoubleClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flex: "0 0 auto",
          cursor: isDraggable ? "grab" : undefined,
          touchAction: isDraggable ? "none" : undefined,
          // Otherwise the second click of the double-click selects the title.
          userSelect: "none",
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
            onClick={onMinimize}
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

      {toolbar && (
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
