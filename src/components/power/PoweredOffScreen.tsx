"use client";

import React, { useEffect } from "react";
import { usePower } from "./PowerProvider";

export default function PoweredOffScreen() {
  const { powerOn } = usePower();

  useEffect(() => {
    const onKeyDown = () => powerOn();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [powerOn]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "black",
        zIndex: 999999,
      }}
      onMouseDown={() => powerOn()}
      role="presentation"
    />
  );
}
