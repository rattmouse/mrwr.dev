"use client";

import React, { useEffect, useRef, useState } from "react";
import { AppBar, Button, MenuList, MenuListItem, Separator, Toolbar } from "react95";
import { Z } from "@/constants/zIndex";
import { Sizes } from "react95/dist/types";
import { usePower } from "@/components/power/PowerProvider";
import { WindowId } from "@/components/windows/windowTypes";
import SearchBox from "@/components/SearchBox";
import type { SearchHistorySession } from "@/lib/searchHistory.types";

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
  const menuWidth = depth === 0 ? 200 : 160;

  const isSeparator = (item: MenuItem): item is MenuSeparator =>
    "separator" in item;

  const hasSubmenu = (item: MenuItem): item is MenuParentItem =>
    "submenu" in item && Array.isArray(item.submenu) && item.submenu.length > 0;

  return (
    <MenuList
      style={{ minWidth: menuWidth, zIndex: Z.START_MENU }}
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
              <span
                style={{
                  width: itemIsLarge ? 48 : 24,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                <img src={item.icon} width={itemIsLarge ? "48" : "24"} alt="" />
              </span>
              <span style={{ marginLeft: 6, flex: "1 1 auto", textAlign: "left" }}>
                {item.label}
              </span>
              <span
                aria-hidden
                style={{
                  width: 12,
                  marginLeft: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 12px",
                }}
              >
                {itemHasSubmenu ? (
                  <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                    <path d="M2 1l4 3-4 3z" fill="currentColor" />
                  </svg>
                ) : null}
              </span>
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
  searchHistory = [],
}: {
  openWindow: (id: WindowId) => void;
  searchHistory?: SearchHistorySession[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { shutdown } = usePower();

  const pick = (id: WindowId) => {
    openWindow(id);
    setOpen(false);
  };

  const handleShutdown = () => {
    shutdown();
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
          { label: "Changes", icon: "../w95_changes.ico", size: "sm", onClick: () => pick("changes") },
          { label: "REPL", icon: "../w98_repl.ico", size: "sm", onClick: () => pick("music") },
          { label: "Collections", icon: "../w98_collections_cards.ico", size: "sm", onClick: () => pick("collections") }
        ],
    },
    { separator: true },
    { label: "Shut Down...", icon: "../w95_shutdown.ico", size: "lg", onClick: handleShutdown },
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

        <SearchBox history={searchHistory} />
      </Toolbar>
    </AppBar>
  );
}
