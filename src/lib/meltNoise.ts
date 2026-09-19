// The displacement map behind party.webp's melting frame.
//
// The obvious way to warp the window is `feTurbulence` feeding
// `feDisplacementMap`, and that is what the frame falls back to. The catch is
// that a filter is re-run whenever anything inside the element it is applied to
// repaints — and the melting window contains a canvas redrawing itself sixty
// times a second. Procedural turbulence is the expensive primitive in that
// graph, and it produces the same pixels every time.
//
// So the noise is generated once into a tile and handed to the filter as an
// image: the same static warp, without paying to invent it each frame.

const TILE = 256;

let pending: Promise<string | null> | null = null;

/** Smooth value noise, wrapped so the tile repeats without a seam. */
function octave(field: Float32Array, cells: number, amplitude: number, random: () => number) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i += 1) grid[i] = random();

  const step = TILE / cells;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const gx = x / step;
      const gy = y / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      // Wrapping the far edge back to the near one is what makes it tileable.
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const fx = gx - x0;
      const fy = gy - y0;
      // Smoothstep, so the cells blend into blobs rather than diamonds.
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);

      const top = grid[y0 * cells + (x0 % cells)] * (1 - sx) + grid[y0 * cells + x1] * sx;
      const bottom = grid[y1 * cells + (x0 % cells)] * (1 - sx) + grid[y1 * cells + x1] * sx;
      field[y * TILE + x] += (top * (1 - sy) + bottom * sy) * amplitude;
    }
  }
}

function buildTile(): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Fixed seed: every window melts out of true the same way, and a reload
  // doesn't reshuffle a frame somebody is looking at.
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Red drives horizontal displacement and green vertical, so they get
  // independent fields; two octaves give the big soft bends a bit of grain.
  const horizontal = new Float32Array(TILE * TILE);
  const vertical = new Float32Array(TILE * TILE);
  octave(horizontal, 2, 0.74, random);
  octave(horizontal, 5, 0.26, random);
  octave(vertical, 3, 0.74, random);
  octave(vertical, 7, 0.26, random);

  const image = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i += 1) {
    image.data[i * 4] = Math.max(0, Math.min(255, Math.round(horizontal[i] * 255)));
    image.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(vertical[i] * 255)));
    // A flat blue channel keeps the map honest if anything samples it.
    image.data[i * 4 + 2] = 128;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * The warp tile as a data URL, built on first use and kept for the life of the
 * page. Resolves to null if the canvas is unavailable — the frame then warps
 * with live turbulence instead, which looks the same and costs more.
 */
export function loadMeltNoise(): Promise<string | null> {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    // Off the click that opened the panel: building the tile is a couple of
    // milliseconds, but there is no reason for it to land mid-interaction.
    const build = () => resolve(buildTile());
    if (typeof requestIdleCallback === "function") requestIdleCallback(build, { timeout: 500 });
    else window.setTimeout(build, 0);
  });
  return pending;
}
