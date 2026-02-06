"use client";

import { ThemeProvider, createGlobalStyle } from "styled-components";
import { styleReset } from "react95";
import original from "react95/dist/themes/original";

// bundled fonts from react95
import ms_sans_serif from "react95/dist/fonts/ms_sans_serif.woff2";
import ms_sans_serif_bold from "react95/dist/fonts/ms_sans_serif_bold.woff2";

const React95GlobalStyle = createGlobalStyle`
  ${styleReset}

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif}') format('woff2');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${ms_sans_serif_bold}') format('woff2');
    font-weight: bold;
    font-style: normal;
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
    font-family: 'ms_sans_serif';
    font-size: 12px;              /* big one: keeps spacing/menu right */
    line-height: 1.2;

    background: #008080; /* classic teal */

    /* helps avoid “modern smooth” look */
    -webkit-font-smoothing: none;
    -moz-osx-font-smoothing: auto;
    text-rendering: optimizeSpeed;
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
  return (
    <ThemeProvider theme={original}>
      <React95GlobalStyle />
      {children}
    </ThemeProvider>
  );
}
