"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Slider, Window, WindowContent, WindowHeader } from "react95";
import { loadTrees, treeAddress, treeOwner, treeYear, Trees } from "@/lib/trees";
import { dayLabel, doy, isConifer, phenology, RGB, seasonColor, todayDoy } from "@/lib/treeSeasons";

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
 */

export type TreesMode = "season" | "planted" | "species";

const BG: RGB = [14, 20, 16];
const GHOST: RGB = [30, 42, 34];
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
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => trees.diam[b] - trees.diam[a]);

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

export type TreesWindowProps = {
  mode: TreesMode;
  /** The focused window takes Space, Escape and +/−. */
  active: boolean;
  /** Minimized: stop any playback. */
  paused: boolean;
  /** Bumped by the toolbar's Fit button. */
  fitSignal: number;
};

export default function TreesWindow({ mode, active, paused, fitSignal }: TreesWindowProps) {
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

  useEffect(() => {
    const abort = new AbortController();
    loadTrees(abort.signal)
      .then(setTrees)
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => abort.abort();
  }, []);

  // --- what color every tree is right now ---------------------------------

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
      if (mode === "planted") {
        const y = trees.year[i];
        return y !== 0 && 1900 + y <= year;
      }
      if (mode === "species" && group !== null) return prepared.groupOf[trees.species16[i]] === group;
      return true;
    },
    [trees, prepared, mode, year, group],
  );

  // A pick that's gone out of view (a later year, another genus) goes with it.
  const selected = selectedAsked !== null && isLive(selectedAsked) ? selectedAsked : null;
  const hover = hoverAsked !== null && isLive(hoverAsked) ? hoverAsked : null;

  // --- view -----------------------------------------------------------------

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!prepared || !w || !h) return;
    const s = Math.min(w / prepared.widthM, h / prepared.heightM) * 0.94;
    viewRef.current = { cx: prepared.widthM / 2, cy: prepared.heightM / 2, s };
  }, [prepared]);

  const scaleLimits = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (!prepared) return [0.001, 40];
    const fitS = Math.min(w / prepared.widthM, h / prepared.heightM);
    return [fitS * 0.5, 40];
  }, [prepared]);

  const toWorld = (px: number, py: number, v: View) => {
    const { w, h } = sizeRef.current;
    return { x: v.cx + (px - w / 2) / v.s, y: v.cy - (py - h / 2) / v.s };
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
    buf.fill(pack(BG));

    if (trees && prepared && v && speciesPalette) {
      const s = v.s * dpr;
      const ox = W / 2 - v.cx * s;
      const oy = H / 2 + v.cy * s;
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
    }
    ctx.putImageData(img, 0, 0);

    if (trees && prepared && v) {
      ctx.save();
      ctx.scale(dpr, dpr);
      const ring = (i: number, color: string, width: number) => {
        const sx = w / 2 + (prepared.mx[i] - v.cx) * v.s;
        const sy = h / 2 - (prepared.my[i] - v.cy) * v.s;
        const r = Math.max(5, prepared.crown[i] * v.s + 3);
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
      ctx.restore();
    }
  }, [trees, prepared, speciesPalette, yearPalette, mode, hover, selected]);

  // The frame always runs the latest draw, so one asked for before the data
  // or a new palette arrived still paints what's current when it fires.
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  useEffect(() => {
    requestDraw();
  }, [draw, requestDraw]);

  // Forget the frame as well as cancelling it, or the next requestDraw takes
  // it for one still on its way and never asks again.
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
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
      if (!viewRef.current) fit();
      requestDraw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fit, requestDraw]);

  useEffect(() => {
    if (!prepared) return;
    fit();
    requestDraw();
    // fitSignal is the toolbar's Fit button; prepared is the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, fitSignal]);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = viewRef.current;
      if (!v) return;
      const [lo, hi] = scaleLimits();
      const s = Math.min(hi, Math.max(lo, v.s * factor));
      const at = toWorld(px, py, v);
      const { w, h } = sizeRef.current;
      viewRef.current = { s, cx: at.x - (px - w / 2) / s, cy: at.y + (py - h / 2) / s };
      requestDraw();
    },
    [scaleLimits, requestDraw],
  );

  // --- picking --------------------------------------------------------------

  const pick = useCallback(
    (px: number, py: number): number | null => {
      const v = viewRef.current;
      if (!trees || !prepared || !v) return null;
      const at = toWorld(px, py, v);
      const { mx, my, crown } = prepared;
      let best = -1;
      let bestD = Infinity;
      const reachPx = 9;
      for (let i = 0; i < trees.count; i++) {
        const dx = (mx[i] - at.x) * v.s;
        if (dx > 120 || dx < -120) continue;
        const dy = (my[i] - at.y) * v.s;
        if (dy > 120 || dy < -120) continue;
        const reach = Math.max(reachPx, crown[i] * v.s);
        const d = dx * dx + dy * dy;
        if (d <= reach * reach && d < bestD && isLive(i)) {
          best = i;
          bestD = d;
        }
      }
      return best >= 0 ? best : null;
    },
    [trees, prepared, isLive],
  );


  // --- pointer handling -----------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    view: View;
    moved: boolean;
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
        const [lo, hi] = scaleLimits();
        const s = Math.min(hi, Math.max(lo, g.view.s * (dist / Math.max(1, g.pinch.dist))));
        const at = toWorld(g.pinch.midX, g.pinch.midY, g.view);
        const { w, h } = sizeRef.current;
        viewRef.current = { s, cx: at.x - (midX - w / 2) / s, cy: at.y + (midY - h / 2) / s };
        requestDraw();
        return;
      }
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (!g.moved && dx * dx + dy * dy > 16) g.moved = true;
      if (g.moved) {
        viewRef.current = { s: g.view.s, cx: g.view.cx - dx / g.view.s, cy: g.view.cy + dy / g.view.s };
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
  }, [active, togglePlay, zoomAt]);

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
    if (!prepared) return { standing: 0, thisYear: 0 };
    let standing = 0;
    for (let y = YEAR_MIN; y <= year; y++) standing += prepared.yearCounts[y - YEAR_MIN] ?? 0;
    return { standing, thisYear: prepared.yearCounts[year - YEAR_MIN] ?? 0 };
  }, [prepared, year]);

  const describe = (i: number) => {
    if (!trees) return "";
    const sp = trees.species[trees.species16[i]];
    const y = treeYear(trees, i);
    return [sp.common, treeAddress(trees, i), trees.diam[i] ? `${trees.diam[i]} in` : null, y ? `planted ${y}` : null]
      .filter(Boolean)
      .join(" · ");
  };

  let status: string;
  if (error) status = "No tree data";
  else if (!trees) status = "Loading Seattle's street trees…";
  else if (hover !== null) status = describe(hover);
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
        {(error || !trees) && (
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
            {error ? "Couldn't load the street trees. They'll be back after the next refresh." : "Loading 215,000 trees…"}
          </div>
        )}
        {trees && selected !== null && (
          <TreeCard trees={trees} i={selected} count={prepared?.speciesCount[trees.species16[selected]] ?? 0} onClose={() => setSelected(null)} />
        )}
      </div>

      {trees && prepared && mode === "season" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button size="sm" square onClick={togglePlay} title={playing ? "Pause (Space)" : "Play the year (Space)"} style={{ width: 28 }}>
              <PlayIcon playing={playing} />
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
            <Button size="sm" square onClick={togglePlay} title={playing ? "Pause (Space)" : "Play the years (Space)"} style={{ width: 28 }}>
              <PlayIcon playing={playing} />
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
            {fmt(plantedTotals.thisYear)} dated {year} · {fmt(plantedTotals.standing)} standing
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

/** Drawn rather than typed: ▶ turns into a colour emoji on half the systems out there. */
function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden style={{ display: "block" }}>
      {playing ? (
        <>
          <rect x="1" y="0" width="2.5" height="9" fill="currentColor" />
          <rect x="5.5" y="0" width="2.5" height="9" fill="currentColor" />
        </>
      ) : (
        <path d="M1 0 L8.5 4.5 L1 9 Z" fill="currentColor" />
      )}
    </svg>
  );
}

