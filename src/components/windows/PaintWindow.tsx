"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Turn, UPRIGHT, isUpright, pointIn, sizeIn, turnMatrix, unturn } from "@/lib/windowTurn";
import { ColorAdjust, adjustColors } from "@/lib/colorAdjust";
import PaintAdjustPanel from "@/components/windows/PaintAdjustPanel";
import PaintGrabOverlay from "@/components/windows/PaintGrabOverlay";
import { GrabRect, freezePage, grabPage } from "@/lib/desktopGrab";
import ContextMenu, { ContextMenuItem } from "@/components/ContextMenu";

/** The five things the pointer can be: one draws, one picks, three select. */
export type PaintTool = "pencil" | "dropper" | "select" | "lasso" | "wand";

/** What the toolbar needs to know to grey the right rows out. */
export type PaintStatus = {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  canPaste: boolean;
  zoom: number;
};

/**
 * The keyboard reaches things the window owns rather than the sheet — the tool
 * box, the brush sizes, the File menu — so Paint calls back out for those.
 */
export type PaintCommands = {
  setTool: (tool: PaintTool) => void;
  cycleBrush: (delta: number) => void;
  requestOpen: () => void;
  requestSave: () => void;
  /** The window's own turns, for the right-click menu. */
  rotate: () => void;
  flipVertical: () => void;
  flipHorizontal: () => void;
};

export type PaintWindowHandle = {
  clear: () => void;
  newFile: () => void;
  /** Resolves true once the picture is on the sheet, false if it wasn't one. */
  openFile: (file: File) => Promise<boolean>;
  save: () => Promise<{ blob: Blob; name: string } | null>;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  /** Freeze the page and take a box of it — any window, the desktop — as a paste. */
  grab: () => void;
  deleteSelection: () => void;
  selectAll: () => void;
  /** Open Adjust colors on the selection, if there is one. */
  adjustColors: () => void;
  deselect: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
};

type PaintWindowProps = {
  color: string;
  brushSize: number;
  tool: PaintTool;
  /** The dropper hands back whatever color was under it, as #rrggbb. */
  onPickColor: (hex: string) => void;
  onStatusChange: (status: PaintStatus) => void;
  commands: PaintCommands;
  /** Whether the navigator in the corner is wanted when there's more sheet than window. */
  map: boolean;
  /** How the window round the sheet has been turned; Save writes it that way round. */
  turn?: Turn;
};

const BG = "#ffffff";
/** Showing behind the sheet once it's small enough to leave a margin. */
const MAT = "#808080";
const STORAGE_KEY = "mrwr:paint";
const UNTITLED = "untitled.png";
/** How far off the clicked color the magic wand still counts as the same, per channel. */
const WAND_TOLERANCE = 32;
/**
 * Holding the wand down and dragging retunes it: right or down takes in more,
 * left or up less, by this much per screen pixel of drag.
 */
const WAND_DRAG_RATE = 0.5;
/**
 * The most pixels a wand drag's preview is ever drawn with. A big sheet is
 * sampled down to it, so retuning costs the same whatever was opened.
 */
const WAND_PREVIEW_PIXELS = 1_000_000;
/** The preview's tint, one RGBA pixel as a little-endian word: navy at 40%. */
const WAND_TINT = ((102 << 24) | (128 << 16)) >>> 0;
/** The dropper's magnifier: this many sheet pixels across, each this many CSS pixels big. */
const LOUPE_SPAN = 11;
const LOUPE_CELL = 8;
/** Snapshots kept for Undo. Each one is a whole sheet, so the ceiling is memory. */
const UNDO_LIMIT = 20;
/** ...and the pixels they may take between them, big sheet or small. */
const UNDO_BUDGET = 64_000_000;
/** An opened picture longer than this on either side is brought down to it. */
const MAX_SHEET = 4096;
/**
 * A sheet past this many pixels isn't kept in localStorage: the data URL would
 * be slow to make and too fat for the quota anyway.
 */
const PERSIST_MAX_PIXELS = 4_000_000;
/** The navigator's longest side, in CSS pixels. */
const MAP_MAX = 132;
/**
 * How fat the ants' outline is ever drawn, in sheet pixels. Zoomed out it
 * wants to be fatter to survive being scaled down, but tracing the outline
 * again costs a pass over the whole shape, so past this it is left alone and
 * allowed to go delicate instead.
 */
const MAX_ANTS_THICKNESS = 2;
/**
 * The ants only have to crawl about fifteen times a second to read as moving.
 * Between those, a frame with nothing else going on is skipped entirely.
 */
const ANTS_TICK = 66;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;
/** One press of a zoom key, or one detent of the wheel at its usual size. */
const ZOOM_STEP = 1.25;

// Copied pixels, kept out here so they outlive a closed window: paint.exe's own
// clipboard. The system one is written to as well where the browser allows it,
// but never read without the user pressing Ctrl+V, which avoids a permission
// prompt nobody asked for.
let CLIPBOARD: HTMLCanvasElement | null = null;
// Set when the system clipboard turned down the last copy, so whatever picture
// it still holds is older than paint.exe's own. Leaving the page clears it:
// out there, something newer may well have been copied.
let OWN_IS_NEWER = false;
if (typeof window !== "undefined") {
  window.addEventListener("blur", () => {
    OWN_IS_NEWER = false;
  });
}

// The sheet as last left: a PNG data URL plus the CSS size it was drawn at, so
// it comes back at the same scale whatever the backing store's DPR.
type Stored = {
  png: string;
  w: number;
  h: number;
  name: string;
  /** Sheet pixels per CSS pixel: the display's own for a sheet that fits the
   *  window, and 1 for a picture that brought its own size with it. */
  scale: number;
  /** Set once a picture has fixed the sheet's size, so the window stops driving it. */
  locked: boolean;
};

/**
 * A region of the sheet, in device pixels. `mask` is the shape's alpha — a
 * filled rectangle, a lassoed polygon or whatever the wand flooded — and
 * `pixels` is the cut-out it covers. Until it is `lifted` the pixels are still
 * on the sheet underneath; the first drag lifts them off and leaves white.
 */
type Selection = {
  x: number;
  y: number;
  w: number;
  h: number;
  mask: HTMLCanvasElement;
  maskCtx: CanvasRenderingContext2D;
  pixels: HTMLCanvasElement;
  /** The shape's outline, for the marching ants, and how fat it was drawn. */
  ants: HTMLCanvasElement;
  antsThickness: number;
  lifted: boolean;
};

type Drag =
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "lasso"; pts: { x: number; y: number }[]; path: Path2D }
  | { kind: "move"; startX: number; startY: number; origX: number; origY: number; moved: boolean }
  | { kind: "pan"; startX: number; startY: number; origX: number; origY: number }
  | WandDrag
  /** The dropper held down: it picks wherever it's let go, not where it landed. */
  | { kind: "dropper"; x: number; y: number };

/**
 * The wand held down. The levels are worked out once, at the press; after
 * that a drag only re-draws the preview from them, into a buffer kept for the
 * whole drag, and the real selection is built once, on release.
 */
type WandDrag = {
  kind: "wand";
  /** For each sheet pixel, the least tolerance that takes it in. */
  level: Uint8Array;
  w: number;
  h: number;
  /** Sheet pixels per preview pixel, each way. */
  stride: number;
  preview: CanvasRenderingContext2D;
  image: ImageData;
  pixels: Uint32Array;
  /** Where the press was on screen, and the tolerance it started at. */
  startX: number;
  startY: number;
  base: number;
  tolerance: number;
};

/** Where the sheet sits in the window: a scale, and a top-left offset in CSS px. */
type View = { z: number; x: number; y: number };

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.png !== "string" || typeof parsed.w !== "number" || typeof parsed.h !== "number") {
      return null;
    }
    return {
      png: parsed.png,
      w: parsed.w,
      h: parsed.h,
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : UNTITLED,
      scale: typeof parsed.scale === "number" && parsed.scale > 0 ? parsed.scale : 1,
      locked: parsed.locked === true,
    };
  } catch {
    return null;
  }
}

function saveStored(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or quota — the drawing just doesn't outlive the tab.
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

// The sheet turned the way the window is, so what's saved is what's on screen.
function turnedCopy(canvas: HTMLCanvasElement, turn: Turn): HTMLCanvasElement {
  const sideways = turn.quarter % 2 === 1;
  const out = makeCanvas(sideways ? canvas.height : canvas.width, sideways ? canvas.width : canvas.height);
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  const [a, b, c, d] = turnMatrix(turn);
  ctx.setTransform(a, b, c, d, out.width / 2, out.height / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

// "cat.jpg" → "cat.png": whatever came in, Save writes a PNG.
const asPngName = (name: string) => `${name.replace(/\.[^.]*$/, "") || "untitled"}.png`;

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

function ctxOf(canvas: HTMLCanvasElement, readBack = false) {
  return canvas.getContext("2d", readBack ? { willReadFrequently: true } : undefined)!;
}

function copyOf(source: HTMLCanvasElement) {
  const out = makeCanvas(source.width, source.height);
  ctxOf(out).drawImage(source, 0, 0);
  return out;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The 1-bit outline of a mask: every pixel inside the shape with something
 * outside it next door. The alpha is unpacked into a flat array first — the
 * inner loop runs once per pixel of the shape's bounding box, which for a
 * magic wand over a background is the whole sheet, so the indexing arithmetic
 * in it is worth keeping cheap.
 *
 * Wanting it fatter than a pixel doesn't cost another pass: the one-pixel
 * outline is stamped back over itself at a few offsets and trimmed to the
 * shape, which the canvas does far faster than JavaScript can.
 */
function outlineOf(mask: HTMLCanvasElement, thickness: number) {
  const w = mask.width;
  const h = mask.height;
  const src = ctxOf(mask, true).getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h);
  for (let i = 0, a = 3; i < inside.length; i += 1, a += 4) {
    if (src[a] > 127) inside[i] = 1;
  }

  const thin = makeCanvas(w, h);
  const thinCtx = ctxOf(thin);
  const img = thinCtx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const i = row + x;
      if (!inside[i]) continue;
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !inside[i - 1] ||
        !inside[i + 1] ||
        !inside[i - w] ||
        !inside[i + w]
      ) {
        data[i * 4 + 3] = 255;
      }
    }
  }
  thinCtx.putImageData(img, 0, 0);
  if (thickness <= 1) return thin;

  const fat = makeCanvas(w, h);
  const fatCtx = ctxOf(fat);
  const r = thickness - 1;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) fatCtx.drawImage(thin, dx, dy);
  }
  // Keep the fattening on the inside of the shape, where the outline belongs.
  fatCtx.globalCompositeOperation = "destination-in";
  fatCtx.drawImage(mask, 0, 0);
  return fat;
}

