import React from "react";

/*
 * player.exe's toolbar glyphs, shared so every play, pause and stop button on
 * the desktop draws the same thing: flat black on a 12px grid, square-edged so
 * they stay crisp like Windows 95's. Drawn rather than typed — ▶ ⏸ ⏹ are
 * characters a font draws in its own weight, and phones turn several of them
 * into colour emoji.
 */

/** `scale` draws the same 12px glyph at a whole multiple, still pixel-crisp. */
export function Glyph({ children, scale = 1 }: { children: React.ReactNode; scale?: number }) {
  return (
    <svg
      width={12 * scale}
      height={12 * scale}
      viewBox="0 0 12 12"
      aria-hidden
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/* Transport. Prev, stop and next sit on the same 8×8 footprint as pause — a
   bar and a stepped triangle either side of centre, mirrored between prev and
   next — so a row of them reads as one. */
export const PrevIcon = () => (
  <Glyph>
    <path d="M2 2h2v8H2z" fill="currentColor" />
    <path d="M6 5h1v2H6zM7 4h1v4H7zM8 3h1v6H8zM9 2h1v8H9z" fill="currentColor" />
  </Glyph>
);

export const StopIcon = () => (
  <Glyph>
    <path d="M2 2h8v8H2z" fill="currentColor" />
  </Glyph>
);

export const NextIcon = () => (
  <Glyph>
    <path d="M2 2h1v8H2zM3 3h1v6H3zM4 4h1v4H4zM5 5h1v2H5z" fill="currentColor" />
    <path d="M8 2h2v8H8z" fill="currentColor" />
  </Glyph>
);

export const PlayIcon = () => (
  <Glyph>
    <path d="M3 1h1v10H3zM4 2h1v8H4zM5 3h1v6H5zM6 4h1v4H6zM7 5h1v2H7z" fill="currentColor" />
  </Glyph>
);

export const PauseIcon = () => (
  <Glyph>
    <path d="M2 2h3v8H2zM7 2h3v8H7z" fill="currentColor" />
  </Glyph>
);

/* What's playing: a strip of film for a video, a quaver for sound — on a
   playlist row at 1×, on the player's screen bigger. */
export const FilmIcon = ({ scale }: { scale?: number }) => (
  <Glyph scale={scale}>
    {/* Sprocket holes and two frames cut out, so it reads on a selected row too. */}
    <path
      d="M2 1h8v10H2zM3 2h1v1H3zM3 4h1v1H3zM3 6h1v1H3zM3 8h1v1H3zM8 2h1v1H8zM8 4h1v1H8zM8 6h1v1H8zM8 8h1v1H8zM5 2h2v3H5zM5 6h2v3H5z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </Glyph>
);

export const NoteIcon = ({ scale }: { scale?: number }) => (
  <Glyph scale={scale}>
    <path d="M6 1h1v8H6zM7 2h1v1H7zM8 3h1v1H8zM8 4h1v2H8zM3 8h3v1H3zM2 9h4v1H2zM3 10h2v1H3z" fill="currentColor" />
  </Glyph>
);

/* Something that won't play. */
export const WarningIcon = ({ scale }: { scale?: number }) => (
  <Glyph scale={scale}>
    <path
      d="M5 1h2v1H5zM4 2h4v2H4zM3 4h6v2H3zM2 6h8v2H2zM1 8h10v2H1zM0 10h12v1H0zM5 3h2v4H5zM5 8h2v1H5z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </Glyph>
);
