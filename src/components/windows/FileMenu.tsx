"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem } from "react95";

export type FileMenuItem = {
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
  /** Set on rows that are a choice, ticked when they're the one in force. */
  checked?: boolean;
  onClick: () => void;
};

/**
 * A flat toolbar drop-down: a button that opens a MenuList of plain rows,
 * closing on pick, on mouse-out, or on a click anywhere else. Named "File"
 * unless told otherwise; rows carrying `checked` get a tick column.
 */
export default function FileMenu({ name = "File", items }: { name?: string; items: FileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasChecks = items.some((item) => item.checked !== undefined);

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
        aria-label={name}
        title={name}
        onClick={() => setOpen((prev) => !prev)}
      >
        {name}
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
                role={item.checked === undefined ? undefined : "menuitemradio"}
                aria-checked={item.checked}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick();
                  setOpen(false);
                }}
              >
                {hasChecks && (
                  <span
                    aria-hidden
                    style={{
                      width: 12,
                      marginRight: 6,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 12px",
                    }}
                  >
                    {item.checked && (
                      <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                        <path d="M0 4l1-1 2 2 4-4 1 1-5 5z" fill="currentColor" />
                      </svg>
                    )}
                  </span>
                )}
                <span style={{ flex: "1 1 auto", textAlign: "left" }}>{item.label}</span>
              </MenuListItem>
            ))}
          </MenuList>
        </div>
      )}
    </div>
  );
}
