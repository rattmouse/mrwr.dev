"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ProgressBar, Window, WindowContent } from "react95";
import { Joystick } from "@/components/windows/MpkPanel";
import { Crowns, loadCrowns, loadTrees, Trees } from "@/lib/trees";
import { dayLabel, phenology, RGB, seasonColor, todayDoy } from "@/lib/treeSeasons";
import { CONIFER_COLOR, CROWN_BROADLEAF, CROWN_CONIFER, hexRgb, plantedColor, speciesGroups, YEAR_MIN } from "@/lib/treeColors";
import { clockLabel, lightFrom, seattleInstant, sunPosition } from "@/lib/sun";
import type { TreesMode } from "@/components/windows/TreesWindow";
import { loadTerrain, Terrain } from "@/lib/terrain";
import { loadPlaces, Places } from "@/lib/places";
import { groundZ, makeGround, treeForms } from "@/lib/treesTilt";
import { walkerChannel, WalkerLayers, WalkerMap, WalkerMessage } from "@/lib/treesWalker";
import TreesRingMenu, { RingNode } from "@/components/windows/TreesRingMenu";
import { coloringItems, dayItem, layerItems, playItem, treesRing } from "@/components/windows/treesMenu";
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
 * Space jumps. Medium's day leaves you as you are: Earth's gravity, a jump
 * of half a metre, a sprint a person could keep up. `light` is Hard's:
 * gravity turned right down, a jump clean over the trees, and faster legs.
 *
 * Wherever you are, trees.exe hears about it (treesWalker.ts) and draws you
 * on its map.
 *
 * Right-click brings up trees.exe's ring menu, with what applies out here:
 * the year's playback and its Day slider, and the layers, plus a way back in.
 * Once a Hard day has been worked (`full`), Type and Age's colorings — Age
 * with its own years to play through — and the Sun, which lights the walk by
 * its hour, come too.
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
/**
 * How you move: metres a second squared down, metres a second up off the
 * ground when you jump, and metres a second walking and with Shift held.
 * Medium's is a person's: a jump of half a metre, a sprint of eight. Hard's
 * jump goes some fifty metres up.
 */
type Body = { gravity: number; jump: number; walk: number; run: number };
const NORMAL: Body = { gravity: 9.81, jump: 3.1, walk: 4.5, run: 8 };
const LIGHT: Body = { gravity: 2.4, jump: 16, walk: 6.5, run: 22 };
/** How often trees.exe is told where you are. */
const TELL_MS = 100;
/** The year goes round as trees.exe's Season view plays it: about thirty seconds a turn. */
const DAYS_PER_SECOND = 12;
/** Age's years go by as trees.exe's do: three a second. */
const YEARS_PER_SECOND = 3;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type Data = { trees: Trees; terrain: Terrain | null };
/** A place to come down, and how to stand once there: radians clockwise from north, and above level. */
export type Landing = { lat: number; lon: number; yaw: number; pitch: number };

