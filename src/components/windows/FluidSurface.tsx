"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Current, FluidOptions, FluidSim } from "@/lib/fluidSim";
import { Z } from "@/constants/zIndex";

// A press that lets go within this far and this soon is a tap, not a stir.
const TAP_SLOP = 8;
const TAP_MS = 400;

export type FluidSurfaceHandle = {
  clear: () => void;
  splash: () => void;
  /** This frame's crowd, in CSS px from the top-left of wherever the ink is showing. */
  currents: (list: Current[]) => void;
};

type FluidSurfaceProps = {
  options: FluidOptions;
  /** False while nobody could see it: the ink stays put and the GPU rests. */
  running: boolean;
  /**
   * Spill the ink out of the frame to cover the whole desktop, behind every
   * window. The frame's own patch of it is then a see-through view onto it.
   */
  wallpaper: boolean;
  /** The element the pointer stirs the ink through — the canvas laid over it. */
  area: React.RefObject<HTMLElement | null>;
  /** Told once, after start-up, whether this GPU can show shading, bloom and rays. */
  onEffects?: (available: boolean) => void;
  /** Told if this computer can't run it at all. */
  onFailed?: () => void;
};

/**
 * Colored ink laid under something else — party.webp's crowd, which walks
 * through it. The simulation is fluidSim.ts; this gives it a canvas, stirs it
 * with the pointer, and starts and stops it with the window. It takes no
 * clicks of its own: whatever is drawn over it keeps those.
 *
 * As wallpaper the same canvas is lifted out and laid over the whole desktop,
 * under the windows. Moving the element keeps its GL context, so the ink
 * carries straight on, resampled to the new size.
 */
