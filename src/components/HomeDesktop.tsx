"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import StartMenu from "@/components/StartMenu";
import ProgramWindow from "@/components/windows/ProgramWindow";
import DocumentWindow from "@/components/windows/DocumentWindow";
import { NotepadIncoming } from "@/components/windows/NotepadWindow";
import { VersionEntry } from "@/lib/versions.types";
import { SearchHistorySession, SearchIssueLink } from "@/lib/searchHistory.types";
import { Layout, WindowAction, WindowBox, WindowId, isDocumentWindow, isProgramWindow } from "@/components/windows/windowTypes";
import { usePower } from "@/components/power/PowerProvider";
import { clearDesktop, loadDesktop, saveDesktop } from "@/lib/desktopStorage";

type HomeDesktopProps = {
  versions: VersionEntry[];
  searchHistory: SearchHistorySession[];
};

/**
 * One window on the desktop. The array they live in is the stacking order —
 * first is furthest back, last is on top — and focusing a window moves it to
 * the end of that array. That order only ever becomes a z-index, though: the
 * windows are drawn in the order they were opened, so bringing one forward
 * never moves it in the page. Moving it would restart it (an iframe reloads,
 * a dragged window forgets where it was put) instead of just raising it.
 */
export type OpenWindow = {
  id: WindowId;
  layout: Layout;
  /** Which step of the cascade this window opened on, so two don't land flush. */
  cascade: number;
  /** Where it was dragged and how big it was made; null until it's first moved. */
  box: WindowBox | null;
};

// How far each window in the cascade steps down and right from the one before,
// and how many steps there are before it starts over at the middle again.
const CASCADE_STEP = 26;
const CASCADE_WRAP = 6;
// The taskbar across the top of the desktop.
const TASKBAR_H = 50;

type Desktop = {
  windows: OpenWindow[];
  focused: WindowId | null;
};

// Raising a window is moving it to the back of the list — the desktop draws them
// in order, so the last one drawn is the one on top.
function raise(windows: OpenWindow[], id: WindowId): OpenWindow[] {
  const found = windows.find((w) => w.id === id);
  if (!found) return windows;
  return [...windows.filter((w) => w.id !== id), found];
}

// Whatever is left on top once a window goes away — or goes quiet — takes the
// focus. Anything sent to the taskbar is passed over, and an empty desktop has
// nothing to give it to.
function topmost(windows: OpenWindow[]): WindowId | null {
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    if (windows[i].layout !== "minimized") return windows[i].id;
  }
  return null;
}

