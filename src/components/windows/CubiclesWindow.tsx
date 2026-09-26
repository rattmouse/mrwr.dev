"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Window, WindowContent, WindowHeader } from "react95";
import { Joystick } from "@/components/windows/MpkPanel";
import { makeView, applyT, normalise, rgb, vec, Vec3 } from "@/lib/marbles3d";
import {
  DOOR_RANGE,
  EYE_STANDING,
  LIGHTS_MESSAGE_TYPE,
  Pose,
  ROOM,
  SCREEN,
  SEATED,
  STANDING,
  USE_RANGE,
  aimAtDoor,
  aimAtScreen,
  doorBoxes,
  gaze,
  walk,
} from "@/lib/cubicle";
import { Face, Skin, VOID, collectGlass, collectRoom, glassQuad, paintFaces, quadTransform } from "@/lib/cubicleDraw";

type Phase = "intro" | "standing" | "seated";

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/** Radians per pixel dragged. */
const LOOK = 0.0045;
/** Radians a second the arrow keys turn you. */
const TURN = 2;
const PITCH_LIMIT = 1.15;
/** How long sitting down at the desk, or getting back up, takes. */
const SIT_MS = 480;
/** Past this far a press counts as a look-around rather than a click. */
const CLICK_SLOP = 5;
const STICK_DEAD_ZONE = 0.18;
/** How long the door goes on rattling after you have tried it. */
const RATTLE_MS = 420;
/** What the browser on the desk is pointed at when the machine boots. */
const HOME = "/";
/** How much of the frame's own resolution the echo on the glass is kept at. */
const ECHO_SCALE = 0.5;
/** Never shrink the browser's logical width below this, however small the
 *  glass lands on screen — narrower than this and the desktop it's showing
 *  stops being usable, crisp or not. */
const SCREEN_MIN_WIDTH = 320;
/** ...nor grow it past this, however big a maximized window makes the glass.
 *  Past a certain point a bigger logical size just means a bigger iframe to
 *  lay out for no crispness gain, since the transform would otherwise have to
 *  upscale it to fill the quad — the same smeared-text problem shrinking too
 *  far causes, just via magnification instead. */
const SCREEN_MAX_WIDTH = 1280;

/**
 * The site inside the monitor is this same site, so opening the cubicle in
 * there would hang another whole browser off this one, and another off that.
 * One deep is the joke; two is a resource leak.
 *
 * So a cubicle that finds itself already inside one doesn't put a browser on
 * the desk at all. It paints the last frame of the room onto the glass
 * instead: the monitor shows the room it is standing in, and the monitor in
 * that picture shows the frame before it, and so on down until there are no
 * pixels left to spend. Unbounded depth for one blit a frame, because the
 * depth is in the picture rather than in the number of things running.
 */
const nestedStore = {
  subscribe: () => () => {},
  get: () => window.self !== window.top,
  onServer: () => false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function lerpPose(from: Pose, to: Pose, t: number): Pose {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    pos: vec(mix(from.pos.x, to.pos.x), mix(from.pos.y, to.pos.y), mix(from.pos.z, to.pos.z)),
    yaw: mix(from.yaw, to.yaw),
    pitch: mix(from.pitch, to.pitch),
    fov: mix(from.fov, to.fov),
  };
}

