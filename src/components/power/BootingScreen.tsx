"use client";

import React, { useMemo } from "react";

function useTypewriter(text: string, msPerChar = 10, linePauseMs = 250) {
  const [i, setI] = React.useState(0);

  React.useEffect(() => {
    const nextChar = text[i];
    const delay = nextChar === "\n" ? linePauseMs : msPerChar;

    const t = window.setTimeout(() => setI((p) => Math.min(p + 1, text.length)), delay);
    return () => window.clearTimeout(t);
  }, [i, text, msPerChar, linePauseMs]);

  return text.slice(0, i);
}

export default function BootingScreen() {
  const lines = useMemo(
    () =>
      [
        "mrwrOS bootloader v0.1",
        "Checking memory... ok",
        "Loading desktop... ok",
        "",
        "Starting UI...",
      ].join("\n"),
    []
  );

  const typed = useTypewriter(lines);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "black",
        color: "#cfcfcf",
        zIndex: 999999,
        padding: 24,
        fontFamily: "monospace",
        fontSize: 14,
        lineHeight: 1.5,
        userSelect: "none",
      }}
      role="presentation"
    >
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{typed}</pre>
    </div>
  );
}
