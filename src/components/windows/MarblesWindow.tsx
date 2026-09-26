"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  drawSky,
  IDENTITY,
  makeStars,
  makeView,
  paintQueue,
  sub,
  vec,
  type Camera,
  type Mat3,
  type Vec3,
} from "@/lib/marbles3d";
import {
  newMarble,
  resetMarble,
  stepCourse,
  stepMarble,
  TOP_SPEED,
  type Marble,
} from "@/lib/marblesCourse";
import { buildCourse, type Course } from "@/lib/marblesLayout";
import {
  collectBlocks,
  collectGhost,
  collectMarble,
  drawClock,
  drawCountdown,
  drawFinishGlow,
} from "@/lib/marblesDraw";
import { ghostAt, newTrail, record, rollBy, type Trail } from "@/lib/marblesGhost";

export type MarblesWindowHandle = {
  /** Put the ball back on the first pad of the course it is already on. */
  restart: () => void;
};

/** What there is to race against, and what there is to hand on. */
export type GhostState = {
  /** Whether any ghost is riding this course — what the toggle is for. */
  racing: boolean;
  /** Your own best run, which is the one your code carries. */
  mine: Trail | null;
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
   * The course to roll. Held by the window around this one, because the seed
   * is on show up in the toolbar and can be typed over — a different seed here
   * is a different course, dealt on the next frame.
   */
  seed: number;
  /**
   * Whether the best run known on this course rides round again beside you. It
   * has nothing to show until the course has been got round once, by you or by
   * whoever sent it.
   */
  ghost?: boolean;
  /** Whether this is the focused window — only then does it take the keyboard. */
  active?: boolean;
  /** A run that came in on a pasted code, to be raced from the first go. */
  sent?: { time: number; run: Trail } | null;
  /** Called whenever there is a different ghost, or a different run to send. */
  onGhosts?: (state: GhostState) => void;
  /**
   * Called with the result when a run is finished, and with null the moment
   * the next one begins — whichever way it was started, the toolbar or the R
   * key — so what the window is showing can't get out of step with the game.
   */
  onResult?: (result: RunResult | null) => void;
};

/**
 * Minutes, seconds and hundredths — long enough for a bad run, and fine enough
 * that two goes at the same course are hardly ever the same time.
 */
