"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuList, MenuListItem, Separator } from "react95";
import { Z } from "@/constants/zIndex";

export type ContextMenuItem =
  | {
      label: React.ReactNode;
      /** Shown faintly at the right, the way Windows lists a shortcut. */
      shortcut?: string;
      disabled?: boolean;
      onClick: () => void;
    }
  | "separator";

/**
 * A right-click menu in the desktop's own style, opened at a point on the
 * screen. It goes to the top of the page rather than inside whatever was
 * clicked, so it stands upright and unclipped even over a window that's been
 * turned on its side, and it nudges itself back on screen near an edge. A pick,
 * a press anywhere else, Escape, or the page losing focus closes it.
 */
export default function ContextMenu({
  x,
  y,
  label,
  items,
  onDismiss,
}: {
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [at, setAt] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 4;
    const { width, height } = el.getBoundingClientRect();
    setAt({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // Capture, so a press on a window (which the window then claims) still
    // closes the menu first.
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  return createPortal(
    <MenuList
      ref={ref}
      role="menu"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: at.left, top: at.top, zIndex: Z.START_MENU, minWidth: 160 }}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <Separator key={index} />
        ) : (
          <MenuListItem
            key={index}
            role="menuitem"
            size="sm"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onDismiss();
              item.onClick();
            }}
          >
            <span style={{ flex: "1 1 auto", textAlign: "left" }}>{item.label}</span>
            {item.shortcut && <span style={{ marginLeft: 18, opacity: 0.7 }}>{item.shortcut}</span>}
          </MenuListItem>
        ),
      )}
    </MenuList>,
    document.body,
  );
}