export default function HomeDesktop({ versions, searchHistory }: HomeDesktopProps) {
  // The open windows and which one has the focus are one piece of state: every
  // change to the desktop touches both (opening focuses, closing hands the
  // focus on), and keeping them together means they can never disagree.
  const [desktop, setDesktop] = useState<Desktop>({
    windows: [{ id: "welcome", layout: "normal", cascade: 0, box: null }],
    focused: "welcome",
  });
  const { windows, focused } = desktop;
  // Where the next window opened will sit in the cascade. It only ever counts
  // up, so closing a window doesn't shuffle the ones still open.
  const cascadeSeed = useRef(1);
  const { state: power } = usePower();

  // Pick up the desktop where the last visit left it. The page is prerendered
  // with just the welcome window, so the saved one can only be read once it's
  // in the browser — before the first paint, so there's no flash of the wrong
  // desktop.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const saved = loadDesktop();
    if (!saved) return;
    cascadeSeed.current = saved.windows.reduce((max, w) => Math.max(max, w.cascade + 1), 1);
    setDesktop(saved);
  }, []);

  // Remember every change — but not the untouched desktop the page first drew,
  // which would land on top of the save before it had been read back. Once
  // Shut Down starts, the save is wiped and stays wiped, so powering on again
  // starts from a clean desktop.
  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      return;
    }
    if (power === "on") saveDesktop(desktop);
  }, [desktop, power]);

  useEffect(() => {
    if (power === "shuttingDown" || power === "off") clearDesktop();
  }, [power]);

  const setWindowBox = useCallback((id: WindowId, box: WindowBox) => {
    setDesktop((state) => ({
      ...state,
      windows: state.windows.map((w) => (w.id === id ? { ...w, box } : w)),
    }));
  }, []);

  // A picked past search, waiting to land in Notepad or the Issues tree; each
  // window clears its own once it's on screen.
  const [notepadDoc, setNotepadDoc] = useState<NotepadIncoming | null>(null);
  const [issueReveal, setIssueReveal] = useState<SearchIssueLink | null>(null);
  const [phoneOrientation, setPhoneOrientation] = useState<"portrait" | "landscape">("landscape");
  const [rotationCount, setRotationCount] = useState(0);
  const orientationRef = useRef<"portrait" | "landscape">("landscape");

  useEffect(() => {
    const getOrientation = (): "portrait" | "landscape" => {
      if (typeof window === "undefined") return "landscape";
      return window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
    };

    let raf = 0;
    const syncOrientation = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const next = getOrientation();
        if (orientationRef.current !== next) {
          if (orientationRef.current) {
            setRotationCount((count) => count + 1);
          }
          orientationRef.current = next;
          setPhoneOrientation(next);
        }
      });
    };

    syncOrientation();
    window.addEventListener("resize", syncOrientation, { passive: true });
    window.addEventListener("orientationchange", syncOrientation, { passive: true });
    screen.orientation?.addEventListener("change", syncOrientation);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
      screen.orientation?.removeEventListener("change", syncOrientation);
    };
  }, []);

  const focusWindow = useCallback((id: WindowId) => {
    setDesktop((state) => ({ windows: raise(state.windows, id), focused: id }));
  }, []);

  // A program is only ever open once: asking for one that's already up brings
  // it forward (and back off the taskbar) rather than opening a second copy.
  const openWindow = useCallback((id: WindowId) => {
    setDesktop((state) => {
      if (state.windows.some((w) => w.id === id)) {
        const woken = state.windows.map((w) =>
          w.id === id && w.layout === "minimized" ? { ...w, layout: "normal" as Layout } : w,
        );
        return { windows: raise(woken, id), focused: id };
      }
      const cascade = cascadeSeed.current;
      cascadeSeed.current += 1;
      return {
        windows: [...state.windows, { id, layout: "normal" as Layout, cascade, box: null }],
        focused: id,
      };
    });
  }, []);

  // Bring up the window a picked search lands in. If it's already open, leave
  // its size and place alone — just pull it off the taskbar and raise it so the
  // new content is visible.
  const showWindow = openWindow;

  // A search that became an issue opens on that issue; any other goes to
  // Notepad — added to the end of the page if Notepad is already open,
  // otherwise as a fresh page.
  const openSearch = (session: SearchHistorySession, text: string) => {
    if (session.issue) {
      setIssueReveal(session.issue);
      showWindow("issues");
    } else {
      setNotepadDoc({
        text,
        name: "search.txt",
        append: windows.some((w) => w.id === "notepad"),
      });
      showWindow("notepad");
    }
  };

  const clearNotepadDoc = useCallback(() => setNotepadDoc(null), []);
  const clearIssueReveal = useCallback(() => setIssueReveal(null), []);

  const closeWindow = useCallback((id: WindowId) => {
    setDesktop((state) => {
      const windows = state.windows.filter((w) => w.id !== id);
      return { windows, focused: state.focused === id ? topmost(windows) : state.focused };
    });
  }, []);

  const minimizeWindow = useCallback((id: WindowId) => {
    setDesktop((state) => {
      const windows = state.windows.map((w) =>
        w.id === id ? { ...w, layout: "minimized" as Layout } : w,
      );
      return { windows, focused: state.focused === id ? topmost(windows) : state.focused };
    });
  }, []);

  const toggleMaximize = useCallback((id: WindowId) => {
    setDesktop((state) => ({
      windows: raise(
        state.windows.map((w) =>
          w.id === id ? { ...w, layout: w.layout === "maximized" ? "normal" : "maximized" } : w,
        ),
        id,
      ),
      focused: id,
    }));
  }, []);

  // Put a window square in the middle of the desktop — the space under the
  // taskbar — at the size it is now, back on screen and in front. The handy
  // way to fetch a window that's been left hanging off an edge.
  const centerWindow = useCallback((id: WindowId) => {
    setDesktop((state) => ({
      windows: raise(
        state.windows.map((w) => {
          if (w.id !== id) return w;
          // Not laid out yet: dropping the box lets it be centred and pinned
          // afresh.
          if (!w.box) return { ...w, layout: "normal" as Layout };
          const width = Math.min(w.box.width, window.innerWidth - 16);
          const height = Math.min(w.box.height, window.innerHeight - TASKBAR_H - 16);
          return {
            ...w,
            layout: "normal" as Layout,
            box: {
              width,
              height,
              left: Math.round((window.innerWidth - width) / 2),
              top: Math.round(TASKBAR_H + (window.innerHeight - TASKBAR_H - height) / 2),
            },
          };
        }),
        id,
      ),
      focused: id,
    }));
  }, []);

  const setLayout = useCallback((id: WindowId, layout: Layout) => {
    setDesktop((state) => ({
      windows: raise(
        state.windows.map((w) => (w.id === id ? { ...w, layout } : w)),
        id,
      ),
      focused: id,
    }));
  }, []);

  const taskAction = useCallback(
    (id: WindowId, action: WindowAction) => {
      if (action === "restore") setLayout(id, "normal");
      else if (action === "maximize") setLayout(id, "maximized");
      else if (action === "minimize") minimizeWindow(id);
      else if (action === "center") centerWindow(id);
      else closeWindow(id);
    },
    [setLayout, minimizeWindow, centerWindow, closeWindow],
  );

  // What the taskbar button does, which is what it does in Windows 95: clicking
  // the window you're already in puts it away, clicking any other brings it up.
  const toggleFromTaskbar = useCallback(
    (id: WindowId) => {
      const target = windows.find((w) => w.id === id);
      if (!target) return;
      if (target.layout !== "minimized" && focused === id) minimizeWindow(id);
      else openWindow(id);
    },
    [windows, focused, minimizeWindow, openWindow],
  );

  // The order things were opened in. The desktop draws the windows in it, and
  // the taskbar lays its buttons out in it — a button that moved every time you
  // used it would be impossible to aim at.
  const taskOrder = useMemo(() => [...windows].sort((a, b) => a.cascade - b.cascade), [windows]);
  const taskbarItems = useMemo(() => taskOrder.map((w) => ({ id: w.id, layout: w.layout })), [taskOrder]);

  return (
    <main
      data-phone-orientation={phoneOrientation}
      data-phone-rotation-count={rotationCount}
      // Clipped at the screen's edge: windows now stay where they were put when
      // the browser shrinks, and one left hanging past the edge mustn't make
      // the whole page scroll sideways (a phone widens its layout to fit it).
      style={{ width: "100dvw", height: "100dvh", position: "relative", overflow: "hidden" }}
    >
      {taskOrder.map((w) => {
        const shared = {
          layout: w.layout,
          box: w.box,
          onBoxChange: (box: WindowBox) => setWindowBox(w.id, box),
          stackIndex: windows.indexOf(w),
          active: focused === w.id,
          onFocus: () => focusWindow(w.id),
          cascadeX: (w.cascade % CASCADE_WRAP) * CASCADE_STEP,
          cascadeY: (w.cascade % CASCADE_WRAP) * CASCADE_STEP,
          onClose: () => closeWindow(w.id),
          onMinimize: () => minimizeWindow(w.id),
          onToggleMaximize: () => toggleMaximize(w.id),
        };

        if (isProgramWindow(w.id)) {
          return (
            <ProgramWindow
              key={w.id}
              id={w.id}
              {...shared}
              versions={versions}
              notepadDoc={notepadDoc}
              onNotepadDocApplied={clearNotepadDoc}
              issueReveal={issueReveal}
              onIssueRevealed={clearIssueReveal}
              onOpenWindow={openWindow}
            />
          );
        }

        if (isDocumentWindow(w.id)) {
          return <DocumentWindow key={w.id} id={w.id} {...shared} />;
        }

        return null;
      })}

      <StartMenu
        searchHistory={searchHistory}
        openWindow={openWindow}
        onOpenSearch={openSearch}
        tasks={taskbarItems}
        focused={focused}
        onTaskClick={toggleFromTaskbar}
        onTaskAction={taskAction}
      />
    </main>
  );
}
