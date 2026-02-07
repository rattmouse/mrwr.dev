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
import DesktopWindow from "@/components/windows/DesktopWindow";

export default function Home() {
   const [open, setOpen] = useState(false);

  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
      }}
    >

    <AppBar>
      <Toolbar style={{ justifyContent: 'space-between' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Button
            onClick={() => setOpen(!open)}
            active={open}
            style={{ fontWeight: 'bold' }}
          >
            Start
          </Button>
          {open && (
            <MenuList
              style={{
                position: 'absolute',
                left: '0',
                top: '100%'
              }}
              onClick={() => setOpen(false)}
            >
              <MenuListItem
               onClick={() => location.reload()}>
              Ratt
              <span role='img' aria-label='rat'>
              🐀
              </span>
              </MenuListItem>
              <MenuListItem>
              Mouse
              <span role='img' aria-label='mouse'>
              🐁
              </span>
              </MenuListItem>
              <Separator />
              <MenuListItem disabled>
                Exit
              </MenuListItem>
            </MenuList>
          )}
        </div>
        <TextInput placeholder='Search...' width={150} />
      </Toolbar>
    </AppBar>
    <DesktopWindow />

    </main>
  );
}
