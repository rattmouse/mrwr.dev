"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, ProgressBar, Slider, Window, WindowContent, WindowHeader } from "react95";
import { PauseIcon, PlayIcon } from "@/components/common/MediaGlyphs";
import {
  CherryBloom,
  Crowns,
  GROUNDS_TREE,
  isParkTree,
  isUwTree,
  loadAddresses,
  loadCrowns,
  loadRemoved,
  loadSidewalk,
  loadTrees,
  loadUw,
  RemovedTrees,
  SIDEWALK_BY_NEARNESS,
  SIDEWALK_CRACKED,
  SIDEWALK_IN_THE_WAY,
  SIDEWALK_LOW_BRANCHES,
  SIDEWALK_NARROWED,
  SIDEWALK_REPAIRED,
  SIDEWALK_TILTED,
  treeAddress,
  TreeAddresses,
  treeOwner,
  TreeSidewalk,
  treeYear,
  Trees,
  UwTrees,
} from "@/lib/trees";
import { dayLabel, doy, phenology, RGB, seasonColor, todayDoy } from "@/lib/treeSeasons";
import { loadTerrain, Terrain } from "@/lib/terrain";
import { buildGrid, gridSpan } from "@/lib/treesGrid";
import { loadPlaces, parkAt, Place, placeAt, Places, RESTORATION_PHASES, treesInside } from "@/lib/places";
import { areawayAtScreen, drapePlaces, drawFlatPlaces, outlinePlace } from "@/lib/placesDraw";
import { clockLabel, Light, lightFrom, seattleInstant, sunPosition, sunTimes } from "@/lib/sun";
import {
  DEPTH_SLACK,
  drawTiltTrees,
  EXAG,
  Ground,
  groundZ,
  makeGround,
  MAP_LIGHT,
  renderGround,
  resetShadowMask,
  treeLight,
  Heading,
  rot,
  firstAtMost,
  Packed,
  packOrder,
  thinPacked,
  tiltOrder,
  tiltView as makeTiltView,
  visibleSlice,
  unrot,
  TREE_SCALE,
  TiltView,
  TreeForms,
  treeForms,
  crownOutline,
} from "@/lib/treesTilt";
import { GUYS_SHEET, GuySheet, guyBounds, loadGuys, tintGuys } from "@/lib/guys";
import {
  CONIFER_COLOR,
  CROWN_BROADLEAF,
  CROWN_CONIFER,
  hexRgb,
  plantedColor,
  speciesGroups,
  TreeGroup,
  YEAR_MIN,
} from "@/lib/treeColors";
import { WALKER_STALE_MS, WalkerAt, walkerChannel, WalkerMessage } from "@/lib/treesWalker";

/**
 * trees.exe's map: every street tree in Seattle as a dot, with no basemap —
 * 215k trees along the planting strips draw the street grid, the parks and
 * the shoreline on their own. Three ways to color it, picked from the
 * program's toolbar:
 *
 *   season   what each tree looks like on a day of the year (treeSeasons.ts)
 *   planted  the trees standing by a given year, the newest lit up
 *   species  the commonest genera, any one of which can be picked out
 *
 * Drawn straight into an ImageData, a pixel or a disc a tree — far quicker
 * than 215k canvas arcs, and the hard pixel edge suits the frame. Drag to
 * pan, wheel or pinch to zoom, click a tree for its details.
 *
 * Tilt stands the same trees on their hills, seen from an angle the
 * Tilt dial sets and facing whichever way the Rotate dial turns it
 * (treesTilt.ts); every coloring works in both.
 *
 * Under the trees, when the toolbar asks: the parks with their restoration
 * zones and P-Patch gardens, the creeks, and the areaways under the
 * sidewalks (places.ts), which
 * can be hovered and clicked like a tree. And in Tilt, the Sun: the hills and
 * trees lit, and shadowed, as they would be at the toolbar's hour on the day
 * shown (sun.ts).
 */

export type TreesMode = "season" | "planted" | "species";

const BG: RGB = [14, 20, 16];
const GHOST: RGB = [30, 42, 34];
/** A draw slot with nothing to draw in Season or Type. */
const NO_KEY = 0xffff;
/** The picked tree's ring, and the picked place's outline. */
const PICKED: RGB = [0, 255, 102];
/** A removed street tree, in the year it came down. */
const FELLED: RGB = [236, 64, 48];
/** How long the walker's figure stays each painted guy before the next, ms. */
const GUY_CYCLE_MS = 300;
/** Dates in these years are mostly the city's first inventory, not plantings. */
const INVENTORY = [1990, 1992];

const SUNK: React.CSSProperties = {
  border: "2px solid",
  borderColor: "#808080 #ffffff #ffffff #808080",
};

