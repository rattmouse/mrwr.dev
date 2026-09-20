"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { drawSky, makeStars, makeView, paintQueue, vec, type Camera } from "@/lib/marbles3d";
import { newMarble, resetMarble, stepCourse, stepMarble, type Marble } from "@/lib/marblesCourse";
import { buildCourse, type Course } from "@/lib/marblesLayout";
import { collectBlocks, collectMarble, drawFinishGlow } from "@/lib/marblesDraw";

export type MarblesWindowHandle = {
  /** Put the ball back on the first pad of the course it is already on. */
  restart: () => void;
  /** Throw that course away and roll another one. */
  reroll: () => void;
};

/** How a run ended, for the window to offer another go with. */
export type RunResult = {
  /** Seconds, for this run. */
  time: number;
  /** The quickest this course has been got round so far. */
  best: number;
  /** Whether this run was that best — the first one round always is. */
  improved: boolean;
};

type MarblesWindowProps = {
  /**
   * Where the running time is written. Handed in as an element rather than
   * pushed up as state: the clock changes ten times a second and the window
   * around it has no other reason to redraw that often.
   */
  clock?: React.RefObject<HTMLElement | null>;
  /**
   * Called with the result when a run is finished, and with null the moment
   * the next one begins — whichever way it was started, the toolbar or the R
   * key — so what the window is showing can't get out of step with the game.
   */
  onResult?: (result: RunResult | null) => void;
};

