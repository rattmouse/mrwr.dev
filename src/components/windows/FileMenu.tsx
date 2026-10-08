"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem } from "react95";

export type FileMenuItem = {
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
  /** Set on rows that are a choice, ticked when they're the one in force. */
  checked?: boolean;
  /** A row that opens a submenu of its own to the right, on hover or click, rather than doing anything. */
  items?: FileMenuItem[];
  onClick?: () => void;
};

/**
 * A toolbar drop-down: a button that opens a MenuList of plain rows, closing
 * on pick, on mouse-out, or on a click anywhere else. Named "File" unless told
 * otherwise; rows carrying `checked` get a tick column, and rows carrying
 * `items` open a submenu beside them.
 */
export default function FileMenu({ name = "File", items }: { name?: string; items: FileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  // Which row's submenu is out, and how far down the list that row sits.
  const [sub, setSub] = useState<{ index: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setSub(null);
  };

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !(rootRef.current?.contains(target) ?? false)) {
        setOpen(false);
        setSub(null);
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
        onClick={() => {
          setOpen((prev) => !prev);
          setSub(null);
        }}
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
          onMouseLeave={close}
        >
          <MenuRows
            items={items}
            subOpen={sub?.index ?? null}
            onSub={(index, row) => setSub(index === null || !row ? null : { index, top: row.offsetTop })}
            onPick={close}
          />
          {sub && items[sub.index]?.items && (
            <div style={{ position: "absolute", left: "calc(100% - 4px)", top: sub.top - 2, width: "max-content" }}>
              <MenuRows items={items[sub.index].items!} subOpen={null} onSub={() => {}} onPick={close} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MARK: React.CSSProperties = {
  width: 12,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 12px",
};

/** One list of rows: ticks where they're choices, an arrow where they open a submenu. */
function MenuRows({
  items,
  subOpen,
  onSub,
  onPick,
}: {
  items: FileMenuItem[];
  subOpen: number | null;
  onSub: (index: number | null, row: HTMLElement | null) => void;
  onPick: () => void;
}) {
  const hasChecks = items.some((item) => item.checked !== undefined);
  return (
    <MenuList style={{ marginTop: 0 }}>
      {items.map((item, index) => (
        <MenuListItem
          key={index}
          size="sm"
          title={item.title}
          disabled={item.disabled}
          role={item.checked === undefined ? undefined : "menuitemradio"}
          aria-checked={item.checked}
          aria-haspopup={item.items ? "menu" : undefined}
          aria-expanded={item.items ? subOpen === index : undefined}
          // Hovering another row puts any open submenu away, or opens this row's.
          onMouseEnter={(event) => onSub(item.items && !item.disabled ? index : null, event.currentTarget)}
          onClick={(event) => {
            if (item.disabled) return;
            // Hovering has usually opened it already; a click keeps it open rather than undoing that.
            if (item.items) {
              onSub(index, event.currentTarget);
              return;
            }
            item.onClick?.();
            onPick();
          }}
        >
          {hasChecks && (
            <span aria-hidden style={{ ...MARK, marginRight: 6 }}>
              {item.checked && (
                <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                  <path d="M0 4l1-1 2 2 4-4 1 1-5 5z" fill="currentColor" />
                </svg>
              )}
            </span>
          )}
          <span style={{ flex: "1 1 auto", textAlign: "left" }}>{item.label}</span>
          {item.items && (
            <span aria-hidden style={{ ...MARK, marginLeft: 12 }}>
              <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                <path d="M2 1l4 3-4 3z" fill="currentColor" />
              </svg>
            </span>
          )}
        </MenuListItem>
      ))}
    </MenuList>
  );
}
