"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ProgressBar, Window, WindowContent } from "react95";
import { Joystick } from "@/components/windows/MpkPanel";
import { Crowns, loadCrowns, loadTrees, Trees } from "@/lib/trees";
import { dayLabel, phenology, RGB, seasonColor, todayDoy } from "@/lib/treeSeasons";
import { loadTerrain, Terrain } from "@/lib/terrain";
import { loadPlaces, Places } from "@/lib/places";
import { groundZ, makeGround, treeForms } from "@/lib/treesTilt";
import {
  EYE,
  PITCH_LIMIT,
  WalkCamera,
  WalkFrame,
  WalkWorld,
  gridTrees,
  isWet,
  renderWalk,
  walkFrame,
} from "@/lib/treesWalk";

/**
 * Behind the doors down cubicles.exe's hallway, once a day worked on Medium or
 * Hard has opened them: you, out of the office and stood among Seattle's
 * trees, at one of DROP_INS, as they look today — and then through the year.
 * The same data trees.exe draws, every layer of it — street, park and campus
 * trees, the LiDAR canopy, parks, creeks, gardens, track and areaways on the
 * wireframe ground — from eye height (treesWalk.ts), walked about
 * with the cubicle's own controls — WASD or the arrows or the stick, drag to
 * look. Esc, or the button, goes back in.
 *
 * `light` is Hard's: gravity turned right down, and Space to jump clean over
 * the trees.
 *
 * It owns the whole cubicle window while it's up, and loads its own copy of
 * the trees: trees.exe's is in the iframe on the desk, a frame away.
 */

