"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem } from "react95";

export type FileMenuItem = {
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
};

/**
 * A flat toolbar "File" drop-down: a button that opens a MenuList of plain
 * rows, closing on pick, on mouse-out, or on a click anywhere else.
 */
export default function FileMenu({ items }: { items: FileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !(rootRef.current?.contains(target) ?? false)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <Button
        variant="menu"
        size="sm"
        active={open}
        aria-label="File"
        title="File"
        onClick={() => setOpen((prev) => !prev)}
      >
        File
      </Button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% - 2px)",
            left: 0,
            zIndex: 1000,
            width: "max-content",
          }}
          onMouseLeave={() => setOpen(false)}
        >
          <MenuList style={{ marginTop: 0 }}>
            {items.map((item, index) => (
              <MenuListItem
                key={index}
                size="sm"
                title={item.title}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick();
                  setOpen(false);
                }}
              >
                {item.label}
              </MenuListItem>
            ))}
          </MenuList>
        </div>
      )}
    </div>
  );
}
