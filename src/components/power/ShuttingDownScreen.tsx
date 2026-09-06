"use client";

import React, { useMemo } from "react";

function useTypewriter(text: string, msPerChar = 14) {
  const [i, setI] = React.useState(0);

  React.useEffect(() => {
    const t = window.setTimeout(() => setI((p) => Math.min(p + 1, text.length)), msPerChar);
    return () => window.clearTimeout(t);
  }, [i, text, msPerChar]);

  return text.slice(0, i);
}

export default function ShuttingDownScreen({ version }: { version: string }) {
  const lines = useMemo(
    () =>
      [
        `mrwrOS v${version || "0.1"}`,
        "Saving session...",
        "Stopping services: ok",
        "Syncing disks... done",
        "",
        "Powering off.",
      ].join("\n"),
    [version]
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
