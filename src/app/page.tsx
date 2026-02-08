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

export default function Home() {
   const [open, setOpen] = useState(false);
   const [programsOpen, setProgramsOpen] = useState(false);

  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
      }}
    >
    <StartMenu />
    <DesktopWindow />

    </main>
  );
}
