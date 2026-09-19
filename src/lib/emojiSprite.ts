const cache = new Map<string, HTMLCanvasElement | null>();

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/**
 * An emoji drawn once into its own little canvas, so a canvas full of them is
 * a pile of cheap drawImage calls rather than a pile of fillText calls laying
 * out a colour glyph every frame.
 *
 * Rendered generously large and scaled down at the draw site, which keeps it
 * sharp on hi-dpi screens without re-rasterising per size.
 */
export function emojiSprite(emoji: string, px = 72): HTMLCanvasElement | null {
  const key = `${emoji}@${px}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  // Glyphs routinely overflow their nominal em box, so the tile is padded.
  const size = Math.ceil(px * 1.3);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cache.set(key, null);
    return null;
  }

  ctx.font = `${px}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2);

  cache.set(key, canvas);
  return canvas;
}