/** The world, and what it takes to colour it again for another day. */
type Scene = WalkWorld & {
  nStreet: number;
  species16: Uint16Array;
  /** Year planted − 1900, 0 undated: Age's. */
  year: Uint8Array;
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
    year: trees.year,
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

/** What's drawn, the right-click menu's Layers: trees.exe's five. */
type WalkLayers = WalkerLayers;
const LAYER_NAMES: { key: keyof WalkLayers; label: string; title: string }[] = [
  { key: "street", label: "Street", title: "The city's street, park and campus trees" },
  { key: "canopy", label: "Canopy", title: "Every other tree, from the 2021 LiDAR survey" },
  { key: "parks", label: "Parks", title: "Parks, restoration zones and P-Patch gardens on the ground" },
  { key: "water", label: "Water", title: "Creeks" },
  { key: "underground", label: "Underground", title: "The areaways and Link light rail" },
];

/** How the trees are coloured, other than Season's: Type's legend and the kind picked out of it, or Age's year. */
type Look = { mode: TreesMode; group: number | null; year: number };
type Legend = { colors: Uint32Array; groupOf: Uint8Array; conifer: number };

/**
 * Type's or Age's colours, as trees.exe paints them — except that a tree
 * trees.exe would draw faintly (another kind than the one picked out, or not
 * planted yet) isn't drawn at all, there being no dark map behind it here.
 */
function paintLook(scene: Scene, look: Look, legend: Legend) {
  const { color, bare, nStreet, species16, year, conifer } = scene;
  bare.fill(0);
  if (look.mode === "species") {
    for (let i = 0; i < nStreet; i++) {
      const g = legend.groupOf[species16[i]];
      color[i] = look.group === null || look.group === g ? legend.colors[g] : 0;
    }
    if (!conifer) return;
    const coneOn = look.group === null || look.group === legend.conifer;
    const cone = pack(look.group === null ? CROWN_CONIFER : hexRgb(CONIFER_COLOR));
    const broad = look.group === null ? pack(CROWN_BROADLEAF) : 0;
    for (let c = 0; c < conifer.length; c++) color[nStreet + c] = conifer[c] ? (coneOn ? cone : 0) : broad;
    return;
  }
  // Age: the dated street trees standing by the year, the newest brightest; the undated canopy stays out of it.
  for (let i = 0; i < nStreet; i++) {
    const y = year[i];
    color[i] = y && 1900 + y <= look.year ? pack(plantedColor(look.year - 1900 - y)) : 0;
  }
  color.fill(0, nStreet);
}

/**
 * The Sun's light on the whole scene at an hour: full and white at midday,
 * gold and lower near sunrise and sunset, blue and dim at night. Channel
 * multipliers for the finished frame.
 */
function sunTint(year: number, day: number, minutes: number): [number, number, number] {
  const light = lightFrom(sunPosition(seattleInstant(year, day, minutes)));
  const lit = 0.22 + 0.78 * light.day;
  const gold = light.day > 0 ? Math.max(0, 1 - light.altitude / 20) * light.day : 0;
  const night = 1 - light.day;
  return [lit * (1 + 0.18 * gold) * (1 - 0.25 * night), lit * (1 - 0.04 * gold) * (1 - 0.1 * night), lit * (1 - 0.35 * gold) * (1 + 0.35 * night)];
}

function groundAt(world: WalkWorld, x: number, y: number) {
  return world.ground ? groundZ(world.ground, x, y) : 0;
}

export default function TreesWalk({
  active,
  onLeave,
  landing,
  light = false,
  full = false,
}: {
  active: boolean;
  onLeave: () => void;
  /** Where to come down. */
  landing: Landing;
  /** Hard's low gravity, high jump and fast legs. */
  light?: boolean;
  /** A Hard day's been worked: every coloring, and the Sun, on the menu. */
  full?: boolean;
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
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
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
      if (event.code === "Space") {
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
    // Only the left button looks about; the right one brings up the menu.
    if (event.button !== 0) return;
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
  // The day the trees are coloured for, and whether the year is going round
  // (from landing, until the menu's Pause). The loop keeps its own copies in
  // refs, so the menu can scrub and pause it without restarting it.
  const [today, setToday] = useState<number | null>(null);
  const dayRef = useRef(todayDoy());
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  const [layers, setLayers] = useState<WalkLayers>({ street: true, canopy: true, parks: true, water: true, underground: true });
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  // Hard's extras: Type and Age's colorings — Age with its own year to play
  // through — and the Sun's hour, null while it's left as it was.
  const [look, setLook] = useState<Look>({ mode: "season", group: null, year: new Date().getFullYear() });
  const lookRef = useRef(look);
  useEffect(() => {
    lookRef.current = look;
  }, [look]);
  const [sunHour, setSunHour] = useState<number | null>(null);
  const sunRef = useRef<number | null>(null);
  useEffect(() => {
    sunRef.current = sunHour;
  }, [sunHour]);
  const legend = useMemo(() => {
    if (!data) return null;
    const { trees } = data;
    const counts = new Int32Array(trees.species.length);
    for (let i = 0; i < trees.count; i++) counts[trees.species16[i]]++;
    const { groups, groupOf } = speciesGroups(trees, counts);
    const nowYear = new Date().getFullYear();
    let yearMax = YEAR_MIN;
    for (let i = 0; i < trees.count; i++) {
      const y = trees.year[i];
      if (y && 1900 + y <= nowYear) yearMax = Math.max(yearMax, 1900 + y);
    }
    return {
      groups,
      yearMax,
      paint: {
        colors: Uint32Array.from(groups, (g) => pack(hexRgb(g.color))),
        groupOf,
        conifer: groups.findIndex((g) => g.key === "conifers"),
      } satisfies Legend,
    };
  }, [data]);
  const legendRef = useRef(legend);
  useEffect(() => {
    legendRef.current = legend;
  }, [legend]);
  // The menu's settings go to trees.exe too, wherever it's open, so its map shows what the walk does.
  const mapChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const channel = walkerChannel();
    mapChannelRef.current = channel;
    return () => {
      mapChannelRef.current = null;
      channel?.close();
    };
  }, []);
  const tellMap = useCallback((message: Omit<WalkerMap, "type">) => {
    mapChannelRef.current?.postMessage({ type: "map", ...message } satisfies WalkerMap);
  }, []);
  const setMode = useCallback(
    (mode: TreesMode) => {
      setPlaying(false);
      setLook((cur) => ({ ...cur, mode, group: null }));
      tellMap({ trees: { mode, group: null, playing: false } });
    },
    [tellMap],
  );
  const togglePlay = useCallback(() => {
    // Age at its last year starts again from its first, as trees.exe's does.
    const lg = legendRef.current;
    let year = lookRef.current.year;
    if (!playingRef.current && lookRef.current.mode === "planted" && lg && year >= lg.yearMax) {
      year = YEAR_MIN;
      setLook((cur) => ({ ...cur, year }));
    }
    const playing = !playingRef.current;
    setPlaying(playing);
    // Where it's got to as well, so the two start (or stop) together.
    tellMap({ trees: { playing, day: Math.floor(dayRef.current), year } });
  }, [tellMap]);
  const scrubYear = useCallback(
    (year: number) => {
      setPlaying(false);
      setLook((cur) => ({ ...cur, year }));
      tellMap({ trees: { year, playing: false } });
    },
    [tellMap],
  );
  const pickGroup = useCallback(
    (k: number) => {
      const group = lookRef.current.group === k ? null : k;
      setLook((cur) => ({ ...cur, group }));
      tellMap({ trees: { group } });
    },
    [tellMap],
  );
  const toggleLayer = useCallback(
    (key: keyof WalkLayers) => {
      const next = { ...layersRef.current, [key]: !layersRef.current[key] };
      setLayers(next);
      tellMap({ layers: next });
    },
    [tellMap],
  );
  const pickSunHour = useCallback(
    (hour: number) => {
      const next = sunRef.current === hour ? null : hour;
      setSunHour(next);
      // Back to plain daylight here leaves trees.exe's Sun where it was.
      if (next !== null) tellMap({ sunHour: next });
    },
    [tellMap],
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // The menu's Day slider: the year stops where it's put, as trees.exe's does.
  const scrubDay = useCallback(
    (d: number) => {
      setPlaying(false);
      dayRef.current = d;
      setToday(d);
      tellMap({ trees: { day: d, playing: false } });
    },
    [tellMap],
  );
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
    // Which day, which world and which layers the trees were last coloured for.
    let paintedDay = -1;
    let paintedLayers: WalkLayers | null = null;
    let paintedLook: Look | null = null;
    /** Age's year, counted up in fractions while it plays. */
    let ageClock = 0;
    let tint: [number, number, number] | null = null;
    let tintFor = "";
    let paintedWorld: Scene | null = null;
    /** Metres a second upward. */
    let rise = 0;
    /** Stood on the ground last frame, so a slope down is walked, not fallen off. */
    let grounded = true;
    const channel = walkerChannel();
    const bbox = () => dataRef.current?.trees.bbox ?? null;
    let told = 0;
    /** Where trees.exe last put you down by dragging you across its map, not yet stepped to. */
    let moveTo: { lat: number; lon: number } | null = null;
    if (channel)
      channel.onmessage = (event: MessageEvent<WalkerMessage>) => {
        if (event.data?.type === "move") moveTo = event.data;
      };
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
        const box = bbox();
        if (moveTo && box) {
          // Picked up and put down elsewhere: as high off the ground there as you were here.
          const lift = cam.z - groundAt(w, cam.x, cam.y);
          cam.x = clamp(((moveTo.lon - box.west) / (box.east - box.west)) * w.widthM, 1, w.widthM - 1);
          cam.y = clamp(((moveTo.lat - box.south) / (box.north - box.south)) * w.heightM, 1, w.heightM - 1);
          cam.z = groundAt(w, cam.x, cam.y) + lift;
        }
        moveTo = null;
        const body = lightRef.current ? LIGHT : NORMAL;
        cam.yaw += ((held("ArrowRight") ? 1 : 0) - (held("ArrowLeft") ? 1 : 0)) * TURN * dt;
        const airborne = !grounded;
        let side = (held("KeyD") ? 1 : 0) - (held("KeyA") ? 1 : 0);
        let ahead = (held("KeyW", "ArrowUp") ? 1 : 0) - (held("KeyS", "ArrowDown") ? 1 : 0);
        const push = stickRef.current;
        if (Math.hypot(push.x, push.y) > STICK_DEAD_ZONE) {
          side = push.x;
          ahead = push.y;
        }
        const amount = Math.hypot(side, ahead);
        if (amount > 1e-3) {
          const speed = (held("ShiftLeft", "ShiftRight") ? body.run : body.walk) * Math.min(1, amount) * dt;
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
        if (jumpRef.current && grounded) {
          rise = body.jump;
          grounded = false;
        }
        jumpRef.current = false;
        if (grounded && floor < cam.z) {
          // Downhill: kept on your feet, unless it drops away faster than a cliff would let you walk it.
          const fall = cam.z - floor;
          if (fall <= Math.max(0.3, body.run * dt * 1.5)) cam.z = floor;
          else grounded = false;
        }
        if (!grounded) {
          rise -= body.gravity * dt;
          cam.z += rise * dt;
        }
        if (cam.z <= floor) {
          cam.z = floor;
          rise = 0;
          grounded = true;
        }
        eye = { ...cam, z: cam.z + (bob ? Math.sin(bob) * 0.04 : 0) };
      }

      // Today's trees as you come down; the year only starts going round once
      // you've landed, and stops while the menu has it paused.
      const look = lookRef.current;
      const legend = legendRef.current;
      if (!dropRef.current && playingRef.current) {
        if (look.mode === "season") dayRef.current = (dayRef.current + dt * DAYS_PER_SECOND) % 365;
        else if (look.mode === "planted" && legend) {
          ageClock += dt * YEARS_PER_SECOND;
          if (ageClock >= 1) {
            ageClock = 0;
            const next = Math.min(legend.yearMax, look.year + 1);
            setLook((cur) => ({ ...cur, year: next }));
            if (next >= legend.yearMax) setPlaying(false);
          }
        }
      }
      const day = Math.floor(dayRef.current);
      const shownLayers = layersRef.current;
      // Season's colours change with the day; Type's and Age's don't, so they're painted only when the look does.
      const stale = look.mode === "season" ? day !== paintedDay : look !== paintedLook;
      if (stale || w !== paintedWorld || shownLayers !== paintedLayers || look.mode !== paintedLook?.mode) {
        if (look.mode !== "season" && legend) paintLook(w, look, legend.paint);
        else paintSeason(w, day);
        paintedLook = look;
        // A colour of 0 isn't drawn: the street trees come first in the world, the canopy after.
        const nStreet = Math.min(w.nStreet, w.n);
        if (!shownLayers.street) w.color.fill(0, 0, nStreet);
        if (!shownLayers.canopy) w.color.fill(0, nStreet, w.n);
        paintedDay = day;
        paintedWorld = w;
        paintedLayers = shownLayers;
        setToday(day);
      }

      // trees.exe, wherever it's open, puts you on its map.
      const box = bbox();
      if (channel && box && !dropRef.current && now - told >= TELL_MS) {
        told = now;
        const ground = groundAt(w, cam.x, cam.y);
        channel.postMessage({
          type: "at",
          lat: box.south + (cam.y / w.heightM) * (box.north - box.south),
          lon: box.west + (cam.x / w.widthM) * (box.east - box.west),
          z: cam.z - EYE,
          ground,
          yaw: cam.yaw,
        });
      }

      renderWalk(frame, eye, w, placesRef.current, layersRef.current);
      // The Sun at its hour, over everything: worked out again only when the hour or the day moves.
      const hour = sunRef.current;
      if (hour !== null) {
        const key = `${hour}/${day}`;
        if (key !== tintFor) {
          tint = sunTint(new Date().getFullYear(), day, hour * 60);
          tintFor = key;
        }
        const [kr, kg, kb] = tint!;
        const buf = frame.buf;
        for (let p = 0; p < buf.length; p++) {
          const c = buf[p];
          const r = Math.min(255, (c & 255) * kr);
          const g = Math.min(255, ((c >>> 8) & 255) * kg);
          const b = Math.min(255, ((c >>> 16) & 255) * kb);
          buf[p] = ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
        }
      }
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
      channel?.postMessage({ type: "gone" });
      channel?.close();
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
        onContextMenu={(event) => {
          event.preventDefault();
          if (landed) setMenu({ x: event.clientX, y: event.clientY });
        }}
        style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated", cursor: "crosshair" }}
      />
      {/* Put away with the cubicle window when it goes inactive. */}
      {menu && active && today !== null && (
        <TreesRingMenu
          x={menu.x}
          y={menu.y}
          start={90}
          onDismiss={closeMenu}
          wedges={[
            {
              label: "Trees",
              value: look.mode === "season" ? "Season" : look.mode === "species" ? "Type" : "Age",
              ring: treesRing(
                coloringItems(look.mode, setMode, (mode) => full || mode === "season", "work a Hard day first"),
                playItem(
                  playing,
                  togglePlay,
                  look.mode !== "species",
                  look.mode === "species" ? "Play: Season and Age only" : playing ? "Pause" : look.mode === "planted" ? "Play the years" : "Play the year",
                ),
                look.mode === "species"
                  ? {
                      label: "Types",
                      title: "Pick out one kind of tree",
                      disabled: !legend,
                      ring: {
                        step: 360 / Math.max(1, legend?.groups.length ?? 1),
                        start: -90,
                        items: (legend?.groups ?? []).map((g, k) => ({
                          label: g.label,
                          title: look.group === k ? `${g.label}: show every tree again` : `${g.label}: show only these`,
                          paint: g.color,
                          faded: look.group !== null && look.group !== k,
                          role: "menuitemcheckbox",
                          on: look.group === k,
                          keepOpen: true,
                          onSelect: () => pickGroup(k),
                        })),
                      },
                    }
                  : look.mode === "planted"
                    ? {
                        label: "Year",
                        value: String(look.year),
                        title: "Drag along the arc to move through the years",
                        keepOpen: true,
                        scrub: {
                          value: look.year,
                          min: YEAR_MIN,
                          max: legend?.yearMax ?? look.year,
                          step: 1,
                          ticks: Array.from({ length: Math.floor((legend?.yearMax ?? YEAR_MIN) / 10) - YEAR_MIN / 10 + 1 }, (_, k) => YEAR_MIN + k * 10),
                          onChange: scrubYear,
                        },
                      }
                    : dayItem(today, scrubDay),
              ),
            },
            {
              label: "Map",
              value: "Walk",
              ring: {
                step: 45,
                items: [
                  {
                    label: "Layers",
                    value: `${LAYER_NAMES.filter((l) => layers[l.key] && !(l.key === "canopy" && look.mode === "planted")).length}/${LAYER_NAMES.length}`,
                    ring: {
                      step: 30,
                      items: layerItems(
                        LAYER_NAMES.map((l) => ({
                          ...l,
                          on: layers[l.key],
                          // The canopy has no planting dates, so Age leaves it out anyway — as trees.exe does.
                          disabled: l.key === "canopy" && look.mode === "planted",
                          toggle: () => toggleLayer(l.key),
                        })),
                      ),
                    },
                  },
                  {
                    label: "Sun",
                    value: sunHour === null ? "Off" : `${sunHour}:00`,
                    disabled: !full,
                    title: full ? (sunHour === null ? "Light the walk by the sun at an hour" : `${clockLabel(sunHour * 60)}, Seattle time`) : "Sun: work a Hard day first",
                    ring: {
                      step: 15,
                      start: -90 - 15 / 2,
                      items: Array.from({ length: 24 }, (_, h) => ({
                        label: String(h),
                        title: sunHour === h ? "Back to plain daylight" : `${clockLabel(h * 60)}, Seattle time`,
                        role: "menuitemradio",
                        on: sunHour === h,
                        keepOpen: true,
                        onSelect: () => pickSunHour(h),
                      })),
                    },
                  },
                  { label: "Leave", title: "Back to the office (Esc)", onSelect: onLeave } satisfies RingNode,
                ],
              },
            },
          ]}
        />
      )}

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
            {today === null ? null : dayLabel(today)}
            <br />
            {light ? "You feel very light" : "It smells like rain"}
            <br />
            Space to jump, Shift to run
          </div>
          {/* For a touch screen, with no Space bar. */}
          <Button
            onPointerDown={() => (jumpRef.current = true)}
            size="sm"
            style={{ position: "absolute", right: 8, bottom: 40, fontSize: 11 }}
          >
            Jump (Space)
          </Button>
          <Button onClick={onLeave} size="sm" style={{ position: "absolute", right: 8, bottom: 8, fontSize: 11 }}>
            Back to the office (Esc)
          </Button>
        </>
      )}
    </div>
  );
}
