"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem, Separator } from "react95";
import { Z } from "@/constants/zIndex";
import { Layout, WindowAction, WindowId } from "@/components/windows/windowTypes";
import { PROGRAMS } from "@/components/windows/programs";

export type TaskbarItem = {
  id: WindowId;
  layout: Layout;
};

// A button is never allowed narrower than it takes to read what's on it: a
// short title on the desktop, just the icon on a phone. Past that the windows
// that don't fit go into the overflow menu instead of squeezing every button
// down to a letter and an ellipsis.
const READABLE_W = 104;
const ICON_W = 34;
const MAX_W = 160;
const GAP = 3;
const OVERFLOW_W = 30;
// Matches the phone breakpoint the rest of the taskbar uses.
const COMPACT_QUERY = "(max-width: 560px)";

type ContextMenuState = { id: WindowId; x: number; y: number };

/**
 * The right-click menu on a taskbar button — the window's own controls, plus
 * Center to fetch it back into the middle of the desktop. It opens where you
 * clicked and nudges itself back inside the screen if that would run it off an
 * edge.
 */
function TaskContextMenu({
  menu,
  layout,
  onAction,
  onDismiss,
}: {
  menu: ContextMenuState;
  layout: Layout;
  onAction: (action: WindowAction) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [at, setAt] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 4;
    const { width, height } = el.getBoundingClientRect();
    setAt({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin)),
    });
  }, [menu.x, menu.y]);

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

  const items: { action: WindowAction; label: string; disabled: boolean }[] = [
    { action: "restore", label: "Restore", disabled: layout === "normal" },
    { action: "minimize", label: "Minimize", disabled: layout === "minimized" },
    { action: "maximize", label: "Maximize", disabled: layout === "maximized" },
    { action: "center", label: "Center", disabled: false },
  ];

  const item = (action: WindowAction, label: string, disabled: boolean) => (
    <MenuListItem
      key={action}
      role="menuitem"
      size="sm"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onAction(action);
        onDismiss();
      }}
    >
      {label}
    </MenuListItem>
  );

  return (
    <MenuList
      ref={ref}
      role="menu"
      aria-label={`${PROGRAMS[menu.id].title} window`}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: at.left, top: at.top, zIndex: Z.START_MENU, minWidth: 140 }}
    >
      {items.map(({ action, label, disabled }) => item(action, label, disabled))}
      <Separator />
      {item("close", "Close", false)}
    </MenuList>
  );
}

/**
 * One button per open window, in the order they were opened. The focused
 * window's button is held in; everything else — minimized or just behind —
 * stands out. Clicking is the desktop's business: the same button both puts a
 * window away and fetches it back.
 *
 * When there are more windows than fit, the ones that don't go into a "»"
 * menu at the end of the strip, listed by name. The window you're in always
 * keeps its place on the bar itself.
 */
export default function TaskbarButtons({
  tasks,
  focused,
  onTaskClick,
  onTaskAction,
}: {
  tasks: TaskbarItem[];
  focused: WindowId | null;
  onTaskClick: (id: WindowId) => void;
  onTaskAction: (id: WindowId, action: WindowAction) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Right-click (or a long press on a phone) opens the window's menu where the
  // pointer is, in place of the browser's own.
  const openContextMenu = (id: WindowId) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const minW = compact ? ICON_W : READABLE_W;
  const fits = (room: number) => Math.max(0, Math.floor((room + GAP) / (minW + GAP)));

  // Before the strip has been measured, show everything rather than nothing.
  let shown = tasks;
  let hidden: TaskbarItem[] = [];
  if (width > 0 && fits(width) < tasks.length) {
    const room = fits(width - OVERFLOW_W - GAP);
    shown = tasks.slice(0, room);
    // The focused window stays on the bar: it swaps in for the last button that
    // would have been shown, and the rest keep their opening order.
    if (focused && room > 0 && !shown.some((t) => t.id === focused)) {
      const keep = new Set([...shown.slice(0, room - 1).map((t) => t.id), focused]);
      shown = tasks.filter((t) => keep.has(t.id));
    }
    const onBar = new Set(shown.map((t) => t.id));
    hidden = tasks.filter((t) => !onBar.has(t.id));
  }

  // Nothing left to overflow — there's no menu of nothing to show.
  const overflowOpen = menuOpen && hidden.length > 0;

  return (
    <div
      ref={rootRef}
      style={{
        // Takes what room is left between Start and the tray — its own contents
        // never push it wider, which is what keeps the search box whole.
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: GAP,
        marginLeft: 4,
        marginRight: 4,
        position: "relative",
      }}
    >
      {shown.map((task) => {
        const held = focused === task.id && task.layout !== "minimized";
        return (
          <Button
            key={task.id}
            active={held}
            onClick={() => onTaskClick(task.id)}
            onContextMenu={openContextMenu(task.id)}
            title={PROGRAMS[task.id].title}
            aria-label={PROGRAMS[task.id].title}
            style={{
              // Equal shares of the strip, the way the real taskbar divides it.
              flex: compact ? `0 0 ${ICON_W}px` : "1 1 0",
              minWidth: minW,
              maxWidth: compact ? ICON_W : MAX_W,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: compact ? "center" : "flex-start",
              gap: 5,
              padding: compact ? 0 : "0 6px",
              overflow: "hidden",
              fontWeight: held ? "bold" : "normal",
            }}
          >
            <img
              src={PROGRAMS[task.id].icon}
              width={16}
              height={16}
              alt=""
              aria-hidden
              style={{ flex: "0 0 auto", imageRendering: "pixelated" }}
            />
            {!compact && (
              <span
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                }}
              >
                {PROGRAMS[task.id].title}
              </span>
            )}
          </Button>
        );
      })}

      {hidden.length > 0 && (
        <Button
          active={overflowOpen}
          onClick={() => setMenuOpen(!overflowOpen)}
          title={`${hidden.length} more window${hidden.length === 1 ? "" : "s"}`}
          aria-label={`${hidden.length} more window${hidden.length === 1 ? "" : "s"}`}
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
          style={{ flex: `0 0 ${OVERFLOW_W}px`, width: OVERFLOW_W, minWidth: OVERFLOW_W, height: 30, padding: 0, fontWeight: "bold" }}
        >
          »
        </Button>
      )}

      {contextMenu && tasks.some((t) => t.id === contextMenu.id) && (
        <TaskContextMenu
          menu={contextMenu}
          layout={tasks.find((t) => t.id === contextMenu.id)!.layout}
          onAction={(action) => onTaskAction(contextMenu.id, action)}
          onDismiss={closeContextMenu}
        />
      )}

      {overflowOpen && (
        <MenuList
          role="menu"
          style={{ position: "absolute", top: "100%", right: 0, zIndex: Z.START_MENU, minWidth: 180 }}
        >
          {hidden.map((task) => (
            <MenuListItem
              key={task.id}
              role="menuitem"
              size="sm"
              onClick={() => {
                onTaskClick(task.id);
                setMenuOpen(false);
              }}
              onContextMenu={openContextMenu(task.id)}
              style={{ gap: 8, justifyContent: "flex-start" }}
            >
              <img src={PROGRAMS[task.id].icon} width={16} height={16} alt="" aria-hidden style={{ imageRendering: "pixelated" }} />
              <span>{PROGRAMS[task.id].title}</span>
              {task.layout === "minimized" && <span style={{ marginLeft: "auto", opacity: 0.6 }}>minimized</span>}
            </MenuListItem>
          ))}
        </MenuList>
      )}
    </div>
  );
}
