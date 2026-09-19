import manifest from "@/data/guys.json";

export type GuySheet = {
  image: HTMLImageElement;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  count: number;
};

let pending: Promise<GuySheet | null> | null = null;

/**
 * The little painted figures interface.exe can draw in place of its dots, cut
 * out of a photographed sheet by scripts/content/make-guys-sprites.mjs.
 *
 * The sheet is ~100KB, so it is fetched the first time somebody actually asks
 * for guys and then kept for the life of the page. A failed load resolves to
 * null rather than throwing — the canvas just stays dots.
 */
export function loadGuys(): Promise<GuySheet | null> {
  if (pending) return pending;
  pending = new Promise<GuySheet | null>((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        image,
        cellWidth: manifest.cellWidth,
        cellHeight: manifest.cellHeight,
        columns: manifest.columns,
        count: manifest.count,
      });
    image.onerror = () => resolve(null);
    image.src = manifest.sheet;
  });
  return pending;
}

const tints = new Map<string, HTMLCanvasElement>();

/**
 * The figures are painted in near-black ink, which is invisible on a dark
 * canvas, so they are re-coloured to whatever the palette is set to. Each
 * colour is drawn once and kept — the brush texture lives in the sprite's
 * alpha, so filling through it leaves every stroke intact.
 */
export function tintGuys(sheet: GuySheet, color: string): HTMLCanvasElement {
  const cached = tints.get(color);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = sheet.image.naturalWidth;
  canvas.height = sheet.image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(sheet.image, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  tints.set(color, canvas);
  return canvas;
}
