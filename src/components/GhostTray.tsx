"use client";

import React, { useSyncExternalStore } from "react";
import { Frame } from "react95";
import { GhostArrow } from "@/components/GhostCursors";
import { ghostStatusStore, setGhostsEnabled } from "@/lib/ghosts";

/**
 * The taskbar's count of other visitors here right now, whose pointers
 * GhostCursors draws. Click it to stop seeing them (and stop being one);
 * click again to come back. Only there while a ghost is out on the desktop.
 */
export default function GhostTray() {
  const { enabled, others, visible } = useSyncExternalStore(
    ghostStatusStore.subscribe,
    ghostStatusStore.get,
    ghostStatusStore.onServer,
  );
  if (!visible || others === null) return null;

  const label = enabled
    ? `${others} other visitor${others === 1 ? "" : "s"} here — click to hide their cursors`
    : "Other visitors' cursors are hidden — click to show them";
  const toggle = () => setGhostsEnabled(!enabled);

  return (
    <Frame
      variant="status"
      role="button"
      tabIndex={0}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 30,
        padding: "0 6px",
        marginRight: 6,
        flex: "0 0 auto",
        cursor: "pointer",
        userSelect: "none",
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <GhostArrow color={enabled ? "#fff" : "#c0c0c0"} />
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: "bold", minWidth: "1ch" }}>
        {enabled ? others : "off"}
      </span>
    </Frame>
  );
}