const FluidSurface = forwardRef<FluidSurfaceHandle, FluidSurfaceProps>(function FluidSurface(
  { options, running, wallpaper, area, onEffects, onFailed },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mirrorRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<FluidSim | null>(null);
  // Start-up reads these once; after that the effects below keep the sim in step.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onEffectsRef = useRef(onEffects);
  onEffectsRef.current = onEffects;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  // Read by the pointer listeners, which outlive a flip of the wallpaper switch.
  const wallpaperRef = useRef(wallpaper);

  // The canvas is made here rather than rendered: closing the sim throws its
  // GL context away, and a canvas only ever hands out the one context — so a
  // remount (React's dev double-mount, for one) needs a fresh canvas, not the
  // old one with a dead context still attached.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
    wrap.prepend(canvas);
    const sim = FluidSim.create(canvas, optionsRef.current);
    if (!sim) {
      canvas.remove();
      onFailedRef.current?.();
      return;
    }
    canvasRef.current = canvas;
    simRef.current = sim;
    onEffectsRef.current?.(sim.hasEffects);
    return () => {
      sim.destroy();
      canvas.remove();
      canvasRef.current = null;
      simRef.current = null;
    };
  }, []);

  useEffect(() => {
    simRef.current?.setOptions(options);
  }, [options]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (running) sim.start();
    else sim.stop();
  }, [running]);

  // Wallpaper: the canvas goes out onto the desktop, and the frame's patch is
  // filled in by copying back whatever part of it is behind the frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const mirror = mirrorRef.current;
    const sim = simRef.current;
    if (!wallpaper || !canvas || !wrap || !mirror || !sim) return;
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(Z.WALLPAPER),
      pointerEvents: "none",
    });
    document.body.appendChild(layer);
    layer.appendChild(canvas);

    // The window's own body sits between the frame and the wallpaper, so the
    // frame can't simply be left clear. Instead it copies whatever patch of
    // wallpaper is behind it every frame, which looks the same: a see-through
    // pane onto the ink, wherever the window is dragged.
    const ctx = mirror.getContext("2d");
    sim.onFrame = () => {
      if (!ctx) return;
      const r = mirror.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const scale = canvas.width / Math.max(1, canvas.clientWidth);
      const w = Math.round(r.width * scale);
      const h = Math.round(r.height * scale);
      if (mirror.width !== w || mirror.height !== h) {
        mirror.width = w;
        mirror.height = h;
      }
      ctx.drawImage(canvas, r.left * scale, r.top * scale, w, h, 0, 0, w, h);
    };

    return () => {
      sim.onFrame = null;
      // Unless the sim has already gone with the window, back into the frame.
      if (canvasRef.current === canvas) wrap.prepend(canvas);
      layer.remove();
    };
  }, [wallpaper]);

  // The pointer. The ink takes no clicks — the canvas over it in the frame,
  // and the desktop around it, keep theirs — so it is followed from the window.
  // A mouse stirs just by moving, and lets go over anything that isn't ink so
  // it doesn't streak across a window when it comes back out the other side.
  // A finger has no hover: it stirs from where it touches down, and a touch
  // screen sends a finger's moves to wherever it started, so one that starts
  // on the ink keeps stirring wherever it goes.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    // Where a pointer is decides what it does. Over the frame it stirs, and
    // over bare desktop too if the ink is out there as wallpaper; a tap on
    // either drops a splash where it lands. Whatever is drawn over the ink
    // still gets the tap as well — a guy tapped is picked and splashed at once.
    // The desktop itself is the page's <main>, so a window, the taskbar, a
    // collections tile or a floating panel is never bare desktop.
    const where = (target: EventTarget | null): "frame" | "desktop" | null => {
      if (!(target instanceof Element)) return null;
      if (area.current?.contains(target)) return "frame";
      if (!wallpaperRef.current) return null;
      const bare =
        target === document.body || target === document.documentElement || target.tagName === "MAIN";
      return bare ? "desktop" : null;
    };
    // Pointer positions are wanted relative to the ink's own canvas, which is
    // the frame or, as wallpaper, the whole screen.
    const local = (event: PointerEvent): [number, number] => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)];
    };

    const touches = new Set<number>();
    const taps = new Map<number, { x: number; y: number; t: number }>();
    const onDown = (event: PointerEvent) => {
      const here = where(event.target);
      if (!here) return;
      taps.set(event.pointerId, { x: event.clientX, y: event.clientY, t: performance.now() });
      if (event.pointerType !== "mouse") {
        touches.add(event.pointerId);
        sim.pointerDown(event.pointerId, ...local(event));
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        if (where(event.target)) sim.hover(event.pointerId, ...local(event));
        else sim.pointerUp(event.pointerId);
      } else if (touches.has(event.pointerId)) {
        sim.pointerMove(event.pointerId, ...local(event));
      }
    };
    const onUp = (event: PointerEvent) => {
      const down = taps.get(event.pointerId);
      taps.delete(event.pointerId);
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_SLOP &&
        performance.now() - down.t < TAP_MS
      ) {
        // A touch screen has no hover, and a tap that never moves would
        // otherwise leave nothing behind.
        sim.drop(...local(event));
      }
      if (touches.delete(event.pointerId)) sim.pointerUp(event.pointerId);
    };
    const onCancel = (event: PointerEvent) => {
      taps.delete(event.pointerId);
      touches.delete(event.pointerId);
      sim.pointerUp(event.pointerId);
    };
    const onLeave = (event: PointerEvent) => sim.pointerUp(event.pointerId);
    // Left to itself the browser would take a finger dragged across the
    // desktop as a scroll — or, from the top of a phone, a pull to refresh.
    const onTouchMove = (event: TouchEvent) => {
      if (touches.size > 0 && event.cancelable) event.preventDefault();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      sim.letGo();
    };
  }, [area]);

  useEffect(() => {
    wallpaperRef.current = wallpaper;
    // Hovering held the mouse down; brought back into the frame, or sent out
    // of it, that pointer would otherwise jump across the screen.
    simRef.current?.letGo();
  }, [wallpaper]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => simRef.current?.clear(),
      splash: () => simRef.current?.splash(),
      currents: (list) => simRef.current?.currents(list),
    }),
    [],
  );

  return (
    <div
      ref={wrapRef}
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", background: options.background }}
    >
      <canvas
        ref={mirrorRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: wallpaper ? "block" : "none",
        }}
      />
    </div>
  );
});

export default FluidSurface;
