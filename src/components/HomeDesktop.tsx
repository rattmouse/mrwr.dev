"use client";

import React, { useState } from "react";
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

  const closeWindow = () => {
    setActiveWindow(null);
    setLayout("normal");
  };

  const restoreWindow = () => setLayout("normal");
  const dockWindow = () => setLayout("docked");
  const toggleMaximize = () => setLayout((l) => (l === "maximized" ? "normal" : "maximized"));

  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
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