/** ImageData's pixels, read as one little-endian u32 each. */
const pack = (c: RGB, a = 255) =>
  ((a << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
const GHOST_PACKED = pack(GHOST);
const FELLED_PACKED = pack(FELLED);

const fmt = (n: number) => n.toLocaleString("en-US");

/** Everything worked out once per load. */
type Prepared = {
  /** Metres east and north of the bbox's south-west corner. */
  mx: Float32Array;
  my: Float32Array;
  widthM: number;
  heightM: number;
  /** Rough crown radius in metres, from trunk diameter. */
  crown: Float32Array;
  /** Biggest first, so small trees draw on top of the big ones around them. */
  order: Uint32Array;
  /** The street trees' positions, crowns and what colors them, laid out in that order for the flat map to walk. */
  byOrder: {
    mx: Float32Array;
    my: Float32Array;
    crown: Float32Array;
    species16: Uint16Array;
    year: Uint8Array;
    flags: Uint8Array;
  };
  speciesCount: Int32Array;
  phen: ReturnType<typeof phenology>[];
  groups: TreeGroup[];
  groupOf: Uint8Array;
  yearMax: number;
  yearCounts: Int32Array;
  unknownYear: number;
};

function prepare(trees: Trees): Prepared {
  const { south, north, west, east } = trees.bbox;
  const lat = ((south + north) / 2) * (Math.PI / 180);
  const widthM = (east - west) * 111320 * Math.cos(lat);
  const heightM = (north - south) * 110574;
  const n = trees.count;
  const mx = new Float32Array(n);
  const my = new Float32Array(n);
  const crown = new Float32Array(n);
  let yearMax = YEAR_MIN;
  const nowYear = new Date().getFullYear();
  for (let i = 0; i < n; i++) {
    mx[i] = (trees.x[i] / 65535) * widthM;
    my[i] = (trees.y[i] / 65535) * heightM;
    crown[i] = Math.min(9, 1.2 + trees.diam[i] * 0.2);
    const y = trees.year[i];
    if (y && 1900 + y <= nowYear) yearMax = Math.max(yearMax, 1900 + y);
  }
  // Biggest trunk first. Diameters are a byte, so a counting sort does it in
  // one pass rather than a comparison sort of 215k.
  const order = new Uint32Array(n);
  const start = new Uint32Array(257);
  for (let i = 0; i < n; i++) start[255 - trees.diam[i] + 1]++;
  for (let b = 0; b < 256; b++) start[b + 1] += start[b];
  for (let i = 0; i < n; i++) order[start[255 - trees.diam[i]]++] = i;
  const byOrder = {
    mx: new Float32Array(n),
    my: new Float32Array(n),
    crown: new Float32Array(n),
    species16: new Uint16Array(n),
    year: new Uint8Array(n),
    flags: new Uint8Array(n),
  };
  for (let k = 0; k < n; k++) {
    const i = order[k];
    byOrder.mx[k] = mx[i];
    byOrder.my[k] = my[i];
    byOrder.crown[k] = crown[i];
    byOrder.species16[k] = trees.species16[i];
    byOrder.year[k] = trees.year[i];
    byOrder.flags[k] = trees.flags[i];
  }

  const speciesCount = new Int32Array(trees.species.length);
  for (let i = 0; i < n; i++) speciesCount[trees.species16[i]]++;

  const { groups, groupOf } = speciesGroups(trees, speciesCount);

  const yearCounts = new Int32Array(yearMax - YEAR_MIN + 1);
  let unknownYear = 0;
  for (let i = 0; i < n; i++) {
    const y = trees.year[i];
    if (!y || 1900 + y > yearMax) {
      unknownYear++;
      continue;
    }
    yearCounts[Math.max(0, 1900 + y - YEAR_MIN)]++;
  }

  return {
    mx,
    my,
    widthM,
    heightM,
    crown,
    order,
    byOrder,
    speciesCount,
    phen: trees.species.map(phenology),
    groups,
    groupOf,
    yearMax,
    yearCounts,
    unknownYear,
  };
}


type View = { cx: number; cy: number; s: number };

/** The removed street trees, laid out on the same metres as the standing ones. */
type RemovedPrepared = {
  n: number;
  mx: Float32Array;
  my: Float32Array;
  /** Flat-map dot radius, metres. */
  dot: Float32Array;
  /** Calendar years; a missing planting date counts from the first inventory. */
  plantedYear: Uint16Array;
  removedYear: Uint16Array;
  /** Trees planted, and trees removed, in each year from YEAR_MIN. */
  plantedCounts: Int32Array;
  removedCounts: Int32Array;
  forms: TreeForms;
};

function prepareRemoved(r: RemovedTrees, p: Prepared): RemovedPrepared {
  const n = r.count;
  const mx = new Float32Array(n);
  const my = new Float32Array(n);
  const dot = new Float32Array(n);
  const plantedYear = new Uint16Array(n);
  const removedYear = new Uint16Array(n);
  const plantedCounts = new Int32Array(p.yearMax - YEAR_MIN + 1);
  const removedCounts = new Int32Array(p.yearMax - YEAR_MIN + 1);
  const bucket = (y: number) => Math.max(0, Math.min(p.yearMax, y) - YEAR_MIN);
  for (let i = 0; i < n; i++) {
    mx[i] = (r.x[i] / 65535) * p.widthM;
    my[i] = (r.y[i] / 65535) * p.heightM;
    dot[i] = Math.min(9, 1.2 + r.diam[i] * 0.2);
    plantedYear[i] = r.planted[i] ? 1900 + r.planted[i] : INVENTORY[0];
    removedYear[i] = 1900 + r.removed[i];
    plantedCounts[bucket(plantedYear[i])]++;
    removedCounts[bucket(removedYear[i])]++;
  }
  return {
    n,
    mx,
    my,
    dot,
    plantedYear,
    removedYear,
    plantedCounts,
    removedCounts,
    forms: treeForms(r.species, r.species16, r.diam),
  };
}

/**
 * Everything Tilt draws, in one run of indices: the standing street trees,
 * then the removed ones, then the LiDAR crowns. Picking and the card use the
 * same numbering, so `kindOf` says which a tree is.
 */
type Scene = {
  nS: number;
  nR: number;
  nC: number;
  mx: Float32Array;
  my: Float32Array;
  forms: TreeForms;
  /** The tallest tree, metres: how far above the ground anything can reach. */
  tallest: number;
};

function buildScene(
  p: Prepared,
  streetForms: TreeForms,
  removed: RemovedPrepared | null,
  crowns: Crowns | null,
  /** The LiDAR's measured street-tree heights, used whether or not the canopy is shown. */
  measured: Crowns | null,
): Scene {
  const nS = p.mx.length;
  const nR = removed?.n ?? 0;
  const nC = crowns?.count ?? 0;
  const N = nS + nR + nC;
  const mx = new Float32Array(N);
  const my = new Float32Array(N);
  const height = new Float32Array(N);
  const crown = new Float32Array(N);
  const shape = new Uint8Array(N);
  mx.set(p.mx);
  my.set(p.my);
  height.set(streetForms.height);
  crown.set(streetForms.crown);
  shape.set(streetForms.shape);
  // A street tree the LiDAR saw keeps its measured height, not the estimate.
  if (measured) {
    for (let i = 0; i < nS; i++) if (measured.streetHeight[i] > 0) height[i] = measured.streetHeight[i];
  }
  if (removed) {
    mx.set(removed.mx, nS);
    my.set(removed.my, nS);
    height.set(removed.forms.height, nS);
    crown.set(removed.forms.crown, nS);
    shape.set(removed.forms.shape, nS);
  }
  if (crowns) {
    const at = nS + nR;
    for (let i = 0; i < nC; i++) {
      mx[at + i] = (crowns.x[i] / 65535) * p.widthM;
      my[at + i] = (crowns.y[i] / 65535) * p.heightM;
      height[at + i] = crowns.height[i];
      crown[at + i] = crowns.radius[i];
      shape[at + i] = crowns.conifer[i] ? 1 : 0;
    }
  }
  let tallest = 0;
  for (let i = 0; i < N; i++) if (height[i] > tallest) tallest = height[i];
  return { nS, nR, nC, mx, my, forms: { height, crown, shape }, tallest };
}

type Kind = "street" | "removed" | "crown";

function kindOf(scene: Scene | null, i: number): Kind {
  if (!scene || i < scene.nS) return "street";
  return i < scene.nS + scene.nR ? "removed" : "crown";
}

/** A removed tree on the Planted timeline: not yet planted, growing, red the year it comes down, then gone. */
function removedColor(rp: RemovedPrepared, r: number, year: number, agePalette: Uint32Array): number {
  const p = rp.plantedYear[r];
  const gone = rp.removedYear[r];
  if (year < p) return GHOST_PACKED;
  if (year < gone) return agePalette[Math.min(255, year - p)];
  if (year === gone) return FELLED_PACKED;
  return 0;
}

/**
 * What the right-click menu needs from the window: the timeline — what's
 * playing, where it's got to, the means to move it — and Type's legend.
 */
export type TreesMenuState = {
  playing: boolean;
  /** Type has no timeline, and nothing plays before the trees have loaded. */
  canPlay: boolean;
  toggle: () => void;
  /** Season's day of the year, 0–364. */
  day: number;
  setDay: (day: number) => void;
  /** Age's year. */
  year: number;
  yearMin: number;
  yearMax: number;
  setYear: (year: number) => void;
  /** Type's kinds of tree and their colors, and the one picked out alone, if any. */
  groups: { label: string; color: string }[];
  group: number | null;
  setGroup: (group: number | null) => void;
};

export type TreesWindowProps = {
  mode: TreesMode;
  /** The diorama: the city seen from a locked angle, standing on its hills. */
  tilt: boolean;
  /** Degrees above the horizon Tilt looks down from; the Tilt dial. */
  pitch: number;
  /** Which way Tilt faces, degrees clockwise from north; the flat map is always north-up. */
  heading: Heading;
  /** Q and E turn Tilt a step left or right. */
  onTurn: (step: 1 | -1) => void;
  /** The focused window takes Space, Escape and +/−. */
  active: boolean;
  /** Minimized: stop any playback. */
  paused: boolean;
  /** Bumped by the control panel's Reset button: the whole city in view, and the day and year back to today. */
  fitSignal: number;
  /** Draw the street trees (and the ones taken down, on the Age timeline). */
  street: boolean;
  /** Draw the LiDAR's other trees, under the street trees. */
  canopy: boolean;
  /** Parks, restoration zones and P-Patch gardens under the trees, and the trees Parks has inventoried in them. */
  parks: boolean;
  /** Creeks. */
  water: boolean;
  /** The areaways under the sidewalks. */
  underground: boolean;
  /** Light Tilt by the sun at `minutes` past midnight, Seattle time, instead of from the map's north-west. */
  sun: boolean;
  minutes: number;
  /** The Today button: the sun's hour back to now, as the day goes back to today. */
  onNow: () => void;
  /** The control panel, under the map and the view's own controls, over the status line. */
  controls?: React.ReactNode;
  /** A right-click on the map, at that point on the screen: the control panel's settings, as a menu. */
  onMenu?: (x: number, y: number) => void;
  /** The menu itself, drawn here so it follows the timeline as it plays. */
  menu?: (state: TreesMenuState) => React.ReactNode;
  /** The coloring's knob, to the left of the view's own controls: the day or year slider, or the Type legend. */
  modeKnob?: React.ReactNode;
};

export default function TreesWindow({
  mode,
  tilt,
  pitch,
  heading,
  onTurn,
  active,
  paused,
  fitSignal,
  street,
  canopy,
  parks,
  water,
  underground,
  sun,
  minutes,
  onNow,
  controls,
  onMenu,
  menu,
  modeKnob,
}: TreesWindowProps) {
  const [trees, setTrees] = useState<Trees | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prepared = useMemo(() => (trees ? prepare(trees) : null), [trees]);

  const [day, setDay] = useState(todayDoy);
  const [yearAsked, setYear] = useState(() => new Date().getFullYear());
  const [playAsked, setPlaying] = useState(false);
  const [group, setGroup] = useState<number | null>(null);
  const [selectedAsked, setSelected] = useState<number | null>(null);
  const [hoverAsked, setHover] = useState<number | null>(null);
  // A park, zone, garden or creek, picked or pointed at where there's no tree.
  const [selectedPlaceAsked, setSelectedPlace] = useState<Place | null>(null);
  // Which corner of the map the tree card was last dropped in, for the next one too.
  const [cardCorner, setCardCorner] = useState<CardCorner>("top-right");
  const [hoverPlaceAsked, setHoverPlace] = useState<Place | null>(null);

  // Playback stops on a change of view. Worked out while rendering rather than
  // in an effect, so the new view never draws a frame still playing.
  const [shownMode, setShownMode] = useState(mode);
  if (shownMode !== mode) {
    setShownMode(mode);
    setPlaying(false);
  }
  // Held while the window is down on the taskbar, and picked up again after.
  const playing = playAsked && !paused && mode !== "species";
  const year = prepared ? Math.min(Math.max(yearAsked, YEAR_MIN), prepared.yearMax) : yearAsked;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const imageRef = useRef<{ img: ImageData; buf: Uint32Array } | null>(null);
  const frameRef = useRef(0);
  /** Whoever is out walking the city from cubicles.exe (TreesWalk), and when they last said where. */
  const walkerRef = useRef<{ at: WalkerAt; t: number } | null>(null);
  /** The painted guys to draw the walker with, once the sheet is in, and which of them it is. */
  const guysRef = useRef<GuySheet | null>(null);
  const walkerPoseRef = useRef(0);
  /** Where the figure was last drawn, CSS pixels: its box to grab, and the ground under its feet. */
  const walkerHitRef = useRef<{ x0: number; y0: number; x1: number; y1: number; gx: number; gy: number } | null>(null);
  const walkerChannelRef = useRef<BroadcastChannel | null>(null);
  /** The figure being dragged: which pointer, and how far the pointer is from the ground under its feet. */
  const walkerDragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [overWalker, setOverWalker] = useState(false);

  // How far each download has got, 0–1, for the progress panel; null while
  // the size isn't known yet.
  const [treesProgress, setTreesProgress] = useState<number | null>(null);
  const [addresses, setAddresses] = useState<TreeAddresses | null>(null);
  const [removed, setRemoved] = useState<RemovedTrees | null>(null);
  const [sidewalk, setSidewalk] = useState<TreeSidewalk | null>(null);
  const [uw, setUw] = useState<UwTrees | null>(null);
  // Set a moment after the map is up: the ground starts coming down then, so
  // Tilt is usually ready before it's asked for.
  const [prefetchGround, setPrefetchGround] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    loadTrees(abort.signal, setTreesProgress)
      .then((loaded) => {
        setTrees(loaded);
        // The map is drawn; the addresses are only for the hover line and the
        // card, so they follow on their own.
        loadAddresses(abort.signal)
          .then(setAddresses)
          .catch(() => {});
        // What the sidewalk inspectors blamed on which trees, for the card alone.
        loadSidewalk(abort.signal)
          .then(setSidewalk)
          .catch(() => {});
        // UW Grounds' tags, heights and cherry bloom checks, for the campus trees' cards.
        if (loaded.uwCount)
          loadUw(abort.signal)
            .then(setUw)
            .catch(() => {});
        // The trees that have come down, for the Planted timeline.
        loadRemoved(abort.signal)
          .then(setRemoved)
          .catch(() => {});
        window.setTimeout(() => {
          if (!abort.signal.aborted) setPrefetchGround(true);
        }, 1500);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => abort.abort();
  }, []);

  // The ground: fetched the first time Tilt is asked for, or quietly once the
  // map has settled, and kept.
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [terrainError, setTerrainError] = useState(false);
  const [terrainProgress, setTerrainProgress] = useState<number | null>(null);
  const fetchingTerrain = (tilt || prefetchGround) && !terrain && !terrainError;
  const wantTerrain = tilt && !terrain && !terrainError;
  useEffect(() => {
    if (!fetchingTerrain) return;
    const abort = new AbortController();
    loadTerrain(abort.signal, setTerrainProgress)
      .then(setTerrain)
      .catch(() => {
        if (!abort.signal.aborted) setTerrainError(true);
      });
    return () => abort.abort();
  }, [fetchingTerrain]);

  const ground = useMemo<Ground | null>(
    () => (terrain && trees && prepared ? makeGround(terrain, trees.bbox, prepared.widthM, prepared.heightM) : null),
    [terrain, trees, prepared],
  );

  // The parks, gardens, creeks and areaways: small, so they follow the trees straight in.
  const [places, setPlaces] = useState<Places | null>(null);
  useEffect(() => {
    if (!trees || !prepared) return;
    const abort = new AbortController();
    loadPlaces(trees, prepared.widthM, prepared.heightM, abort.signal)
      .then(setPlaces)
      .catch(() => {});
    return () => abort.abort();
  }, [trees, prepared]);
  const showPlaces = places !== null && (parks || water || underground);
  const placeShown = useCallback(
    (p: Place) => (p.kind === "creek" ? water : p.kind === "areaway" ? underground : parks),
    [parks, water, underground],
  );

  // The sun, on the day the Season view shows (today in the others) at the
  // toolbar's hour. Rounded to a degree or so: a playing season then relights
  // the hills a few times a second, not every frame.
  // While the season plays, the sun moves a week at a time: relighting the
  // hills every frame would cost more than the trees.
  const sunDay = mode === "season" ? (playing ? Math.floor(day / 7) * 7 : Math.floor(day)) : todayDoy();
  const sunYear = new Date().getFullYear();
  const sunKey = useMemo(() => {
    if (!sun || !tilt) return null;
    const at = sunPosition(seattleInstant(sunYear, sunDay, minutes));
    return `${Math.round(at.azimuth)} ${Math.round(at.altitude * 2) / 2}`;
  }, [sun, tilt, sunYear, sunDay, minutes]);
  const light = useMemo<Light | null>(() => {
    if (!sunKey) return null;
    const [azimuth, altitude] = sunKey.split(" ").map(Number);
    return lightFrom({ azimuth, altitude });
  }, [sunKey]);
  const daylight = useMemo(() => (sun && tilt ? sunTimes(sunYear, sunDay) : null), [sun, tilt, sunYear, sunDay]);
  // The ground as drawn: lit by the sun when it's on. Heights, fitting and
  // standing the trees up all use `ground`, so relighting moves nothing.
  const litGround = useMemo<Ground | null>(
    () =>
      light && terrain && trees && prepared ? makeGround(terrain, trees.bbox, prepared.widthM, prepared.heightM, light) : ground,
    [light, terrain, trees, prepared, ground],
  );
  // The LiDAR's other 850k trees: the biggest file by far, so it follows the
  // street trees in, once the map is up, or straight away if Tilt asks.
  const [crowns, setCrowns] = useState<Crowns | null>(null);
  const [crownsError, setCrownsError] = useState(false);
  const [crownsProgress, setCrownsProgress] = useState<number | null>(null);
  const wantCrowns = canopy && (tilt || prefetchGround) && !crowns && !crownsError;
  // What's drawn: none of it while the Canopy toggle is off.
  const shownCrowns = canopy ? crowns : null;
  useEffect(() => {
    if (!wantCrowns) return;
    const abort = new AbortController();
    loadCrowns(abort.signal, setCrownsProgress)
      .then(setCrowns)
      .catch(() => {
        if (!abort.signal.aborted) setCrownsError(true);
      });
    return () => abort.abort();
  }, [wantCrowns]);

  const removedPrep = useMemo(() => (removed && prepared ? prepareRemoved(removed, prepared) : null), [removed, prepared]);
  const streetForms = useMemo(() => (trees ? treeForms(trees.species, trees.species16, trees.diam) : null), [trees]);
  const scene = useMemo(
    () => (prepared && streetForms ? buildScene(prepared, streetForms, removedPrep, shownCrowns, crowns) : null),
    [prepared, streetForms, removedPrep, shownCrowns, crowns],
  );
  // Which ~100 m cell each tree is in, so the flat map draws and picks only those on screen.
  const grid = useMemo(
    () => (scene && prepared ? buildGrid(scene.mx, scene.my, scene.forms.crown, prepared.widthM, prepared.heightM) : null),
    [scene, prepared],
  );
  // Each tree's ground height, for standing it on its hill.
  const sceneGround = useMemo(() => {
    if (!scene || !tilt) return null;
    const gz = new Float32Array(scene.mx.length);
    if (ground) for (let i = 0; i < gz.length; i++) gz[i] = groundZ(ground, scene.mx[i], scene.my[i]);
    return gz;
  }, [scene, tilt, ground]);

  // Tilt's back-to-front order, re-sorted (a few ms) when it turns to face another way.
  const order = useMemo(
    () => (scene && tilt ? tiltOrder(heading, scene.mx, scene.my) : null),
    [scene, tilt, heading],
  );
  // The same, laid out in draw order for the tree pass to walk straight through.
  const packed = useMemo(
    () => (order && scene && sceneGround ? packOrder(order, heading, scene.mx, scene.my, sceneGround, scene.forms) : null),
    [order, scene, sceneGround, heading],
  );
  // Each draw slot's palette entry for Season and Type: its species, or the
  // canopy's broadleaf or conifer just past the species, or none — a tree
  // whose layer is off, or a removed one.
  const slotKeys = useMemo(() => {
    if (!packed || !scene || !trees) return null;
    const S = trees.species.length;
    const { nS, nR } = scene;
    const at = nS + nR;
    const keys = new Uint16Array(packed.n);
    for (let k = 0; k < packed.n; k++) {
      const i = packed.index[k];
      if (i < nS) keys[k] = (trees.flags[i] & GROUNDS_TREE ? parks : street) ? trees.species16[i] : NO_KEY;
      else if (i < at) keys[k] = NO_KEY;
      else keys[k] = shownCrowns ? S + shownCrowns.conifer[i - at] : NO_KEY;
    }
    return keys;
  }, [packed, scene, trees, street, parks, shownCrowns]);
  // The ground layer, kept until the view moves: playing through a year redraws only the trees.
  const groundLayerRef = useRef<{ key: string; buf: Uint32Array; depth: Float32Array; W: number } | null>(null);
  // The flat map's places, likewise kept until the view moves.
  const flatLayerRef = useRef<{ key: string; buf: Uint32Array } | null>(null);
  // Which pixels are still bare ground, for the trees' shadows to fall on.
  const shadowMaskRef = useRef<Uint8Array | null>(null);
  const treeColorRef = useRef<Uint32Array | null>(null);
  const treeBareRef = useRef<Uint8Array | null>(null);
  const colorDepsRef = useRef<unknown[]>([]);
  // The slots to draw with the canopy sampled, one list per thinning, for the packing they came from.
  const thinnedRef = useRef<{ base: Packed | null; byThin: Map<number, Uint32Array> }>({ base: null, byThin: new Map() });
  // Colors and bareness gathered into draw order.
  const packedColorRef = useRef<Uint32Array | null>(null);
  const packedBareRef = useRef<Uint8Array | null>(null);

  // --- what color every tree is right now ---------------------------------

  /** Species bare on this day, whose crowns Tilt draws see-through. */
  const bareSpecies = useMemo(() => {
    if (!trees || !prepared || mode !== "season") return null;
    const bare = new Uint8Array(trees.species.length);
    prepared.phen.forEach((p, s) => (bare[s] = seasonColor(p, day).state === "bare" ? 1 : 0));
    return bare;
  }, [trees, prepared, mode, day]);

  const speciesPalette = useMemo(() => {
    if (!trees || !prepared) return null;
    const pal = new Uint32Array(trees.species.length);
    if (mode === "season") {
      prepared.phen.forEach((p, s) => (pal[s] = pack(seasonColor(p, day).rgb)));
    } else if (mode === "species") {
      const colors = prepared.groups.map((g) => hexRgb(g.color));
      for (let s = 0; s < pal.length; s++) {
        const g = prepared.groupOf[s];
        pal[s] = pack(group === null || group === g ? colors[g] : GHOST);
      }
    }
    return pal;
  }, [trees, prepared, mode, day, group]);

  /** The LiDAR trees' two colors, broadleaf and conifer, and whether broadleaf is bare today. */
  const crownLook = useMemo(() => {
    if (!prepared) return null;
    if (mode === "season") {
      const broad = seasonColor(phenology({ common: "", scientific: "", genus: "Unknown" }), day);
      const conifer = seasonColor(phenology({ common: "", scientific: "", genus: "Pseudotsuga" }), day);
      return { broad: pack(broad.rgb), conifer: pack(conifer.rgb), bare: broad.state === "bare" };
    }
    if (mode === "species") {
      const coniferGroup = prepared.groups.findIndex((g) => g.key === "conifers");
      if (group === null) return { broad: pack(CROWN_BROADLEAF), conifer: pack(CROWN_CONIFER), bare: false };
      return { broad: pack(GHOST), conifer: pack(group === coniferGroup ? hexRgb(CONIFER_COLOR) : GHOST), bare: false };
    }
    // The Planted timeline is about dated street trees; the undated canopy stays out of it.
    return { broad: 0, conifer: 0, bare: false };
  }, [prepared, mode, day, group]);

  /** Planted view colors by a tree's age in years, for the removed trees. */
  const agePalette = useMemo(() => {
    const pal = new Uint32Array(256);
    for (let a = 0; a < 256; a++) pal[a] = pack(plantedColor(a));
    return pal;
  }, []);

  const yearPalette = useMemo(() => {
    const pal = new Uint32Array(256);
    for (let b = 1; b < 256; b++) {
      const y = 1900 + b;
      pal[b] = pack(y > year ? GHOST : plantedColor(year - y));
    }
    return pal;
  }, [year]);

  /** Whether tree i is one you can see and pick in this view (rather than ghosted, or not there). */
  const isLive = useCallback(
    (i: number) => {
      if (!trees || !prepared) return false;
      const kind = kindOf(scene, i);
      if (kind === "removed") {
        // Only on the timeline, from planting to the year it came down.
        const r = i - scene!.nS;
        return street && mode === "planted" && removedPrep !== null && removedPrep.plantedYear[r] <= year && year <= removedPrep.removedYear[r];
      }
      if (kind === "crown") {
        if (!shownCrowns || mode === "planted") return false;
        if (mode === "species" && group !== null) {
          const coniferGroup = prepared.groups.findIndex((g) => g.key === "conifers");
          return group === coniferGroup && shownCrowns.conifer[i - scene!.nS - scene!.nR] === 1;
        }
        return true;
      }
      // A street tree with the Street layer, a park or campus tree with the Parks layer.
      if (!(trees.flags[i] & GROUNDS_TREE ? parks : street)) return false;
      if (mode === "planted") {
        const y = trees.year[i];
        return y !== 0 && 1900 + y <= year;
      }
      if (mode === "species" && group !== null) return prepared.groupOf[trees.species16[i]] === group;
      return true;
    },
    [trees, prepared, scene, removedPrep, shownCrowns, mode, year, group, street, parks],
  );

  // A pick that's gone out of view (a later year, another genus) goes with it.
  const selected = selectedAsked !== null && isLive(selectedAsked) ? selectedAsked : null;
  const hover = hoverAsked !== null && isLive(hoverAsked) ? hoverAsked : null;
  const selectedPlace =
    selected === null && selectedPlaceAsked && placeShown(selectedPlaceAsked) ? selectedPlaceAsked : null;
  const hoverPlace = hover === null && hoverPlaceAsked && placeShown(hoverPlaceAsked) ? hoverPlaceAsked : null;

  // --- view -----------------------------------------------------------------

  // The flat map is Tilt seen from straight overhead and facing north, so one
  // pair of conversions does both: turn into view axes, and squash distances
  // away from the viewer by the angle.
  const pitchRad = (pitch * Math.PI) / 180;
  const squash = tilt ? Math.sin(pitchRad) : 1;
  const turn: Heading = tilt ? heading : 0;

  // Whether the view is still the whole city, untouched since Fit: turning the
  // diorama or switching between Flat and Tilt then fits the city again,
  // where after a pan or zoom it keeps your place.
  const fittedRef = useRef(true);
  // What the last full frame showed, and while a zoom is under way, a copy of
  // it to stretch rather than draw the city again for every step of the wheel.
  type Shown = { view: View; W: number; H: number; tilt: boolean; pitch: number; heading: Heading };
  const shownRef = useRef<Shown | null>(null);
  const stretchRef = useRef<(Shown & { snap: HTMLCanvasElement }) | null>(null);
  // Set while the view is being dragged or zoomed, and for a moment after.
  const movingRef = useRef(false);
  const settleRef = useRef(0);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!prepared || !w || !h) return;
    fittedRef.current = true;
    stretchRef.current = null;
    const cx = prepared.widthM / 2;
    const cy = prepared.heightM / 2;
    if (!tilt) {
      viewRef.current = { cx, cy, s: Math.min(w / prepared.widthM, h / prepared.heightM) * 0.94 };
      return;
    }
    // The city's rectangle turned to face the view: how wide and how deep it is now.
    const corners = [
      rot(turn, 0, 0),
      rot(turn, prepared.widthM, 0),
      rot(turn, 0, prepared.heightM),
      rot(turn, prepared.widthM, prepared.heightM),
    ];
    const us = corners.map((c) => c[0]);
    const vs = corners.map((c) => c[1]);
    const across = Math.max(...us) - Math.min(...us);
    const deep = Math.max(...vs) - Math.min(...vs);
    const rise = ((ground?.zMax ?? 0) + 30) * EXAG * Math.cos(pitchRad);
    viewRef.current = { cx, cy, s: Math.min(w / across, h / (deep * squash + rise)) * 0.94 };
  }, [prepared, tilt, squash, pitchRad, turn, ground]);

  const scaleLimits = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!prepared) return [0.001, 40];
    const fitS = Math.min(w / prepared.widthM, h / prepared.heightM);
    return [fitS * 0.5, 40];
  }, [prepared]);

  /** The point on the ground (at sea level, in Tilt) under a spot on the canvas. */
  const toWorld = (px: number, py: number, v: View) => {
    const { w, h } = sizeRef.current;
    const [cu, cv] = rot(turn, v.cx, v.cy);
    const [x, y] = unrot(turn, cu + (px - w / 2) / v.s, cv - (py - h / 2) / (v.s * squash));
    return { x, y };
  };

  /** The view at scale s with world point `at` under canvas spot (px, py). */
  const viewWith = (at: { x: number; y: number }, px: number, py: number, s: number): View => {
    const { w, h } = sizeRef.current;
    const [au, av] = rot(turn, at.x, at.y);
    const [cx, cy] = unrot(turn, au - (px - w / 2) / s, av + (py - h / 2) / (s * squash));
    return { cx, cy, s };
  };

  // --- drawing --------------------------------------------------------------

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const v = viewRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || !w || !h) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    let image = imageRef.current;
    if (!image || image.img.width !== W || image.img.height !== H) {
      const img = ctx.createImageData(W, H);
      image = { img, buf: new Uint32Array(img.data.buffer) };
      imageRef.current = image;
    }
    const { img, buf } = image;
    let tiltView: TiltView | null = null;

    // Mid-zoom or mid-drag, the last full frame slid and scaled to the new
    // view instead of a new one: blurry, but next to free, and the real frame
    // follows once it settles.
    const st = stretchRef.current;
    let stretched = false;
    let k = 1;
    let ax = 0;
    let ay = 0;
    if (st && v && st.W === W && st.H === H && st.tilt === tilt && st.pitch === pitch && st.heading === heading) {
      k = v.s / st.view.s;
      // Where the old view's centre lands in the new one; everything else scales about it.
      const [ou, ov] = rot(turn, st.view.cx, st.view.cy);
      const [nu, nv] = rot(turn, v.cx, v.cy);
      ax = w / 2 + (ou - nu) * v.s;
      ay = h / 2 - (ov - nv) * v.s * squash;
      // Once it leaves too much of the screen empty, or has blown up too far
      // to read, a fresh (rough) frame instead, for the next steps to carry on from.
      const across = Math.max(0, Math.min(w, ax + (k * w) / 2) - Math.max(0, ax - (k * w) / 2));
      const down = Math.max(0, Math.min(h, ay + (k * h) / 2) - Math.max(0, ay - (k * h) / 2));
      stretched = (across * down) / (w * h) >= 0.8 && k <= 3;
      if (!stretched) stretchRef.current = null;
    }
    if (st && v && stretched) {
      ctx.fillStyle = `rgb(${BG.join(",")})`;
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(k, 0, 0, k, (ax - (k * w) / 2) * dpr, (ay - (k * h) / 2) * dpr);
      ctx.drawImage(st.snap, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (tilt) tiltView = makeTiltView(W, H, v.s * dpr, v.cx, v.cy, pitch, heading);
    } else if (tilt && trees && prepared && scene && sceneGround && packed && v && speciesPalette && crownLook) {
      tiltView = makeTiltView(W, H, v.s * dpr, v.cx, v.cy, pitch, heading);
      // Two CSS pixels per ground sample, at any pixel ratio: a soft ground
      // for a quick one — it was most of what a frame cost. The trees stay sharp.
      // While the view moves, three, and no shadows.
      const rough = movingRef.current;
      const stride = Math.max(1, Math.round((rough ? 3 : 2) * dpr));
      const key =
        `${W}x${H} ${tiltView.S} ${v.cx} ${v.cy} ${pitch} ${heading} ${ground ? "g" : "-"} ${stride} ` +
        `${sunKey ?? "map"} ${showPlaces ? `${parks} ${water} ${underground}` : "-"}`;
      let layer = groundLayerRef.current;
      if (!layer || layer.key !== key) {
        if (!layer || layer.buf.length !== W * H) {
          layer = { key, buf: new Uint32Array(W * H), depth: new Float32Array(W * H), W };
        }
        const overlay = places && parks ? places.overlay : null;
        renderGround(layer.buf, layer.depth, tiltView, litGround, prepared.widthM, prepared.heightM, pack(BG), stride, overlay);
        if (showPlaces && places) drapePlaces(layer.buf, layer.depth, tiltView, litGround, places, { parks, water, underground }, light ? 0.3 + 0.7 * light.day : 1);
        layer.key = key;
        layer.W = W;
        groundLayerRef.current = layer;
      }
      buf.set(layer.buf);
      if (selectedPlace) {
        outlinePlace(buf, W, H, selectedPlace, pack(PICKED), null, { view: tiltView, depth: layer.depth, g: litGround });
      }
      // The sun's light on the trees, and their shadows on whatever ground is bare.
      let lit = MAP_LIGHT;
      if (light) {
        let mask: Uint8Array | null = null;
        if (light.altitude > 1 && !rough) {
          if (!shadowMaskRef.current || shadowMaskRef.current.length !== W * H) shadowMaskRef.current = new Uint8Array(W * H);
          mask = shadowMaskRef.current;
          resetShadowMask(mask, layer.depth);
        }
        lit = treeLight(tiltView, light, mask);
      }

      const N = scene.mx.length;
      const { nS, nR } = scene;
      // Far out, where a canopy tree is a fraction of a pixel and several share
      // each one, a sample of the canopy does; while the view is being dragged
      // about, a thinner one still. The street trees are always all there.
      const canopyPx = 3.5 * tiltView.S;
      // About one sampled tree per 0.7 px of crown: as many as the pixels can show.
      let thin = canopyPx < 0.7 ? Math.min(8, Math.round(0.7 / canopyPx)) : 1;
      if (rough && canopyPx < 1.5) thin = Math.max(2, thin * 2);
      let sub: Uint32Array | null = null;
      if (thin > 1) {
        const cache = thinnedRef.current;
        if (cache.base !== packed) {
          cache.base = packed;
          cache.byThin.clear();
        }
        sub = cache.byThin.get(thin) ?? null;
        if (!sub) {
          sub = thinPacked(packed, nS + nR, thin);
          cache.byThin.set(thin, sub);
        }
      }
      // Only the band of depths the view can see.
      const [from, to] = visibleSlice(tiltView, packed, ground?.zMax ?? 0, scene.tallest, sub);
      if (!packedColorRef.current || packedColorRef.current.length !== packed.n) {
        packedColorRef.current = new Uint32Array(packed.n);
      }
      const drawColors = packedColorRef.current;
      let drawBare: Uint8Array | null = null;
      if (mode !== "planted" && slotKeys) {
        // Season and Type color by species: one palette entry per species (and
        // the canopy's two), looked up only for the trees in view — a playing
        // season changes every color every frame, and most aren't on screen.
        const S = trees.species.length;
        const pal = new Uint32Array(S + 2);
        pal.set(speciesPalette);
        pal[S] = crownLook.broad;
        pal[S + 1] = crownLook.conifer;
        let bareOf: Uint8Array | null = null;
        if (bareSpecies) {
          bareOf = new Uint8Array(S + 2);
          bareOf.set(bareSpecies);
          bareOf[S] = crownLook.bare ? 1 : 0;
          if (!packedBareRef.current || packedBareRef.current.length !== packed.n) packedBareRef.current = new Uint8Array(packed.n);
          drawBare = packedBareRef.current;
        }
        for (let j = from; j < to; j++) {
          const k = sub ? sub[j] : j;
          const key = slotKeys[k];
          drawColors[k] = key === NO_KEY ? 0 : pal[key];
          if (drawBare) drawBare[k] = key === NO_KEY ? 0 : bareOf![key];
        }
        // The by-tree colors below are stale now.
        colorDepsRef.current = [];
      } else {
        // A million colors, worked out again only when one of them can have
        // changed — not for every frame of a pan.
        const colorDeps = [scene, packed, mode, year, speciesPalette, yearPalette, crownLook, removedPrep, bareSpecies, street, parks];
        const colorsFresh =
          treeColorRef.current?.length === N &&
          colorDepsRef.current.length === colorDeps.length &&
          colorDeps.every((d, k) => Object.is(d, colorDepsRef.current[k]));
        colorDepsRef.current = colorDeps;
        if (!treeColorRef.current || treeColorRef.current.length !== N) treeColorRef.current = new Uint32Array(N);
        const colors = treeColorRef.current;
        if (!colorsFresh) {
          if (mode === "planted") {
            for (let i = 0; i < nS; i++) colors[i] = trees.year[i] ? yearPalette[trees.year[i]] : 0;
          } else {
            for (let i = 0; i < nS; i++) colors[i] = speciesPalette[trees.species16[i]];
          }
          // Street trees go with the Street layer, park trees with Parks.
          if (!street || !parks) {
            for (let i = 0; i < nS; i++) if (!(trees.flags[i] & GROUNDS_TREE ? parks : street)) colors[i] = 0;
          }
          for (let r = 0; r < nR; r++) {
            colors[nS + r] = street && removedPrep && mode === "planted" ? removedColor(removedPrep, r, year, agePalette) : 0;
          }
          if (shownCrowns) {
            const at = nS + nR;
            for (let c = 0; c < shownCrowns.count; c++) colors[at + c] = shownCrowns.conifer[c] ? crownLook.conifer : crownLook.broad;
          }
          if (bareSpecies) {
            if (!treeBareRef.current || treeBareRef.current.length !== N) treeBareRef.current = new Uint8Array(N);
            const bareNow = treeBareRef.current;
            bareNow.fill(0);
            for (let i = 0; i < nS; i++) bareNow[i] = bareSpecies[trees.species16[i]];
            if (shownCrowns && crownLook.bare) {
              const at = nS + nR;
              for (let c = 0; c < shownCrowns.count; c++) bareNow[at + c] = shownCrowns.conifer[c] ? 0 : 1;
            }
          }
        }
        // Into draw order, so the tree pass reads them front to back like everything else.
        if (!colorsFresh) {
          for (let k = 0; k < packed.n; k++) drawColors[k] = colors[packed.index[k]];
        }
        if (bareSpecies && treeBareRef.current) {
          if (!packedBareRef.current || packedBareRef.current.length !== packed.n) packedBareRef.current = new Uint8Array(packed.n);
          drawBare = packedBareRef.current;
          if (!colorsFresh) {
            const bareNow = treeBareRef.current;
            for (let k = 0; k < packed.n; k++) drawBare[k] = bareNow[packed.index[k]];
          }
        }
      }
      drawTiltTrees(buf, layer.depth, tiltView, packed, drawColors, drawBare, GHOST_PACKED, sub, from, to, lit);
    } else if (!tilt && showPlaces && places && v) {
      const s = v.s * dpr;
      const ox = W / 2 - v.cx * s;
      const oy = H / 2 + v.cy * s;
      const stride = movingRef.current ? 2 : 1;
      const key = `${W}x${H} ${s} ${ox} ${oy} ${parks} ${water} ${underground} ${stride}`;
      let layer = flatLayerRef.current;
      if (!layer || layer.key !== key) {
        if (!layer || layer.buf.length !== W * H) layer = { key, buf: new Uint32Array(W * H) };
        drawFlatPlaces(layer.buf, W, H, s, ox, oy, places, { parks, water, underground }, pack(BG), stride);
        layer.key = key;
        flatLayerRef.current = layer;
      }
      buf.set(layer.buf);
    } else {
      buf.fill(pack(BG));
    }

    if (!stretched && !tilt && trees && prepared && scene && grid && v && speciesPalette) {
      const s = v.s * dpr;
      const ox = W / 2 - v.cx * s;
      const oy = H / 2 + v.cy * s;
      // Only the cells on screen, grown by the widest crown (or the 80 px a
      // crown is capped at) so one just off the edge still draws its rim.
      const pad = Math.min(80 / s, grid.reach);
      const [c0, r0, c1, r1] = gridSpan(grid, -ox / s - pad, (oy - H) / s - pad, (W - ox) / s + pad, oy / s + pad);
      const { cols, start, items } = grid;
      // The LiDAR's trees first, underneath: the street trees are the ones with
      // names, so they stay on top. Half of them while the view moves, if
      // they're small enough that the gaps don't show.
      const sparse = movingRef.current && 3.5 * s < 1.5;
      if (shownCrowns && crownLook) {
        const at = scene.nS + scene.nR;
        const radius = scene.forms.crown;
        for (let row = r0; row <= r1; row++) {
          for (let cell = row * cols + c0, last = row * cols + c1; cell <= last; cell++) {
            for (let j = start[cell], end = start[cell + 1]; j < end; j++) {
              const i = items[j];
              if (i < at || (sparse && i & 1)) continue;
              const color = shownCrowns.conifer[i - at] ? crownLook.conifer : crownLook.broad;
              if (!color) continue;
              const sx = scene.mx[i] * s + ox;
              const sy = oy - scene.my[i] * s;
              const rr = Math.min(80, radius[i] * s);
              if (sx + rr < 0 || sx - rr >= W || sy + rr < 0 || sy - rr >= H) continue;
              if (rr < 1.25) {
                if (sx >= 0 && sy >= 0 && sx < W && sy < H) buf[(sy | 0) * W + (sx | 0)] = color;
                continue;
              }
              const y0 = Math.max(0, Math.ceil(sy - rr));
              const y1 = Math.min(H - 1, Math.floor(sy + rr));
              for (let py = y0; py <= y1; py++) {
                const dy = py + 0.5 - sy;
                const half = Math.sqrt(Math.max(0, rr * rr - dy * dy));
                const x0 = Math.max(0, Math.ceil(sx - half - 0.5));
                const x1 = Math.min(W - 1, Math.floor(sx + half - 0.5));
                if (x1 >= x0) buf.fill(color, py * W + x0, py * W + x1 + 1);
              }
            }
          }
        }
      }
      // The street trees keep their biggest-first order, laid out in it so the
      // pass reads straight through memory; at a quarter of a million that,
      // more than the trees off screen, is what it costs.
      const { mx, my, crown, species16: sp16, year: yr, flags: fl } = prepared.byOrder;
      const planted = mode === "planted";
      const n = mx.length;
      for (let k = 0; k < n; k++) {
        if (!(fl[k] & GROUNDS_TREE ? parks : street)) continue;
        let color: number;
        if (planted) {
          const y = yr[k];
          if (!y) continue;
          color = yearPalette[y];
        } else {
          color = speciesPalette[sp16[k]];
        }
        const sx = mx[k] * s + ox;
        const sy = oy - my[k] * s;
        const r = crown[k] * s;
        if (r < 1.25) {
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          buf[(sy | 0) * W + (sx | 0)] = color;
          continue;
        }
        const rr = Math.min(r, 80);
        if (sx + rr < 0 || sx - rr >= W || sy + rr < 0 || sy - rr >= H) continue;
        const y0 = Math.max(0, Math.ceil(sy - rr));
        const y1 = Math.min(H - 1, Math.floor(sy + rr));
        const r2 = rr * rr;
        for (let py = y0; py <= y1; py++) {
          const dy = py + 0.5 - sy;
          const half = Math.sqrt(Math.max(0, r2 - dy * dy));
          const x0 = Math.max(0, Math.ceil(sx - half - 0.5));
          const x1 = Math.min(W - 1, Math.floor(sx + half - 0.5));
          if (x1 >= x0) buf.fill(color, py * W + x0, py * W + x1 + 1);
        }
      }
      // The trees that have come down, on the timeline: standing until their year, red in it.
      if (planted && removedPrep && street) {
        const { nS, nR } = scene;
        for (let row = r0; row <= r1; row++) {
          for (let cell = row * cols + c0, last = row * cols + c1; cell <= last; cell++) {
            for (let j = start[cell], end = start[cell + 1]; j < end; j++) {
              const r = items[j] - nS;
              if (r < 0) continue;
              if (r >= nR) break;
              const color = removedColor(removedPrep, r, year, agePalette);
              if (!color) continue;
              const sx = removedPrep.mx[r] * s + ox;
              const sy = oy - removedPrep.my[r] * s;
              const rr = Math.min(80, Math.max(0.5, removedPrep.dot[r] * s));
              if (sx + rr < 0 || sx - rr >= W || sy + rr < 0 || sy - rr >= H) continue;
              if (rr < 1.25) {
                if (sx >= 0 && sy >= 0 && sx < W && sy < H) buf[(sy | 0) * W + (sx | 0)] = color;
                continue;
              }
              const y0 = Math.max(0, Math.ceil(sy - rr));
              const y1 = Math.min(H - 1, Math.floor(sy + rr));
              for (let py = y0; py <= y1; py++) {
                const dy = py + 0.5 - sy;
                const half = Math.sqrt(Math.max(0, rr * rr - dy * dy));
                const x0 = Math.max(0, Math.ceil(sx - half - 0.5));
                const x1 = Math.min(W - 1, Math.floor(sx + half - 0.5));
                if (x1 >= x0) buf.fill(color, py * W + x0, py * W + x1 + 1);
              }
            }
          }
        }
      }
      // The picked place over the dots, or a park's edge is lost among its trees.
      if (selectedPlace) outlinePlace(buf, W, H, selectedPlace, pack(PICKED), { s, ox, oy }, null);
    }
    if (!stretched) {
      ctx.putImageData(img, 0, 0);
      shownRef.current = v ? { view: { ...v }, W, H, tilt, pitch, heading } : null;
    }

    if (trees && prepared && v) {
      ctx.save();
      ctx.scale(dpr, dpr);
      const ring = (i: number, color: string, width: number) => {
        if (!scene) return;
        const flatDot =
          i < scene.nS
            ? prepared.crown[i]
            : kindOf(scene, i) === "removed" && removedPrep
              ? removedPrep.dot[i - scene.nS]
              : scene.forms.crown[i];
        ctx.beginPath();
        const outline = tiltView && sceneGround
          ? crownOutline(
              tiltView,
              scene.mx[i],
              scene.my[i],
              sceneGround[i],
              scene.forms.height[i],
              scene.forms.crown[i],
              scene.forms.shape[i],
            )
          : null;
        if (outline?.shape === "cone") {
          // The cone's own triangle, a few pixels out all round.
          const x = outline.x / dpr;
          const top = outline.top / dpr - 4;
          const bottom = outline.bottom / dpr + 3;
          const half = Math.max(4, outline.half / dpr + 3);
          ctx.moveTo(x, top);
          ctx.lineTo(x + half, bottom);
          ctx.lineTo(x - half, bottom);
          ctx.closePath();
        } else if (outline) {
          ctx.ellipse(
            outline.x / dpr,
            outline.y / dpr,
            Math.max(5, outline.r / dpr + 3),
            Math.max(5, outline.ry / dpr + 3),
            0,
            0,
            Math.PI * 2,
          );
        } else {
          const sx = w / 2 + (scene.mx[i] - v.cx) * v.s;
          const sy = h / 2 - (scene.my[i] - v.cy) * v.s;
          ctx.arc(sx, sy, Math.max(5, flatDot * v.s + 3), 0, Math.PI * 2);
        }
        ctx.lineJoin = "round";
        ctx.lineWidth = width + 2;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.stroke();
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      if (hover !== null && hover !== selected) ring(hover, "rgba(255,255,255,0.75)", 1);
      if (selected !== null) ring(selected, `rgb(${PICKED.join(",")})`, 2);

      // The walker, out from cubicles.exe: a figure where they stand — in 2.5D at their height, plumbed to the ground.
      const walker = walkerRef.current;
      walkerHitRef.current = null;
      if (walker && performance.now() - walker.t < WALKER_STALE_MS) {
        const { south, north, west, east } = trees.bbox;
        const at = walker.at;
        const mx = ((at.lon - west) / (east - west)) * prepared.widthM;
        const my = ((at.lat - south) / (north - south)) * prepared.heightM;
        let fx: number;
        let fy: number;
        let gy: number;
        if (tiltView) {
          const u = tiltView.ux * mx + tiltView.uy * my;
          const vv = tiltView.vx * mx + tiltView.vy * my;
          fx = (tiltView.W / 2 + (u - tiltView.cu) * tiltView.S) / dpr;
          const across = tiltView.H / 2 - (vv - tiltView.cv) * tiltView.S * tiltView.sin;
          const up = tiltView.S * tiltView.cos * EXAG;
          fy = (across - at.z * up) / dpr;
          gy = (across - at.ground * up) / dpr;
        } else {
          fx = w / 2 + (mx - v.cx) * v.s;
          fy = gy = h / 2 - (my - v.cy) * v.s;
        }
        if (fx > -30 && fx < w + 30 && fy > -10 && fy < h + 50) {
          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          // Off the ground: a plumb line down to it, and a shadow where it lands.
          if (gy - fy > 2) {
            ctx.setLineDash([2, 3]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.beginPath();
            ctx.moveTo(fx + 0.5, fy);
            ctx.lineTo(fx + 0.5, gy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.ellipse(fx, gy, 4, 1.6, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fill();
          }
          // One of the painted guys (guys.ts), feet at (fx, fy): a yellower green than any tree, on a dark edge so he shows on any ground.
          const sheet = guysRef.current;
          if (sheet) {
            const b = guyBounds(walkerPoseRef.current);
            const gh = 36;
            const gw = (b.w / b.h) * gh;
            walkerHitRef.current = { x0: fx - gw / 2 - 3, y0: fy - gh - 3, x1: fx + gw / 2 + 3, y1: fy + 3, gx: fx, gy };
            const edge = tintGuys(sheet, "rgba(0,0,0,0.85)");
            for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              ctx.drawImage(edge, b.x, b.y, b.w, b.h, fx - gw / 2 + ox, fy - gh + oy, gw, gh);
            }
            ctx.drawImage(tintGuys(sheet, "#7cfc00"), b.x, b.y, b.w, b.h, fx - gw / 2, fy - gh, gw, gh);
          }
          ctx.restore();
        }
      }

      // Scale bar: the roundest distance that fits in about 90px.
      const target = 90 / v.s;
      const pow = Math.pow(10, Math.floor(Math.log10(target)));
      const step = [5, 2, 1].map((m) => m * pow).find((d) => d <= target) ?? pow;
      const len = step * v.s;
      const x = 10;
      const y = h - 12;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#dfe8df";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y - 4);
      ctx.lineTo(x + 0.5, y + 0.5);
      ctx.lineTo(x + len + 0.5, y + 0.5);
      ctx.lineTo(x + len + 0.5, y - 4);
      ctx.stroke();
      ctx.fillStyle = "#dfe8df";
      ctx.font = "11px sans-serif";
      ctx.fillText(step >= 1000 ? `${step / 1000} km` : `${step} m`, x + 4, y - 4);

      // Which way is north, once the diorama has been turned.
      if (tiltView && heading !== 0) {
        const [nu, nv] = rot(heading, 0, 1);
        const len2 = Math.hypot(nu, nv * tiltView.sin) || 1;
        const dx = nu / len2;
        const dy = (-nv * tiltView.sin) / len2;
        const cxp = 26;
        const cyp = 26;
        ctx.beginPath();
        ctx.arc(cxp, cyp, 18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fill();
        // A long narrow needle pointing north, and the N past its tip.
        ctx.beginPath();
        ctx.moveTo(cxp + dx * 5, cyp + dy * 5);
        ctx.lineTo(cxp - dx * 9 - dy * 3, cyp - dy * 9 + dx * 3);
        ctx.lineTo(cxp - dx * 9 + dy * 3, cyp - dy * 9 - dx * 3);
        ctx.closePath();
        ctx.fillStyle = "#dfe8df";
        ctx.fill();
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("N", cxp + dx * 11, cyp + dy * 11 + 0.5);
      }

      ctx.restore();
    }
  }, [
    trees,
    prepared,
    scene,
    grid,
    removedPrep,
    shownCrowns,
    crownLook,
    agePalette,
    speciesPalette,
    yearPalette,
    bareSpecies,
    mode,
    year,
    hover,
    selected,
    tilt,
    pitch,
    heading,
    ground,
    sceneGround,
    packed,
    places,
    showPlaces,
    slotKeys,
    street,
    parks,
    water,
    underground,
    selectedPlace,
    light,
    sunKey,
    litGround,
    turn,
    squash,
  ]);

  // The frame always runs the latest draw, so one asked for before the data
  // or a new palette arrived still paints what's current when it fires.
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  /** The view just moved: draw it rough, then sharp once it has been still a moment. */
  const moved = useCallback(() => {
    movingRef.current = true;
    window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      movingRef.current = false;
      stretchRef.current = null;
      requestDraw();
    }, 160);
  }, [requestDraw]);

  /** A zoom or a drag is starting: keep the frame on screen to stretch until it settles. */
  const beginStretch = useCallback(() => {
    if (stretchRef.current) return;
    const shown = shownRef.current;
    const image = imageRef.current;
    if (!shown || !image || image.img.width !== shown.W || image.img.height !== shown.H) return;
    const snap = document.createElement("canvas");
    snap.width = shown.W;
    snap.height = shown.H;
    snap.getContext("2d")?.putImageData(image.img, 0, 0);
    stretchRef.current = { ...shown, snap };
  }, []);

  useEffect(() => {
    requestDraw();
  }, [draw, requestDraw]);

  // Hear from the walker, and redraw as they move — or once more when they've gone quiet.
  useEffect(() => {
    const channel = walkerChannel();
    if (!channel) return;
    walkerChannelRef.current = channel;
    let stale = 0;
    channel.onmessage = (event: MessageEvent<WalkerMessage>) => {
      const message = event.data;
      // Another trees.exe moving the walker: theirs will come back as an "at" like any other.
      if (message?.type === "move") return;
      // The walk's settings: its layers, Sun and coloring are TreesProgram's to take up; the rest are here.
      if (message?.type === "map") {
        const t = message.trees;
        if (!t) return;
        if (t.day !== undefined) setDay(t.day);
        if (t.year !== undefined) setYear(t.year);
        if (t.group !== undefined) setGroup(t.group);
        if (t.playing !== undefined) setPlaying(t.playing);
        return;
      }
      window.clearTimeout(stale);
      if (message?.type === "at") {
        if (!walkerRef.current) walkerPoseRef.current = Math.floor(Math.random() * GUYS_SHEET.count);
        if (!guysRef.current)
          loadGuys().then((sheet) => {
            guysRef.current = sheet;
            requestDraw();
          });
        // Mid-drag, the figure stays under the pointer; the walker's own word on where it is lags behind.
        const held = walkerDragRef.current && walkerRef.current;
        const at = held ? { ...message, lat: held.at.lat, lon: held.at.lon } : message;
        walkerRef.current = { at, t: performance.now() };
        stale = window.setTimeout(requestDraw, WALKER_STALE_MS + 50);
      } else walkerRef.current = null;
      requestDraw();
    };
    // The figure never stays one guy: it steps through the whole painted sheet while the walker's out.
    const cycle = window.setInterval(() => {
      const walker = walkerRef.current;
      if (!walker || !guysRef.current || performance.now() - walker.t >= WALKER_STALE_MS) return;
      walkerPoseRef.current = (walkerPoseRef.current + 1) % GUYS_SHEET.count;
      requestDraw();
    }, GUY_CYCLE_MS);
    return () => {
      window.clearTimeout(stale);
      window.clearInterval(cycle);
      walkerChannelRef.current = null;
      channel.close();
    };
  }, [requestDraw]);

  // Forget the frame as well as cancelling it, or the next requestDraw takes
  // it for one still on its way and never asks again.
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      window.clearTimeout(settleRef.current);
    },
    [],
  );

  // Keep the canvas the size of its box; the view keeps its centre and zoom.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      sizeRef.current = {
        w: Math.max(1, wrap.clientWidth),
        h: Math.max(1, wrap.clientHeight),
        dpr: Math.min(2, window.devicePixelRatio || 1),
      };
      if (!viewRef.current || fittedRef.current) fit();
      requestDraw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fit, requestDraw]);

  // Fit the city on the first load, and whenever the toolbar's Fit is pressed —
  // only then. Effects can run again with nothing changed (a hot reload, React
  // checking itself), and a fit then would throw away wherever you'd zoomed to.
  const fittedForRef = useRef<{ prepared: Prepared | null; fitSignal: number }>({ prepared: null, fitSignal: 0 });
  useEffect(() => {
    if (!prepared) return;
    const last = fittedForRef.current;
    if (last.prepared === prepared && last.fitSignal === fitSignal) return;
    // Reset puts the day and the year back to today as well.
    if (last.fitSignal !== fitSignal && fitSignal > 0) {
      setPlaying(false);
      setDay(todayDoy());
      setYear(new Date().getFullYear());
    }
    fittedForRef.current = { prepared, fitSignal };
    fit();
    requestDraw();
    // fitSignal is the control panel's Reset button; prepared is the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, fitSignal]);

  // Dragging the tilt slider redraws the ground on every step: draw it rough
  // while it moves, as for a pan.
  useEffect(() => {
    if (tilt) moved();
    // Only a change of angle or facing counts as movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, heading]);

  // Likewise the sun's hour: rough while the slider is dragged, sharp when it stops.
  useEffect(() => {
    if (tilt && sun) moved();
    // Only a change of hour counts as movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  useEffect(() => {
    if (!fittedRef.current) return;
    fit();
    requestDraw();
    // Refit only for a change of view: fit itself changes with these too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilt, pitch, heading, ground]);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = viewRef.current;
      if (!v) return;
      const [lo, hi] = scaleLimits();
      const s = Math.min(hi, Math.max(lo, v.s * factor));
      beginStretch();
      viewRef.current = viewWith(toWorld(px, py, v), px, py, s);
      fittedRef.current = false;
      moved();
      requestDraw();
    },
    // toWorld and viewWith change with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scaleLimits, requestDraw, beginStretch, turn, squash],
  );

  /** The view slid by (dx, dy) canvas pixels: the ground that was there comes to the middle. */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = viewRef.current;
      if (!v) return;
      const { w, h } = sizeRef.current;
      beginStretch();
      viewRef.current = viewWith(toWorld(w / 2 + dx, h / 2 + dy, v), w / 2, h / 2, v.s);
      fittedRef.current = false;
      moved();
      requestDraw();
    },
    // toWorld and viewWith change with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moved, requestDraw, beginStretch, turn, squash],
  );

  // --- picking --------------------------------------------------------------

  const pick = useCallback(
    (px: number, py: number): number | null => {
      const v = viewRef.current;
      if (!trees || !prepared || !v) return null;
      const layer = groundLayerRef.current;
      if (tilt && scene && sceneGround && layer) {
        // The crown under the pointer, as drawn — a conifer's tall cone, or a
        // ball — or failing that the nearest, if it's close; the nearer tree
        // wins a tie, as it's drawn over the other. Measured to the shape's
        // edge rather than its centre, so a cone stood up tall by a low tilt
        // can be picked anywhere along it.
        const { w, h, dpr } = sizeRef.current;
        const view: TiltView = makeTiltView(Math.round(w * dpr), Math.round(h * dpr), v.s * dpr, v.cx, v.cy, pitch, heading);
        let best = -1;
        let bestD = Infinity;
        let bestV = Infinity;
        const { mx, my, forms } = scene;
        // Only trees whose depth puts them near the pointer — those it could be
        // on, allowing for hills and trees rising into view — then only those
        // near it across: a million checks a mouse move is too many.
        const pxd = px * dpr;
        const pyd = py * dpr;
        const ss = view.S * view.sin;
        const rise = ((ground?.zMax ?? 0) * EXAG + scene.tallest * 1.4 * TREE_SCALE) * view.S * view.cos;
        const vFar = view.cv + (view.H / 2 - pyd + 60 * dpr) / ss;
        const vNear = view.cv + (view.H / 2 - pyd - 60 * dpr - rise) / ss;
        const sorted = order;
        const kFrom = sorted ? firstAtMost(sorted.depth, vFar) : 0;
        const kTo = sorted ? firstAtMost(sorted.depth, vNear) : mx.length;
        // The ground right under the pointer: a tree further off than it is behind a hill there.
        const ix = Math.round(pxd);
        const iy = Math.round(pyd);
        const groundAt = ix >= 0 && iy >= 0 && ix < layer.W && iy * layer.W + ix < layer.depth.length ? layer.depth[iy * layer.W + ix] : Infinity;
        for (let k = kFrom; k < kTo; k++) {
          const i = sorted ? sorted.order[k] : k;
          const sx = view.W / 2 + (view.ux * mx[i] + view.uy * my[i] - view.cu) * view.S;
          const across = Math.max(60, forms.crown[i] * TREE_SCALE * v.s) * dpr;
          if (sx - pxd > across || pxd - sx > across) continue;
          const o = crownOutline(view, mx[i], my[i], sceneGround[i], forms.height[i], forms.crown[i], forms.shape[i]);
          // How far outside the shape the pointer is, in CSS pixels (0 inside), and how big the shape is.
          let d: number;
          let size: number;
          if (o.shape === "cone") {
            const y = Math.max(o.top, Math.min(o.bottom, pyd));
            const half = (o.half * (y - o.top)) / Math.max(1, o.bottom - o.top);
            const ex = Math.max(0, Math.abs(pxd - o.x) - half);
            const ey = pyd - y;
            d = Math.sqrt(ex * ex + ey * ey) / dpr;
            size = Math.max(o.half, (o.bottom - o.top) / 2) / dpr;
          } else {
            // Squashed back to a circle the oval's width, then measured as one.
            d = Math.max(0, Math.hypot(pxd - o.x, ((pyd - o.y) * o.r) / Math.max(0.5, o.ry)) - o.r) / dpr;
            size = Math.max(o.r, o.ry) / dpr;
          }
          // A little to spare, and a small tree still 9 pixels' worth to aim at.
          if (d > Math.max(3, 9 - size) || !isLive(i)) continue;
          const at = view.vx * mx[i] + view.vy * my[i];
          if (at - DEPTH_SLACK > groundAt) continue;
          if (d < bestD - 0.5 || (d <= bestD + 0.5 && at < bestV)) {
            best = i;
            bestD = d;
            bestV = at;
          }
        }
        return best >= 0 ? best : null;
      }
      const at = toWorld(px, py, v);
      const { mx, my, crown } = prepared;
      let best = -1;
      let bestD = Infinity;
      const reachPx = 9;
      const consider = (i: number, x: number, y: number, dot: number) => {
        const dx = (x - at.x) * v.s;
        if (dx > 120 || dx < -120) return;
        const dy = (y - at.y) * v.s;
        if (dy > 120 || dy < -120) return;
        const reach = Math.max(reachPx, dot * v.s);
        const d = dx * dx + dy * dy;
        if (d <= reach * reach && d < bestD && isLive(i)) {
          best = i;
          bestD = d;
        }
      };
      if (!scene || !grid) return null;
      // Only the cells within the 120 px anything can be picked from.
      const far = 120 / v.s;
      const [c0, r0, c1, r1] = gridSpan(grid, at.x - far, at.y - far, at.x + far, at.y + far);
      const { cols, start, items } = grid;
      const { nS, nR } = scene;
      const near = (from: number, to: number, each: (i: number) => void) => {
        for (let row = r0; row <= r1; row++) {
          for (let cell = row * cols + c0, last = row * cols + c1; cell <= last; cell++) {
            for (let j = start[cell], end = start[cell + 1]; j < end; j++) {
              const i = items[j];
              if (i >= to) break;
              if (i >= from) each(i);
            }
          }
        }
      };
      near(0, nS, (i) => consider(i, mx[i], my[i], crown[i]));
      if (mode === "planted" && removedPrep) {
        near(nS, nS + nR, (i) => consider(i, removedPrep.mx[i - nS], removedPrep.my[i - nS], removedPrep.dot[i - nS]));
      }
      // A street tree under the pointer wins over the canopy around it.
      if (best < 0 && shownCrowns && mode !== "planted") {
        near(nS + nR, scene.mx.length, (i) => consider(i, scene.mx[i], scene.my[i], scene.forms.crown[i]));
      }
      return best >= 0 ? best : null;
    },
    // toWorld changes with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trees, prepared, scene, grid, order, ground, removedPrep, shownCrowns, isLive, mode, tilt, pitch, heading, sceneGround, turn, squash],
  );

  /** The place under a spot on the canvas, where there's no tree: in Tilt, on the ground actually drawn there. */
  const pickPlace = useCallback(
    (px: number, py: number): Place | null => {
      const v = viewRef.current;
      if (!places || !showPlaces || !prepared || !v) return null;
      // A few pixels' grace, in metres, for the gardens and creeks.
      const reach = 6 / v.s;
      let at: { x: number; y: number };
      if (tilt) {
        const layer = groundLayerRef.current;
        const { w, h, dpr } = sizeRef.current;
        const W = Math.round(w * dpr);
        const H = Math.round(h * dpr);
        const ix = Math.floor(px * dpr);
        const iy = Math.floor(py * dpr);
        if (!layer || ix < 0 || iy < 0 || ix >= W || iy >= H) return null;
        // The areaways go down below the pavement, where the ground under the pixel isn't theirs.
        if (underground) {
          const view = makeTiltView(W, H, v.s * dpr, v.cx, v.cy, pitch, heading);
          const pit = areawayAtScreen(view, litGround, layer.depth, places, ix + 0.5, iy + 0.5);
          if (pit) return pit;
        }
        const depthAt = layer.depth[iy * layer.W + ix];
        if (!Number.isFinite(depthAt)) return null;
        const [cu] = rot(heading, v.cx, v.cy);
        const [x, y] = unrot(heading, cu + (ix + 0.5 - W / 2) / (v.s * dpr), depthAt);
        at = { x, y };
      } else {
        at = toWorld(px, py, v);
      }
      if (at.x < 0 || at.y < 0 || at.x > prepared.widthM || at.y > prepared.heightM) return null;
      return placeAt(places, { parks, water, underground }, at.x, at.y, reach);
    },
    // toWorld changes with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places, showPlaces, prepared, tilt, pitch, heading, parks, water, underground, litGround, turn, squash],
  );

  // --- pointer handling -----------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    view: View;
    moved: boolean;
    /** The last two-finger reading, so a pinch zooms and pans by the change since. */
    pinch?: { dist: number; midX: number; midY: number };
  } | null>(null);
  const hoverFrame = useRef(0);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Is (px, py) on the walker's figure? */
  const onWalker = (px: number, py: number) => {
    const hit = walkerHitRef.current;
    return !!hit && px >= hit.x0 && px <= hit.x1 && py >= hit.y0 && py <= hit.y1;
  };

  /**
   * Put the walker down under (px, py): the ground there in 2.5D, the map
   * there flat. Only where they stand — how high is the walk's business.
   */
  const dropWalker = (px: number, py: number) => {
    const v = viewRef.current;
    const walker = walkerRef.current;
    if (!v || !walker || !trees || !prepared) return;
    let at: { x: number; y: number };
    if (tilt) {
      const layer = groundLayerRef.current;
      const { w, h, dpr } = sizeRef.current;
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      const ix = Math.floor(px * dpr);
      const iy = Math.floor(py * dpr);
      if (!layer || ix < 0 || iy < 0 || ix >= W || iy >= H) return;
      const depthAt = layer.depth[iy * layer.W + ix];
      if (!Number.isFinite(depthAt)) return;
      const [cu] = rot(heading, v.cx, v.cy);
      const [x, y] = unrot(heading, cu + (ix + 0.5 - W / 2) / (v.s * dpr), depthAt);
      at = { x, y };
    } else at = toWorld(px, py, v);
    const x = Math.min(Math.max(at.x, 1), prepared.widthM - 1);
    const y = Math.min(Math.max(at.y, 1), prepared.heightM - 1);
    const { south, north, west, east } = trees.bbox;
    const lat = south + (y / prepared.heightM) * (north - south);
    const lon = west + (x / prepared.widthM) * (east - west);
    walkerRef.current = { at: { ...walker.at, lat, lon }, t: performance.now() };
    walkerChannelRef.current?.postMessage({ type: "move", lat, lon });
    requestDraw();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !viewRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    // Grabbing the walker drags them, not the map.
    const hit = walkerHitRef.current;
    if (pointers.current.size === 0 && hit && onWalker(p.x, p.y)) {
      walkerDragRef.current = { id: e.pointerId, dx: hit.gx - p.x, dy: hit.gy - p.y };
      return;
    }
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { startX: p.x, startY: p.y, view: { ...viewRef.current }, moved: false };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        startX: (a.x + b.x) / 2,
        startY: (a.y + b.y) / 2,
        view: { ...viewRef.current },
        moved: true,
        pinch: { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const drag = walkerDragRef.current;
    if (drag) {
      if (drag.id === e.pointerId) dropWalker(p.x + drag.dx, p.y + drag.dy);
      return;
    }
    const g = gesture.current;
    if (g && pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, p);
      const pts = [...pointers.current.values()];
      if (g.pinch && pts.length >= 2) {
        const [a, b] = pts;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const v = viewRef.current;
        if (v) {
          const [lo, hi] = scaleLimits();
          const s = Math.min(hi, Math.max(lo, v.s * (dist / Math.max(1, g.pinch.dist))));
          beginStretch();
          viewRef.current = viewWith(toWorld(g.pinch.midX, g.pinch.midY, v), midX, midY, s);
        }
        g.pinch = { dist, midX, midY };
        fittedRef.current = false;
        moved();
        requestDraw();
        return;
      }
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (!g.moved && dx * dx + dy * dy > 16) g.moved = true;
      if (g.moved) {
        // The ground that was under the pointer stays under it.
        beginStretch();
        viewRef.current = viewWith(toWorld(g.startX, g.startY, g.view), p.x, p.y, g.view.s);
        fittedRef.current = false;
        moved();
        requestDraw();
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    const over = onWalker(p.x, p.y);
    if (over !== overWalker) setOverWalker(over);
    if (over) return;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const tree = pick(p.x, p.y);
      setHover(tree);
      setHoverPlace(tree === null ? pickPlace(p.x, p.y) : null);
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (walkerDragRef.current?.id === e.pointerId) {
      walkerDragRef.current = null;
      return;
    }
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // One finger left after a pinch carries on as a drag from where it is.
      const [rest] = [...pointers.current.values()];
      if (viewRef.current) gesture.current = { startX: rest.x, startY: rest.y, view: { ...viewRef.current }, moved: true };
      return;
    }
    gesture.current = null;
    if (g && !g.moved && e.type === "pointerup") {
      const p = local(e);
      // Clicking what's already picked puts it down again.
      const tree = pick(p.x, p.y);
      const place = tree === null ? pickPlace(p.x, p.y) : null;
      setSelected((cur) => (tree !== null && tree === cur ? null : tree));
      setSelectedPlace((cur) => (place !== null && place === cur ? null : place));
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = local(e);
    zoomAt(p.x, p.y, 2.5);
  };

  // Wheel has to be a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-delta * 0.0018));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // --- playback -------------------------------------------------------------

  // The season runs smoothly, a year in about half a minute; it loops.
  useEffect(() => {
    if (!playing || mode !== "season") return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setDay((d) => (d + dt * 12) % 365);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode]);

  // Years step whole, three a second, and stop at the last one.
  useEffect(() => {
    if (!playing || mode !== "planted" || !prepared || year >= prepared.yearMax) return;
    const timer = window.setTimeout(() => {
      const next = year + 1;
      setYear(next);
      if (next >= prepared.yearMax) setPlaying(false);
    }, 330);
    return () => window.clearTimeout(timer);
  }, [playing, mode, prepared, year]);

  const togglePlay = useCallback(() => {
    if (mode === "species" || !prepared) return;
    if (!playing && mode === "planted" && year >= prepared.yearMax) setYear(YEAR_MIN);
    setPlaying(!playing);
  }, [mode, prepared, playing, year]);

  // --- keys -----------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedPlace(null);
      }
      else if (tilt && (e.key === "q" || e.key === "Q")) onTurn(-1);
      else if (tilt && (e.key === "e" || e.key === "E")) onTurn(1);
      else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
        const { w, h } = sizeRef.current;
        zoomAt(w / 2, h / 2, e.key === "+" || e.key === "=" ? 1.6 : 1 / 1.6);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, togglePlay, zoomAt, tilt, onTurn]);

  // WASD slide the map while held, up, left, down and right on the screen
  // whichever way Tilt faces, at most of the window a second.
  useEffect(() => {
    if (!active) return;
    const held = new Set<string>();
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h } = sizeRef.current;
      const speed = Math.min(w, h) * 0.8 * dt;
      const dx = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
      const dy = (held.has("s") ? 1 : 0) - (held.has("w") ? 1 : 0);
      if (dx || dy) panBy((dx * speed) / Math.hypot(dx, dy), (dy * speed) / Math.hypot(dx, dy));
      raf = held.size ? requestAnimationFrame(step) : 0;
    };
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "w" && k !== "a" && k !== "s" && k !== "d") return;
      e.preventDefault();
      held.add(k);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };
    const onUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    const onBlur = () => held.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active, panBy]);

  // --- readouts -------------------------------------------------------------

  const seasonNotes = useMemo(() => {
    if (!trees || !prepared || mode !== "season") return null;
    const d = Math.floor(day);
    const bloom = new Map<string, number>();
    const turning = new Map<string, number>();
    trees.species.forEach((sp, s) => {
      const { state } = seasonColor(prepared.phen[s], d);
      const target = state === "bloom" ? bloom : state === "turning" ? turning : null;
      if (target) target.set(sp.common, (target.get(sp.common) ?? 0) + prepared.speciesCount[s]);
    });
    const top = (m: Map<string, number>) =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name.replace(/\s*\(.*?\)\s*/g, " ").trim());
    return { bloom: top(bloom), turning: top(turning) };
  }, [trees, prepared, mode, day]);

  const plantedTotals = useMemo(() => {
    if (!prepared) return { standing: 0, thisYear: 0, felled: 0 };
    let standing = 0;
    for (let y = YEAR_MIN; y <= year; y++) {
      const k = y - YEAR_MIN;
      standing += prepared.yearCounts[k] ?? 0;
      // A removed tree stands from its planting until the year it came down.
      if (removedPrep) standing += (removedPrep.plantedCounts[k] ?? 0) - (removedPrep.removedCounts[k] ?? 0);
    }
    const k = year - YEAR_MIN;
    return {
      standing,
      thisYear: (prepared.yearCounts[k] ?? 0) + (removedPrep?.plantedCounts[k] ?? 0),
      felled: removedPrep?.removedCounts[k] ?? 0,
    };
  }, [prepared, removedPrep, year]);

  /** What the card says about tree i, whichever kind of tree it is. */
  const cardFor = (i: number): CardInfo | null => {
    if (!trees || !scene) return null;
    const kind = kindOf(scene, i);
    const metres = (m: number) => `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
    if (kind === "crown" && crowns) {
      const c = i - scene.nS - scene.nR;
      const conifer = crowns.conifer[c] === 1;
      return {
        kind: "LiDAR tree",
        title: conifer ? "Conifer" : "Broadleaf tree",
        rows: [
          ["Height", metres(crowns.height[c])],
          ["Crown", `${metres(crowns.radius[c] * 2)} across`],
          ["Ground", sceneGround && ground ? `${Math.round(sceneGround[i])} m above sea level` : "—"],
        ],
        notes: [
          "Not in the street-tree inventory: a park, yard or greenbelt tree, measured from the air by the city's 2021 LiDAR survey, which can't say what kind it is.",
        ],
      };
    }
    if (kind === "removed" && removed && removedPrep) {
      const r = i - scene.nS;
      const sp = removed.species[removed.species16[r]];
      const by = (removed.flags[r] & 1) !== 0;
      const gone = removedPrep.removedYear[r];
      return {
        kind: "Removed tree",
        title: sp.common,
        rows: [
          ["Species", speciesLabel(sp)],
          ["Address", treeAddress(removed.addresses, r) || "not recorded"],
          ["Trunk", removed.diam[r] ? `${removed.diam[r]} in across` : "not measured"],
          ["Planted", removed.planted[r] ? String(1900 + removed.planted[r]) : "no date"],
          ["Removed", by ? `by ${gone}` : String(gone)],
        ],
        notes: by ? ["The city didn't record when it came down; the year is the record's last edit, so it was gone by then."] : [],
        italicSpecies: true,
      };
    }
    const sp = trees.species[trees.species16[i]];
    const y = treeYear(trees, i);
    const flags = trees.flags[i];
    const count = prepared?.speciesCount[trees.species16[i]] ?? 0;
    const measured = crowns?.streetHeight[i] ?? 0;
    if (isUwTree(trees, i)) {
      const k = uw?.row.get(i);
      const ft = k !== undefined ? uw!.height[k] : 0;
      const when = k !== undefined && uw!.measured[k] ? `, ${1900 + uw!.measured[k]}` : "";
      const rows: [string, string][] = [
        ["Species", speciesLabel(sp)],
        ["Campus", "University of Washington"],
      ];
      if (k !== undefined && uw!.tag[k]) rows.push(["Tag", String(uw!.tag[k])]);
      rows.push(["Trunk", trees.diam[i] ? `${trees.diam[i]} in across` : "not measured"]);
      if (measured > 0) rows.push(["Height", `${metres(measured)} (LiDAR, 2021)`]);
      else if (ft) rows.push(["Height", `${metres(ft * 0.3048)} (UW Grounds${when})`]);
      rows.push(["Cared for by", "UW Grounds"]);
      const notes = ["From UW Grounds' inventory of the trees on its Seattle campus."];
      const cherry = k !== undefined ? uw!.cherries.get(k) : undefined;
      if (cherry) {
        const bloom = cherryRows(cherry);
        rows.push(...bloom.rows);
        if (bloom.note) notes.push(bloom.note);
      }
      notes.push(count <= 1 ? "The only one inventoried." : `One of ${fmt(count)} inventoried across the city and campus.`);
      return { kind: cherry ? "Quad cherry" : "Campus tree", title: sp.common, rows, notes, italicSpecies: true };
    }
    const inPark = isParkTree(trees, i);
    // Some records have no address, or only a number; the park it stands in will do, if it's in one.
    let address = treeAddress(addresses, i);
    if (address !== null && !/[a-z]{2}/i.test(address)) {
      const park = places && prepared ? parkAt(places, prepared.mx[i], prepared.my[i]) : null;
      address = park?.name ?? "not recorded";
    }
    const rows: [string, string][] = [
      ["Species", speciesLabel(sp)],
      [inPark ? "Park" : "Address", address ?? "…"],
      ["Trunk", trees.diam[i] ? `${trees.diam[i]} in across` : "not measured"],
    ];
    if (measured > 0) rows.push(["Height", `${metres(measured)} (LiDAR, 2021)`]);
    // Parks' inventory keeps no planting dates.
    if (!inPark) {
      rows.push(["Planted", y ? (y >= INVENTORY[0] && y <= INVENTORY[1] ? `by ${y} (first inventory)` : String(y)) : "no date"]);
    }
    rows.push(["Cared for by", OWNER_LABEL[treeOwner(trees, i)]]);
    const notes: string[] = [];
    if ((flags & 12) !== 0) notes.push(flags & 4 ? "Heritage tree" : "Exceptional tree");
    if (inPark) notes.push("From Seattle Parks' own inventory of the trees in its parks.");
    const walk = sidewalk ? sidewalkRows(sidewalk, i) : null;
    if (walk) {
      rows.push(...walk.rows);
      notes.push(walk.note);
    }
    notes.push(count <= 1 ? "The only one the city has inventoried." : `One of ${fmt(count)} the city has inventoried.`);
    return {
      kind: inPark ? "Park tree" : "Street tree",
      title: sp.common,
      rows,
      notes,
      italicSpecies: true,
      boldFirstNote: (flags & 12) !== 0,
    };
  };

  const describe = (i: number) => {
    const card = cardFor(i);
    if (!card) return "";
    const get = (k: string) => card.rows.find(([key]) => key === k)?.[1];
    const parts = [
      card.title,
      get("Address") ?? get("Park") ?? get("Campus"),
      get("Blossom") ? `in bloom ${get("Blossom")!.split("; ")[0]}` : null,
      get("Height"),
      get("Trunk"),
      get("Roots") ? `roots ${get("Roots")}` : null,
      get("Removed") ? `removed ${get("Removed")}` : null,
    ];
    return parts.filter((p) => p && p !== "…" && p !== "not measured" && p !== "not recorded").join(" · ");
  };

  const selectedCard = selected !== null ? cardFor(selected) : null;
  // Counting a park's trees means testing every tree in its box: once, when it's picked.
  const selectedPlaceCard = useMemo(() => {
    if (!selectedPlace || !trees || !prepared) return null;
    return placeCard(selectedPlace, treesInside(selectedPlace, prepared.mx, prepared.my, trees.count));
  }, [selectedPlace, trees, prepared]);

  let status: string;
  if (error) status = "No tree data";
  else if (!trees) status = "Loading Seattle's street trees…";
  else if (tilt && wantTerrain) status = "Loading the ground…";
  else if (hover !== null) status = describe(hover);
  else if (hoverPlace) status = describePlace(hoverPlace);
  else if (tilt && terrainError) status = "No elevation data here, so the ground is flat";
  else if (light) {
    const up = light.altitude > 0;
    status =
      `${clockLabel(minutes)} · the sun ${up ? `${Math.round(light.altitude)}° up in the` : "down, below the"} ` +
      `${compass(light.azimuth)}` +
      (daylight ? ` · sunrise ${clockLabel(daylight.rise)}, sunset ${clockLabel(daylight.set)}` : "");
  }
  else if (canopy && crowns && mode !== "planted")
    status = `${fmt(trees.count)} street and park trees and ${fmt(crowns.count)} more from the city's 2021 LiDAR survey`;
  else if (mode === "planted" && removed)
    status = `${fmt(trees.count - trees.parkCount - trees.uwCount)} street trees standing, ${fmt(removed.count)} more the city has taken down`;
  else if (trees.parkCount && trees.uwCount)
    status = `${fmt(trees.count - trees.parkCount - trees.uwCount)} street trees, ${fmt(trees.parkCount)} in parks and ${fmt(
      trees.uwCount,
    )} on the UW campus · fetched ${new Date(trees.fetched).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  else if (trees.parkCount)
    status = `${fmt(trees.count - trees.parkCount)} street trees and ${fmt(trees.parkCount)} in parks · fetched ${new Date(
      trees.fetched,
    ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  else
    status = `${fmt(trees.count)} street trees · ${trees.source} · fetched ${new Date(trees.fetched).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    )}`;

  // --- render ---------------------------------------------------------------

  const yearMax = prepared?.yearMax ?? new Date().getFullYear();

  // Picking a day or a year from the menu stops playback, as the sliders do.
  const menuState: TreesMenuState = {
    playing,
    canPlay: !!prepared && mode !== "species",
    toggle: togglePlay,
    day: Math.floor(day),
    setDay: (d) => {
      setPlaying(false);
      setDay(d);
    },
    year,
    yearMin: YEAR_MIN,
    yearMax,
    setYear: (y) => {
      setPlaying(false);
      setYear(y);
    },
    groups: prepared?.groups ?? [],
    group,
    setGroup,
  };

  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Portalled to the top of the page; only here to see the timeline. */}
      {menu?.(menuState)}
      <div
        ref={wrapRef}
        style={{ ...SUNK, flex: "1 1 auto", minHeight: 80, position: "relative", overflow: "hidden", background: "rgb(14,20,16)" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            setHover(null);
            setHoverPlace(null);
          }}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu?.(e.clientX, e.clientY);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: overWalker ? "move" : hover !== null || hoverPlace !== null ? "pointer" : "grab",
          }}
        />
        {error ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#dfe8df",
              fontSize: 12,
              padding: 16,
              textAlign: "center",
            }}
          >
            Couldn&apos;t load the street trees. They&apos;ll be back after the next refresh.
          </div>
        ) : !trees ? (
          <LoadingPanel label="Loading Seattle's street trees" progress={treesProgress} />
        ) : wantTerrain ? (
          <LoadingPanel label="Loading the hills" progress={terrainProgress} corner />
        ) : wantCrowns && trees ? (
          <LoadingPanel label="Loading the city's other 850,000 trees" progress={crownsProgress} corner />
        ) : null}
        {selectedCard && <TreeCard card={selectedCard} corner={cardCorner} onCorner={setCardCorner} onClose={() => setSelected(null)} />}
        {!selectedCard && selectedPlaceCard && (
          <TreeCard card={selectedPlaceCard} corner={cardCorner} onCorner={setCardCorner} onClose={() => setSelectedPlace(null)} />
        )}

      </div>

      {/* The same 10px gaps as the control panel's, so the separators after their knobs line up; and
          as tall whichever view's controls are in it, so switching views doesn't move the map's edge. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: MODE_ROW_H, flex: "none" }}>
        {modeKnob}
        <div
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            overflowY: "auto",
          }}
        >
        {trees && prepared && mode === "season" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Button
                size="sm"
                square
                active={playing}
                title={playing ? "Pause (Space)" : "Play the year (Space)"}
                aria-label={playing ? "Pause" : "Play"}
                onClick={togglePlay}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <TrackSlider
                min={0}
                max={364}
                value={Math.floor(day)}
                onChange={(v) => {
                  setPlaying(false);
                  setDay(v);
                }}
                format={dayLabel}
                label="Day of the year"
                below={
                  <div style={{ position: "relative", height: 12, fontSize: 10, opacity: 0.7 }}>
                    {"JFMAMJJASOND".split("").map((m, k) => (
                      <span
                        key={k}
                        style={{ position: "absolute", left: `${(doy(k + 1, 15) / 364) * 100}%`, transform: "translateX(-50%)" }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                }
              />
              <span style={{ minWidth: 52, flex: "none", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{dayLabel(Math.floor(day))}</span>
              <Button
                size="sm"
                onClick={() => {
                  setPlaying(false);
                  setDay(todayDoy());
                  onNow();
                }}
                title={sun && tilt ? "Back to today, and the sun to now" : "Back to today"}
              >
                Today
              </Button>
            </div>
            <div style={{ fontSize: 11, minHeight: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {seasonNotes && seasonNotes.bloom.length > 0 && <span><b>In bloom:</b> {seasonNotes.bloom.join(", ")}</span>}
              {seasonNotes && seasonNotes.bloom.length > 0 && seasonNotes.turning.length > 0 && " · "}
              {seasonNotes && seasonNotes.turning.length > 0 && <span><b>Turning:</b> {seasonNotes.turning.join(", ")}</span>}
              {seasonNotes && !seasonNotes.bloom.length && !seasonNotes.turning.length && (
                <span style={{ opacity: 0.7 }}>Nothing much flowering or turning.</span>
              )}
            </div>
          </div>
        )}

        {trees && prepared && mode === "planted" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
              <Button
                size="sm"
                square
                active={playing}
                title={playing ? "Pause (Space)" : "Play the years (Space)"}
                aria-label={playing ? "Pause" : "Play"}
                onClick={togglePlay}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <TrackSlider
                min={YEAR_MIN}
                max={yearMax}
                value={year}
                onChange={(v) => {
                  setPlaying(false);
                  setYear(v);
                }}
                format={String}
                label="Year"
                behind={
                  <YearHistogram
                    counts={prepared.yearCounts}
                    felled={removedPrep?.removedCounts ?? null}
                    extraPlanted={removedPrep?.plantedCounts ?? null}
                    year={year}
                  />
                }
              />
              <span style={{ minWidth: 36, flex: "none", whiteSpace: "nowrap", textAlign: "right", fontWeight: "bold", fontVariantNumeric: "tabular-nums" }}>{year}</span>
            </div>
            <div style={{ fontSize: 11, minHeight: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {fmt(plantedTotals.thisYear)} dated {year}
              {removedPrep && (
                <>
                  {" · "}
                  <span style={{ color: plantedTotals.felled ? "#b01e10" : undefined }}>{fmt(plantedTotals.felled)} removed</span>
                </>
              )}
              {" · "}
              {fmt(plantedTotals.standing)} standing
              {year >= INVENTORY[0] && year <= INVENTORY[1] ? (
                <span style={{ opacity: 0.75 }}> · {INVENTORY[0]}–{INVENTORY[1]} dates are mostly the city&apos;s first inventory, not plantings</span>
              ) : year < INVENTORY[0] ? (
                <span style={{ opacity: 0.75 }}> · few trees were dated before the {INVENTORY[0]} inventory</span>
              ) : null}
            </div>
          </div>
        )}

        {trees && prepared && mode === "species" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {prepared.groups.map((g, k) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGroup((cur) => (cur === k ? null : k))}
                title={group === k ? "Show every tree again" : `Show only ${g.label.toLowerCase()}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "1px 5px",
                  font: "inherit",
                  fontSize: 11,
                  cursor: "pointer",
                  background: group === k ? "#000080" : "transparent",
                  color: group === k ? "#ffffff" : "inherit",
                  border: "1px solid transparent",
                  borderColor: group === k ? "#000080" : "transparent",
                  opacity: group === null || group === k ? 1 : 0.55,
                }}
              >
                <span style={{ width: 9, height: 9, background: g.color, border: "1px solid #000", flex: "none" }} />
                {g.label}
                <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{fmt(g.count)}</span>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {controls && <div style={{ borderTop: "1px solid #808080", boxShadow: "inset 0 1px #fff" }}>{controls}</div>}

      <div style={{ ...SUNK, padding: "1px 4px", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {status}
      </div>
    </div>
  );
}

/** The coloring's row under the map: the Season view's slider, its month letters and its notes. */
const MODE_ROW_H = 64;

// react95's Slider centres its 18px thumb on the value, so it overhangs each
// end of the track by half that — pad for it, and measure positions inside it.
const THUMB_INSET = 9;

const TOOLTIP_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  transform: "translateX(-50%)",
  marginBottom: 2,
  padding: "1px 4px",
  background: "#ffffe1",
  color: "#000",
  border: "1px solid #000",
  fontSize: 11,
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 2,
};