/**
 * A bare-bones MS Paint: one white sheet with a pencil, an eyedropper, three
 * ways to select (rectangle, lasso, magic wand), cut/copy/paste of whatever is
 * selected, a Grab that takes any box of the page itself — other windows,
 * the desktop — as a paste, and an undo stack behind all of it. Color, size and the current
 * tool are driven from the window toolbar, and most of it answers to the
 * keyboard as well. The wheel zooms in on the pixel under the pointer; space
 * and a drag shoves the sheet about underneath it.
 *
 * The sheet keeps itself in localStorage between visits; File → Open pulls in a
 * picture off disk and Save hands the sheet back as a PNG. Rotate and flip turn
 * the whole window, sheet and all; the sheet itself stays upright underneath,
 * and only Save turns it to match.
 */
/**
 * Anything the toolbar asks for — undo, cut, a new sheet — first lands an
 * Adjust colors in progress, as if OK had been pressed. Zooming doesn't.
 */
function settleFirst(handle: PaintWindowHandle, settle: () => void): PaintWindowHandle {
  const out: Record<string, unknown> = { ...handle };
  for (const key of Object.keys(handle) as (keyof PaintWindowHandle)[]) {
    if (key.startsWith("zoom") || key === "adjustColors") continue;
    const fn = handle[key] as (...args: unknown[]) => unknown;
    out[key] = (...args: unknown[]) => {
      settle();
      return fn(...args);
    };
  }
  return out as PaintWindowHandle;
}

/**
 * The bare letters that reach for a tool, Paint's own and Photoshop's both.
 * W, A, S and D are kept clear for walking about the picture, so the wand is
 * on Q and the rectangle only on M.
 */
const TOOL_KEYS: Record<string, PaintTool> = {
  p: "pencil",
  b: "pencil",
  m: "select",
  f: "lasso",
  l: "lasso",
  q: "wand",
  k: "dropper",
  i: "dropper",
};

/** How fast WASD moves the view over the picture, in screen pixels a second; Shift triples it. */
const WALK_SPEED = 600;