export default function CubiclesWindow({ active = true }: { active?: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 600, height: 420 });
  /** The browser's own logical size, shrunk from SCREEN's 640×512 so a small
   *  window doesn't have to squash it down onto a tiny quad — which is what
   *  smeared the start menu's font on small screens instead of just shrinking
   *  it cleanly. Recomputed on resize, not per frame: it depends only on the
   *  window's height (see marbles3d.ts's `focal`), not on where you're stood. */
  const screenSizeRef = useRef({ width: SCREEN.width, height: SCREEN.height });

  const poseRef = useRef<Pose>({ ...STANDING });
  const phaseRef = useRef<Phase>("intro");
  /** Where you were standing when you sat down, to put you back there. */
  const standPoseRef = useRef<Pose>({ ...STANDING });
  const sitRef = useRef<{ from: Pose; to: Pose; t: number; into: Phase } | null>(null);
  const bobRef = useRef(0);

  /** When the door was last tried, so it can shake it off. */
  const rattledRef = useRef(-Infinity);
  const keysRef = useRef<Set<string>>(new Set());
  const stickRef = useRef({ x: 0, y: 0 });
  // Only the focused window hears the keyboard. Held keys are let go the moment
  // it loses the focus, or they'd stay held down while you're somewhere else.
  const focusedRef = useRef(active);
  useEffect(() => {
    focusedRef.current = active;
    if (!active) {
      keysRef.current.clear();
      stickRef.current = { x: 0, y: 0 };
    }
  }, [active]);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);

  /** The browser sitting on the monitor, laid over the glass. */
  const screenRef = useRef<HTMLDivElement | null>(null);
  const nested = useSyncExternalStore(nestedStore.subscribe, nestedStore.get, nestedStore.onServer);

  const [phase, setPhase] = useState<Phase>("intro");
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState<string | null>(null);
  // lights.exe lives one frame in, on the computer on this desk, so it flips
  // this switch by shouting across the frame boundary rather than a prop.
  const [lightsOn, setLightsOn] = useState(true);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === LIGHTS_MESSAGE_TYPE) setLightsOn((v) => !v);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /* ----------------------------------------------------------- the moving */

  /**
   * Move between standing at the desk and leaning in at it. Changing your mind
   * part-way turns the move round from wherever the camera has got to rather
   * than being ignored — otherwise Esc does nothing for half a second after
   * you sit down. Where you were standing is only remembered on the way in, so
   * an interrupted stand-up still puts you back on the same spot.
   */
  const sit = useCallback((into: Phase) => {
    if (phaseRef.current === into) return;
    if (into === "seated" && !sitRef.current) standPoseRef.current = { ...poseRef.current };
    sitRef.current = {
      from: { ...poseRef.current },
      to: into === "seated" ? SEATED : standPoseRef.current,
      t: 0,
      into,
    };
    setPrompt(null);
    setPhase(into);
    phaseRef.current = into;
  }, []);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

    const down = (event: KeyboardEvent) => {
      if (!focusedRef.current) return;
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Escape") {
        if (phaseRef.current === "seated") {
          sit("standing");
          event.preventDefault();
        }
        return;
      }
      if (phaseRef.current !== "standing") return;
      if (event.code === "KeyE") {
        const pose = poseRef.current;
        const look = gaze(pose.yaw, pose.pitch);
        if (aimAtScreen(pose.pos, look, USE_RANGE)) sit("seated");
        else if (aimAtDoor(pose.pos, look)) rattledRef.current = performance.now();
        event.preventDefault();
        return;
      }
      if (!MOVE_KEYS.has(event.code)) return;
      event.preventDefault();
      keysRef.current.add(event.code);
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    const blur = () => {
      keysRef.current.clear();
      stickRef.current = { x: 0, y: 0 };
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [sit]);

  /* --------------------------------------------------------- the pointer */

  /**
   * The ray out of the eye through one pixel of the canvas. The size is passed
   * in rather than read from sizeRef: a click landing in the same tick as a
   * resize would otherwise be cast through the canvas's old shape and miss.
   */
  const rayThrough = useCallback((px: number, py: number, width: number, height: number): Vec3 => {
    const view = makeView(poseRef.current, width, height);
    return normalise(applyT(view.rot, vec((px - view.cx) / view.focal, -(py - view.cy) / view.focal, -1)));
  }, []);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current === "intro") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (phaseRef.current !== "standing" || sitRef.current) return;
    const pose = poseRef.current;
    poseRef.current = {
      ...pose,
      yaw: pose.yaw - dx * LOOK,
      pitch: clamp(pose.pitch + dy * LOOK, -PITCH_LIMIT, PITCH_LIMIT),
    };
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved > CLICK_SLOP || sitRef.current) return;
    if (phaseRef.current !== "standing") return;

    const at = canvasPoint(event);
    const pose = poseRef.current;
    const look = rayThrough(at.x, at.y, at.width, at.height);
    if (aimAtScreen(pose.pos, look, USE_RANGE)) sit("seated");
    else if (aimAtDoor(pose.pos, look)) rattledRef.current = performance.now();
  };

  const onStickMove = useCallback((x: number, y: number) => {
    setStick({ x, y });
    stickRef.current = { x, y };
  }, []);

  const onStickRelease = useCallback(() => {
    setStick({ x: 0, y: 0 });
    stickRef.current = { x: 0, y: 0 };
  }, []);

  const start = useCallback(() => {
    poseRef.current = { ...STANDING };
    standPoseRef.current = { ...STANDING };
    phaseRef.current = "standing";
    setPhase("standing");
  }, []);

  /* ------------------------------------------------------------ the loop */

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // How big the glass actually lands on screen once you're seated at it —
      // the only pose the browser is legible in. Projection scales with the
      // viewport's height alone (see marbles3d.ts), so this only needs
      // recomputing here, on resize, not every animation frame.
      const seatedQuad = glassQuad(makeView(SEATED, width, height));
      if (seatedQuad) {
        const [p0, p1] = seatedQuad;
        const quadWidth = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const screenWidth = Math.min(SCREEN_MAX_WIDTH, Math.max(SCREEN_MIN_WIDTH, Math.round(quadWidth)));
        const screen = screenRef.current;
        screenSizeRef.current = { width: screenWidth, height: Math.round((screenWidth * SCREEN.height) / SCREEN.width) };
        if (screen) {
          screen.style.width = `${screenSizeRef.current.width}px`;
          screen.style.height = `${screenSizeRef.current.height}px`;
        }
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    const held = (...codes: string[]) => codes.some((code) => keysRef.current.has(code));

    // The last frame, kept to hand back to the monitor. Only a nested cubicle
    // wants one — out here the real browser is sitting on top of the glass and
    // nothing painted underneath it would ever be seen.
    const echo = nested ? document.createElement("canvas") : null;
    const echoCtx = echo ? echo.getContext("2d") : null;
    const echoSkin: Skin | null = echo ? { image: echo, width: 1, height: 1 } : null;

    // Both of these are refilled every frame rather than rebuilt, which keeps
    // a few hundred arrays a second out of the collector.
    const scene = [...ROOM];
    const faces: Face[] = [];

    let raf = 0;
    let last = performance.now();
    let shownPrompt: string | null = null;

    const loop = (now: number) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const { width, height } = sizeRef.current;

      const sitting = sitRef.current;
      if (sitting) {
        sitting.t = Math.min(1, sitting.t + (dt * 1000) / SIT_MS);
        poseRef.current = lerpPose(sitting.from, sitting.to, ease(sitting.t));
        if (sitting.t >= 1) {
          poseRef.current = { ...sitting.to, pos: vec(sitting.to.pos.x, sitting.to.pos.y, sitting.to.pos.z) };
          sitRef.current = null;
        }
      } else if (phaseRef.current === "standing") {
        const pose = poseRef.current;
        let yaw = pose.yaw - ((held("ArrowRight") ? 1 : 0) - (held("ArrowLeft") ? 1 : 0)) * TURN * dt;
        let dx = (held("KeyD") ? 1 : 0) - (held("KeyA") ? 1 : 0);
        let dz = (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0);
        const push = stickRef.current;
        if (Math.hypot(push.x, push.y) > STICK_DEAD_ZONE) {
          dx = push.x;
          dz = push.y;
        }
        const moving = Math.hypot(dx, dz) > 1e-3;
        bobRef.current = moving ? bobRef.current + dt * 7.5 : 0;
        const walked = walk(pose.pos, yaw, dx, dz, dt);
        yaw = ((yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
        poseRef.current = {
          ...pose,
          yaw,
          pos: vec(walked.x, EYE_STANDING + (moving ? Math.sin(bobRef.current) * 0.022 : 0), walked.z),
        };
      }

      const pose = poseRef.current;
      const view = makeView(pose, width, height);

      let hint: string | null = null;
      const rattling = now - rattledRef.current < RATTLE_MS;
      if (phaseRef.current === "standing" && !sitRef.current) {
        const look = gaze(pose.yaw, pose.pitch);
        if (aimAtScreen(pose.pos, look, USE_RANGE)) {
          hint = "Use the computer — click, or E";
        } else if (aimAtDoor(pose.pos, look, DOOR_RANGE)) {
          hint = rattling ? "It doesn't budge." : "The door is locked — click, or E";
        }
      }
      if (hint !== shownPrompt) {
        shownPrompt = hint;
        setPrompt(hint);
      }

      ctx.fillStyle = rgb(VOID);
      ctx.fillRect(0, 0, width, height);
      // A tried door shakes in its frame for a moment and then gives up.
      const since = now - rattledRef.current;
      const shove = rattling ? Math.sin(since / 11) * 0.007 * (1 - since / RATTLE_MS) : 0;

      if (echo && echoSkin) {
        const wide = Math.max(1, Math.round(canvas.width * ECHO_SCALE));
        const tall = Math.max(1, Math.round(canvas.height * ECHO_SCALE));
        // Resizing a canvas wipes it, so only ever on a real change of size.
        if (echo.width !== wide || echo.height !== tall) {
          echo.width = wide;
          echo.height = tall;
        }
        echoSkin.width = wide;
        echoSkin.height = tall;
      }

      const quad = glassQuad(view);
      // The door is the only thing in the room that moves, so the list handed
      // to the painter is built once and only its last two entries replaced.
      scene.length = ROOM.length;
      for (const box of doorBoxes(shove)) scene.push(box);
      collectRoom(view, scene, faces);
      const glass = collectGlass(view, quad, echoSkin);
      if (glass) faces.push(glass);
      paintFaces(ctx, faces);

      // Keep this frame for the next one to hang on the wall. It already has
      // the frame before it on the monitor inside it, which is where the depth
      // comes from — one copy, however far down the picture goes.
      if (echo && echoCtx) echoCtx.drawImage(canvas, 0, 0, echo.width, echo.height);

      // And lay the real browser over the glass it just painted.
      const screen = screenRef.current;
      if (screen) {
        // The browser is a real DOM element over the canvas, so no amount of
        // wall paints over it — the one thing in the room you can see from
        // anywhere in it. Left that way deliberately.
        const { width: screenWidth, height: screenHeight } = screenSizeRef.current;
        const matrix = quad ? quadTransform(quad, screenWidth, screenHeight) : null;
        if (matrix) {
          screen.style.transform = matrix;
          screen.style.visibility = "visible";
        } else {
          screen.style.visibility = "hidden";
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [nested, rayThrough]);

  const walking = phase === "standing";

  return (
    <div
      ref={wrapRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        border: "2px solid",
        borderColor: "#808080 #ffffff #ffffff #808080",
        background: "#11121a",
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          cursor: walking ? "crosshair" : "default",
          filter: lightsOn ? "none" : "brightness(0.1) saturate(0.5)",
          transition: "filter 120ms ease-out",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* The computer's screen: a browser, bent onto the monitor's glass by
          the same projection the room is painted with. It only takes clicks
          once you are sitting at it — otherwise it would swallow every drag
          you meant for looking around. A cubicle running inside a cubicle has
          no browser here at all: its monitor is painted on the canvas, out of
          the frame before this one. */}
      {!nested && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            perspective: "none",
          }}
        >
          <div
            ref={screenRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: screenSizeRef.current.width,
              height: screenSizeRef.current.height,
              transformOrigin: "0 0",
              // Deliberately no `willChange: "transform"` here. That hint
              // gets the browser to promote this to its own layer and keep
              // reusing one rasterized bitmap of it under cheap composited
              // scaling as the matrix keeps changing every frame, instead of
              // re-rasterizing the text at the new effective resolution —
              // which is why a freshly-opened window on the glass renders
              // crisp right next to stale, smeared text that's been sitting
              // there the whole time the transform kept moving.
              visibility: "hidden",
              background: "#c0c0c0",
              display: "flex",
              flexDirection: "column",
              pointerEvents: phase === "seated" ? "auto" : "none",
              overflow: "hidden",
            }}
          >
            <iframe
              src={HOME}
              title="The browser on the desk"
              style={{ flex: "1 1 auto", width: "100%", border: 0, display: "block", background: "#008080" }}
            />
          </div>
        </div>
      )}

      {walking && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 5,
            height: 5,
            marginLeft: -2.5,
            marginTop: -2.5,
            borderRadius: "50%",
            background: prompt ? "#ffe066" : "rgba(255,255,255,0.7)",
            boxShadow: "0 0 3px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        />
      )}

      {prompt && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 46,
            transform: "translateX(-50%)",
            padding: "3px 8px",
            fontSize: 11,
            whiteSpace: "nowrap",
            color: "#fff",
            background: "rgba(8,10,18,0.78)",
            border: "1px solid rgba(255,255,255,0.25)",
            pointerEvents: "none",
          }}
        >
          {prompt}
        </div>
      )}

      {walking && (
        <div
          style={{ position: "absolute", left: 10, bottom: 8 }}
          // The stick's own arrow-key nudging would fight the arrow keys that
          // are already turning you, and leave the stick parked off-centre.
          onKeyDownCapture={(event) => event.stopPropagation()}
        >
          <Joystick
            size={68}
            x={stick.x}
            y={stick.y}
            ariaLabel="Walk"
            readout=""
            onMove={onStickMove}
            onRelease={onStickRelease}
          />
        </div>
      )}

      {walking && (
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            fontSize: 11,
            textAlign: "right",
            lineHeight: 1.45,
            color: "rgba(232,238,248,0.9)",
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            pointerEvents: "none",
          }}
        >
          You hear a dull humming sound
          <br />
          sometimes with a slight buzz
        </div>
      )}

      {phase === "seated" && (
        <Button
          onClick={() => sit("standing")}
          size="sm"
          style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11, zIndex: 2 }}
        >
          Stand up (Esc)
        </Button>
      )}

      {phase === "intro" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3,
          }}
        >
          <Window style={{ width: "min(320px, 92%)" }}>
            <WindowHeader>Welcome!</WindowHeader>
            <WindowContent>
              <p style={{ fontSize: 12, lineHeight: 1.45, margin: "0 0 10px" }}>
                This is your new office.
                <br />
                - Arrow keys, WASD, or joystick to move.
                <br />
                - Drag to look around.
                <br />
                {nested ? "- How deep does the rabbit hole go?" : "- IT has set up your computer."}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button onClick={start}>Start the day</Button>
              </div>
            </WindowContent>
          </Window>
        </div>
      )}
    </div>
  );
}