/** Minutes, seconds and tenths — long enough for a bad run, short enough to read. */
export function readClock(seconds: number) {
  const whole = Math.max(0, seconds);
  const mins = Math.floor(whole / 60);
  const secs = Math.floor(whole % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}.${Math.floor((whole * 10) % 10)}`;
}

/** How far behind the ball the camera sits, and how much further at speed. */
const CAMERA_BACK = 9;
const CAMERA_STRETCH = 0.12;
/** Seconds for the camera to catch up with where the ball actually is. */
const CAMERA_LAG = 0.09;
const PITCH_MIN = 0.06;
const PITCH_MAX = 1;
/** How long after you last touched the camera it starts trailing the ball again. */
const TRAIL_AFTER = 1.5;
/** How fast the finish lights up, and goes out again. */
const GLOW_RATE = 3.5;

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyR",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/**
 * Which way the camera should be pointing when a course opens: down the course,
 * rather than at whatever happens to be behind the ball.
 */
function facing(course: Course) {
  const first = course.route[0];
  const next = course.route[1] ?? first;
  if (!first || (next.x === first.x && next.z === first.z)) return 0;
  return Math.atan2(-(next.x - first.x), -(next.z - first.z));
}

/** Shortest way round from one heading to another, in radians. */
function turnToward(from: number, to: number) {
  return ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * marbles.exe: a ball you roll around a course of boxes hanging in the dark.
 *
 * Nothing is drawn over the view — no clock, no counter, no lives. Falling off
 * puts you back where you last had firm footing, and reaching the end lights
 * the finish up and starts you over. The whole game is in the picture.
 */
const MarblesWindow = forwardRef<MarblesWindowHandle, MarblesWindowProps>(function MarblesWindow(
  { clock, onResult },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // A course is rolled when the window opens and lasts as long as it is open.
  const courseRef = useRef<Course>(buildCourse());
  const marbleRef = useRef<Marble>(newMarble(courseRef.current.start));
  const restartRef = useRef(false);
  const rerollRef = useRef(false);

  // Where the camera is looking from, and the point it is easing toward. Kept
  // in a ref because the draw loop owns it — React never needs to see it.
  const camRef = useRef({
    yaw: facing(courseRef.current),
    pitch: 0.34,
    look: { ...marbleRef.current.pos },
    /** Seconds since the last deliberate camera move, for the lazy trail. */
    idle: 0,
  });

  // Held in a ref rather than read from props inside the loop: the loop is set
  // up once and must not be torn down and rebuilt — that would deal a new
  // course — just because the window around it re-rendered.
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const keysRef = useRef(new Set<string>());
  /** Raised by a press of the jump key, lowered by the frame that spends it. */
  const jumpRef = useRef(false);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  // A finger held on the canvas rolls the ball forward; there is no keyboard to
  // do it with, and dragging is already steering the camera.
  const touchRollRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      restart: () => {
        restartRef.current = true;
      },
      reroll: () => {
        rerollRef.current = true;
      },
    }),
    [],
  );

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!MOVE_KEYS.has(event.code)) return;
      event.preventDefault();
      if (event.code === "KeyR") restartRef.current = true;
      // A jump is a press, not a hold: taking it here rather than reading the
      // key each frame is what stops a held space bar hopping all the way
      // along the ground.
      else if (event.code === "Space") {
        if (!keysRef.current.has("Space")) jumpRef.current = true;
        keysRef.current.add("Space");
      } else keysRef.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    const blur = () => keysRef.current.clear();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stars = makeStars(320);
    let width = 0;
    let height = 0;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    let frame = 0;
    let previous = performance.now();
    let ticking = 0;
    // 0 to 1 as the finish pad lights up.
    let glow = 0;
    // The current run. It holds at nought until you actually set off — no
    // sense counting the time spent reading what the keys do — and stops when
    // the finish is reached, so the time you got stays up while it is lit.
    let elapsed = 0;
    let running = false;
    let shown = "";
    // Set when a course has been got round. The ball stops where it is and
    // stays there: what happens next — another go at this one, or a new one —
    // is the window's to ask and yours to answer.
    let finished = false;
    // The quickest this course has been done, which is what a retry is for.
    let best: number | null = null;

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      // A long pause — a hidden tab, a dragged window — should not be simulated.
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      ticking += dt;

      const cam = camRef.current;
      const keys = keysRef.current;

      if (rerollRef.current) {
        rerollRef.current = false;
        courseRef.current = buildCourse();
        restartRef.current = true;
        best = null;
      }
      const course = courseRef.current;
      const marble = marbleRef.current;
      const blocks = course.blocks;

      if (restartRef.current) {
        restartRef.current = false;
        resetMarble(marble, course.start);
        cam.look = { ...marble.pos };
        cam.yaw = facing(course);
        elapsed = 0;
        running = false;
        finished = false;
        resultRef.current?.(null);
      }

      const held = (...codes: string[]) => codes.some((c) => keys.has(c));
      const forward = (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0);
      const right = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
      const spin = (held("KeyE") ? 1 : 0) - (held("KeyQ") ? 1 : 0);
      if (spin !== 0) {
        cam.yaw += spin * 1.8 * dt;
        cam.idle = 0;
      } else {
        cam.idle += dt;
      }

      const rolling = forward !== 0 || right !== 0 || touchRollRef.current || jumpRef.current;
      const jump = jumpRef.current;
      jumpRef.current = false;

      // The ferries keep sliding once the run is over — it should look like a
      // place that is still there — but the ball stops where it finished.
      stepCourse(blocks, ticking, dt);
      const events = finished
        ? { fell: false, reached: false }
        : stepMarble(
            marble,
            blocks,
            { forward: touchRollRef.current ? 1 : forward, right, yaw: cam.yaw, jump },
            dt,
          );

      if (rolling && !running && !finished) running = true;
      if (running) elapsed += dt;
      if (events.reached) {
        finished = true;
        running = false;
        const improved = best === null || elapsed < best;
        if (improved) best = elapsed;
        resultRef.current?.({ time: elapsed, best: best ?? elapsed, improved });
      }
      glow += ((finished ? 1 : 0) - glow) * Math.min(1, GLOW_RATE * dt);

      // Left alone for a moment, the camera drifts round behind wherever the
      // ball is actually going — enough to help, not enough to fight a drag.
      const pace = Math.hypot(marble.vel.x, marble.vel.z);
      if (cam.idle > TRAIL_AFTER && pace > 5) {
        const heading = Math.atan2(-marble.vel.x, -marble.vel.z);
        cam.yaw += turnToward(cam.yaw, heading) * Math.min(1, 1.1 * dt);
      }

      // The look-at point lags the ball, so a hard bounce doesn't jerk the view.
      const target = { x: marble.pos.x, y: marble.pos.y + 0.9, z: marble.pos.z };
      const chase = 1 - Math.exp(-dt / CAMERA_LAG);
      cam.look = {
        x: cam.look.x + (target.x - cam.look.x) * chase,
        y: cam.look.y + (target.y - cam.look.y) * chase,
        z: cam.look.z + (target.z - cam.look.z) * chase,
      };

      const back = CAMERA_BACK + pace * CAMERA_STRETCH;
      const cp = Math.cos(cam.pitch);
      const camera: Camera = {
        pos: vec(
          cam.look.x + Math.sin(cam.yaw) * cp * back,
          cam.look.y + Math.sin(cam.pitch) * back,
          cam.look.z + Math.cos(cam.yaw) * cp * back,
        ),
        yaw: cam.yaw,
        pitch: cam.pitch,
        fov: 1.05,
      };

      const view = makeView(camera, width, height);
      const lift = glow;

      drawSky(ctx, view, stars);
      paintQueue(ctx, [
        ...collectBlocks(view, blocks, lift),
        ...collectMarble(view, marble, blocks),
      ]);
      drawFinishGlow(ctx, view, blocks, lift);

      const reading = readClock(elapsed);
      if (reading !== shown && clock?.current) {
        shown = reading;
        clock.current.textContent = reading;
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [clock]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.pointerType === "touch") touchRollRef.current = true;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const cam = camRef.current;
    cam.yaw -= (event.clientX - drag.x) * 0.006;
    cam.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, cam.pitch + (event.clientY - drag.y) * 0.004));
    cam.idle = 0;
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    touchRollRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={wrapRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        border: "2px solid",
        borderColor: "#808080 #ffffff #ffffff #808080",
        background: "#0a0c16",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ display: "block", touchAction: "none", cursor: "grab" }}
      />
    </div>
  );
});

export default MarblesWindow;