const PaintWindow = forwardRef<PaintWindowHandle, PaintWindowProps>(function PaintWindow(
  { color, brushSize, tool, onPickColor, onStatusChange, commands, map, turn = UPRIGHT },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  /** Sheet pixels per sheet CSS pixel: the display's DPR, or 1 for a picture. */
  const dprRef = useRef(1);
  /** The display's own DPR, which is what the overlay is drawn in. */
  const viewDprRef = useRef(1);
  // Latest color/size/tool, readable from the pointer handlers without re-binding them.
  const styleRef = useRef({ color, brushSize, tool });
  styleRef.current = { color, brushSize, tool };
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const pickRef = useRef(onPickColor);
  pickRef.current = onPickColor;
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const mapOnRef = useRef(map);
  mapOnRef.current = map;
  const mapHolderRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const mapBufRef = useRef<HTMLCanvasElement | null>(null);
  const mapBufAt = useRef(0);
  const mapDragRef = useRef(false);
  /**
   * The sheet's own size, which is the window's until a picture is opened into
   * it and brings a size of its own. `scale` is how many sheet pixels one of
   * its CSS pixels is worth — the display's DPR for a sheet that is only ever
   * shown at window size, and 1 for a picture, so that saving it back gives the
   * pixels it arrived with.
   */
  const sheetRef = useRef({ w: 0, h: 0, scale: 1, locked: false });
  const nameRef = useRef(UNTITLED);
  // Nothing is written back until the stored sheet has been drawn in, so an
  // early stroke or resize can't overwrite it with a blank one.
  const restoredRef = useRef(false);

  const selRef = useRef<Selection | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const undoRef = useRef<HTMLCanvasElement[]>([]);
  const redoRef = useRef<HTMLCanvasElement[]>([]);
  const frameRef = useRef<number | null>(null);
  /** Something moved, so the next frame has to be drawn rather than skipped. */
  const dirtyRef = useRef(true);
  const paintedAt = useRef(0);
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  // Held space turns the pointer into a hand, the way it does everywhere else.
  const [panning, setPanning] = useState(false);
  const spaceRef = useRef(false);
  // The wand's tolerance as last left, so a plain click picks up where a drag
  // set it. The readout shows it beside the press while a drag is retuning it.
  const wandToleranceRef = useRef(WAND_TOLERANCE);
  const wandFrameRef = useRef<number | null>(null);
  const wandPreviewRef = useRef<HTMLCanvasElement | null>(null);
  // Placed once per press; the number in it is written straight to the DOM as
  // the drag goes, so retuning never re-renders the window.
  const [wandReadout, setWandReadout] = useState<{ x: number; y: number; tolerance: number } | null>(null);
  const wandReadoutRef = useRef<HTMLDivElement | null>(null);
  // The dropper's magnifier, moved and redrawn straight in the DOM — at most
  // once a frame, from the latest pointer — so hovering never re-renders.
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeLabelRef = useRef<HTMLDivElement | null>(null);
  const loupeFrameRef = useRef<number | null>(null);
  const loupeAtRef = useRef<{ clientX: number; clientY: number; touch: boolean; x: number; y: number } | null>(null);

  // applyView runs before ensureLoop is declared, and wants to wake it.
  const ensureLoopRef = useRef<(() => void) | null>(null);

  const emitStatus = useCallback(() => {
    statusRef.current({
      canUndo: undoRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
      hasSelection: selRef.current !== null,
      canPaste: CLIPBOARD !== null,
      zoom: viewRef.current.z,
    });
  }, []);

  // Fill the whole backing store white. Runs in identity transform, so it takes
  // device pixels, not CSS pixels.
  const fillBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }, []);

  const persist = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !restoredRef.current || canvas.width === 0) return;
    mapBufAt.current = 0;
    // A big opened photograph is left out of localStorage rather than stalling
    // every stroke on a data URL it hasn't room for.
    if (canvas.width * canvas.height > PERSIST_MAX_PIXELS) return;
    saveStored({
      png: canvas.toDataURL("image/png"),
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      name: nameRef.current,
      scale: sheetRef.current.scale,
      locked: sheetRef.current.locked,
    });
  }, []);

  // ---- where the sheet sits --------------------------------------------

  /**
   * Keep the sheet honest: centred while it's smaller than the window, and
   * never dragged so far that an edge comes inside it.
   */
  const clampView = useCallback((z: number, x: number, y: number): View => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return { z, x, y };
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    const sw = canvas.clientWidth * z;
    const sh = canvas.clientHeight * z;
    return {
      z,
      x: sw <= vw ? Math.round((vw - sw) / 2) : clamp(x, vw - sw, 0),
      y: sh <= vh ? Math.round((vh - sh) / 2) : clamp(y, vh - sh, 0),
    };
  }, []);

  const applyView = useCallback(
    (next: View) => {
      const cur = viewRef.current;
      if (next.z === cur.z && next.x === cur.x && next.y === cur.y) return;
      viewRef.current = next;
      setView(next);
      dirtyRef.current = true;
      ensureLoopRef.current?.();
      if (next.z !== cur.z) emitStatus();
    },
    [emitStatus],
  );

  /** Zoom about a point given in the window's own CSS pixels. */
  const zoomAbout = useCallback(
    (factor: number, px: number, py: number) => {
      const cur = viewRef.current;
      let z = clamp(cur.z * factor, MIN_ZOOM, MAX_ZOOM);
      // Make 100% easy to land on again on the way past it.
      if (Math.abs(z - 1) < 0.06) z = 1;
      if (z === cur.z) return;
      const sx = (px - cur.x) / cur.z;
      const sy = (py - cur.y) / cur.z;
      applyView(clampView(z, px - sx * z, py - sy * z));
    },
    [applyView, clampView],
  );

  /** Zoom on the middle of the window — what the keys and buttons do. */
  const zoomBy = useCallback(
    (factor: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      zoomAbout(factor, wrap.clientWidth / 2, wrap.clientHeight / 2);
    },
    [zoomAbout],
  );

  const zoomReset = useCallback(() => {
    applyView(clampView(1, 0, 0));
  }, [applyView, clampView]);

  // The wheel has to be bound by hand: React's own is passive, so it can't
  // stop the page scrolling underneath.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      // Over the Adjust colors box, the wheel is the box's to ignore.
      if ((event.target as HTMLElement).closest("[data-paint-panel]")) return;
      event.preventDefault();
      const at = pointIn(turnRef.current, wrap.getBoundingClientRect(), event.clientX, event.clientY);
      // deltaY comes in pixels, lines or pages depending on the mouse.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const steps = (event.deltaY * unit) / 100;
      zoomAbout(Math.pow(ZOOM_STEP, -steps), at.x - wrap.clientLeft, at.y - wrap.clientTop);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  // ---- undo stack -------------------------------------------------------

  const snapshot = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas && canvas.width > 0 ? copyOf(canvas) : null;
  }, []);

  /** How many sheets-worth of undo this sheet's size can afford. */
  const undoDepth = useCallback(() => {
    const canvas = canvasRef.current;
    const px = canvas ? canvas.width * canvas.height : 0;
    return px ? clamp(Math.floor(UNDO_BUDGET / px), 3, UNDO_LIMIT) : UNDO_LIMIT;
  }, []);

  /** Call immediately before anything that changes the sheet. */
  const pushUndo = useCallback(() => {
    const shot = snapshot();
    if (!shot) return;
    undoRef.current.push(shot);
    const depth = undoDepth();
    while (undoRef.current.length > depth) undoRef.current.shift();
    redoRef.current = [];
    mapBufAt.current = 0;
    emitStatus();
  }, [emitStatus, snapshot, undoDepth]);

  const restoreShot = useCallback((shot: HTMLCanvasElement) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(shot, 0, 0);
    ctx.restore();
  }, []);

  // ---- the selection overlay -------------------------------------------

  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The shape's outline with stripes crawling along it: marching ants.
   *
   * All of it happens in the window's own pixels, clipped to the part of the
   * selection actually on screen. A magic wand over a background selects a
   * shape whose bounding box is the whole sheet, and compositing that every
   * frame — on a big picture, tens of millions of pixels — is what used to
   * make a complicated selection crawl. The cost here is bounded by the window
   * instead, however large or intricate the shape behind it is.
   */
  const drawAnts = useCallback(
    (
      octx: CanvasRenderingContext2D,
      sel: Selection,
      time: number,
      k: number,
      panX: number,
      panY: number,
    ) => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      // The selection's box on the overlay, cut down to what is on screen.
      const bx = sel.x * k + panX;
      const by = sel.y * k + panY;
      const x0 = Math.max(0, Math.floor(bx));
      const y0 = Math.max(0, Math.floor(by));
      const x1 = Math.min(overlay.width, Math.ceil(bx + sel.w * k));
      const y1 = Math.min(overlay.height, Math.ceil(by + sel.h * k));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return;

      if (!scratchRef.current) scratchRef.current = makeCanvas(1, 1);
      const buf = scratchRef.current;
      if (buf.width !== overlay.width || buf.height !== overlay.height) {
        buf.width = Math.max(1, overlay.width);
        buf.height = Math.max(1, overlay.height);
      }
      const bctx = ctxOf(buf);
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, w, h);
      // Lay the outline in with the window's top-left corner of it at (0, 0).
      bctx.setTransform(k, 0, 0, k, bx - x0, by - y0);
      bctx.imageSmoothingEnabled = k < 1;
      bctx.drawImage(sel.ants, 0, 0);

      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.globalCompositeOperation = "source-atop";
      bctx.strokeStyle = "#ffffff";
      const period = Math.max(6, Math.round(12 * viewDprRef.current));
      bctx.lineWidth = period / 2;
      // The stripes run at 45°, so a line is fixed by x + y. Taking the phase
      // off that sum in the window's coordinates keeps them from jumping as
      // the clipped corner moves about.
      const phase = (((time / 45 - x0 - y0) % period) + period) % period;
      bctx.beginPath();
      for (let i = -h; i < w + h + period; i += period) {
        bctx.moveTo(i + phase, 0);
        bctx.lineTo(i + phase - h, h);
      }
      bctx.stroke();
      bctx.globalCompositeOperation = "source-over";

      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.drawImage(buf, 0, 0, w, h, x0, y0, w, h);
    },
    [],
  );

  /** Is there more sheet than window, and is the navigator wanted? */
  const mapNeeded = useCallback(() => {
    if (!mapOnRef.current) return false;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return false;
    const { z } = viewRef.current;
    return (
      canvas.clientWidth * z > wrap.clientWidth + 1 ||
      canvas.clientHeight * z > wrap.clientHeight + 1
    );
  }, []);

  /**
   * The whole sheet in the corner with the window's own frame drawn on it. The
   * thumbnail itself is only re-taken now and then — on a big sheet it is the
   * expensive part — while the frame follows every pan.
   */
  const drawMap = useCallback(
    (time: number) => {
      const holder = mapHolderRef.current;
      const mapCanvas = mapRef.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!holder || !mapCanvas || !canvas || !wrap) return;
      if (!mapNeeded()) {
        holder.style.display = "none";
        return;
      }
      holder.style.display = "block";

      const sw = canvas.clientWidth;
      const sh = canvas.clientHeight;
      const k = Math.min(MAP_MAX / sw, MAP_MAX / sh);
      const mw = Math.max(16, Math.round(sw * k));
      const mh = Math.max(16, Math.round(sh * k));
      const dpr = window.devicePixelRatio || 1;
      if (mapCanvas.width !== Math.round(mw * dpr) || mapCanvas.height !== Math.round(mh * dpr)) {
        mapCanvas.width = Math.round(mw * dpr);
        mapCanvas.height = Math.round(mh * dpr);
        mapCanvas.style.width = `${mw}px`;
        mapCanvas.style.height = `${mh}px`;
        mapBufAt.current = 0;
      }

      if (!mapBufRef.current) mapBufRef.current = makeCanvas(1, 1);
      const buf = mapBufRef.current;
      if (buf.width !== mapCanvas.width || buf.height !== mapCanvas.height) {
        buf.width = mapCanvas.width;
        buf.height = mapCanvas.height;
        mapBufAt.current = 0;
      }
      if (time - mapBufAt.current > 100) {
        mapBufAt.current = time;
        const bctx = ctxOf(buf);
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.fillStyle = BG;
        bctx.fillRect(0, 0, buf.width, buf.height);
        bctx.drawImage(canvas, 0, 0, buf.width, buf.height);
      }

      const mctx = ctxOf(mapCanvas);
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, mw, mh);
      mctx.drawImage(buf, 0, 0, mw, mh);

      // Where the window is looking, in the thumbnail's own pixels.
      const { z, x, y } = viewRef.current;
      const rx = clamp((-x / z) * (mw / sw), 0, mw);
      const ry = clamp((-y / z) * (mh / sh), 0, mh);
      const rw = clamp((wrap.clientWidth / z) * (mw / sw), 2, mw - rx);
      const rh = clamp((wrap.clientHeight / z) * (mh / sh), 2, mh - ry);

      // Everything the window is not showing goes under a shade, so the part
      // that it is reads as a lit panel rather than as one more rectangle in a
      // picture that may be full of them.
      mctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      mctx.fillRect(0, 0, mw, ry);
      mctx.fillRect(0, ry + rh, mw, mh - ry - rh);
      mctx.fillRect(0, ry, rx, rh);
      mctx.fillRect(rx + rw, ry, mw - rx - rw, rh);

      // A white band just inside the edge carries against the shade, and a
      // hairline on the boundary itself carries against a pale picture.
      mctx.lineWidth = 2;
      mctx.strokeStyle = "#ffffff";
      mctx.strokeRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
      mctx.lineWidth = 1;
      mctx.strokeStyle = "#000000";
      mctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
    },
    [mapNeeded],
  );

  /** Point the window at a spot on the thumbnail. */
  const mapTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = pointIn(turnRef.current, rect, e.clientX, e.clientY);
    const size = sizeIn(turnRef.current, rect);
    const sx = (at.x / size.w) * canvas.clientWidth;
    const sy = (at.y / size.h) * canvas.clientHeight;
    const { z } = viewRef.current;
    applyView(clampView(z, wrap.clientWidth / 2 - sx * z, wrap.clientHeight / 2 - sy * z));
  };

  /**
   * The clock the ants crawl by. It stands still while a selection is being
   * drawn out — rectangle, lasso or wand — so the shape being made, and the
   * one Shift is adding it to, hold still under the pointer; letting go picks
   * up where it stopped rather than jumping ahead.
   */
  const antsClockRef = useRef({ stoppedAt: -1, behind: 0 });
  const antsTime = useCallback((time: number) => {
    const clock = antsClockRef.current;
    const drag = dragRef.current;
    const making = drag !== null && (drag.kind === "rect" || drag.kind === "lasso" || drag.kind === "wand");
    if (making && clock.stoppedAt < 0) clock.stoppedAt = time;
    if (!making && clock.stoppedAt >= 0) {
      clock.behind += time - clock.stoppedAt;
      clock.stoppedAt = -1;
    }
    return (clock.stoppedAt >= 0 ? clock.stoppedAt : time) - clock.behind;
  }, []);

  const paintOverlay = useCallback(
    (now: number) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const time = antsTime(now);
      const octx = ctxOf(overlay);
      const dpr = dprRef.current;
      const viewDpr = viewDprRef.current;
      const { z, x: panX, y: panY } = viewRef.current;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      // The overlay covers the window, not the sheet, so everything on it is
      // drawn through the same scale and offset the sheet itself is shown at.
      // One sheet pixel is z of its own CSS pixels on screen, and the overlay
      // counts in the display's, which needn't be the sheet's.
      const k = (z * viewDpr) / dpr;
      const ox = panX * viewDpr;
      const oy = panY * viewDpr;

      const sel = selRef.current;
      if (sel) {
        // Blown up, a one-pixel outline would come out z pixels wide, so the
        // outline is rebuilt thinner whenever the zoom asks for a new width.
        const wantThickness = clamp(Math.round(dpr / z), 1, MAX_ANTS_THICKNESS);
        if (sel.antsThickness !== wantThickness) {
          sel.ants = outlineOf(sel.mask, wantThickness);
          sel.antsThickness = wantThickness;
        }
        if (sel.lifted) {
          octx.setTransform(k, 0, 0, k, ox, oy);
          octx.imageSmoothingEnabled = k < 1;
          octx.drawImage(sel.pixels, sel.x, sel.y);
        }
        drawAnts(octx, sel, time, k, ox, oy);
      }

      const drag = dragRef.current;
      if (drag && (drag.kind === "rect" || drag.kind === "lasso")) {
        octx.setTransform(k, 0, 0, k, ox, oy);
        octx.save();
        octx.strokeStyle = "#000000";
        octx.lineWidth = Math.max(1, dpr) / z;
        const dash = (4 * dpr) / z;
        octx.setLineDash([dash, dash]);
        octx.lineDashOffset = -(time / 45) % (2 * dash);
        if (drag.kind === "rect") {
          octx.beginPath();
          octx.rect(
            Math.min(drag.x0, drag.x1),
            Math.min(drag.y0, drag.y1),
            Math.abs(drag.x1 - drag.x0),
            Math.abs(drag.y1 - drag.y0),
          );
          octx.stroke();
        } else if (drag.pts.length > 1) {
          // The line drawn so far is a Path2D the pointer has been extending,
          // so a long free-hand shape costs one stroke rather than a fresh
          // path of every point it has collected, sixty times a second.
          octx.stroke(drag.path);
          const first = drag.pts[0];
          const last = drag.pts[drag.pts.length - 1];
          octx.beginPath();
          octx.moveTo(last.x, last.y);
          octx.lineTo(first.x, first.y);
          octx.stroke();
        }
        octx.restore();
      }

      drawMap(now);
    },
    [antsTime, drawAnts, drawMap],
  );

  /**
   * Keep the overlay animating while there is anything on it to animate — but
   * only actually redraw when something moved, or when the ants are due their
   * next step. Idling on a selection costs fifteen frames a second, not sixty.
   */
  const ensureLoop = useCallback(() => {
    if (frameRef.current !== null) return;
    const step = (time: number) => {
      const moving = dragRef.current !== null;
      if (dirtyRef.current || moving || time - paintedAt.current >= ANTS_TICK) {
        dirtyRef.current = false;
        paintedAt.current = time;
        paintOverlay(time);
      }
      if (selRef.current || moving || mapNeeded()) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
        paintOverlay(time);
      }
    };
    frameRef.current = requestAnimationFrame(step);
  }, [mapNeeded, paintOverlay]);

  ensureLoopRef.current = ensureLoop;

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Clearing it matters: a leftover id reads as "already running", and
      // nothing would ever start the loop again.
      frameRef.current = null;
    },
    [],
  );

  // Turning the navigator on has to wake the loop that draws it.
  useEffect(() => {
    if (map) ensureLoop();
  }, [ensureLoop, map]);

  // ---- selection plumbing ----------------------------------------------

  /** A copy of `mask`'s shape, filled flat with one color. */
  const tintMask = (mask: HTMLCanvasElement, fill: string) => {
    const out = makeCanvas(mask.width, mask.height);
    const octx = ctxOf(out);
    octx.drawImage(mask, 0, 0);
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = fill;
    octx.fillRect(0, 0, out.width, out.height);
    return out;
  };

  const makeSelection = useCallback(
    (mask: HTMLCanvasElement, x: number, y: number, pixels?: HTMLCanvasElement): Selection | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      let cut = pixels ?? null;
      if (!cut) {
        cut = makeCanvas(mask.width, mask.height);
        const cctx = ctxOf(cut);
        cctx.drawImage(canvas, x, y, mask.width, mask.height, 0, 0, mask.width, mask.height);
        cctx.globalCompositeOperation = "destination-in";
        cctx.drawImage(mask, 0, 0);
      }
      const thickness = clamp(Math.round(dprRef.current / viewRef.current.z), 1, MAX_ANTS_THICKNESS);
      return {
        x,
        y,
        w: mask.width,
        h: mask.height,
        mask,
        maskCtx: ctxOf(mask, true),
        pixels: cut,
        ants: outlineOf(mask, thickness),
        antsThickness: thickness,
        lifted: pixels !== undefined,
      };
    },
    [],
  );

  /** Take the pixels off the sheet, leaving white behind. One undo step. */
  const liftSelection = useCallback(() => {
    const sel = selRef.current;
    const ctx = ctxRef.current;
    if (!sel || sel.lifted || !ctx) return;
    pushUndo();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tintMask(sel.mask, BG), sel.x, sel.y);
    ctx.restore();
    sel.lifted = true;
  }, [pushUndo]);

  /** Put a floating selection down where it sits and drop the marquee. */
  const commitSelection = useCallback(() => {
    const sel = selRef.current;
    const ctx = ctxRef.current;
    if (!sel) return;
    selRef.current = null;
    if (sel.lifted && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(sel.pixels, sel.x, sel.y);
      ctx.restore();
      persist();
    }
    emitStatus();
  }, [emitStatus, persist]);

  const setSelection = useCallback(
    (sel: Selection | null) => {
      selRef.current = sel;
      dirtyRef.current = true;
      emitStatus();
      if (sel) ensureLoop();
    },
    [emitStatus, ensureLoop],
  );

  const hitSelection = (sel: Selection, x: number, y: number) => {
    const px = Math.floor(x - sel.x);
    const py = Math.floor(y - sel.y);
    if (px < 0 || py < 0 || px >= sel.w || py >= sel.h) return false;
    return sel.maskCtx.getImageData(px, py, 1, 1).data[3] > 127;
  };

  // ---- how big the sheet is --------------------------------------------

  /**
   * Give the sheet a size, in its own CSS pixels, and a scale to back it with.
   * Optionally carries the art across, which is what growing the window does.
   */
  const applySheet = useCallback(
    (w: number, h: number, scale: number, keepArt: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));
      const snap = keepArt && canvas.width > 0 ? copyOf(canvas) : null;

      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctxRef.current = ctx;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      fillBackground(ctx, pw, ph);
      if (snap) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(snap, 0, 0);
        ctx.restore();
      }
      dprRef.current = scale;
      sheetRef.current = { ...sheetRef.current, w, h, scale };
      mapBufAt.current = 0;
    },
    [fillBackground],
  );

  /**
   * The window changed shape. An unlocked sheet is the window, so it follows
   * along; a picture's sheet keeps its own size and only the view is nudged
   * back inside.
   */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !overlay || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    viewDprRef.current = dpr;
    const vw = Math.max(1, Math.floor(wrap.clientWidth));
    const vh = Math.max(1, Math.floor(wrap.clientHeight));

    // The overlay is the window, not the sheet: selections and ants are drawn
    // on it through the same scale and offset the sheet is shown at.
    const ow = Math.round(vw * dpr);
    const oh = Math.round(vh * dpr);
    if (overlay.width !== ow || overlay.height !== oh) {
      overlay.width = ow;
      overlay.height = oh;
      overlay.style.width = `${vw}px`;
      overlay.style.height = `${vh}px`;
    }

    const sheet = sheetRef.current;
    if (!sheet.locked && (sheet.w !== vw || sheet.h !== vh || sheet.scale !== dpr)) {
      // A floating selection is positioned in the old pixels, so put it down
      // before the sheet changes size under it.
      commitSelection();
      applySheet(vw, vh, dpr, true);
    }
    const v = viewRef.current;
    applyView(clampView(v.z, v.x, v.y));
  }, [applySheet, applyView, clampView, commitSelection]);

  useEffect(() => {
    resize();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [resize]);

  // Bring back the sheet from last time, drawn at the CSS size it was saved at.
  useEffect(() => {
    emitStatus();
    const stored = loadStored();
    if (!stored) {
      restoredRef.current = true;
      return;
    }
    nameRef.current = stored.name;
    let cancelled = false;
    loadImage(stored.png)
      .then((img) => {
        if (cancelled) return;
        if (stored.locked) {
          // It was a picture, so it comes back at its own size, shown whole.
          sheetRef.current.locked = true;
          applySheet(stored.w, stored.h, stored.scale, false);
          const wrap = wrapRef.current;
          ctxRef.current?.drawImage(img, 0, 0, stored.w, stored.h);
          if (wrap) {
            applyView(
              clampView(
                Math.min(1, wrap.clientWidth / stored.w, wrap.clientHeight / stored.h),
                0,
                0,
              ),
            );
          }
        } else {
          ctxRef.current?.drawImage(img, 0, 0, stored.w, stored.h);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) restoredRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [applySheet, applyView, clampView, emitStatus]);

  // Switching tools puts any floating selection down, the way Paint does.
  useEffect(() => {
    if (tool === "select" || tool === "lasso" || tool === "wand") return;
    commitSelection();
  }, [commitSelection, tool]);

  // ---- the tools --------------------------------------------------------

  const strokeTo = (x: number, y: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { color: c, brushSize: s } = styleRef.current;
    const from = last.current;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = s;
    if (from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      // A lone click/tap still leaves a dot.
      ctx.beginPath();
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    last.current = { x, y };
  };

  const pickColorAt = (dx: number, dy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const x = clamp(Math.floor(dx), 0, canvas.width - 1);
    const y = clamp(Math.floor(dy), 0, canvas.height - 1);
    const px = ctxOf(canvas, true).getImageData(x, y, 1, 1).data;
    pickRef.current(`#${hex2(px[0])}${hex2(px[1])}${hex2(px[2])}`);
  };

  /**
   * Draw the dropper's magnifier: the sheet pixel under the pointer and its
   * neighbours, blown up square with a faint grid, the middle one boxed, and
   * its color written underneath. It sits beside the pointer — above it for a
   * finger, so the finger isn't covering it — and swaps sides at the edges.
   */
  const drawLoupe = () => {
    loupeFrameRef.current = null;
    const at = loupeAtRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const holder = loupeRef.current;
    const glass = loupeCanvasRef.current;
    const label = loupeLabelRef.current;
    if (!at || !canvas || !wrap || !holder || !glass || !label) return;

    const size = LOUPE_SPAN * LOUPE_CELL;
    const half = (LOUPE_SPAN - 1) / 2;
    const vdpr = window.devicePixelRatio || 1;
    if (glass.width !== Math.round(size * vdpr)) {
      glass.width = glass.height = Math.round(size * vdpr);
      glass.style.width = glass.style.height = `${size}px`;
    }
    const g = ctxOf(glass);
    g.setTransform(vdpr, 0, 0, vdpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = MAT;
    g.fillRect(0, 0, size, size);

    // Only what's on the sheet is copied; past its edge stays table grey.
    const cx = Math.floor(at.x);
    const cy = Math.floor(at.y);
    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half);
    const x1 = Math.min(canvas.width, cx + half + 1);
    const y1 = Math.min(canvas.height, cy + half + 1);
    if (x1 > x0 && y1 > y0) {
      g.drawImage(
        canvas,
        x0,
        y0,
        x1 - x0,
        y1 - y0,
        (x0 - (cx - half)) * LOUPE_CELL,
        (y0 - (cy - half)) * LOUPE_CELL,
        (x1 - x0) * LOUPE_CELL,
        (y1 - y0) * LOUPE_CELL,
      );
    }
    g.lineWidth = 1;
    g.strokeStyle = "rgba(0, 0, 0, 0.12)";
    g.beginPath();
    for (let i = 1; i < LOUPE_SPAN; i += 1) {
      const line = i * LOUPE_CELL + 0.5;
      g.moveTo(line, 0);
      g.lineTo(line, size);
      g.moveTo(0, line);
      g.lineTo(size, line);
    }
    g.stroke();
    const mid = half * LOUPE_CELL;
    g.strokeStyle = "#000000";
    g.strokeRect(mid - 0.5, mid - 0.5, LOUPE_CELL + 1, LOUPE_CELL + 1);
    g.strokeStyle = "#ffffff";
    g.strokeRect(mid + 0.5, mid + 0.5, LOUPE_CELL - 1, LOUPE_CELL - 1);

    const onSheet = cx >= 0 && cy >= 0 && cx < canvas.width && cy < canvas.height;
    const px = onSheet ? ctxOf(canvas, true).getImageData(cx, cy, 1, 1).data : null;
    const hex = px ? `#${hex2(px[0])}${hex2(px[1])}${hex2(px[2])}` : "";
    label.textContent = hex || "—";
    label.style.borderLeftColor = hex || "transparent";

    holder.style.display = "block";
    const spot = pointIn(turnRef.current, wrap.getBoundingClientRect(), at.clientX, at.clientY);
    const lx = spot.x - wrap.clientLeft;
    const ly = spot.y - wrap.clientTop;
    const boxW = holder.offsetWidth;
    const boxH = holder.offsetHeight;
    const gap = 16;
    let left = lx + gap;
    let top = at.touch ? ly - gap - boxH : ly + gap;
    if (left + boxW > wrap.clientWidth) left = lx - gap - boxW;
    if (top < 0) top = ly + gap;
    if (top + boxH > wrap.clientHeight) top = ly - gap - boxH;
    holder.style.left = `${Math.max(0, left)}px`;
    holder.style.top = `${Math.max(0, top)}px`;
  };

  const showLoupe = (e: React.PointerEvent<HTMLElement>, x: number, y: number) => {
    loupeAtRef.current = { clientX: e.clientX, clientY: e.clientY, touch: e.pointerType !== "mouse", x, y };
    if (loupeFrameRef.current === null) loupeFrameRef.current = requestAnimationFrame(drawLoupe);
  };

  const hideLoupe = () => {
    if (loupeFrameRef.current !== null) {
      cancelAnimationFrame(loupeFrameRef.current);
      loupeFrameRef.current = null;
    }
    loupeAtRef.current = null;
    if (loupeRef.current) loupeRef.current.style.display = "none";
  };

  // Picking a color hands the pointer back to the pencil; the glass goes with it.
  useEffect(() => {
    if (tool === "dropper") return;
    if (loupeFrameRef.current !== null) cancelAnimationFrame(loupeFrameRef.current);
    loupeFrameRef.current = null;
    loupeAtRef.current = null;
    if (loupeRef.current) loupeRef.current.style.display = "none";
  }, [tool]);

  // ---- adjust colors ---------------------------------------------------

  /**
   * Adjust colors works on the selection's own pixels, lifted off the sheet
   * so the overlay shows them as they change (lifting is the undo step). The
   * untouched pixels and the buffer the sliders write into are both made once,
   * when the box opens, and a slider redraws at most once a frame.
   */
  const adjustRef = useRef<{
    sel: Selection;
    original: ImageData;
    out: ImageData;
    pending: ColorAdjust | null;
    frame: number | null;
  } | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const startAdjust = () => {
    const sel = selRef.current;
    if (!sel || adjustRef.current) return;
    liftSelection();
    const original = ctxOf(sel.pixels, true).getImageData(0, 0, sel.w, sel.h);
    const out = new ImageData(new Uint8ClampedArray(original.data), sel.w, sel.h);
    adjustRef.current = { sel, original, out, pending: null, frame: null };
    setAdjusting(true);
  };

  const previewAdjust = (adjust: ColorAdjust) => {
    const a = adjustRef.current;
    if (!a) return;
    a.pending = adjust;
    if (a.frame !== null) return;
    a.frame = requestAnimationFrame(() => {
      a.frame = null;
      if (!a.pending) return;
      adjustColors(a.original.data, a.out.data, a.pending);
      ctxOf(a.sel.pixels, true).putImageData(a.out, 0, 0);
      dirtyRef.current = true;
      ensureLoop();
    });
  };

  /** OK keeps the sliders' work; Cancel puts the selection's pixels back. */
  const finishAdjust = (keep: boolean) => {
    const a = adjustRef.current;
    if (!a) return;
    adjustRef.current = null;
    if (a.frame !== null) cancelAnimationFrame(a.frame);
    if (keep && a.pending) adjustColors(a.original.data, a.out.data, a.pending);
    ctxOf(a.sel.pixels, true).putImageData(keep ? a.out : a.original, 0, 0);
    dirtyRef.current = true;
    ensureLoop();
    setAdjusting(false);
  };
  const finishAdjustRef = useRef(finishAdjust);
  finishAdjustRef.current = finishAdjust;
  const startAdjustRef = useRef(startAdjust);
  startAdjustRef.current = startAdjust;

  // Picking another tool lands the adjustment, the way clicking away would.
  useEffect(() => {
    finishAdjustRef.current(true);
  }, [tool]);

  /**
   * The wand, worked out once per press: for every pixel, the least tolerance
   * at which a flood from the pressed one reaches it — the worst color step
   * along the kindest way there. Retuning the wand then never floods again: a
   * pixel is in at tolerance t exactly when its level is t or less.
   *
   * A bucket per level, emptied in order. Levels only rise from one bucket to
   * the next, so the first finished neighbour to find a pixel fixes its level
   * for good: each pixel is queued once, and the whole map is a single pass.
   */
  const wandLevels = (src: Uint8ClampedArray, w: number, h: number, sx: number, sy: number) => {
    const seed = (sy * w + sx) * 4;
    const sr = src[seed];
    const sg = src[seed + 1];
    const sb = src[seed + 2];
    const n = w * h;
    const level = new Uint8Array(n);
    const seen = new Uint8Array(n);
    const next = new Int32Array(n);
    const head = new Int32Array(256).fill(-1);
    const queue = (i: number, at: number) => {
      const p = i * 4;
      const off = Math.max(Math.abs(src[p] - sr), Math.abs(src[p + 1] - sg), Math.abs(src[p + 2] - sb));
      const lv = off > at ? off : at;
      seen[i] = 1;
      level[i] = lv;
      next[i] = head[lv];
      head[lv] = i;
    };
    queue(sy * w + sx, 0);
    for (let at = 0; at < 256; at += 1) {
      while (head[at] !== -1) {
        const i = head[at];
        head[at] = next[i];
        const x = i % w;
        if (x > 0 && !seen[i - 1]) queue(i - 1, at);
        if (x < w - 1 && !seen[i + 1]) queue(i + 1, at);
        if (i >= w && !seen[i - w]) queue(i - w, at);
        if (i + w < n && !seen[i + w]) queue(i + w, at);
      }
    }
    return level;
  };

  /** One frame of a wand drag: everything in at the current tolerance, tinted. */
  const drawWandPreview = (drag: WandDrag) => {
    const { level, w, stride, image, pixels, tolerance } = drag;
    const pw = image.width;
    const ph = image.height;
    let o = 0;
    for (let y = 0; y < ph; y += 1) {
      const row = y * stride * w;
      for (let x = 0; x < pw; x += 1) {
        pixels[o] = level[row + x * stride] <= tolerance ? WAND_TINT : 0;
        o += 1;
      }
    }
    drag.preview.putImageData(image, 0, 0);
  };

  /**
   * Shift held as a selection starts adds the new one to what's already
   * selected. The old shape waits here, still showing, until the new one is
   * made — or, if the new one comes to nothing, simply stays selected.
   */
  const addToRef = useRef<{ mask: HTMLCanvasElement; x: number; y: number } | null>(null);

  /** Select a freshly made shape, joined to the one Shift is adding to, if any. */
  const finishSelection = (mask: HTMLCanvasElement, x: number, y: number) => {
    const prev = addToRef.current;
    addToRef.current = null;
    if (!prev) {
      setSelection(makeSelection(mask, x, y));
      return;
    }
    const left = Math.min(prev.x, x);
    const top = Math.min(prev.y, y);
    const right = Math.max(prev.x + prev.mask.width, x + mask.width);
    const bottom = Math.max(prev.y + prev.mask.height, y + mask.height);
    const both = makeCanvas(right - left, bottom - top);
    const bctx = ctxOf(both, true);
    bctx.drawImage(prev.mask, prev.x - left, prev.y - top);
    bctx.drawImage(mask, x - left, y - top);
    setSelection(makeSelection(both, left, top));
  };

  /** Select everything the wand takes in at `tolerance`. */
  const selectLevels = (level: Uint8Array, w: number, h: number, tolerance: number) => {
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      for (let x = 0; x < w; x += 1) {
        if (level[row + x] > tolerance) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
    if (maxX < 0) return;
    const mw = maxX - minX + 1;
    const mh = maxY - minY + 1;
    const mask = makeCanvas(mw, mh);
    const mctx = ctxOf(mask, true);
    const img = mctx.createImageData(mw, mh);
    for (let y = 0; y < mh; y += 1) {
      const from = (y + minY) * w + minX;
      const to = y * mw;
      for (let x = 0; x < mw; x += 1) {
        if (level[from + x] <= tolerance) img.data[(to + x) * 4 + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
    finishSelection(mask, minX, minY);
  };

  const selectRect = (x0: number, y0: number, x1: number, y1: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const left = Math.max(0, Math.round(Math.min(x0, x1)));
    const top = Math.max(0, Math.round(Math.min(y0, y1)));
    const right = Math.min(canvas.width, Math.round(Math.max(x0, x1)));
    const bottom = Math.min(canvas.height, Math.round(Math.max(y0, y1)));
    const w = right - left;
    const h = bottom - top;
    if (w < 2 || h < 2) return;
    const mask = makeCanvas(w, h);
    const mctx = ctxOf(mask, true);
    mctx.fillStyle = "#000000";
    mctx.fillRect(0, 0, w, h);
    finishSelection(mask, left, top);
  };

  const selectLasso = (pts: { x: number; y: number }[]) => {
    const canvas = canvasRef.current;
    if (!canvas || pts.length < 3) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const left = Math.max(0, Math.floor(minX));
    const top = Math.max(0, Math.floor(minY));
    const right = Math.min(canvas.width, Math.ceil(maxX));
    const bottom = Math.min(canvas.height, Math.ceil(maxY));
    const w = right - left;
    const h = bottom - top;
    if (w < 2 || h < 2) return;
    const mask = makeCanvas(w, h);
    const mctx = ctxOf(mask, true);
    mctx.fillStyle = "#000000";
    mctx.beginPath();
    mctx.moveTo(pts[0].x - left, pts[0].y - top);
    for (const pt of pts.slice(1)) mctx.lineTo(pt.x - left, pt.y - top);
    mctx.closePath();
    mctx.fill();
    finishSelection(mask, left, top);
  };

  // ---- clipboard --------------------------------------------------------

  const copy = useCallback(() => {
    const sel = selRef.current;
    if (!sel) return;
    CLIPBOARD = copyOf(sel.pixels);
    OWN_IS_NEWER = true;
    emitStatus();
    // Best effort: hand the same pixels to the system clipboard so they can be
    // pasted into something else. Plenty of browsers say no; that's fine —
    // paint.exe's own clipboard still has it, and Ctrl+V will prefer it.
    // ClipboardItem takes the PNG as a promise so the write starts inside the
    // keypress, while the browser still counts it as the user's doing.
    try {
      const png = new Promise<Blob>((resolve, reject) =>
        sel.pixels.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no blob"))), "image/png"),
      );
      const write = navigator.clipboard?.write?.([new ClipboardItem({ "image/png": png })]);
      if (!write) return;
      void write.then(
        () => {
          OWN_IS_NEWER = false;
        },
        () => {},
      );
    } catch {
      // No ClipboardItem here.
    }
  }, [emitStatus]);

  /** Wipe whatever the selection covers back to white. */
  const eraseSelection = useCallback(() => {
    const sel = selRef.current;
    const ctx = ctxRef.current;
    if (!sel || !ctx) return;
    if (!sel.lifted) {
      pushUndo();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tintMask(sel.mask, BG), sel.x, sel.y);
      ctx.restore();
    }
    selRef.current = null;
    emitStatus();
    persist();
  }, [emitStatus, persist, pushUndo]);

  /** The part of the sheet on screen right now, in sheet pixels. */
  const visibleSheet = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return null;
    const { z, x: panX, y: panY } = viewRef.current;
    const k = dprRef.current / z;
    const left = Math.max(0, -panX * k);
    const top = Math.max(0, -panY * k);
    const right = Math.min(canvas.width, (wrap.clientWidth - panX) * k);
    const bottom = Math.min(canvas.height, (wrap.clientHeight - panY) * k);
    return { left, top, right, bottom, w: right - left, h: bottom - top };
  }, []);

  /**
   * Pasted pixels always land whole and in view. Too big for the window at
   * this zoom, the view backs out until they fit; too big for the sheet
   * itself, they are shrunk to fit what's on screen. Then they're centred on
   * `at` (a sheet pixel) or, without one, on the middle of the visible sheet,
   * and pulled back inside it if that would hang them off an edge.
   */
  const pasteCanvas = useCallback(
    (source: HTMLCanvasElement, at?: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      commitSelection();
      pushUndo();

      // Back out far enough to take the whole paste in, but no further than
      // showing the whole sheet: past that, zooming out shows only more mat.
      const dpr = dprRef.current;
      const cur = viewRef.current;
      const fitPaste = Math.min((wrap.clientWidth * dpr) / source.width, (wrap.clientHeight * dpr) / source.height);
      const fitSheet = Math.min(
        (wrap.clientWidth * dpr) / canvas.width,
        (wrap.clientHeight * dpr) / canvas.height,
      );
      const z = clamp(Math.max(fitPaste, fitSheet), MIN_ZOOM, cur.z);
      if (z < cur.z) {
        // About the middle of the window, so what was being looked at stays put.
        const mx = wrap.clientWidth / 2;
        const my = wrap.clientHeight / 2;
        applyView(clampView(z, mx - ((mx - cur.x) / cur.z) * z, my - ((my - cur.y) / cur.z) * z));
      }

      const seen = visibleSheet();
      if (!seen || seen.w < 1 || seen.h < 1) return;
      // The pixels' own alpha is the shape, so a lassoed cut-out keeps its edge.
      let pixels = copyOf(source);
      const shrink = Math.min(1, seen.w / pixels.width, seen.h / pixels.height);
      if (shrink < 1) {
        const small = makeCanvas(Math.floor(pixels.width * shrink), Math.floor(pixels.height * shrink));
        const sctx = ctxOf(small);
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(pixels, 0, 0, small.width, small.height);
        pixels = small;
      }
      const cx = at?.x ?? (seen.left + seen.right) / 2;
      const cy = at?.y ?? (seen.top + seen.bottom) / 2;
      const x = Math.round(clamp(cx - pixels.width / 2, seen.left, seen.right - pixels.width));
      const y = Math.round(clamp(cy - pixels.height / 2, seen.top, seen.bottom - pixels.height));
      setSelection(makeSelection(pixels, x, y, pixels));
      wrap.focus({ preventScroll: true });
    },
    [applyView, clampView, commitSelection, makeSelection, pushUndo, setSelection, visibleSheet],
  );

  const paste = useCallback(
    (at?: { x: number; y: number }) => {
      if (!CLIPBOARD) return;
      pasteCanvas(CLIPBOARD, at);
    },
    [pasteCanvas],
  );

  /**
   * Ctrl+V. A picture on the system clipboard — a screenshot, something copied
   * in another tab — comes in as it is; with none there, or when paint.exe's
   * own copy is the newer of the two, its own clipboard is pasted instead.
   */
  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-paint-panel]")) return;
    const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
      entry.type.startsWith("image/"),
    );
    const file = OWN_IS_NEWER ? null : item?.getAsFile();
    if (!file) {
      if (!CLIPBOARD) return;
      event.preventDefault();
      finishAdjustRef.current(true);
      paste();
      return;
    }
    event.preventDefault();
    finishAdjustRef.current(true);
    const url = URL.createObjectURL(file);
    void loadImage(url)
      .then((img) => {
        const source = makeCanvas(img.width, img.height);
        ctxOf(source).drawImage(img, 0, 0);
        CLIPBOARD = source;
        pasteCanvas(source);
      })
      .catch(() => {})
      .finally(() => URL.revokeObjectURL(url));
  };

  // ---- grab -------------------------------------------------------------

  /**
   * Grab stops the whole page moving and puts a pane of glass over it; the box
   * dragged on that comes back as a paste, kept on paint.exe's clipboard too.
   * It's taken at the sheet's own scale, so it lands the size it looked.
   */
  const [grabbing, setGrabbing] = useState(false);
  const thawRef = useRef<(() => void) | null>(null);

  const startGrab = () => {
    if (thawRef.current) return;
    finishAdjustRef.current(true);
    thawRef.current = freezePage();
    setGrabbing(true);
  };
  const startGrabRef = useRef(startGrab);
  startGrabRef.current = startGrab;

  const endGrab = useCallback(() => {
    thawRef.current?.();
    thawRef.current = null;
    setGrabbing(false);
  }, []);

  // Closing paint.exe mid-grab mustn't leave the page standing still.
  useEffect(() => endGrab, [endGrab]);

  const finishGrab = async (rect: GrabRect) => {
    let picture: HTMLCanvasElement | null = null;
    try {
      picture = await grabPage(rect, dprRef.current, (el) => el.hasAttribute("data-paint-grab"));
    } catch (error) {
      console.warn(error);
    }
    endGrab();
    if (!picture) {
      window.alert("paint.exe couldn't take a picture of that.");
      return;
    }
    CLIPBOARD = picture;
    // The system clipboard can't be written to this long after the click, so
    // whatever it holds is older than this.
    OWN_IS_NEWER = true;
    // It arrives selected, ready to drag about.
    if (styleRef.current.tool === "pencil" || styleRef.current.tool === "dropper") {
      commandsRef.current.setTool("select");
    }
    pasteCanvas(picture);
  };

  // ---- pointer ----------------------------------------------------------

  /**
   * Screen pointer → the sheet's own device pixels, whatever the zoom or turn.
   * Off the sheet, out on the mat, the numbers just run past its edges.
   */
  const devicePoint = (e: React.PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: -1, y: -1 };
    const at = pointIn(turnRef.current, canvas.getBoundingClientRect(), e.clientX, e.clientY);
    const scale = dprRef.current / viewRef.current.z;
    return { x: at.x * scale, y: at.y * scale };
  };

  const onSheet = (p: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    return !!canvas && p.x >= 0 && p.y >= 0 && p.x < canvas.width && p.y < canvas.height;
  };

  /**
   * The pointer is heard over the whole window, mat and all, not just the
   * sheet: a selection can be started off the edge of the picture and dragged
   * across it, the way it can on a real desk. Anything on top of the picture
   * with controls of its own — the navigator, the menu, Adjust colors — keeps
   * its presses to itself.
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== canvasRef.current) return;
    e.preventDefault();
    wrapRef.current?.focus({ preventScroll: true });
    // The right button is for the menu, which opens on its own event.
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Going back to the picture with Adjust colors open is an OK.
    finishAdjustRef.current(true);

    // Space, or the middle button, shoves the sheet about instead.
    if (spaceRef.current || e.button === 1) {
      const v = viewRef.current;
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, origX: v.x, origY: v.y };
      setPanning(true);
      return;
    }

    const p = devicePoint(e);
    const dpr = dprRef.current;
    const active = styleRef.current.tool;
    // Drawing and picking need something under them; selecting doesn't.
    if ((active === "dropper" || active === "pencil") && !onSheet(p)) return;

    if (active === "dropper") {
      dragRef.current = { kind: "dropper", x: p.x, y: p.y };
      showLoupe(e, p.x, p.y);
      return;
    }

    if (active === "pencil") {
      commitSelection();
      pushUndo();
      drawing.current = true;
      last.current = null;
      strokeTo(p.x / dpr, p.y / dpr);
      return;
    }

    const sel = selRef.current;
    if (sel && !e.shiftKey && hitSelection(sel, p.x, p.y)) {
      dragRef.current = {
        kind: "move",
        startX: p.x,
        startY: p.y,
        origX: sel.x,
        origY: sel.y,
        moved: false,
      };
      return;
    }

    commitSelection();
    addToRef.current = null;
    if (e.shiftKey && sel) {
      // Put down anything that was floating, then keep its shape selected —
      // cut from the sheet where it now sits — to add the new one to.
      const kept = { mask: sel.mask, x: Math.round(sel.x), y: Math.round(sel.y) };
      setSelection(makeSelection(kept.mask, kept.x, kept.y));
      addToRef.current = kept;
    }
    if (active === "wand") {
      // Off the sheet there's no color to flood from: the click only deselects.
      if (!onSheet(p)) {
        addToRef.current = null;
        return;
      }
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const previewCanvas = wandPreviewRef.current;
      if (!canvas || !wrap || !previewCanvas) return;
      const w = canvas.width;
      const h = canvas.height;
      const level = wandLevels(
        ctxOf(canvas, true).getImageData(0, 0, w, h).data,
        w,
        h,
        clamp(Math.floor(p.x), 0, w - 1),
        clamp(Math.floor(p.y), 0, h - 1),
      );
      const stride = Math.max(1, Math.ceil(Math.sqrt((w * h) / WAND_PREVIEW_PIXELS)));
      previewCanvas.width = Math.ceil(w / stride);
      previewCanvas.height = Math.ceil(h / stride);
      previewCanvas.style.width = canvas.style.width;
      previewCanvas.style.height = canvas.style.height;
      previewCanvas.style.display = "block";
      const preview = ctxOf(previewCanvas);
      const image = preview.createImageData(previewCanvas.width, previewCanvas.height);
      const base = wandToleranceRef.current;
      const drag: WandDrag = {
        kind: "wand",
        level,
        w,
        h,
        stride,
        preview,
        image,
        pixels: new Uint32Array(image.data.buffer),
        startX: e.clientX,
        startY: e.clientY,
        base,
        tolerance: base,
      };
      dragRef.current = drag;
      drawWandPreview(drag);
      const at = pointIn(turnRef.current, wrap.getBoundingClientRect(), e.clientX, e.clientY);
      setWandReadout({ x: at.x - wrap.clientLeft, y: at.y - wrap.clientTop, tolerance: base });
      return;
    }
    if (active === "select") {
      dragRef.current = { kind: "rect", x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else {
      const path = new Path2D();
      path.moveTo(p.x, p.y);
      dragRef.current = { kind: "lasso", pts: [p], path };
    }
    ensureLoop();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drawing.current && !drag) {
      // A mouse gets the dropper's magnifier just hovering, before it clicks.
      if (styleRef.current.tool === "dropper" && !spaceRef.current) {
        const p = devicePoint(e);
        if (onSheet(p) && (e.target === e.currentTarget || e.target === canvasRef.current)) showLoupe(e, p.x, p.y);
        else hideLoupe();
      }
      return;
    }
    e.preventDefault();

    if (drag?.kind === "dropper") {
      const p = devicePoint(e);
      drag.x = p.x;
      drag.y = p.y;
      showLoupe(e, p.x, p.y);
      return;
    }

    if (drag?.kind === "pan") {
      // The sheet follows the hand on screen, whichever way the window faces.
      const shove = unturn(turnRef.current, e.clientX - drag.startX, e.clientY - drag.startY);
      applyView(clampView(viewRef.current.z, drag.origX + shove.x, drag.origY + shove.y));
      return;
    }

    if (drag?.kind === "wand") {
      // Measured on screen, so right and down mean more however the window is
      // turned. One flood a frame at most, from the latest tolerance.
      const along = (e.clientX - drag.startX + (e.clientY - drag.startY)) * WAND_DRAG_RATE;
      const tolerance = clamp(Math.round(drag.base + along), 0, 255);
      if (tolerance === drag.tolerance) return;
      drag.tolerance = tolerance;
      if (wandFrameRef.current === null) {
        wandFrameRef.current = requestAnimationFrame(() => {
          wandFrameRef.current = null;
          drawWandPreview(drag);
          if (wandReadoutRef.current) wandReadoutRef.current.textContent = `Tolerance ${drag.tolerance}`;
        });
      }
      return;
    }

    const p = devicePoint(e);
    if (drawing.current) {
      strokeTo(p.x / dprRef.current, p.y / dprRef.current);
      return;
    }
    if (!drag) return;
    if (drag.kind === "rect") {
      drag.x1 = p.x;
      drag.y1 = p.y;
    } else if (drag.kind === "lasso") {
      // A pointer can report many moves inside one pixel. Keeping only the
      // ones that got somewhere holds the point count — and with it the cost
      // of drawing the line and of filling the shape it makes — down.
      const prev = drag.pts[drag.pts.length - 1];
      const step = Math.max(1, dprRef.current / viewRef.current.z);
      if (Math.abs(p.x - prev.x) >= step || Math.abs(p.y - prev.y) >= step) {
        drag.pts.push(p);
        drag.path.lineTo(p.x, p.y);
      }
    } else {
      const sel = selRef.current;
      if (!sel) return;
      if (!drag.moved) {
        drag.moved = true;
        liftSelection();
      }
      sel.x = drag.origX + (p.x - drag.startX);
      sel.y = drag.origY + (p.y - drag.startY);
      dirtyRef.current = true;
    }
  };

  const endStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;

    if (drawing.current) {
      drawing.current = false;
      last.current = null;
      persist();
      return;
    }
    if (!drag) return;
    if (drag.kind === "pan") setPanning(spaceRef.current);
    else if (drag.kind === "dropper") {
      hideLoupe();
      if (e.type !== "pointercancel") pickColorAt(drag.x, drag.y);
    } else if (drag.kind === "wand") {
      // The real selection, once, at wherever the drag let go — and that
      // tolerance is kept for the next press.
      if (wandFrameRef.current !== null) {
        cancelAnimationFrame(wandFrameRef.current);
        wandFrameRef.current = null;
      }
      const previewCanvas = wandPreviewRef.current;
      if (previewCanvas) {
        previewCanvas.style.display = "none";
        previewCanvas.width = 1;
        previewCanvas.height = 1;
      }
      selectLevels(drag.level, drag.w, drag.h, drag.tolerance);
      wandToleranceRef.current = drag.tolerance;
      setWandReadout(null);
    } else if (drag.kind === "rect") selectRect(drag.x0, drag.y0, drag.x1, drag.y1);
    else if (drag.kind === "lasso") selectLasso(drag.pts);
    else if (drag.moved) persist();
    // A Shift-add whose new shape came to nothing leaves the old one selected.
    addToRef.current = null;
  };

  // ---- keyboard ---------------------------------------------------------

  const undo = useCallback(() => {
    if (!undoRef.current.length) return;
    selRef.current = null;
    const shot = snapshot();
    if (shot) redoRef.current.push(shot);
    restoreShot(undoRef.current.pop()!);
    emitStatus();
    persist();
  }, [emitStatus, persist, restoreShot, snapshot]);

  const redo = useCallback(() => {
    if (!redoRef.current.length) return;
    selRef.current = null;
    const shot = snapshot();
    if (shot) undoRef.current.push(shot);
    restoreShot(redoRef.current.pop()!);
    emitStatus();
    persist();
  }, [emitStatus, persist, restoreShot, snapshot]);

  const selectAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    commitSelection();
    const mask = makeCanvas(canvas.width, canvas.height);
    const mctx = ctxOf(mask, true);
    mctx.fillStyle = "#000000";
    mctx.fillRect(0, 0, mask.width, mask.height);
    setSelection(makeSelection(mask, 0, 0));
  }, [commitSelection, makeSelection, setSelection]);

  const cut = useCallback(() => {
    if (!selRef.current) return;
    copy();
    eraseSelection();
  }, [copy, eraseSelection]);

  /** Arrow keys: shift the selection a pixel, or the view if there isn't one. */
  const nudge = (dx: number, dy: number, far: boolean) => {
    const sel = selRef.current;
    const step = far ? 10 : 1;
    if (sel) {
      liftSelection();
      sel.x += dx * step * dprRef.current;
      sel.y += dy * step * dprRef.current;
      dirtyRef.current = true;
      return;
    }
    const v = viewRef.current;
    applyView(clampView(v.z, v.x - dx * step * 8, v.y - dy * step * 8));
  };

  /**
   * WASD walks the view about the picture for as long as the keys are held,
   * smoothly rather than in the jumps a key's own repeat would give. Directions
   * are the screen's, however the window is turned.
   */
  const walkKeysRef = useRef(new Set<string>());
  const walkFastRef = useRef(false);
  const walkFrameRef = useRef<number | null>(null);
  const walkAtRef = useRef(0);

  const walkStep = (time: number) => {
    const held = walkKeysRef.current;
    if (!held.size) {
      walkFrameRef.current = null;
      return;
    }
    const dt = Math.min(50, Math.max(0, time - walkAtRef.current));
    walkAtRef.current = time;
    const across = (held.has("d") ? 1 : 0) - (held.has("a") ? 1 : 0);
    const down = (held.has("s") ? 1 : 0) - (held.has("w") ? 1 : 0);
    const step = unturn(turnRef.current, across, down);
    const distance = ((walkFastRef.current ? 3 : 1) * WALK_SPEED * dt) / 1000;
    const v = viewRef.current;
    applyView(clampView(v.z, v.x - step.x * distance, v.y - step.y * distance));
    walkFrameRef.current = requestAnimationFrame(walkStep);
  };

  const stopWalking = () => {
    walkKeysRef.current.clear();
    if (walkFrameRef.current !== null) cancelAnimationFrame(walkFrameRef.current);
    walkFrameRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // With Adjust colors open, Enter is OK and Escape is Cancel. Its sliders
    // keep their own arrow keys; anything else pressed over the picture lands
    // the adjustment first.
    if (adjustRef.current) {
      if (key === "escape" || key === "enter") {
        e.preventDefault();
        finishAdjust(key === "enter");
        return;
      }
      if ((e.target as HTMLElement).closest("[data-paint-panel]")) return;
      finishAdjust(true);
    }

    if (key === " ") {
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setPanning(true);
      }
      return;
    }

    // Zoom on the bare keys. Ctrl+= and friends are the browser's own, and it
    // won't hand them over, so taking them here would zoom the page as well.
    if (!mod && (key === "+" || key === "=")) {
      e.preventDefault();
      zoomBy(ZOOM_STEP);
      return;
    }
    if (!mod && (key === "-" || key === "_")) {
      e.preventDefault();
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    if (!mod && key === "0") {
      e.preventDefault();
      zoomReset();
      return;
    }

    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === "c") {
      e.preventDefault();
      copy();
      return;
    }
    if (mod && key === "x") {
      e.preventDefault();
      cut();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      if (styleRef.current.tool === "pencil" || styleRef.current.tool === "dropper") {
        commandsRef.current.setTool("select");
      }
      selectAll();
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      commitSelection();
      return;
    }
    if (mod && key === "s") {
      e.preventDefault();
      commandsRef.current.requestSave();
      return;
    }
    if (mod && key === "o") {
      e.preventDefault();
      commandsRef.current.requestOpen();
      return;
    }
    if (mod && key === "v") {
      // Left for the paste event, which carries the system clipboard's picture;
      // if nothing arrives, fall back to what paint.exe copied itself.
      return;
    }
    if (mod) return;

    if (key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown") {
      e.preventDefault();
      // The arrows go the way they point on screen, however the window is turned.
      const step = unturn(
        turnRef.current,
        key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0,
        key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0,
      );
      nudge(step.x, step.y, e.shiftKey);
      return;
    }
    if (key === "[" || key === "]") {
      e.preventDefault();
      commandsRef.current.cycleBrush(key === "]" ? 1 : -1);
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (!selRef.current) return;
      e.preventDefault();
      eraseSelection();
      return;
    }
    if (key === "escape" && selRef.current) {
      e.preventDefault();
      commitSelection();
      return;
    }
    if (key === "w" || key === "a" || key === "s" || key === "d") {
      e.preventDefault();
      walkFastRef.current = e.shiftKey;
      walkKeysRef.current.add(key);
      if (walkFrameRef.current === null) {
        walkAtRef.current = performance.now();
        walkFrameRef.current = requestAnimationFrame(walkStep);
      }
      return;
    }

    if (key === "g") {
      e.preventDefault();
      startGrab();
      return;
    }

    const picked = TOOL_KEYS[key];
    if (picked) {
      e.preventDefault();
      commandsRef.current.setTool(picked);
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const key = e.key.toLowerCase();
    if (key === "w" || key === "a" || key === "s" || key === "d") {
      walkKeysRef.current.delete(key);
      return;
    }
    if (key === "shift") walkFastRef.current = false;
    if (e.key !== " ") return;
    spaceRef.current = false;
    if (dragRef.current?.kind !== "pan") setPanning(false);
  };

  // ---- sheet-wide actions ----------------------------------------------

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return false;
    selRef.current = null;
    pushUndo();
    fillBackground(ctx, canvas.width, canvas.height);
    emitStatus();
    return true;
  }, [emitStatus, fillBackground, pushUndo]);

  useImperativeHandle(
    ref,
    () =>
      settleFirst({
        clear: () => {
          if (clear()) persist();
        },
        // A blank sheet is the window's again, whatever size the last picture was.
        newFile: () => {
          const wrap = wrapRef.current;
          if (!wrap) return;
          commitSelection();
          nameRef.current = UNTITLED;
          undoRef.current = [];
          redoRef.current = [];
          sheetRef.current.locked = false;
          applySheet(
            Math.max(1, Math.floor(wrap.clientWidth)),
            Math.max(1, Math.floor(wrap.clientHeight)),
            window.devicePixelRatio || 1,
            false,
          );
          applyView(clampView(1, 0, 0));
          restoredRef.current = true;
          emitStatus();
          persist();
        },
        // The sheet becomes the picture: its own size, one sheet pixel per pixel
        // it arrived with, shown whole to start with however big that is. Opening
        // is a new document rather than an edit, so it starts the undo stack over.
        openFile: async (file: File) => {
          const url = URL.createObjectURL(file);
          try {
            const img = await loadImage(url);
            const wrap = wrapRef.current;
            if (!wrap) return false;
            commitSelection();
            const fit = Math.min(1, MAX_SHEET / img.width, MAX_SHEET / img.height);
            const w = Math.max(1, Math.round(img.width * fit));
            const h = Math.max(1, Math.round(img.height * fit));
            undoRef.current = [];
            redoRef.current = [];
            sheetRef.current.locked = true;
            applySheet(w, h, 1, false);
            ctxRef.current?.drawImage(img, 0, 0, w, h);
            nameRef.current = asPngName(file.name);
            restoredRef.current = true;
            applyView(clampView(Math.min(1, wrap.clientWidth / w, wrap.clientHeight / h), 0, 0));
            emitStatus();
            persist();
            return true;
          } catch {
            window.alert(`paint.exe can't open ${file.name} — it doesn't look like a picture.`);
            return false;
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        save: () =>
          new Promise((resolve) => {
            commitSelection();
            const canvas = canvasRef.current;
            if (!canvas) return resolve(null);
            const sheet = isUpright(turnRef.current) ? canvas : turnedCopy(canvas, turnRef.current);
            sheet.toBlob((blob) => resolve(blob ? { blob, name: nameRef.current } : null), "image/png");
          }),
        undo,
        redo,
        cut,
        copy,
        paste,
        grab: () => startGrabRef.current(),
        deleteSelection: eraseSelection,
        selectAll,
        deselect: commitSelection,
        zoomIn: () => zoomBy(ZOOM_STEP),
        zoomOut: () => zoomBy(1 / ZOOM_STEP),
        zoomReset,
        adjustColors: () => startAdjustRef.current(),
      }, () => finishAdjustRef.current(true)),
    [
      applySheet,
      applyView,
      clampView,
      clear,
      commitSelection,
      emitStatus,
      copy,
      cut,
      eraseSelection,
      paste,
      persist,
      redo,
      selectAll,
      undo,
      zoomBy,
      zoomReset,
    ],
  );

  // ---- right-click menu -----------------------------------------------

  /**
   * What the picture's right-click menu was opened on: where on screen, which
   * sheet pixel, and what could be done at that moment. It's a snapshot —
   * nothing about the sheet changes while the menu is up.
   */
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    sheetX: number;
    sheetY: number;
    onSheet: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Over the Adjust colors box, the browser's own menu is fine.
    if ((e.target as HTMLElement).closest("[data-paint-panel]")) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || drawing.current || dragRef.current) return;
    finishAdjustRef.current(true);
    const at = pointIn(turnRef.current, canvas.getBoundingClientRect(), e.clientX, e.clientY);
    const scale = dprRef.current / viewRef.current.z;
    const sheetX = at.x * scale;
    const sheetY = at.y * scale;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      sheetX,
      sheetY,
      onSheet: sheetX >= 0 && sheetY >= 0 && sheetX < canvas.width && sheetY < canvas.height,
      canUndo: undoRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
      hasSelection: selRef.current !== null,
    });
  };

  const menuItems = (m: NonNullable<typeof menu>): ContextMenuItem[] => [
    { label: "Undo", shortcut: "Ctrl+Z", disabled: !m.canUndo, onClick: undo },
    { label: "Redo", shortcut: "Ctrl+Y", disabled: !m.canRedo, onClick: redo },
    "separator",
    { label: "Cut", shortcut: "Ctrl+X", disabled: !m.hasSelection, onClick: cut },
    { label: "Copy", shortcut: "Ctrl+C", disabled: !m.hasSelection, onClick: copy },
    // From the menu, it lands where the menu was opened.
    {
      label: "Paste",
      shortcut: "Ctrl+V",
      disabled: CLIPBOARD === null,
      onClick: () => paste(m.onSheet ? { x: m.sheetX, y: m.sheetY } : undefined),
    },
    { label: "Delete", shortcut: "Del", disabled: !m.hasSelection, onClick: eraseSelection },
    { label: <>Grab from the page&hellip;</>, shortcut: "G", onClick: startGrab },
    "separator",
    {
      label: "Select all",
      shortcut: "Ctrl+A",
      onClick: () => {
        if (styleRef.current.tool === "pencil" || styleRef.current.tool === "dropper") {
          commandsRef.current.setTool("select");
        }
        selectAll();
      },
    },
    { label: "Deselect", shortcut: "Esc", disabled: !m.hasSelection, onClick: commitSelection },
    { label: <>Adjust colors&hellip;</>, disabled: !m.hasSelection, onClick: startAdjust },
    { label: "Pick this color", disabled: !m.onSheet, onClick: () => pickColorAt(m.sheetX, m.sheetY) },
    "separator",
    { label: "Rotate", onClick: () => commandsRef.current.rotate() },
    { label: "Flip vertical", onClick: () => commandsRef.current.flipVertical() },
    { label: "Flip horizontal", onClick: () => commandsRef.current.flipHorizontal() },
  ];

  const cursor = panning
    ? "grab"
    : tool === "dropper"
      ? "copy"
      : tool === "pencil"
        ? "crosshair"
        : "cell";

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      // Keys let go of while the picture wasn't listening would walk forever.
      onBlur={stopWalking}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={() => {
        if (dragRef.current?.kind !== "dropper") hideLoupe();
      }}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
        border: "2px solid",
        borderColor: "#808080 #ffffff #ffffff #808080",
        background: MAT,
        overflow: "hidden",
        outline: "none",
        touchAction: "none",
        // The pencil and the dropper only work on the sheet; the rest work on
        // the mat round it as well.
        cursor: panning || (tool !== "pencil" && tool !== "dropper") ? cursor : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "block",
          cursor,
          transformOrigin: "0 0",
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          // Blown up, the sheet should show its pixels rather than smudge them.
          imageRendering: view.z > 1 ? "pixelated" : "auto",
        }}
      />
      <canvas
        ref={wandPreviewRef}
        aria-hidden
        style={{
          display: "none",
          position: "absolute",
          left: 0,
          top: 0,
          pointerEvents: "none",
          transformOrigin: "0 0",
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          imageRendering: "pixelated",
        }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      />
      {wandReadout && (
        <div
          ref={wandReadoutRef}
          aria-live="polite"
          style={{
            position: "absolute",
            left: wandReadout.x + 12,
            top: wandReadout.y + 12,
            padding: "1px 4px",
            background: "#ffffe1",
            border: "1px solid #000000",
            fontSize: 11,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          Tolerance {wandReadout.tolerance}
        </div>
      )}
      {map && (
        <div
          ref={mapHolderRef}
          // Shown and hidden from the draw loop: there is nothing to navigate
          // while the whole sheet is on screen.
          style={{
            display: "none",
            position: "absolute",
            right: 6,
            bottom: 6,
            padding: 2,
            background: "#c0c0c0",
            border: "2px solid",
            borderColor: "#ffffff #808080 #808080 #ffffff",
            boxShadow: "1px 1px 0 rgba(0, 0, 0, 0.35)",
            cursor: "default",
          }}
        >
          <canvas
            ref={mapRef}
            aria-label="Navigator: drag to move about the picture"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              mapDragRef.current = true;
              mapTo(e);
            }}
            onPointerMove={(e) => {
              if (!mapDragRef.current) return;
              e.preventDefault();
              mapTo(e);
            }}
            onPointerUp={(e) => {
              mapDragRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              mapDragRef.current = false;
            }}
            style={{ display: "block", touchAction: "none", cursor: "pointer" }}
          />
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="paint.exe" items={menuItems(menu)} onDismiss={closeMenu} />
      )}
      {grabbing && <PaintGrabOverlay onGrab={finishGrab} onCancel={endGrab} />}
      {adjusting && <PaintAdjustPanel onChange={previewAdjust} onDone={(keep) => finishAdjustRef.current(keep)} />}
      <div
        ref={loupeRef}
        aria-hidden
        style={{
          display: "none",
          position: "absolute",
          left: 0,
          top: 0,
          padding: 2,
          background: "#c0c0c0",
          border: "2px solid",
          borderColor: "#ffffff #808080 #808080 #ffffff",
          boxShadow: "1px 1px 0 rgba(0, 0, 0, 0.35)",
          pointerEvents: "none",
        }}
      >
        <canvas
          ref={loupeCanvasRef}
          style={{ display: "block", border: "1px solid", borderColor: "#808080 #ffffff #ffffff #808080" }}
        />
        <div
          ref={loupeLabelRef}
          style={{
            marginTop: 2,
            paddingLeft: 4,
            borderLeft: "12px solid transparent",
            fontSize: 11,
            lineHeight: "14px",
          }}
        />
      </div>
    </div>
  );
});

export default PaintWindow;
