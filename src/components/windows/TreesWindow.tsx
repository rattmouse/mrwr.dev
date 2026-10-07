"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, ProgressBar, Slider, Window, WindowContent, WindowHeader } from "react95";
import { PauseIcon, PlayIcon } from "@/components/common/MediaGlyphs";
import {
  Crowns,
  loadAddresses,
  loadCrowns,
  loadRemoved,
  loadTrees,
  RemovedTrees,
  treeAddress,
  TreeAddresses,
  treeOwner,
  treeYear,
  Trees,
} from "@/lib/trees";
import { dayLabel, doy, isConifer, phenology, RGB, seasonColor, todayDoy } from "@/lib/treeSeasons";
import { loadTerrain, Terrain } from "@/lib/terrain";
import {
  DEPTH_SLACK,
  drawTiltTrees,
  EXAG,
  Ground,
  groundZ,
  makeGround,
  renderGround,
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
  treeScreen,
} from "@/lib/treesTilt";

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
 * toolbar's slider sets and facing any of the eight compass points
 * (treesTilt.ts); every coloring works in both.
 */

export type TreesMode = "season" | "planted" | "species";

const BG: RGB = [14, 20, 16];
const GHOST: RGB = [30, 42, 34];
/** A removed street tree, in the year it came down. */
const FELLED: RGB = [236, 64, 48];
/** The LiDAR trees in the Species view: they have no species, so they stay in the background. */
const CROWN_BROADLEAF: RGB = [84, 98, 82];
const CROWN_CONIFER: RGB = [40, 104, 74];
const YEAR_MIN = 1950;
/** Dates in these years are mostly the city's first inventory, not plantings. */
const INVENTORY = [1990, 1992];

const SUNK: React.CSSProperties = {
  border: "2px solid",
  borderColor: "#808080 #ffffff #ffffff #808080",
};

const GROUP_COLORS = [
  "#ff6b3d",
  "#ff8fc0",
  "#c86ae0",
  "#f2f2e6",
  "#c99a4a",
  "#7fd6e8",
  "#e84a5f",
  "#f5e663",
  "#a98cff",
  "#5fa8ff",
  "#8fe36b",
];
const CONIFER_COLOR = "#2fa86b";
const OTHER_COLOR = "#7d8a80";

const GENUS_NAMES: Record<string, string> = {
  Acer: "Maples",
  Prunus: "Cherries & plums",
  Malus: "Apples",
  Cornus: "Dogwoods",
  Quercus: "Oaks",
  Pyrus: "Pears",
  Crataegus: "Hawthorns",
  Betula: "Birches",
  Magnolia: "Magnolias",
  Fraxinus: "Ashes",
  Carpinus: "Hornbeams",
  Tilia: "Lindens",
  Amelanchier: "Serviceberries",
  Liquidambar: "Sweetgums",
  Styrax: "Snowbells",
  Ulmus: "Elms",
};

/** ImageData's pixels, read as one little-endian u32 each. */
const pack = (c: RGB, a = 255) =>
  ((a << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
const GHOST_PACKED = pack(GHOST);
const FELLED_PACKED = pack(FELLED);
const hexRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

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
  speciesCount: Int32Array;
  phen: ReturnType<typeof phenology>[];
  groups: { key: string; label: string; color: string; count: number }[];
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

  const speciesCount = new Int32Array(trees.species.length);
  for (let i = 0; i < n; i++) speciesCount[trees.species16[i]]++;

  const genusCount = new Map<string, number>();
  trees.species.forEach((sp, s) => {
    if (isConifer(sp.genus) || sp.genus === "Unknown") return;
    genusCount.set(sp.genus, (genusCount.get(sp.genus) ?? 0) + speciesCount[s]);
  });
  const top = [...genusCount].sort((a, b) => b[1] - a[1]).slice(0, GROUP_COLORS.length);
  const groups: Prepared["groups"] = top.map(([genus, count], k) => ({
    key: genus,
    label: GENUS_NAMES[genus] ?? genus,
    color: GROUP_COLORS[k],
    count,
  }));
  const coniferIdx = groups.length;
  groups.push({ key: "conifers", label: "Conifers", color: CONIFER_COLOR, count: 0 });
  const otherIdx = groups.length;
  groups.push({ key: "other", label: "Everything else", color: OTHER_COLOR, count: 0 });
  const groupOf = new Uint8Array(trees.species.length);
  trees.species.forEach((sp, s) => {
    const k = groups.findIndex((g) => g.key === sp.genus);
    const idx = k >= 0 ? k : isConifer(sp.genus) ? coniferIdx : otherIdx;
    groupOf[s] = idx;
    if (k < 0) groups[idx].count += speciesCount[s];
  });

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
    speciesCount,
    phen: trees.species.map(phenology),
    groups,
    groupOf,
    yearMax,
    yearCounts,
    unknownYear,
  };
}

