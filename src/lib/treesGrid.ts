/**
 * A bucket grid over the trees' map positions, so a view zoomed in on a few
 * streets walks the trees in those streets rather than all million of them.
 */
export type TreeGrid = {
  /** Cell size, metres. */
  cell: number;
  cols: number;
  rows: number;
  /** Cell c's trees are items[start[c] .. start[c + 1]), in index order. */
  start: Uint32Array;
  items: Uint32Array;
  /** Each tree's cell. */
  cellOf: Uint32Array;
  /** The widest crown, metres: how far a tree can reach past its own cell. */
  reach: number;
};

/** Cells of about a city block: few enough to walk all of when zoomed out, small enough to cull well zoomed in. */
const CELL = 100;

export function buildGrid(
  mx: Float32Array,
  my: Float32Array,
  radius: Float32Array,
  widthM: number,
  heightM: number,
): TreeGrid {
  const n = mx.length;
  const cols = Math.max(1, Math.ceil(widthM / CELL));
  const rows = Math.max(1, Math.ceil(heightM / CELL));
  const cellOf = new Uint32Array(n);
  const start = new Uint32Array(cols * rows + 1);
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const col = Math.min(cols - 1, Math.max(0, (mx[i] / CELL) | 0));
    const row = Math.min(rows - 1, Math.max(0, (my[i] / CELL) | 0));
    const c = row * cols + col;
    cellOf[i] = c;
    start[c + 1]++;
    if (radius[i] > reach) reach = radius[i];
  }
  for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
  // A counting sort into cells; walking i upward keeps each cell in index order.
  const fill = start.slice(0, cols * rows);
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
  return { cell: CELL, cols, rows, start, items, cellOf, reach };
}

/**
 * The cells a world rectangle (metres) touches, as inclusive [col0, row0, col1,
 * row1]; col0 > col1 or row0 > row1 when it misses the grid altogether.
 */
export function gridSpan(g: TreeGrid, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  return [
    Math.max(0, Math.floor(x0 / g.cell)),
    Math.max(0, Math.floor(y0 / g.cell)),
    Math.min(g.cols - 1, Math.floor(x1 / g.cell)),
    Math.min(g.rows - 1, Math.floor(y1 / g.cell)),
  ];
}
