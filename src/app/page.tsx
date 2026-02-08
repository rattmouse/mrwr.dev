"use client";

import React, { useState } from 'react';
import {
  AppBar,
  Button,
  MenuList,
  MenuListItem,
  Separator,
  TextInput,
  Toolbar,
  Window,
  WindowContent,
  WindowHeader
} from 'react95';
import styled from 'styled-components';
import StartMenu from "@/components/StartMenu";
import DesktopWindow from "@/components/windows/DesktopWindow";

type WindowId = "welcome" | "about" | "projects" | "contact";
type Layout = "normal" | "docked" | "maximized";

export default function Home() {
  const [activeWindow, setActiveWindow] = useState<WindowId | null>("welcome");
  const [layout, setLayout] = useState<Layout>("normal");

  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {activeWindow && (
        <DesktopWindow
          id={activeWindow}
          layout={layout}
          onClose={() => {
            setActiveWindow(null);
            setLayout("normal");
          }}
          onMinimize={() => setLayout("docked")}
          onRestore={() => setLayout("normal")}
          onToggleMaximize={() =>
            setLayout(l => (l === "maximized" ? "normal" : "maximized"))
          }
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
