"use client";

import React, { useEffect, useRef, useState } from "react";
import StartMenu from "@/components/StartMenu";
import ProgramWindow from "@/components/windows/ProgramWindow";
import DocumentWindow from "@/components/windows/DocumentWindow";
import { GitChangeEntry } from "@/lib/gitChanges.types";
import { Layout, WindowId, isDocumentWindow, isProgramWindow } from "@/components/windows/windowTypes";

type HomeDesktopProps = {
  gitChanges: GitChangeEntry[];
};

export default function HomeDesktop({ gitChanges }: HomeDesktopProps) {
  const [activeWindow, setActiveWindow] = useState<WindowId | null>("welcome");
  const [layout, setLayout] = useState<Layout>("normal");
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
          gitChanges={gitChanges}
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
        openWindow={(id) => {
          setActiveWindow(id);
          setLayout("normal");
        }}
      />
    </main>
  );
}
