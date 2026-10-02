/**
 * Which way round a window has been turned: some quarter turns clockwise, and
 * whether it was mirrored left-to-right first. However Paint's rotate and flip
 * buttons are mixed, it comes out as one of these eight, so that's all a window
 * has to keep.
 *
 * On screen it is `rotate(quarter × 90°) scaleX(flip ? -1 : 1)` about the
 * window's centre. The turns below are applied the way you'd see them — a horizontal flip mirrors whatever is on screen left-to-right, however
 * it was already turned.
 */
export type Turn = { quarter: 0 | 1 | 2 | 3; flip: boolean };

export const UPRIGHT: Turn = { quarter: 0, flip: false };

const quarterOf = (n: number) => ((((Math.round(n) % 4) + 4) % 4) as Turn["quarter"]);

/** A stored turn back into one of the eight, whatever came out of storage. */
export function normalizeTurn(turn: { quarter: number; flip: boolean }): Turn {
  return { quarter: quarterOf(turn.quarter), flip: !!turn.flip };
}

export const isUpright = (turn: Turn) => turn.quarter === 0 && !turn.flip;

export const rotateRight = (turn: Turn): Turn => ({ ...turn, quarter: quarterOf(turn.quarter + 1) });
// Mirroring after a turn is the same as mirroring first and turning the other way.
export const flipHorizontal = (turn: Turn): Turn => ({ quarter: quarterOf(-turn.quarter), flip: !turn.flip });
// Upside down is mirrored left-to-right and then turned half way round.
export const flipVertical = (turn: Turn): Turn => ({ quarter: quarterOf(2 - turn.quarter), flip: !turn.flip });

/** The CSS transform for it, or undefined when there's nothing to do. */
export function turnTransform(turn: Turn | undefined): string | undefined {
  if (!turn || isUpright(turn)) return undefined;
  return `rotate(${turn.quarter * 90}deg)${turn.flip ? " scaleX(-1)" : ""}`;
}

/**
 * The turn as a 2×2 matrix [a, b, c, d] — x' = a·x + c·y, y' = b·x + d·y, the
 * same order a canvas's transform() takes. Exact, since it's only ever quarter
 * turns.
 */
export function turnMatrix(turn: Turn): [number, number, number, number] {
  const cos = [1, 0, -1, 0][turn.quarter];
  const sin = [0, 1, 0, -1][turn.quarter];
  const sx = turn.flip ? -1 : 1;
  return [cos * sx, sin * sx, -sin, cos];
}

/** Where a step of (x, y) on screen goes inside the turned window. */
export function unturn(turn: Turn, x: number, y: number): { x: number; y: number } {
  const cos = [1, 0, -1, 0][turn.quarter];
  const sin = [0, 1, 0, -1][turn.quarter];
  const sx = turn.flip ? -1 : 1;
  return { x: sx * (cos * x + sin * y), y: -sin * x + cos * y };
}

/**
 * Where a pointer is inside an element of a turned window, measured from the
 * element's own top left as if nothing were turned. The window turns about its
 * middle, which leaves each element's middle at its on-screen rect's middle, so
 * measure from there and undo the turn. Upright, it's the plain offset.
 */
export function pointIn(turn: Turn, rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  if (isUpright(turn)) return { x: clientX - rect.left, y: clientY - rect.top };
  const { w, h } = sizeIn(turn, rect);
  const p = unturn(turn, clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
  return { x: p.x + w / 2, y: p.y + h / 2 };
}

/** The element's own width and height, from its on-screen rect. */
export function sizeIn(turn: Turn, rect: DOMRect): { w: number; h: number } {
  return turn.quarter % 2 === 1 ? { w: rect.height, h: rect.width } : { w: rect.width, h: rect.height };
}

/** Where a step of (x, y) inside the turned window lands on screen. */
export function toScreen(turn: Turn, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d] = turnMatrix(turn);
  return { x: a * x + c * y, y: b * x + d * y };
}