/**
 * media.exe's seek bar, for a day or a year: react95's Slider with a navy fill
 * along the groove up to the thumb, and a tip saying where a click or a drag
 * would land. Whatever sits `above`, `below` or `behind` it is inset to the
 * track, so a month or a year in it lines up with the same spot on the slider;
 * `behind` fills the slider's own height, under the groove and thumb.
 */
function TrackSlider({
  min,
  max,
  value,
  onChange,
  format,
  label,
  above,
  below,
  behind,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  label: string;
  above?: React.ReactNode;
  below?: React.ReactNode;
  behind?: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const pct = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;
  const at = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return null;
    const t = (clientX - box.left - THUMB_INSET) / (box.width - THUMB_INSET * 2);
    return Math.round(min + Math.max(0, Math.min(1, t)) * (max - min));
  };
  const tip = dragging ? value : hover;
  return (
    <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
      {above && <div style={{ padding: `0 ${THUMB_INSET}px` }}>{above}</div>}
      <div
        ref={trackRef}
        style={{ position: "relative", padding: `0 ${THUMB_INSET}px` }}
        onMouseMove={(e) => setHover(at(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {behind && (
          <div aria-hidden style={{ position: "absolute", left: THUMB_INSET, right: THUMB_INSET, top: 0, bottom: 0, pointerEvents: "none" }}>
            {behind}
          </div>
        )}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: THUMB_INSET,
            top: "50%",
            height: 4,
            marginTop: -2,
            width: `calc((100% - ${THUMB_INSET * 2}px) * ${pct(value) / 100})`,
            background: "#000080",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
        {tip !== null && (
          <div style={{ ...TOOLTIP_STYLE, left: `calc(${THUMB_INSET}px + (100% - ${THUMB_INSET * 2}px) * ${pct(tip) / 100})` }}>
            {format(tip)}
          </div>
        )}
        <Slider
          size="100%"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={onChange}
          onChangeCommitted={() => setDragging(false)}
          aria-label={label}
          // react95 leaves room under the track for tick labels; there are none.
          style={{ marginBottom: 0 }}
        />
      </div>
      {below && <div style={{ padding: `0 ${THUMB_INSET}px` }}>{below}</div>}
    </div>
  );
}

/**
 * A Windows 95 progress dialog in miniature, over the map while a file comes
 * down: in the middle while there's nothing to show yet, tucked at the bottom
 * while the flat ground stands in for the hills.
 */
function LoadingPanel({ label, progress, corner }: { label: string; progress: number | null; corner?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: corner ? "flex-end" : "center",
        justifyContent: "center",
        padding: corner ? "0 0 28px" : 16,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <Window style={{ width: 240, maxWidth: "100%" }}>
        <WindowContent style={{ padding: 8, fontSize: 12 }}>
          <div style={{ marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}…
          </div>
          {/* No size from the server: a bar that fills in steps rather than a number it can't know. */}
          <ProgressBar
            value={progress === null ? undefined : Math.round(progress * 100)}
            variant={progress === null ? "tile" : "default"}
            hideValue={progress === null}
            style={{ height: 22 }}
          />
        </WindowContent>
      </Window>
    </div>
  );
}

function YearHistogram({
  counts,
  felled,
  extraPlanted,
  year,
}: {
  counts: Int32Array;
  /** Trees taken down each year, hung red from the top. */
  felled: Int32Array | null;
  /** Removed trees' plantings, added to each year's bar. */
  extraPlanted: Int32Array | null;
  year: number;
}) {
  const planted = Array.from(counts, (c, k) => c + (extraPlanted?.[k] ?? 0));
  const max = Math.max(1, ...planted);
  const maxFelled = felled ? Math.max(1, ...felled) : 1;
  const n = counts.length;
  const H = 30;
  return (
    <svg
      viewBox={`0 0 ${n} ${H}`}
      preserveAspectRatio="none"
      // Laid behind the year slider, as tall as it is: a click on it is the slider's.
      style={{ width: "100%", height: "100%", display: "block", background: "rgb(14,20,16)" }}
      aria-label="Trees planted each year, and removed"
    >
      {planted.map((c, k) => {
        const y = YEAR_MIN + k;
        // Square-root height, or 1991–92's inventory flattens every other year.
        const h = c ? Math.max(1, Math.sqrt(c / max) * (H - 2)) : 0;
        const inv = y >= INVENTORY[0] && y <= INVENTORY[1];
        const fill = y === year ? "#ffff00" : y > year ? "#2a3a2e" : inv ? "#6f8f74" : "#8fd36a";
        return <rect key={k} x={k + 0.1} y={H - h} width={0.8} height={h} fill={fill} />;
      })}
      {felled &&
        Array.from(felled, (c, k) => {
          // Removals hang from the top, a third of the height at most.
          const h = c ? Math.max(1, Math.sqrt(c / maxFelled) * (H / 3)) : 0;
          const y = YEAR_MIN + k;
          return <rect key={`f${k}`} x={k + 0.25} y={0} width={0.5} height={h} fill={y > year ? "#4a2a26" : "#ec4030"} />;
        })}
    </svg>
  );
}

/** What the sidewalk inspectors put down to tree `i`, as card rows and a note saying where it's from; null for nothing. */
function sidewalkRows(sw: TreeSidewalk, i: number): { rows: [string, string][]; note: string } | null {
  const k = sw.row.get(i);
  if (k === undefined) return null;
  const f = sw.flags[k];
  const rows: [string, string][] = [];
  if (sw.uplifts[k]) {
    const inches = sw.uplift[k] / 10;
    const places = sw.uplifts[k] > 1 ? ` (${sw.uplifts[k]} places)` : "";
    rows.push(["Roots", inches ? `lifted the sidewalk ${inches.toFixed(1)} in${places}` : `lifted the sidewalk${places}`]);
  }
  const problems = [
    f & SIDEWALK_LOW_BRANCHES ? "branches hang low over it" : null,
    f & SIDEWALK_NARROWED ? "trunk or pit narrows it" : null,
    f & SIDEWALK_IN_THE_WAY ? "the tree is in the way" : null,
    f & SIDEWALK_CRACKED ? "slabs cracked" : null,
    f & SIDEWALK_TILTED ? "slab tilted" : null,
  ].filter(Boolean);
  if (problems.length) rows.push(["Sidewalk", problems.join("; ")]);
  if (!rows.length) return null;
  const year = sw.year[k] ? ` in ${1900 + sw.year[k]}` : "";
  const note =
    `From SDOT's sidewalk inspections${year}` +
    (f & SIDEWALK_REPAIRED ? ", since repaired." : ".") +
    (f & SIDEWALK_BY_NEARNESS ? " The inspector named no tree; this is the nearest." : "");
  return { rows, note };
}

/** "2025-03-31" → "Mar 31, 2025". */
function dayOf(iso: string, year = true): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: year ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/** A Quad cherry's bloom record as card rows: the day it opened in the last four springs it was checked, newest first, and the last check. */
function cherryRows(c: CherryBloom): { rows: [string, string][]; note: string | null } {
  const rows: [string, string][] = [];
  const years = Object.keys(c.blooms).sort().reverse();
  if (years.length) rows.push(["Blossom", years.slice(0, 4).map((y) => dayOf(c.blooms[y])).join("; ")]);
  if (c.stage && c.seen) rows.push(["Last check", `${c.stage.toLowerCase()}, ${dayOf(c.seen)}`]);
  if (!rows.length) return { rows, note: null };
  return {
    rows,
    note: "UW Grounds checks the Quad cherries' buds every few days each spring; Blossom is the first day it was seen in bloom.",
  };
}

/** The scientific name, or the genus, or — for a record with neither — saying so. */
function speciesLabel(sp: { scientific: string; genus: string }): string {
  const ok = (s: string) => s !== "" && !/^unknown$|error/i.test(s);
  return ok(sp.scientific) ? sp.scientific : ok(sp.genus) ? `${sp.genus} (species not recorded)` : "not recorded";
}

/** Eight points of the compass, for a bearing in degrees. */
function compass(deg: number): string {
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
}

const acresLabel = (acres: number | undefined) =>
  acres === undefined ? null : `${acres < 10 ? acres.toFixed(1) : fmt(Math.round(acres))} acres`;

/** A park, restoration zone, garden, creek or areaway, in a line for the status bar. */
function describePlace(p: Place): string {
  switch (p.kind) {
    case "park":
      return [p.name ?? "Park", acresLabel(p.acres)].filter(Boolean).join(" · ");
    case "restoration":
      return [
        p.zone ?? "Restoration zone",
        p.name ? `forest restoration in ${p.name}` : "forest restoration",
        p.phase !== undefined ? RESTORATION_PHASES[p.phase]?.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "garden":
      return [`${p.name ?? "Community"} P-Patch`, p.address, p.plots ? `${p.plots} plots` : null].filter(Boolean).join(" · ");
    case "areaway":
      return ["Areaway", p.name, p.deep ? `${feet(p.deep)} ft down` : null, p.status].filter(Boolean).join(" · ");
    case "rail":
      return [railLine(p), p.profile].filter(Boolean).join(" · ");
    case "station":
      return [p.name ?? "Link station", p.underground ? "underground" : null].filter(Boolean).join(" · ");
    default:
      return `${p.name ?? "Unnamed creek"}${p.piped ? " · piped here" : ""}`;
  }
}

/** The card for a picked place; `trees` is how many of the city's trees stand in it. */
function placeCard(p: Place, trees: number): CardInfo {
  const rows: [string, string][] = [];
  const add = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") rows.push([k, String(v)]);
  };
  switch (p.kind) {
    case "park":
      add("Area", acresLabel(p.acres));
      add("Trees", `${fmt(trees)} inventoried`);
      return {
        kind: "Park",
        title: p.name ?? "Park",
        rows,
        notes: ["A Seattle Parks and Recreation park. Trees counts the street and park inventories; Canopy shows the rest, measured from the air."],
      };
    case "restoration":
      add("Park", p.name);
      add("Phase", p.phase !== undefined ? `${p.phase} · ${RESTORATION_PHASES[p.phase] ?? ""}` : null);
      add("Last checked", p.visited);
      add("Area", acresLabel(p.acres));
      return {
        kind: "Restoration zone",
        title: p.zone ?? "Restoration zone",
        rows,
        notes: [
          "A Green Seattle Partnership forest-restoration zone: invasive ivy and blackberry cleared, native trees and shrubs planted, then tended until the forest can look after itself.",
        ],
      };
    case "garden":
      add("Address", p.address);
      add("Plots", p.plots);
      add("Since", p.since);
      add("Size", p.sqft ? `${fmt(p.sqft)} sq ft` : null);
      return {
        kind: "P-Patch",
        title: `${p.name ?? "Community"} P-Patch`,
        rows,
        notes: ["A community garden in the city's P-Patch program."],
      };
    case "areaway":
      add("Number", p.id);
      add("Status", p.status);
      add("Used for", p.use);
      add("Depth", p.deep ? `up to ${feet(p.deep)} ft` : null);
      add("Size", p.wide && p.long ? `${feet(p.wide)} × ${feet(p.long)} ft` : p.long ? `${feet(p.long)} ft long` : null);
      add("Street wall", [p.wall, p.wallRating?.toLowerCase()].filter(Boolean).join(", "));
      add("Sidewalk", [p.roof, p.roofRating?.toLowerCase()].filter(Boolean).join(", "));
      add("Inspected", p.inspected);
      add("Owner", p.owner ? AREAWAY_OWNER_LABEL[p.owner] : null);
      return {
        kind: "Areaway",
        title: p.name ?? "Areaway",
        rows,
        notes: [
          "A hollow cavern under the sidewalk. After the 1889 fire the streets were raised a story or more on walls along the curb; the old sidewalks between them and the buildings were roofed over, and the purple glass in some of those roofs once lit them.",
          ...(p.filled ? ["Partly filled in since."] : []),
        ],
      };
    case "rail":
      add("Track", p.profile);
      add("Project", p.name);
      return {
        kind: "Light rail",
        title: railLine(p),
        rows,
        notes: [
          "Sound Transit's Link light rail, dashed where it runs in a tunnel. How deep the tunnels go isn't in the data, so they're drawn along the ground over them.",
        ],
      };
    case "station":
      add("Platform", p.underground ? "underground" : "above ground");
      return {
        kind: "Link station",
        title: p.name ?? "Link station",
        rows,
        notes: ["A Sound Transit Link light rail station: its platform's outline."],
      };
    default:
      add("Here", p.piped ? "through a pipe" : "open to the sky");
      return {
        kind: "Creek",
        title: p.name ?? "Unnamed creek",
        rows,
        notes: ["From Seattle Public Utilities' map of the city's creeks. Piped stretches are drawn dashed."],
      };
  }
}

/** Feet to a tenth at most: SDOT's measurements come with float noise on the end. */
const feet = (n: number) => String(Math.round(n * 10) / 10);

/** Which Link line a stretch of track carries, from the project that built it. */
function railLine(p: Place): string {
  if (p.name === "OMF") return "Link maintenance yard";
  if (p.name === "East Link") return "Link 2 Line";
  return "Link 1 Line";
}

const AREAWAY_OWNER_LABEL = {
  private: "The building next to it",
  sdot: "Seattle Department of Transportation",
  county: "King County",
  light: "Seattle City Light",
} as const;

const OWNER_LABEL = {
  private: "The property owner next to it",
  sdot: "Seattle Department of Transportation",
  parks: "Seattle Parks and Recreation",
  other: "Another public agency",
} as const;

type CardInfo = {
  /** What it is, in the title bar: short enough never to be cut off. */
  kind: string;
  /** Its name, in the window, where a long one has room to wrap. */
  title: string;
  rows: [string, string][];
  notes: string[];
  /** The Species row in italics, as a scientific name. */
  italicSpecies?: boolean;
  /** The first note in bold — a heritage or exceptional tree. */
  boldFirstNote?: boolean;
};

/** The tree card's resting places: a corner of the map, CARD_GAP in from both edges. */
type CardCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CARD_GAP = 6;

/**
 * The picked tree's (or place's) details, over a corner of the map. Dragged by
 * its title bar it follows the pointer, kept on the map, and let go it snaps
 * to whichever corner its middle is nearest — as Sounds' scope does.
 */
function TreeCard({
  card,
  corner,
  onCorner,
  onClose,
}: {
  card: CardInfo;
  corner: CardCorner;
  onCorner: (corner: CardCorner) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Mid-drag: where the card is, in the map's pixels, and where the pointer took hold of it.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const holdRef = useRef<{ dx: number; dy: number } | null>(null);
  const boxes = () => {
    const el = ref.current;
    const parent = el?.offsetParent;
    return el && parent ? { card: el.getBoundingClientRect(), map: parent.getBoundingClientRect() } : null;
  };
  const clamp = (x: number, y: number) => {
    const b = boxes();
    if (!b) return { x, y };
    return {
      x: Math.max(CARD_GAP, Math.min(b.map.width - b.card.width - CARD_GAP, x)),
      y: Math.max(CARD_GAP, Math.min(b.map.height - b.card.height - CARD_GAP, y)),
    };
  };
  const [vertical, horizontal] = corner.split("-");
  const at: React.CSSProperties = drag
    ? { left: drag.x, top: drag.y }
    : { [vertical]: CARD_GAP, [horizontal]: CARD_GAP };
  return (
    <Window
      ref={ref}
      style={{ position: "absolute", ...at, width: 248, maxWidth: `calc(100% - ${CARD_GAP * 2}px)`, zIndex: 3 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <WindowHeader
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
          cursor: drag ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("button")) return;
          const b = boxes();
          if (!b) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          holdRef.current = { dx: e.clientX - b.card.left, dy: e.clientY - b.card.top };
          setDrag({ x: b.card.left - b.map.left, y: b.card.top - b.map.top });
        }}
        onPointerMove={(e) => {
          const hold = holdRef.current;
          const b = boxes();
          if (!hold || !b) return;
          setDrag(clamp(e.clientX - b.map.left - hold.dx, e.clientY - b.map.top - hold.dy));
        }}
        onPointerUp={() => {
          const b = boxes();
          holdRef.current = null;
          if (b) {
            const cx = b.card.left + b.card.width / 2 - b.map.left;
            const cy = b.card.top + b.card.height / 2 - b.map.top;
            onCorner(`${cy < b.map.height / 2 ? "top" : "bottom"}-${cx < b.map.width / 2 ? "left" : "right"}`);
          }
          setDrag(null);
        }}
        onPointerCancel={() => {
          holdRef.current = null;
          setDrag(null);
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.kind}</span>
        <Button size="sm" square onClick={onClose} aria-label="Close">
          <span className="close-icon" />
        </Button>
      </WindowHeader>
      <WindowContent style={{ padding: 8, fontSize: 12 }}>
        <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 6, overflowWrap: "anywhere" }}>{card.title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
          {card.rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <span style={{ opacity: 0.7 }}>{k}</span>
              <span style={{ fontStyle: k === "Species" && card.italicSpecies ? "italic" : undefined }}>{v}</span>
            </React.Fragment>
          ))}
        </div>
        {card.notes.map((note, k) => (
          <div key={k} style={{ marginTop: 6, opacity: k === 0 && card.boldFirstNote ? 1 : 0.8, fontWeight: k === 0 && card.boldFirstNote ? "bold" : undefined }}>
            {note}
          </div>
        ))}
      </WindowContent>
    </Window>
  );
}