export function readClock(seconds: number) {
  const whole = Math.max(0, seconds);
  const mins = Math.floor(whole / 60);
  const secs = Math.floor(whole % 60);
  const bits = Math.floor((whole * 100) % 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${bits.toString().padStart(2, "0")}`;
}

/**
 * How long the ball spins on the spot before it is let go. The run-up is a
 * standing start with the handbrake on: the keys wind it up where it stands —
 * you can see it spinning, and hear nothing, because there is no sound — and
 * the moment the count runs out it is released with everything it has gathered
 * and the clock starts on a ball already at speed.
 */
export const LEAD_IN = 3;

/**
 * And how fast it can be wound up to in that time — half again as fast as it
 * could ever push itself along the flat. What it has gathered grows with the
 * count rather than arriving in the first half-second, so the ball spins
 * faster and faster on the spot as the three seconds run out, and what you see
 * it doing is exactly what it will be doing the moment it is let go.
 */
const WIND_UP = TOP_SPEED * 1.4;


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
 * Next to nothing is drawn over the view — no clock, no counter, no lives; the
 * only thing over the picture is the count before the off, which is there for
 * three seconds and belongs beside the ball it is counting for. Falling off
 * puts you back where you last had firm footing, and reaching the end lights
 * the finish up and stops the clock. The whole game is in the picture.
 */
const MarblesWindow = forwardRef<MarblesWindowHandle, MarblesWindowProps>(function MarblesWindow(
  { seed, ghost = true, active = true, sent, onGhosts, onResult },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The course the window opens on, rolled once — through useState rather than
  // straight into the ref, because a ref's initial value is worked out afresh
  // on every render and a whole course is too much to build and throw away.
  const [opening] = useState(() => {
    const course = buildCourse(seed);
    return { course, marble: newMarble(course.start) };
  });
  const courseRef = useRef<Course>(opening.course);
  const marbleRef = useRef<Marble>(opening.marble);
  const restartRef = useRef(false);
  /** A seed waiting to be dealt, put here by the prop and spent by the loop. */
  const rollRef = useRef<number | null>(null);

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
  const ghostsRef = useRef(onGhosts);
  ghostsRef.current = onGhosts;
  const showGhostRef = useRef(ghost);
  showGhostRef.current = ghost;
  /** A run that arrived in a code, waiting for the loop to set it going. */
  const sentRef = useRef<{ time: number; run: Trail } | null>(sent ?? null);

  const keysRef = useRef(new Set<string>());
  // Only the focused window hears the keyboard. Held keys are let go the moment
  // it loses the focus, or they'd stay held down while you're somewhere else.
  const focusedRef = useRef(active);
  useEffect(() => {
    focusedRef.current = active;
    if (!active) {
      keysRef.current.clear();
    }
  }, [active]);
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
    }),
    [],
  );

  // A new seed from the toolbar — typed in, or rolled by New course — is left
  // for the loop to pick up rather than acted on here: the course is the loop's
  // and swapping it out from under a frame being drawn is asking for trouble.
  useEffect(() => {
    if (seed !== courseRef.current.seed) rollRef.current = seed;
  }, [seed]);

  useEffect(() => {
    if (sent) sentRef.current = sent;
  }, [sent]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

    const down = (event: KeyboardEvent) => {
      if (!focusedRef.current) return;
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
    // What is left of the run-up. It sits at its full length until your first
    // push, counts down while you gather speed, and the timed run starts the
    // moment it runs out.
    let lead = LEAD_IN;
    let leading = false;
    // Set when a course has been got round. The ball stops where it is and
    // stays there: what happens next — another go at this one, or a new one —
    // is the window's to ask and yours to answer.
    let finished = false;
    // The quickest this course has been done, which is what a retry is for.
    let best: number | null = null;
    // The ghost is the quickest run known on this course, whoever did it — your
    // own, or one that came in on a code — and `mine` is your own best, which
    // is the one your code hands on. `trail` is the run being laid down now.
    let ghostPath: Trail | null = null;
    let ghostTime: number | null = null;
    let mine: Trail | null = null;
    let trail: Trail = newTrail();
    let ghostTurn: Mat3 = IDENTITY;
    let ghostWas: Vec3 | null = null;
    const told = () => ghostsRef.current?.({ racing: ghostPath !== null, mine });

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      // A long pause — a hidden tab, a dragged window — should not be simulated.
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      ticking += dt;

      const cam = camRef.current;
      const keys = keysRef.current;

      if (rollRef.current !== null) {
        courseRef.current = buildCourse(rollRef.current);
        rollRef.current = null;
        restartRef.current = true;
        best = null;
        // Another course entirely; the old runs have nothing to do with it.
        ghostPath = null;
        ghostTime = null;
        mine = null;
        told();
      }

      // A run that arrived in a code is something to race from the very first
      // go, before there is anything of your own to race.
      if (sentRef.current) {
        const arrived = sentRef.current;
        sentRef.current = null;
        if (ghostTime === null || arrived.time < ghostTime) {
          ghostPath = arrived.run;
          ghostTime = arrived.time;
          told();
        }
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
        lead = LEAD_IN;
        leading = false;
        finished = false;
        trail = newTrail();
        ghostTurn = IDENTITY;
        ghostWas = null;
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
      // Winding up: how fast it is allowed to have got by this point of the
      // count. None of it at the start, all of it at the off — so the speed,
      // and the spin that goes with it, build over the whole three seconds
      // rather than arriving in the first half-second.
      const winding = lead > 0 && !finished;
      const wound = WIND_UP * (1 - Math.min(1, lead / LEAD_IN));
      // Where it is standing while it winds up. Only the ground it would have
      // covered is taken back; how fast it is going is its own.
      const standing = winding ? { ...marble.pos } : null;
      const events = finished
        ? { fell: false, reached: false, at: 0 }
        : stepMarble(
            marble,
            blocks,
            {
              forward: touchRollRef.current ? 1 : forward,
              right,
              yaw: cam.yaw,
              // A jump spent during the count is not saved up and let off the
              // instant the ball is released.
              jump: winding ? false : jump,
            },
            dt,
            // Past the ordinary top speed at the end of the count; the ball
            // sheds the difference once it is let go.
            winding ? Math.max(TOP_SPEED, wound) : undefined,
          );
      if (standing) {
        // Put back where it stood, but only across the ground: it still has to
        // fall the last inch onto the pad and stay resting on it, or it is not
        // touching anything and a ball that is touching nothing does not roll.
        marble.pos = { x: standing.x, y: marble.pos.y, z: standing.z };
        const flat = Math.hypot(marble.vel.x, marble.vel.z);
        const held = flat > wound ? wound / flat : 1;
        marble.vel = vec(marble.vel.x * held, marble.vel.y, marble.vel.z * held);
      }

      // First push starts the run-up; the clock starts when the run-up is out,
      // and takes whatever was left over from the frame it ran out on.
      if (rolling && !running && !leading && !finished) leading = true;
      if (leading) {
        lead -= dt;
        if (lead <= 0) {
          elapsed -= lead;
          lead = 0;
          leading = false;
          running = true;
        }
      } else if (running) {
        elapsed += dt;
        record(trail, marble.pos, elapsed);
      }
      if (events.reached) {
        finished = true;
        running = false;
        // The pad was touched partway through the frame, not at the end of it:
        // the rest of the frame is not part of the run.
        elapsed = Math.max(0, elapsed - Math.max(0, dt - events.at));
        // The finish goes down as the run's last point, so a ghost of it gets
        // all the way home rather than stopping a step short of the pad.
        record(trail, marble.pos, elapsed);
        // A run of a single point is no run at all — it would take a finish
        // reached before the ball was ever let go — and a ghost of one would
        // be a ghost with nowhere to go and a time nothing could beat.
        const ran = trail.points.length > 1;
        const improved = best === null || elapsed < best;
        if (improved) {
          best = elapsed;
          mine = ran ? trail : null;
        }
        // Whoever holds the quickest run is who you ride against next time.
        if (ran && (ghostTime === null || elapsed < ghostTime)) {
          ghostPath = trail;
          ghostTime = elapsed;
        }
        if (improved || ghostPath === trail) told();
        trail = newTrail();
        resultRef.current?.({ time: elapsed, best: best ?? elapsed, improved });
      }
      glow += ((finished ? 1 : 0) - glow) * Math.min(1, GLOW_RATE * dt);

      // Where the best run had got to by now. Once it is home there is nothing
      // more to show; if you finish first, it stops where it had got to, which
      // is the margin you won by, standing out there on the course.
      const riding = ghostPath && showGhostRef.current ? ghostAt(ghostPath, elapsed) : null;
      if (riding) {
        if (ghostWas) ghostTurn = rollBy(ghostTurn, sub(riding, ghostWas), marble.radius);
        ghostWas = riding;
      }

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
        ...(riding ? collectGhost(view, riding, marble.radius, ghostTurn) : []),
      ]);
      drawFinishGlow(ctx, view, blocks, lift);
      if (!finished) drawCountdown(ctx, view, marble.pos, lead);
      // The time to beat is whatever the ghost is doing the course in, whether
      // that is your own best or one that came in on a code.
      drawClock(
        ctx,
        view,
        readClock(elapsed),
        ghostTime === null ? null : `${readClock(ghostTime)} to beat`,
      );
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Set up once and left alone: everything that changes while it runs comes
    // in through a ref, because tearing the loop down would deal a new course.
  }, []);

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
