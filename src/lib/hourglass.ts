/**
 * Windows 95's busy hourglass, pixel for pixel, as the animated cursor it was:
 * the sand runs through, then the glass turns over and starts again.
 *
 * A CSS cursor can't animate — a picture in `cursor` is drawn still — so the
 * hourglass is a handful of frames, and whoever shows it steps through them on
 * a timer (see `useHourglass`). A timer rather than animation frames or CSS:
 * paint.exe's Grab freezes the page while it works, and holds both of those.
 */
import { useEffect, useState } from "react";

const W = 13;
const H = 22;

/** The glass's walls, row by row: the columns of its left and right sides. */
const WALLS: Record<number, [number, number]> = {
  3: [1, 11],
  4: [1, 11],
  5: [1, 11],
  6: [2, 10],
  7: [3, 9],
  8: [4, 8],
  9: [5, 7],
  10: [5, 7],
  11: [5, 7],
  12: [4, 8],
  13: [3, 9],
  14: [2, 10],
  15: [1, 11],
  16: [1, 11],
  17: [1, 11],
  18: [1, 11],
};

/**
 * The hourglass upright, as rows: `#` is black, `.` is white, `s` is loose
 * sand and a space shows whatever is underneath. `sand` fills the glass's
 * insides (`#` or `s`, or null for empty glass); the caps top and bottom are
 * always the same.
 */
function glass(sand: (x: number, y: number) => string | null): string[] {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      if (y === 0 || y === 2 || y === H - 3 || y === H - 1) row += "#";
      else if (y === 1 || y === H - 2) row += x === 0 || x === W - 1 ? "#" : ".";
      else {
        const [left, right] = WALLS[y];
        row += x === left || x === right ? "#" : x > left && x < right ? (sand(x, y) ?? ".") : " ";
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * One moment of the sand running: the top bulb holds what's below row `top`,
 * the bottom bulb has filled up to row `heap` and settled hard at the very
 * bottom, and while it `runs` a thread falls through the neck between them.
 */
const running = (top: number, heap: number, runs: boolean) =>
  glass((x, y) => {
    if (y >= top && y <= 8) return "s";
    if (runs && x === 6 && y >= 9 && y < heap) return "#";
    if (y >= heap) return y === 18 ? "#" : "s";
    return null;
  });

// Room enough for the glass at any angle, and the middle it turns about.
const SIDE = 26;
const OFFSET_X = Math.floor((SIDE - W) / 2);
const OFFSET_Y = Math.floor((SIDE - H) / 2);
const MID_X = OFFSET_X + W / 2;
const MID_Y = OFFSET_Y + H / 2;

/**
 * The glass turned `degrees` clockwise in the middle of a square, still in
 * whole pixels so a turned frame is as crisp as an upright one. Each pixel
 * looks at sixteen points across itself and goes black if enough of them
 * land on black — enough to keep a one-pixel outline joined up at an angle —
 * else sand or white by whichever most land on, else stays see-through.
 */
function turned(rows: string[], degrees: number): string[] {
  const rad = (-degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (px: number, py: number) => {
    const dx = px - MID_X;
    const dy = py - MID_Y;
    const sx = Math.floor(MID_X + dx * cos - dy * sin + 1e-6) - OFFSET_X;
    const sy = Math.floor(MID_Y + dx * sin + dy * cos + 1e-6) - OFFSET_Y;
    return rows[sy]?.[sx] ?? " ";
  };
  const out: string[] = [];
  for (let y = 0; y < SIDE; y++) {
    let row = "";
    for (let x = 0; x < SIDE; x++) {
      let black = 0;
      let sand = 0;
      let white = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const ch = at(x + (i + 0.5) / 4, y + (j + 0.5) / 4);
          if (ch === "#") black++;
          else if (ch === "s") sand++;
          else if (ch === ".") white++;
        }
      }
      row += black >= 5 ? "#" : black + sand + white < 8 ? " " : sand > white ? "s" : ".";
    }
    out.push(row);
  }
  return out;
}

/** Every run of `ch` along each row, as one rectangle a pixel tall. */
function runs(rows: string[], ch: string) {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== ch) {
        x++;
        continue;
      }
      let end = x;
      while (row[end] === ch) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}

// Loose sand is every other grain, the way Windows dithered it grey —
// dithered last, so it stays an even grey however the glass is turned.
const settled = (rows: string[]) =>
  rows.map((row, y) => row.replace(/s/g, (_, x: number) => ((x + y) % 2 === 0 ? "#" : ".")));

function toUrl(rows: string[]) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDE}" height="${SIDE}" ` +
    `viewBox="0 0 ${SIDE} ${SIDE}" shape-rendering="crispEdges">` +
    `<path fill="#fff" d="${runs(rows, ".")}"/><path fill="#000" d="${runs(rows, "#")}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type HourglassFrame = {
  /** The frame as an image, for an <img> beside a busy message. */
  url: string;
  /** The frame as a CSS cursor, held by the middle, the browser's own wait cursor failing that. */
  cursor: string;
  /** How long it stays up, in ms. */
  ms: number;
};

const emptied = running(9, 12, false);
const FRAMES: { rows: string[]; ms: number }[] = [
  { rows: running(3, 19, false), ms: 300 },
  { rows: running(5, 17, true), ms: 300 },
  { rows: running(7, 15, true), ms: 300 },
  { rows: emptied, ms: 300 },
  // Turned over, it's full at the top again: back to the first frame.
  { rows: turned(emptied, 45), ms: 80 },
  { rows: turned(emptied, 90), ms: 80 },
  { rows: turned(emptied, 135), ms: 80 },
];

export const HOURGLASS: HourglassFrame[] = FRAMES.map(({ rows, ms }) => {
  const placed = settled(rows.length === SIDE ? rows : turned(rows, 0));
  const url = toUrl(placed);
  return { url, cursor: `url("${url}") ${SIDE / 2} ${SIDE / 2}, wait`, ms };
});

export const HOURGLASS_SIZE = { width: SIDE, height: SIDE };

/** The frame showing right now, stepping on while `busy`; the first frame otherwise. */
export function useHourglass(busy: boolean): HourglassFrame {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!busy) return;
    let frame = 0;
    let timer = 0;
    const step = () => {
      timer = window.setTimeout(() => {
        frame = (frame + 1) % HOURGLASS.length;
        setAt(frame);
        step();
      }, HOURGLASS[frame].ms);
    };
    step();
    return () => {
      window.clearTimeout(timer);
      setAt(0);
    };
  }, [busy]);
  return busy ? HOURGLASS[at] : HOURGLASS[0];
}
