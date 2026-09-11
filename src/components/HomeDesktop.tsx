"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import StartMenu from "@/components/StartMenu";
import ProgramWindow from "@/components/windows/ProgramWindow";
import DocumentWindow from "@/components/windows/DocumentWindow";
import { NotepadIncoming } from "@/components/windows/NotepadWindow";
import { VersionEntry } from "@/lib/versions.types";
import { SearchHistorySession, SearchIssueLink } from "@/lib/searchHistory.types";
import { Layout, WindowId, isDocumentWindow, isProgramWindow } from "@/components/windows/windowTypes";

type HomeDesktopProps = {
  versions: VersionEntry[];
  searchHistory: SearchHistorySession[];
};

export default function HomeDesktop({ versions, searchHistory }: HomeDesktopProps) {
  const [activeWindow, setActiveWindow] = useState<WindowId | null>("welcome");
  const [layout, setLayout] = useState<Layout>("normal");
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

  const openWindow = (id: WindowId) => {
    setActiveWindow(id);
    setLayout("normal");
  };

  // Bring up the window a picked search lands in. If it's already the open
  // window, leave its size and place alone — just un-dock it so the new
  // content is visible.
  const showWindow = (id: WindowId) => {
    if (activeWindow !== id) openWindow(id);
    else if (layout === "docked") setLayout("normal");
  };

  // A search that became an issue opens on that issue; any other goes to
  // Notepad — added to the end of the page if Notepad is already open,
  // otherwise as a fresh page.
  const openSearch = (session: SearchHistorySession, text: string) => {
    if (session.issue) {
      setIssueReveal(session.issue);
      showWindow("issues");
    } else {
      setNotepadDoc({ text, name: "search.txt", append: activeWindow === "notepad" });
      showWindow("notepad");
    }
  };

  const clearNotepadDoc = useCallback(() => setNotepadDoc(null), []);
  const clearIssueReveal = useCallback(() => setIssueReveal(null), []);

  const closeWindow = () => {
    setActiveWindow(null);
    setLayout("normal");
  };

  const restoreWindow = () => setLayout("normal");
  const dockWindow = () => setLayout("docked");
  const toggleMaximize = () => setLayout((l) => (l === "maximized" ? "normal" : "maximized"));

  return (
    <main
      data-phone-orientation={phoneOrientation}
      data-phone-rotation-count={rotationCount}
      style={{ width: "100dvw", height: "100dvh", position: "relative" }}
    >
      {activeWindow && isProgramWindow(activeWindow) && (
        <ProgramWindow
          id={activeWindow}
          layout={layout}
          versions={versions}
          notepadDoc={notepadDoc}
          onNotepadDocApplied={clearNotepadDoc}
          issueReveal={issueReveal}
          onIssueRevealed={clearIssueReveal}
          onClose={closeWindow}
          onMinimize={dockWindow}
          onRestore={restoreWindow}
          onToggleMaximize={toggleMaximize}
        />
      )}

      {activeWindow && isDocumentWindow(activeWindow) && (
        <DocumentWindow
          id={activeWindow}
          layout={layout}
          onClose={closeWindow}
          onMinimize={dockWindow}
          onRestore={restoreWindow}
          onToggleMaximize={toggleMaximize}
        />
      )}

      <StartMenu
        searchHistory={searchHistory}
        openWindow={openWindow}
        onOpenSearch={openSearch}
      />
    </main>
  );
}
