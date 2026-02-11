"use client";

import React, { useEffect, useRef, useState } from "react";
import { AppBar, Button, MenuList, MenuListItem, Separator, Toolbar, TextInput } from "react95";
import { Z } from "@/constants/zIndex";
import { Sizes } from "react95/dist/types";
import { usePower } from "@/components/power/PowerProvider";
import { WindowId } from "@/components/windows/windowTypes";

type MenuAction = () => void;

type MenuLeafItem = {
  label: string;
  icon: string;
  size: Sizes;
  onClick?: MenuAction;
  disabled?: boolean;
};

type MenuParentItem = {
  label: string;
  icon: string;
  size: Sizes;
  submenu: MenuItem[]; // submenu can contain leaf items + separators too if you want
  disabled?: boolean;
};

type MenuSeparator = {
  separator: true;
};

type MenuItem = MenuLeafItem | MenuParentItem | MenuSeparator;

type MenuLevelProps = {
  items: MenuItem[];
  onLeafClick: (item: MenuLeafItem) => void;
  depth?: number;
};



/**
 * Data shape:
 * - label: string
 * - disabled?: boolean
 * - separator?: boolean
 * - onClick?: () => void   // only for leaf items
 * - submenu?: MenuItem[]   // nested items
 */
function MenuLevel({ items, onLeafClick, depth = 0 }: MenuLevelProps) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  const isSeparator = (item: MenuItem): item is MenuSeparator =>
    "separator" in item;

  const hasSubmenu = (item: MenuItem): item is MenuParentItem =>
    "submenu" in item && Array.isArray(item.submenu) && item.submenu.length > 0;

  return (
    <MenuList
      style={{ minWidth: 180, zIndex: Z.START_MENU }}
      onMouseLeave={() => setOpenSubmenu(null)}
    >
      {items.map((item, idx) => {
        if (isSeparator(item)) {
          return <Separator key={`sep-${depth}-${idx}`} />;
        }

        const itemHasSubmenu = hasSubmenu(item);
        const itemIsLarge = item.size === "lg";

        return (
          <div
            key={`${depth}-${idx}-${item.label}`}
            style={{ position: "relative"}}
          >
            <MenuListItem 
              size={item.size}
              disabled={item.disabled}
              onMouseEnter={() => {
                if (itemHasSubmenu) {
                  setOpenSubmenu(idx);
                  return;
                }
                setOpenSubmenu(null);
              }}
              onClick={() => {
                // Leaf click: run handler and close everything
                if (!itemHasSubmenu && !item.disabled) {
                  item.onClick?.();
                  onLeafClick(item); // <-- pass the clicked leaf item
                }
              }}
            >
              <img src={item.icon} width={itemIsLarge ? "48" : "24"}/>
              {item.label}
              <span>{itemHasSubmenu ? " >" : ""}</span>
            </MenuListItem>

            {itemHasSubmenu && openSubmenu === idx && (
              <div
                style={{
                  position: "absolute",
                  left: "100%",
                  top: 0,
                  zIndex: Z.START_SUBMENU,
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


export default function StartMenu({
  openWindow,
}: {
  openWindow: (id: WindowId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const timerRef = useRef<number | null>(null);
  const lastSentRef = useRef<string>("");
  const { shutdown } = usePower();

  const pick = (id: WindowId) => {
    openWindow(id);
    setOpen(false);
  };

  const menuItems = [
    {
      label: "Documents",
      size: "lg",
      icon: "../w95_documents.ico",
      submenu:
        [
          { label: "About", icon: "../w95_default.ico", size: "sm", onClick: () => pick("about") },
          { label: "Projects", icon: "../w95_default.ico", size: "sm", onClick: () => pick("projects") },
          { label: "Contact", icon: "../w95_default.ico", size: "sm", onClick: () => pick("contact") }
        ],
    },
    {
      label: "Programs",
      icon: "../w95_programs.ico",
      size: "lg",
      submenu:
        [
          { label: "Welcome", icon: "../w95_desktop.ico", size: "sm", onClick: () => pick("welcome") },
          { label: "Notepad", icon: "../w95_notepad.ico", size: "sm", onClick: () => pick("notepad") },
          { label: "Issues", icon: "../w98_issues.ico", size: "sm", onClick: () => pick("issues") },
          { label: "Changes", icon: "../w95_changes.ico", size: "sm", onClick: () => pick("changes") }
        ],
    },
    { separator: true },
    { label: "Shut Down...", icon: "../w95_shutdown.ico", size: "lg", onClick: () => shutdown() },
  ] satisfies MenuItem[];

  // Close on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (
        e.target instanceof Node &&
        !rootRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    // clear any pending timer
    if (timerRef.current) window.clearTimeout(timerRef.current);

    const q = query.trim();

    // don't log empty
    if (!q) return;

    // debounce: wait 600ms after the last keystroke
    timerRef.current = window.setTimeout(async () => {
      // avoid re-sending same value if nothing changed
      if (q === lastSentRef.current) return;
      lastSentRef.current = q;

      try {
        await fetch("/log-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
      } catch (err) {
        console.error("log-search failed", err);
      }
    }, 600);

    // cleanup if query changes again or component unmounts
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query]);

  return (
    <AppBar style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: Z.TASKBAR }}>
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
            <div style={{ position: "absolute", left: 0, top: "100%" }}>
              <MenuLevel items={menuItems} onLeafClick={() => setOpen(false)} />
            </div>
          )}
        </div>

        <TextInput
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          width={150} />
      </Toolbar>
    </AppBar>
  );
}
