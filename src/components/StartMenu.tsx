"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppBar, Button, MenuList, MenuListItem, Separator, Toolbar } from "react95";
import { Z } from "@/constants/zIndex";
import { Sizes } from "react95/dist/types";
import { usePower } from "@/components/power/PowerProvider";
import { WindowAction, WindowId } from "@/components/windows/windowTypes";
import { MenuFolder, WINDOW_IDS, programDef } from "@/components/windows/programs";
import SearchBox from "@/components/SearchBox";
import TaskbarButtons, { PAD_RING, TaskbarItem } from "@/components/TaskbarButtons";
import PerfMeter from "@/components/PerfMeter";
import type { SearchHistorySession } from "@/lib/searchHistory.types";
import { holdPad, useGamepad } from "@/lib/gamepad";

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
  /** Where a game controller has got to, from this level down: its item here, then the submenu's. */
  padPath?: number[] | null;
};

/**
 * The desktop worked from a game controller: either along the taskbar (`at`:
 * 0 is Start, then each window's button) or down through the Start menu, one
 * index per level open.
 */
type Shell = { row: "bar"; at: number } | { row: "menu"; path: number[] } | null;

const isSeparator = (item: MenuItem): item is MenuSeparator => "separator" in item;

const hasSubmenu = (item: MenuItem): item is MenuParentItem =>
  "submenu" in item && Array.isArray(item.submenu) && item.submenu.length > 0;

/** Can the pad land on it: not a separator, not greyed out. */
const landable = (item: MenuItem | undefined) => !!item && !isSeparator(item) && !item.disabled;

/** The next item from `from` that can be landed on, `step` at a time and round the end. */
function stepIn(items: MenuItem[], from: number, step: 1 | -1): number {
  for (let k = 1; k <= items.length; k++) {
    const i = (((from + step * k) % items.length) + items.length) % items.length;
    if (landable(items[i])) return i;
  }
  return from;
}

/** The menu's own highlight, for an item a pad is on rather than a mouse. */
const PAD_HIGHLIGHT: React.CSSProperties = { background: "#000080", color: "#ffffff" };

/**
 * A nested submenu that keeps itself on screen: it opens to the right of its
 * parent item by default, but flips to the left when that would run past the
 * right edge of the window, and nudges up when it would run past the bottom.
 */
