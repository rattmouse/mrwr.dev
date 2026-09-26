"use client";

import { ThemeProvider, createGlobalStyle } from "styled-components";
import { styleReset } from "react95";
import original from "react95/dist/themes/original";

// bundled fonts from react95
import ms_sans_serif from "react95/dist/fonts/ms_sans_serif.woff2";
import ms_sans_serif_bold from "react95/dist/fonts/ms_sans_serif_bold.woff2";

const React95GlobalStyle = createGlobalStyle<{ $warped: boolean }>`
  ${styleReset}

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif}') format('woff2');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif_bold}') format('woff2');
    font-weight: bold;
    font-style: normal;
    font-display: swap;
  }

  /* --- Window control icons (Storybook-style helpers) --- */
  .minimize-icon,
  .maximize-icon,
  .close-icon {
    display: inline-block;
    width: 12px;
    height: 12px;
    position: relative;
    pointer-events: none; /* clicks should hit the Button */
  }

  .minimize-icon::after {
    content: "";
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 2px;
    height: 2px;
    background: #000;
  }

  .maximize-icon::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    right: 2px;
    bottom: 2px;
    border: 2px solid #000;
    box-sizing: border-box;
  }

  .close-icon::before,
  .close-icon::after {
    content: "";
    position: absolute;
    left: 5px;
    top: 1px;
    width: 2px;
    height: 10px;
    background: #000;
    transform-origin: center;
  }
  .close-icon::before { transform: rotate(45deg); }
  .close-icon::after  { transform: rotate(-45deg); }

  html, body {
    height: 100%;
  }

  body {
    font-family: 'ms_sans_serif', Tahoma, sans-serif;
    font-size: 12px;              /* big one: keeps spacing/menu right */
    line-height: 1.2;

    background: #008080; /* classic teal */

    /* Unsmoothed, aliased glyph edges give the crisp retro look at the size
       this font is meant for — but cubicles.exe shows this same page again,
       recursively, on a monitor warped onto the glass by a CSS matrix3d
       perspective. Aliased edges don't resample cleanly under that warp: they
       ghost and double instead of just blurring. So the page run inside that
       iframe (self !== top) gets ordinary antialiasing instead. */
    -webkit-font-smoothing: ${(p) => (p.$warped ? "antialiased" : "none")};
    -moz-osx-font-smoothing: ${(p) => (p.$warped ? "grayscale" : "auto")};
    text-rendering: ${(p) => (p.$warped ? "optimizeLegibility" : "optimizeSpeed")};

    /* Nothing on that warped copy is worth selecting, and Firefox paints a
       selection there as text wiping itself out — dragging a window left one
       behind and blanked every label on the glass. */
    user-select: ${(p) => (p.$warped ? "none" : "auto")};
  }

  input,
  textarea {
    user-select: text;
  }

  textarea {
    resize: none;
  }

`;

export default function React95Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same check cubicles.exe itself uses to know it's the one running on the
  // recursive iframe (see CubiclesWindow.tsx's nestedStore): true only for
  // the copy of the site sitting on the monitor's glass, warped by CSS.
  const warped = typeof window !== "undefined" && window.self !== window.top;
  return (
    <ThemeProvider theme={original}>
      <React95GlobalStyle $warped={warped} />
      {children}
    </ThemeProvider>
  );
}