function YearHistogram({ counts, year, onPick }: { counts: Int32Array; year: number; onPick: (year: number) => void }) {
  const max = Math.max(1, ...counts);
  const n = counts.length;
  const H = 26;
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
      aria-label="Trees dated each year"
    >
      {Array.from(counts, (c, k) => {
        const y = YEAR_MIN + k;
        // Square-root height, or 1991–92's inventory flattens every other year.
        const h = c ? Math.max(1, Math.sqrt(c / max) * (H - 2)) : 0;
        const inv = y >= INVENTORY[0] && y <= INVENTORY[1];
        const fill = y === year ? "#ffff00" : y > year ? "#2a3a2e" : inv ? "#6f8f74" : "#8fd36a";
        return <rect key={k} x={k + 0.1} y={H - h} width={0.8} height={h} fill={fill} />;
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

function TreeCard({ trees, i, count, onClose }: { trees: Trees; i: number; count: number; onClose: () => void }) {
  const sp = trees.species[trees.species16[i]];
  const y = treeYear(trees, i);
  const flags = trees.flags[i];
  const rows: [string, string][] = [
    ["Species", sp.scientific || sp.genus],
    ["Address", treeAddress(trees, i)],
    ["Trunk", trees.diam[i] ? `${trees.diam[i]} in across` : "not measured"],
    [
      "Planted",
      y ? (y >= INVENTORY[0] && y <= INVENTORY[1] ? `by ${y} (first inventory)` : String(y)) : "no date",
    ],
    ["Cared for by", OWNER_LABEL[treeOwner(trees, i)]],
  ];
  const rarity =
    count <= 1
      ? "The only one on Seattle's streets."
      : `One of ${fmt(count)} on Seattle's streets.`;
  return (
    <Window
      style={{ position: "absolute", top: 6, right: 6, width: 248, maxWidth: "calc(100% - 12px)", zIndex: 3 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <WindowHeader style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sp.common}</span>
        <Button size="sm" square onClick={onClose} aria-label="Close">
          <span className="close-icon" />
        </Button>
      </WindowHeader>
      <WindowContent style={{ padding: 8, fontSize: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <span style={{ opacity: 0.7 }}>{k}</span>
              <span style={{ fontStyle: k === "Species" ? "italic" : undefined }}>{v}</span>
            </React.Fragment>
          ))}
        </div>
        {(flags & 12) !== 0 && (
          <div style={{ marginTop: 6, fontWeight: "bold" }}>
            {flags & 4 ? "Heritage tree" : "Exceptional tree"}
          </div>
        )}
        <div style={{ marginTop: 6, opacity: 0.8 }}>{rarity}</div>
      </WindowContent>
    </Window>
  );
}