/** A whole-number year's trees: newest near-white, a few years on bright green, settling to dark. */
function plantedColor(age: number): RGB {
  if (age <= 0) return [255, 248, 196];
  if (age < 3) return mixRgb([170, 240, 110], [120, 200, 90], (age - 1) / 2);
  return mixRgb([120, 200, 90], [56, 112, 64], Math.min(1, (age - 3) / 12));
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

export type TreesWindowProps = {
  mode: TreesMode;
  /** The diorama: the city seen from a locked angle, standing on its hills. */
  tilt: boolean;
  /** Degrees above the horizon Tilt looks down from; the toolbar's slider. */
  pitch: number;
  /** Which of the eight compass points Tilt faces, in degrees; the flat map is always north-up. */
  heading: Heading;
  /** Q and E turn Tilt an eighth left or right. */
  onTurn: (step: 1 | -1) => void;
  /** The focused window takes Space, Escape and +/−. */
  active: boolean;
  /** Minimized: stop any playback. */
  paused: boolean;
  /** Bumped by the toolbar's Fit button. */
  fitSignal: number;
  /** Draw the LiDAR's other trees, under the street trees. */
  canopy: boolean;
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
  canopy,
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

  // How far each download has got, 0–1, for the progress panel; null while
  // the size isn't known yet.
  const [treesProgress, setTreesProgress] = useState<number | null>(null);
  const [addresses, setAddresses] = useState<TreeAddresses | null>(null);
  const [removed, setRemoved] = useState<RemovedTrees | null>(null);
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
  // The ground layer, kept until the view moves: playing through a year redraws only the trees.
  const groundLayerRef = useRef<{ key: string; buf: Uint32Array; depth: Float32Array; W: number } | null>(null);
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
        return mode === "planted" && removedPrep !== null && removedPrep.plantedYear[r] <= year && year <= removedPrep.removedYear[r];
      }
      if (kind === "crown") {
        if (!shownCrowns || mode === "planted") return false;
        if (mode === "species" && group !== null) {
          const coniferGroup = prepared.groups.findIndex((g) => g.key === "conifers");
          return group === coniferGroup && shownCrowns.conifer[i - scene!.nS - scene!.nR] === 1;
        }
        return true;
      }
      if (mode === "planted") {
        const y = trees.year[i];
        return y !== 0 && 1900 + y <= year;
      }
      if (mode === "species" && group !== null) return prepared.groupOf[trees.species16[i]] === group;
      return true;
    },
    [trees, prepared, scene, removedPrep, shownCrowns, mode, year, group],
  );

  // A pick that's gone out of view (a later year, another genus) goes with it.
  const selected = selectedAsked !== null && isLive(selectedAsked) ? selectedAsked : null;
  const hover = hoverAsked !== null && isLive(hoverAsked) ? hoverAsked : null;

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
  // Set while the view is being dragged or zoomed, and for a moment after.
  const movingRef = useRef(false);
  const settleRef = useRef(0);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!prepared || !w || !h) return;
    fittedRef.current = true;
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

    if (tilt && trees && prepared && scene && sceneGround && packed && v && speciesPalette && crownLook) {
      tiltView = makeTiltView(W, H, v.s * dpr, v.cx, v.cy, pitch, heading);
      // Rough while the view is moving, sharp once it settles.
      const stride = movingRef.current ? 2 : 1;
      const key = `${W}x${H} ${tiltView.S} ${v.cx} ${v.cy} ${pitch} ${heading} ${ground ? "g" : "-"} ${stride}`;
      let layer = groundLayerRef.current;
      if (!layer || layer.key !== key) {
        if (!layer || layer.buf.length !== W * H) {
          layer = { key, buf: new Uint32Array(W * H), depth: new Float32Array(W * H), W };
        }
        renderGround(layer.buf, layer.depth, tiltView, ground, prepared.widthM, prepared.heightM, pack(BG), stride);
        layer.key = key;
        layer.W = W;
        groundLayerRef.current = layer;
      }
      buf.set(layer.buf);

      const N = scene.mx.length;
      const { nS, nR } = scene;
      // A million colors, worked out again only when one of them can have
      // changed — not for every frame of a pan.
      const colorDeps = [scene, packed, mode, year, speciesPalette, yearPalette, crownLook, removedPrep, bareSpecies];
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
        for (let r = 0; r < nR; r++) colors[nS + r] = removedPrep && mode === "planted" ? removedColor(removedPrep, r, year, agePalette) : 0;
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
      if (!packedColorRef.current || packedColorRef.current.length !== packed.n) {
        packedColorRef.current = new Uint32Array(packed.n);
      }
      const drawColors = packedColorRef.current;
      let drawBare: Uint8Array | null = null;
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
      // Far out, where a canopy tree is a fraction of a pixel and several share
      // each one, a sample of the canopy does; while the view is being dragged
      // about, a thinner one still. The street trees are always all there.
      const canopyPx = 3.5 * tiltView.S;
      // About one sampled tree per 0.7 px of crown: as many as the pixels can show.
      let thin = canopyPx < 0.7 ? Math.min(8, Math.round(0.7 / canopyPx)) : 1;
      if (movingRef.current && canopyPx < 1.5) thin = Math.max(2, thin * 2);
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
      drawTiltTrees(buf, layer.depth, tiltView, packed, drawColors, drawBare, GHOST_PACKED, sub, from, to);
    } else {
      buf.fill(pack(BG));
    }

    if (!tilt && trees && prepared && v && speciesPalette) {
      const s = v.s * dpr;
      const ox = W / 2 - v.cx * s;
      const oy = H / 2 + v.cy * s;
      // The LiDAR's trees first, underneath: the street trees are the ones with
      // names, so they stay on top.
      if (shownCrowns && scene && crownLook) {
        const at = scene.nS + scene.nR;
        const radius = scene.forms.crown;
        for (let c = 0; c < shownCrowns.count; c++) {
          const i = at + c;
          const color = shownCrowns.conifer[c] ? crownLook.conifer : crownLook.broad;
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
      const { mx, my, crown, order } = prepared;
      const sp16 = trees.species16;
      const yr = trees.year;
      const planted = mode === "planted";
      const n = order.length;
      for (let k = 0; k < n; k++) {
        const i = order[k];
        let color: number;
        if (planted) {
          const y = yr[i];
          if (!y) continue;
          color = yearPalette[y];
        } else {
          color = speciesPalette[sp16[i]];
        }
        const sx = mx[i] * s + ox;
        const sy = oy - my[i] * s;
        const r = crown[i] * s;
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
      if (planted && removedPrep) {
        for (let r = 0; r < removedPrep.n; r++) {
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
    ctx.putImageData(img, 0, 0);

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
        let sx = w / 2 + (scene.mx[i] - v.cx) * v.s;
        let sy = h / 2 - (scene.my[i] - v.cy) * v.s;
        let r = Math.max(5, flatDot * v.s + 3);
        if (tiltView && sceneGround) {
          const at = treeScreen(
            tiltView,
            scene.mx[i],
            scene.my[i],
            sceneGround[i],
            scene.forms.height[i],
            scene.forms.crown[i],
          );
          sx = at.x / dpr;
          sy = at.y / dpr;
          r = Math.max(5, scene.forms.crown[i] * TREE_SCALE * v.s + 3);
        }
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.lineWidth = width + 2;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.stroke();
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      if (hover !== null && hover !== selected) ring(hover, "rgba(255,255,255,0.75)", 1);
      if (selected !== null) ring(selected, "#ffff00", 2);

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
      requestDraw();
    }, 160);
  }, [requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [draw, requestDraw]);

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
    fittedForRef.current = { prepared, fitSignal };
    fit();
    requestDraw();
    // fitSignal is the toolbar's Fit button; prepared is the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, fitSignal]);

  // Dragging the tilt slider redraws the ground on every step: draw it rough
  // while it moves, as for a pan.
  useEffect(() => {
    if (tilt) moved();
    // Only a change of angle counts as movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch]);

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
      viewRef.current = viewWith(toWorld(px, py, v), px, py, s);
      fittedRef.current = false;
      moved();
      requestDraw();
    },
    // toWorld and viewWith change with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scaleLimits, requestDraw, turn, squash],
  );

  // --- picking --------------------------------------------------------------

  const pick = useCallback(
    (px: number, py: number): number | null => {
      const v = viewRef.current;
      if (!trees || !prepared || !v) return null;
      const layer = groundLayerRef.current;
      if (tilt && scene && sceneGround && layer) {
        // Nearest crown on screen that isn't behind a hill; the nearer tree wins a tie.
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
        const ss = view.S * view.sin;
        const rise = ((ground?.zMax ?? 0) * EXAG + scene.tallest * 1.4 * TREE_SCALE) * view.S * view.cos;
        const vFar = view.cv + (view.H / 2 - py * dpr + 60 * dpr) / ss;
        const vNear = view.cv + (view.H / 2 - py * dpr - 60 * dpr - rise) / ss;
        const sorted = order;
        const kFrom = sorted ? firstAtMost(sorted.depth, vFar) : 0;
        const kTo = sorted ? firstAtMost(sorted.depth, vNear) : mx.length;
        for (let k = kFrom; k < kTo; k++) {
          const i = sorted ? sorted.order[k] : k;
          const sx = view.W / 2 + (view.ux * mx[i] + view.uy * my[i] - view.cu) * view.S;
          if (sx - pxd > 60 * dpr || pxd - sx > 60 * dpr) continue;
          const at = treeScreen(view, mx[i], my[i], sceneGround[i], forms.height[i], forms.crown[i]);
          const dx = at.x / dpr - px;
          const dy = at.y / dpr - py;
          if (dy > 60 || dy < -60) continue;
          const reach = Math.max(9, forms.crown[i] * TREE_SCALE * v.s);
          const d = dx * dx + dy * dy;
          if (d > reach * reach || !isLive(i)) continue;
          const ix = Math.round(at.x);
          const iy = Math.round(at.y);
          if (ix >= 0 && iy >= 0 && ix < layer.W && iy * layer.W + ix < layer.depth.length) {
            if (at.v - DEPTH_SLACK > layer.depth[iy * layer.W + ix]) continue;
          }
          if (d < bestD - 4 || (d <= bestD + 4 && at.v < bestV)) {
            best = i;
            bestD = d;
            bestV = at.v;
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
      for (let i = 0; i < trees.count; i++) consider(i, mx[i], my[i], crown[i]);
      if (mode === "planted" && removedPrep && scene) {
        for (let r = 0; r < removedPrep.n; r++) consider(scene.nS + r, removedPrep.mx[r], removedPrep.my[r], removedPrep.dot[r]);
      }
      // A street tree under the pointer wins over the canopy around it.
      if (best < 0 && shownCrowns && scene && mode !== "planted") {
        const at0 = scene.nS + scene.nR;
        for (let c = 0; c < shownCrowns.count; c++) {
          const i = at0 + c;
          consider(i, scene.mx[i], scene.my[i], scene.forms.crown[i]);
        }
      }
      return best >= 0 ? best : null;
    },
    // toWorld changes with turn and squash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trees, prepared, scene, order, ground, removedPrep, shownCrowns, isLive, mode, tilt, pitch, heading, sceneGround, turn, squash],
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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !viewRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
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
        viewRef.current = viewWith(toWorld(g.startX, g.startY, g.view), p.x, p.y, g.view.s);
        fittedRef.current = false;
        moved();
        requestDraw();
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => setHover(pick(p.x, p.y)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
      setSelected(pick(p.x, p.y));
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
      if (e.key === "Escape") setSelected(null);
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
        title: `${sp.common} (removed)`,
        rows: [
          ["Species", sp.scientific || sp.genus],
          ["Address", treeAddress(removed.addresses, r) ?? "…"],
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
    const rows: [string, string][] = [
      ["Species", sp.scientific || sp.genus],
      ["Address", treeAddress(addresses, i) ?? "…"],
      ["Trunk", trees.diam[i] ? `${trees.diam[i]} in across` : "not measured"],
    ];
    if (measured > 0) rows.push(["Height", `${metres(measured)} (LiDAR, 2021)`]);
    rows.push(
      ["Planted", y ? (y >= INVENTORY[0] && y <= INVENTORY[1] ? `by ${y} (first inventory)` : String(y)) : "no date"],
      ["Cared for by", OWNER_LABEL[treeOwner(trees, i)]],
    );
    const notes: string[] = [];
    if ((flags & 12) !== 0) notes.push(flags & 4 ? "Heritage tree" : "Exceptional tree");
    notes.push(count <= 1 ? "The only one on Seattle's streets." : `One of ${fmt(count)} on Seattle's streets.`);
    return { title: sp.common, rows, notes, italicSpecies: true, boldFirstNote: (flags & 12) !== 0 };
  };

  const describe = (i: number) => {
    const card = cardFor(i);
    if (!card) return "";
    const get = (k: string) => card.rows.find(([key]) => key === k)?.[1];
    const parts = [card.title, get("Address"), get("Height"), get("Trunk"), get("Removed") ? `removed ${get("Removed")}` : null];
    return parts.filter((p) => p && p !== "…" && p !== "not measured").join(" · ");
  };

  const selectedCard = selected !== null ? cardFor(selected) : null;

  let status: string;
  if (error) status = "No tree data";
  else if (!trees) status = "Loading Seattle's street trees…";
  else if (tilt && wantTerrain) status = "Loading the ground…";
  else if (hover !== null) status = describe(hover);
  else if (tilt && terrainError) status = "No elevation data here, so the ground is flat";
  else if (canopy && crowns && mode !== "planted")
    status = `${fmt(trees.count)} street trees and ${fmt(crowns.count)} more from the city's 2021 LiDAR survey`;
  else if (mode === "planted" && removed)
    status = `${fmt(trees.count)} street trees standing, ${fmt(removed.count)} more the city has taken down`;
  else
    status = `${fmt(trees.count)} street trees · ${trees.source} · fetched ${new Date(trees.fetched).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    )}`;

  // --- render ---------------------------------------------------------------

  const yearMax = prepared?.yearMax ?? new Date().getFullYear();

  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 4 }}>
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
          onPointerLeave={() => setHover(null)}
          onDoubleClick={onDoubleClick}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: hover !== null ? "pointer" : "grab",
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
        {selectedCard && <TreeCard card={selectedCard} onClose={() => setSelected(null)} />}

      </div>

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
            <Button size="sm" onClick={() => { setPlaying(false); setDay(todayDoy()); }} title="Back to today">
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
              above={
                <YearHistogram
                  counts={prepared.yearCounts}
                  felled={removedPrep?.removedCounts ?? null}
                  extraPlanted={removedPrep?.plantedCounts ?? null}
                  year={year}
                  onPick={(y) => {
                    setPlaying(false);
                    setYear(y);
                  }}
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

      <div style={{ ...SUNK, padding: "1px 4px", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {status}
      </div>
    </div>
  );
}

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
 * would land. Whatever sits `above` or `below` it is inset to the track, so a
 * month or a year in it lines up with the same spot on the slider.
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
}: {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  label: string;
  above?: React.ReactNode;
  below?: React.ReactNode;
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
  onPick,
}: {
  counts: Int32Array;
  /** Trees taken down each year, hung red from the top. */
  felled: Int32Array | null;
  /** Removed trees' plantings, added to each year's bar. */
  extraPlanted: Int32Array | null;
  year: number;
  onPick: (year: number) => void;
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
      style={{ width: "100%", height: H, display: "block", cursor: "pointer", background: "rgb(14,20,16)" }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const k = Math.floor(((e.clientX - rect.left) / rect.width) * n);
        onPick(YEAR_MIN + Math.max(0, Math.min(n - 1, k)));
      }}
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

const OWNER_LABEL = {
  private: "The property owner next to it",
  sdot: "Seattle Department of Transportation",
  parks: "Seattle Parks and Recreation",
  other: "Another public agency",
} as const;

type CardInfo = {
  title: string;
  rows: [string, string][];
  notes: string[];
  /** The Species row in italics, as a scientific name. */
  italicSpecies?: boolean;
  /** The first note in bold — a heritage or exceptional tree. */
  boldFirstNote?: boolean;
};

function TreeCard({ card, onClose }: { card: CardInfo; onClose: () => void }) {
  return (
    <Window
      style={{ position: "absolute", top: 6, right: 6, width: 248, maxWidth: "calc(100% - 12px)", zIndex: 3 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title}</span>
        <Button size="sm" square onClick={onClose} aria-label="Close">
          <span className="close-icon" />
        </Button>
      </WindowHeader>
      <WindowContent style={{ padding: 8, fontSize: 12 }}>
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
