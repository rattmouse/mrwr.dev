"use client";

import React, { useEffect, useRef, useState } from "react";
import { AppBar, Button, MenuList, MenuListItem, Separator, Toolbar, TextInput } from "react95";
import { Z } from "@/constants/zIndex";

/**
 * Data shape:
 * - label: string
 * - disabled?: boolean
 * - separator?: boolean
 * - onClick?: () => void   // only for leaf items
 * - submenu?: MenuItem[]   // nested items
 */
function MenuLevel({ items, onLeafClick, depth = 0 }) {
  const [openSubmenu, setOpenSubmenu] = useState(null);

  return (
    <MenuList
      style={{ minWidth: 140, zIndex: Z.START_MENU }}
      onMouseLeave={() => setOpenSubmenu(null)}
    >
      {items.map((item, idx) => {
        if (item.separator) return <Separator key={`sep-${depth}-${idx}`} />;

        const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;

        return (
          <div
            key={`${depth}-${idx}-${item.label ?? "item"}`}
            style={{ position: "relative" }}
          >
            <MenuListItem
              disabled={item.disabled}
              onMouseEnter={() => hasSubmenu && setOpenSubmenu(idx)}
              onClick={() => {
                // Leaf click: run handler and close everything
                if (!hasSubmenu && !item.disabled) {
                  item.onClick?.();
                  onLeafClick();
                }
              }}
            >
              {item.label}
              <span>
              {hasSubmenu ? " ▶" : ""}
              </span>
            </MenuListItem>

            {hasSubmenu && openSubmenu === idx && (
              <div
                style={{
                  position: "absolute",
                  left: "100%",
                  top: 0,
                  zIndex: Z.START_SUBMENU
                }}
                onMouseEnter={() => setOpenSubmenu(idx)}
              >
                <MenuLevel
                  items={item.submenu}
                  onLeafClick={onLeafClick}
                  depth={depth + 1}
                />
              </div>
            )}
          </div>
        );
      })}
    </MenuList>
  );
}

export default function StartMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function onDocMouseDown(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Define your menu here (keep adding!)
  const menuItems = [
    {
      label: "Programs",
      submenu: [
        { label: "soon", onClick: () => console.log("soon") },
//         { label: "two", onClick: () => console.log("two") },
//         { label: "three", onClick: () => console.log("three") },
//         { label: "four", onClick: () => console.log("four") },
//         { label: "five", onClick: () => console.log("five") },
      ],
    },
    {
      label: "Documents",
      submenu: [
        { label: "soon", onClick: () => console.log("soon") },
//         { label: "two", onClick: () => console.log("two") },
//         { label: "three", onClick: () => console.log("three") },
//         { label: "four", onClick: () => console.log("four") },
//         { label: "five", onClick: () => console.log("five") },
      ],
    },
    { separator: true },
    { label: "Shut Down...", disabled: true, onClick: () => console.log("Shutdown") },
  ];

  return (
    <AppBar style={{ zIndex: Z.TASKBAR }}>
      <Toolbar style={{ justifyContent: "space-between" }}>
        <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
          <Button
            onClick={() => setOpen((v) => !v)}
            active={open}
            style={{ fontWeight: "bold" }}
          >
            Start
          </Button>

          {open && (
            <div style={{ position: "absolute", left: 0, top: "100%"}}>
              <MenuLevel items={menuItems} onLeafClick={() => setOpen(false)} />
            </div>
          )}
        </div>

        <TextInput placeholder="Search..." width={150} />
      </Toolbar>
    </AppBar>
  );
}