function Submenu({
  items,
  onLeafClick,
  depth = 0,
  padPath,
  onMouseEnter,
}: MenuLevelProps & { onMouseEnter?: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{
    side: "left" | "right";
    shiftY: number;
  }>({ side: "right", shiftY: 0 });

  useLayoutEffect(() => {
    function place() {
      const el = ref.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;

      const margin = 8;
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      // Flip to the left only if the submenu overflows the right edge and it
      // actually fits on the left; otherwise leave it where it is.
      const overflowsRight = rect.right > window.innerWidth - margin;
      const fitsLeft = parentRect.left - rect.width >= margin;
      const side: "left" | "right" = overflowsRight && fitsLeft ? "left" : "right";

      // Pull the menu up if its bottom is past the viewport, but never above
      // the top edge.
      const overflowY = rect.bottom - (window.innerHeight - margin);
      const shiftY = overflowY > 0 ? -Math.min(overflowY, rect.top - margin) : 0;

      setPlacement((prev) =>
        prev.side === side && prev.shiftY === shiftY ? prev : { side, shiftY },
      );
    }

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [items, depth]);

  return (
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      style={{
        position: "absolute",
        top: placement.shiftY,
        ...(placement.side === "left" ? { right: "100%" } : { left: "100%" }),
        zIndex: Z.START_SUBMENU,
      }}
    >
      <MenuLevel items={items} onLeafClick={onLeafClick} depth={depth} padPath={padPath} />
    </div>
  );
}



/**
 * Data shape:
 * - label: string
 * - disabled?: boolean
 * - separator?: boolean
 * - onClick?: () => void   // only for leaf items
 * - submenu?: MenuItem[]   // nested items
 */
function MenuLevel({ items, onLeafClick, depth = 0, padPath }: MenuLevelProps) {
  const [mouseSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const menuWidth = depth === 0 ? 200 : 160;
  // A pad working the menu decides what's open; otherwise the mouse does.
  const padAt = padPath?.length ? padPath[0] : null;
  const openSubmenu = padPath ? (padPath.length > 1 ? padAt : null) : mouseSubmenu;

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
              style={padAt === idx ? PAD_HIGHLIGHT : undefined}
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
              <Submenu
                items={item.submenu}
                onLeafClick={onLeafClick}
                depth={depth + 1}
                padPath={padPath ? padPath.slice(1) : null}
                onMouseEnter={() => setOpenSubmenu(idx)}
              />
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
  onOpenSearch,
  tasks = [],
  focused = null,
  onTaskClick,
  onTaskAction,
}: {
  openWindow: (id: WindowId) => void;
  searchHistory?: SearchHistorySession[];
  onOpenSearch?: (session: SearchHistorySession, text: string) => void;
  tasks?: TaskbarItem[];
  focused?: WindowId | null;
  onTaskClick?: (id: WindowId) => void;
  onTaskAction?: (id: WindowId, action: WindowAction) => void;
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

  // Every window listed in a folder, in the order programs.ts gives them.
  const listed = (folder: MenuFolder): MenuLeafItem[] =>
    WINDOW_IDS.flatMap((id) => {
      const def = programDef(id);
      return def.menu?.folder === folder
        ? [{ label: def.menu.label, icon: def.icon, size: "sm" as Sizes, onClick: () => pick(id) }]
        : [];
    });
  const folder = (label: string, id: MenuFolder): MenuParentItem => ({
    label,
    icon: "../w95_programs.ico",
    size: "sm",
    submenu: listed(id),
  });

  const menuItems = [
    {
      label: "Documents",
      size: "lg",
      icon: "../w95_documents.ico",
      submenu: listed("documents"),
    },
    {
      label: "Programs",
      icon: "../w95_programs.ico",
      size: "lg",
      submenu: [...listed("programs"), folder("App", "app"), folder("Tools", "tools"), folder("Toys", "toys")],
    },
    { separator: true },
    { label: "Shut Down...", icon: "../w95_shutdown.ico", size: "lg", onClick: handleShutdown },
  ] satisfies MenuItem[];

  // A game controller: Back is the Windows key, opening the Start menu with
  // the pad on its first item. Up and down step through a menu, right or A
  // opens a submenu, A on a program opens it, left or B backs out a level. B
  // out of the menu itself lands on the Start button, and from there left and
  // right walk the taskbar, A fetching or putting away that window. Back, or B
  // on the taskbar, hands the pad back to the windows. A copy of the site in a
  // frame — the computer in cubicles.exe — leaves Back to the cubicle.
  const [shell, setShellState] = useState<Shell>(null);
  const shellRef = useRef<Shell>(null);
  const setShell = (next: Shell) => {
    shellRef.current = next;
    // Taken here, not in an effect, so not one frame of the pad reaches a window in between.
    holdPad(next !== null);
    setShellState(next);
    setOpen(next?.row === "menu");
  };
  useEffect(() => () => holdPad(false), []);
  const framed = typeof window !== "undefined" && window.self !== window.top;

  useGamepad(
    !framed,
    (pad) => {
      const now = shellRef.current;
      const top = stepIn(menuItems, -1, 1);
      if (pad.pressed("Back")) {
        setShell(now ? null : { row: "menu", path: [top] });
        return;
      }
      if (!now) return;

      if (now.row === "bar") {
        const count = tasks.length + 1;
        const at = Math.min(now.at, count - 1);
        if (pad.nav === "left" || pad.nav === "right") {
          setShell({ row: "bar", at: (at + (pad.nav === "right" ? 1 : -1) + count) % count });
        } else if (pad.pressed("B")) {
          setShell(null);
        } else if (at === 0 && (pad.pressed("A") || pad.nav === "down")) {
          setShell({ row: "menu", path: [top] });
        } else if (at > 0 && pad.pressed("A")) {
          setShell(null);
          onTaskClick?.(tasks[at - 1].id);
        }
        return;
      }

      // Down through the menu to the level the pad is on.
      const path = now.path;
      let level: MenuItem[] = menuItems;
      for (const i of path.slice(0, -1)) level = (level[i] as MenuParentItem).submenu;
      const here = path[path.length - 1];
      const item = level[here];
      if (pad.nav === "up" || pad.nav === "down") {
        setShell({ row: "menu", path: [...path.slice(0, -1), stepIn(level, here, pad.nav === "down" ? 1 : -1)] });
      } else if (item && hasSubmenu(item) && !item.disabled && (pad.nav === "right" || pad.pressed("A"))) {
        setShell({ row: "menu", path: [...path, stepIn(item.submenu, -1, 1)] });
      } else if (item && !hasSubmenu(item) && !isSeparator(item) && !item.disabled && pad.pressed("A")) {
        setShell(null);
        item.onClick?.();
      } else if (pad.nav === "left" || pad.pressed("B")) {
        setShell(path.length > 1 ? { row: "menu", path: path.slice(0, -1) } : { row: "bar", at: 0 });
      }
    },
    true,
  );

  // Close on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (
        e.target instanceof Node &&
        !rootRef.current.contains(e.target)
      ) {
        setOpen(false);
        // The mouse is back; the pad lets go of the desktop.
        if (shellRef.current) {
          shellRef.current = null;
          holdPad(false);
          setShellState(null);
        }
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <AppBar style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: Z.TASKBAR }}>
      <Toolbar style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <div ref={rootRef} style={{ position: "relative", display: "inline-block", flex: "0 0 auto" }}>
          <Button
            onClick={() => setOpen((v) => !v)}
            active={open}
            style={{
              fontWeight: "bold",
              ...(shell?.row === "bar" && Math.min(shell.at, tasks.length) === 0 ? PAD_RING : null),
            }}
          >
            Start
          </Button>

          {open && (
            <div style={{ position: "absolute", left: 0, top: "100%" }}>
              <MenuLevel
                items={menuItems}
                onLeafClick={() => setOpen(false)}
                padPath={shell?.row === "menu" ? shell.path : null}
              />
            </div>
          )}
        </div>

        <TaskbarButtons
          tasks={tasks}
          focused={focused}
          onTaskClick={(id) => onTaskClick?.(id)}
          onTaskAction={(id, action) => onTaskAction?.(id, action)}
          padAt={shell?.row === "bar" && shell.at > 0 ? (tasks[Math.min(shell.at, tasks.length) - 1]?.id ?? null) : null}
        />

        <PerfMeter windowCount={tasks.length} />

        <SearchBox history={searchHistory} onOpen={onOpenSearch} />
      </Toolbar>
    </AppBar>
  );
}