const pack = (c: RGB) => ((255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);
/** Metres a second: walking, and with Shift held. */
const WALK = 4.5;
const RUN = 22;
/** Radians per pixel dragged, and a second on the arrow keys — the cubicle's. */
const LOOK = 0.0045;
const TURN = 2;
const STICK_DEAD_ZONE = 0.18;
/** The picture is drawn no wider than this and blown up, square pixels and all. */
const MAX_WIDTH = 560;
/** Coming down into the diorama from the angle trees.exe shows it at. */
const DROP_MS = 2400;
const DROP_BACK = 300;
const DROP_UP = 175;
/** Hard's weight: metres a second squared, and how fast a jump leaves the ground — some fifty metres up. */
const LIGHT_GRAVITY = 2.4;
const LIGHT_JUMP = 16;
/** The year goes round as trees.exe's Season view plays it: about thirty seconds a turn. */
const DAYS_PER_SECOND = 12;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type Data = { trees: Trees; terrain: Terrain | null };
/** A place to come down, and how to stand once there: radians clockwise from north, and above level. */
export type Landing = { lat: number; lon: number; yaw: number; pitch: number };

/** The world, and what it takes to colour it again for another day. */
type Scene = WalkWorld & {
  nStreet: number;
  species16: Uint16Array;
  phen: ReturnType<typeof phenology>[];
  /** The canopy's conifers, 1 each; null until the canopy is in. */
  conifer: Uint8Array | null;
};

const BROADLEAF = phenology({ common: "", scientific: "", genus: "Unknown" });
const CONIFER = phenology({ common: "", scientific: "", genus: "Pseudotsuga" });

/** Everything worth drawing. The canopy joins once it's in. Colours are left to paintSeason. */
function buildWorld({ trees, terrain }: Data, crowns: Crowns | null): Scene {
  const { south, north, west, east } = trees.bbox;
  const lat = ((south + north) / 2) * (Math.PI / 180);
  const widthM = (east - west) * 111320 * Math.cos(lat);
  const heightM = (north - south) * 110574;
  const ground = terrain ? makeGround(terrain, trees.bbox, widthM, heightM) : null;
  const nS = trees.count;
  const nC = crowns?.count ?? 0;
  const n = nS + nC;
  const mx = new Float32Array(n);
  const my = new Float32Array(n);
  const forms = treeForms(trees.species, trees.species16, trees.diam);
  const height = new Float32Array(n);
  const crown = new Float32Array(n);
  const shape = new Uint8Array(n);
  height.set(forms.height);
  crown.set(forms.crown);
  shape.set(forms.shape);
  for (let i = 0; i < nS; i++) {
    mx[i] = (trees.x[i] / 65535) * widthM;
    my[i] = (trees.y[i] / 65535) * heightM;
    if (crowns && crowns.streetHeight[i] > 0) height[i] = crowns.streetHeight[i];
  }
  if (crowns) {
    for (let c = 0; c < nC; c++) {
      const i = nS + c;
      mx[i] = (crowns.x[c] / 65535) * widthM;
      my[i] = (crowns.y[c] / 65535) * heightM;
      height[i] = crowns.height[c];
      crown[i] = crowns.radius[c];
      shape[i] = crowns.conifer[c] ? 1 : 0;
    }
  }
  const gz = new Float32Array(n);
  if (ground) for (let i = 0; i < n; i++) gz[i] = groundZ(ground, mx[i], my[i]);
  const color = new Uint32Array(n);
  const bare = new Uint8Array(n);
  return {
    ...gridTrees({ widthM, heightM, ground, n, mx, my, gz, height, crown, shape, color, bare }),
    nStreet: nS,
    species16: trees.species16,
    phen: trees.species.map(phenology),
    conifer: crowns?.conifer ?? null,
  };
}

/** Every tree as it looks on a day of the year, as trees.exe's Season view colours it. */
function paintSeason(scene: Scene, day: number) {
  const { color, bare, nStreet, species16, conifer } = scene;
  const looks = scene.phen.map((p) => seasonColor(p, day));
  const palette = Uint32Array.from(looks, (l) => pack(l.rgb));
  const bareOf = Uint8Array.from(looks, (l) => (l.state === "bare" ? 1 : 0));
  for (let i = 0; i < nStreet; i++) {
    const s = species16[i];
    color[i] = palette[s];
    bare[i] = bareOf[s];
  }
  if (!conifer) return;
  const broad = seasonColor(BROADLEAF, day);
  const cone = pack(seasonColor(CONIFER, day).rgb);
  const leaf = pack(broad.rgb);
  const leafBare = broad.state === "bare" ? 1 : 0;
  for (let c = 0; c < conifer.length; c++) {
    const i = nStreet + c;
    color[i] = conifer[c] ? cone : leaf;
    bare[i] = conifer[c] ? 0 : leafBare;
  }
}

function groundAt(world: WalkWorld, x: number, y: number) {
  return world.ground ? groundZ(world.ground, x, y) : 0;
}

export default function TreesWalk({
  active,
  onLeave,
  landing,
  light = false,
}: {
  active: boolean;
  onLeave: () => void;
  /** Where to come down. */
  landing: Landing;
  /** Low gravity, and Space to jump. */
  light?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [data, setData] = useState<Data | null>(null);
  const [crowns, setCrowns] = useState<Crowns | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    // The street trees and the hills first: enough to stand in. The canopy is
    // three times the size of both, so it follows on and fills in round you.
    Promise.all([loadTrees(abort.signal, setProgress), loadTerrain(abort.signal).catch(() => null)])
      .then(([trees, terrain]) => {
        setData({ trees, terrain });
        loadCrowns(abort.signal)
          .then(setCrowns)
          .catch(() => {});
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, []);

  const world = useMemo(() => (data ? buildWorld(data, crowns) : null), [data, crowns]);
  const worldRef = useRef(world);
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  // The parks, creeks, gardens, track and areaways: small, so they follow the trees straight in.
  const placesRef = useRef<Places | null>(null);
  const widthM = world?.widthM ?? 0;
  const heightM = world?.heightM ?? 0;
  useEffect(() => {
    if (!data || !widthM) return;
    const abort = new AbortController();
    loadPlaces(data.trees, widthM, heightM, abort.signal)
      .then((loaded) => {
        placesRef.current = loaded;
      })
      .catch(() => {});
    return () => abort.abort();
  }, [data, widthM, heightM]);

  const camRef = useRef<WalkCamera | null>(null);
  const dropRef = useRef<{ from: WalkCamera; t: number } | null>(null);
  // Land the first time there's a world to land in — not again when the canopy turns up.
  useEffect(() => {
    if (!world || !data || camRef.current) return;
    const { south, north, west, east } = data.trees.bbox;
    const spot = {
      x: ((landing.lon - west) / (east - west)) * world.widthM,
      y: ((landing.lat - south) / (north - south)) * world.heightM,
      yaw: landing.yaw,
    };
    const z = groundAt(world, spot.x, spot.y) + EYE;
    const to: WalkCamera = { x: spot.x, y: spot.y, z, yaw: spot.yaw, pitch: landing.pitch };
    camRef.current = to;
    dropRef.current = {
      from: {
        x: spot.x - Math.sin(spot.yaw) * DROP_BACK,
        y: spot.y - Math.cos(spot.yaw) * DROP_BACK,
        z: z + DROP_UP,
        yaw: spot.yaw,
        pitch: -Math.atan2(DROP_UP, DROP_BACK),
      },
      t: 0,
    };
  }, [world, data, landing]);

  /* -------------------------------------------------------------- input */

  const keysRef = useRef<Set<string>>(new Set());
  /** A jump asked for, taken the next frame you're on the ground. */
  const jumpRef = useRef(false);
  const lightRef = useRef(light);
  useEffect(() => {
    lightRef.current = light;
  }, [light]);
  const stickRef = useRef({ x: 0, y: 0 });
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      keysRef.current.clear();
      stickRef.current = { x: 0, y: 0 };
    }
  }, [active]);

  // Take the keyboard, in case it's still sitting in the computer on the
  // desk — keys pressed in there never reach this window.
  useEffect(() => {
    window.focus();
    wrapRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!activeRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Escape") {
        event.preventDefault();
        onLeave();
        return;
      }
      if (event.code === "Space" && lightRef.current) {
        event.preventDefault();
        jumpRef.current = true;
        return;
      }
      if (!MOVE_KEYS.has(event.code)) return;
      event.preventDefault();
      keysRef.current.add(event.code);
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
  }, [onLeave]);

  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const cam = camRef.current;
    if (!drag || drag.id !== event.pointerId || !cam || dropRef.current) return;
    cam.yaw += (event.clientX - drag.x) * LOOK;
    cam.pitch = clamp(cam.pitch - (event.clientY - drag.y) * LOOK, -PITCH_LIMIT, PITCH_LIMIT);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onStickMove = useCallback((x: number, y: number) => {
    setStick({ x, y });
    stickRef.current = { x, y };
  }, []);
  const onStickRelease = useCallback(() => {
    setStick({ x: 0, y: 0 });
    stickRef.current = { x: 0, y: 0 };
  }, []);

  /* --------------------------------------------------------------- loop */

  const [prompt, setPrompt] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [landed, setLanded] = useState(false);
  const describeRef = useRef<(i: number) => string | null>(() => null);
  useEffect(() => {
    describeRef.current = (i: number) => {
    if (!data || !world || i < 0) return null;
    const metres = `${Math.round(world.height[i])} m tall`;
    if (i >= world.nStreet) return `${crowns?.conifer[i - world.nStreet] ? "Conifer" : "Broadleaf tree"} · ${metres}`;
    const { trees } = data;
    const sp = trees.species[trees.species16[i]];
    const flags = trees.flags[i];
    const note = flags & 4 ? " · heritage tree" : flags & 8 ? " · exceptional tree" : "";
    return `${sp.common} · ${metres}${note}`;
    };
  }, [data, world, crowns]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame: WalkFrame | null = null;
    let image: ImageData | null = null;
    const fit = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      const k = Math.max(1, cssW / MAX_WIDTH);
      const W = Math.max(1, Math.round(cssW / k));
      const H = Math.max(1, Math.round(cssH / k));
      canvas.width = W;
      canvas.height = H;
      image = ctx.createImageData(W, H);
      frame = walkFrame(W, H, new Uint32Array(image.data.buffer));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);

    const held = (...codes: string[]) => codes.some((code) => keysRef.current.has(code));
    let raf = 0;
    let last = performance.now();
    let bob = 0;
    // The year, from today, and which day and which world the trees were last coloured for.
    let day = todayDoy();
    let paintedDay = -1;
    let paintedWorld: Scene | null = null;
    /** Metres a second upward; only ever not zero with `light` on. */
    let rise = 0;
    let shown: string | null = null;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const w = worldRef.current;
      const cam = camRef.current;
      if (!w || !cam || !frame || !image) return;

      let eye: WalkCamera = cam;
      const drop = dropRef.current;
      if (drop) {
        drop.t = Math.min(1, drop.t + (dt * 1000) / DROP_MS);
        const t = ease(drop.t);
        const mix = (a: number, b: number) => a + (b - a) * t;
        eye = {
          x: mix(drop.from.x, cam.x),
          y: mix(drop.from.y, cam.y),
          z: mix(drop.from.z, cam.z),
          yaw: cam.yaw,
          pitch: mix(drop.from.pitch, cam.pitch),
        };
        if (drop.t >= 1) {
          dropRef.current = null;
          setLanded(true);
        }
      } else {
        cam.yaw += ((held("ArrowRight") ? 1 : 0) - (held("ArrowLeft") ? 1 : 0)) * TURN * dt;
        const airborne = cam.z > groundAt(w, cam.x, cam.y) + EYE + 0.05;
        let side = (held("KeyD") ? 1 : 0) - (held("KeyA") ? 1 : 0);
        let ahead = (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0);
        const push = stickRef.current;
        if (Math.hypot(push.x, push.y) > STICK_DEAD_ZONE) {
          side = push.x;
          ahead = push.y;
        }
        const amount = Math.hypot(side, ahead);
        if (amount > 1e-3) {
          const speed = (held("ShiftLeft", "ShiftRight") ? RUN : WALK) * Math.min(1, amount) * dt;
          const sx = side / amount;
          const sa = ahead / amount;
          const dx = (Math.sin(cam.yaw) * sa + Math.cos(cam.yaw) * sx) * speed;
          const dy = (Math.cos(cam.yaw) * sa - Math.sin(cam.yaw) * sx) * speed;
          // Not off the edge of the table, and not into the Sound: slide along the shore instead.
          // In the air, or already in it (come down there off a jump), the water doesn't stop you.
          const free = airborne || isWet(w.ground, cam.x, cam.y);
          const ok = (x: number, y: number) =>
            x > 1 && y > 1 && x < w.widthM - 1 && y < w.heightM - 1 && (free || !isWet(w.ground, x, y));
          if (ok(cam.x + dx, cam.y + dy)) {
            cam.x += dx;
            cam.y += dy;
          } else if (ok(cam.x + dx, cam.y)) cam.x += dx;
          else if (ok(cam.x, cam.y + dy)) cam.y += dy;
          bob = airborne ? 0 : bob + dt * (held("ShiftLeft", "ShiftRight") ? 11 : 7.5);
        } else bob = 0;
        const floor = groundAt(w, cam.x, cam.y) + EYE;
        if (lightRef.current) {
          if (jumpRef.current && !airborne) rise = LIGHT_JUMP;
          rise -= LIGHT_GRAVITY * dt;
          cam.z += rise * dt;
          if (cam.z <= floor) {
            cam.z = floor;
            rise = 0;
          }
        } else cam.z = floor;
        jumpRef.current = false;
        eye = { ...cam, z: cam.z + (bob ? Math.sin(bob) * 0.04 : 0) };
      }

      // Today's trees as you come down; the year only starts going round once you've landed.
      if (!dropRef.current) day = (day + dt * DAYS_PER_SECOND) % 365;
      const today = Math.floor(day);
      if (today !== paintedDay || w !== paintedWorld) {
        paintSeason(w, today);
        paintedDay = today;
        paintedWorld = w;
        setDate(dayLabel(today));
      }

      renderWalk(frame, eye, w, placesRef.current);
      ctx.putImageData(image, 0, 0);

      // Whatever tree the crosshair is on.
      const at = frame.id[(frame.H >> 1) * frame.W + (frame.W >> 1)];
      const text = dropRef.current ? null : describeRef.current(at);
      if (text !== shown) {
        shown = text;
        setPrompt(text);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={-1}
      style={{ position: "absolute", inset: 0, zIndex: 4, background: "#b6c0c2", outline: "none", touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated", cursor: "crosshair" }}
      />

      {!world && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <Window style={{ width: 240, maxWidth: "100%" }}>
            <WindowContent style={{ padding: 8, fontSize: 12 }}>
              <div style={{ marginBottom: 6 }}>{failed ? "The trees aren't there." : "Going outside…"}</div>
              {failed ? (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button onClick={onLeave}>Back to the office</Button>
                </div>
              ) : (
                <ProgressBar
                  value={progress === null ? undefined : Math.round(progress * 100)}
                  variant={progress === null ? "tile" : "default"}
                  hideValue={progress === null}
                  style={{ height: 22 }}
                />
              )}
            </WindowContent>
          </Window>
        </div>
      )}

      {landed && (
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

      {landed && (
        <>
          <div style={{ position: "absolute", left: 10, bottom: 8 }} onKeyDownCapture={(event) => event.stopPropagation()}>
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
          <div
            style={{
              position: "absolute",
              right: 8,
              top: 8,
              fontSize: 11,
              textAlign: "right",
              lineHeight: 1.45,
              color: "rgba(20,26,24,0.85)",
              textShadow: "0 1px 1px rgba(255,255,255,0.4)",
              pointerEvents: "none",
            }}
          >
            {date}
            <br />
            {light ? "You feel very light" : "It smells like rain"}
            <br />
            {light ? "Space to jump, Shift to run" : "Shift to run"}
          </div>
          {light && (
            // For a touch screen, with no Space bar.
            <Button
              onPointerDown={() => (jumpRef.current = true)}
              size="sm"
              style={{ position: "absolute", right: 8, bottom: 40, fontSize: 11 }}
            >
              Jump (Space)
            </Button>
          )}
          <Button onClick={onLeave} size="sm" style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11 }}>
            Back to the office (Esc)
          </Button>
        </>
      )}
    </div>
  );
}
