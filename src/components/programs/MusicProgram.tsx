"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import StrudelReplWindow, { StrudelReplHandle } from "@/components/windows/StrudelReplWindow";
import { ProgramProps, submenuTopForRow, windowFrame } from "@/components/programs/programFrame";
import strudelSongs from "@/data/strudelSongs.json";

const SONG_ICON_FILES = [
  "../w98_midi_bl.ico",
  "../w98_midi_gr.ico",
  "../w98_midi_mg.ico",
  "../w98_midi_tl.ico",
] as const;

export default function MusicProgram(props: ProgramProps) {
  const { layout } = props;
  const strudelRef = useRef<StrudelReplHandle>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const [strudelPlaying, setStrudelPlaying] = useState(false);
  const [strudelInSync, setStrudelInSync] = useState(false);
  const [musicJitter, setMusicJitter] = useState({ x: 0, y: 0 });
  const [musicTextJitter, setMusicTextJitter] = useState({ x: 0, y: 0 });
  const [musicFileOpen, setMusicFileOpen] = useState(false);
  const [musicFileOpenSubmenu, setMusicFileOpenSubmenu] = useState(false);
  const [musicFileShowSubmenu, setMusicFileShowSubmenu] = useState(false);
  const [musicFileShowSubmenuTop, setMusicFileShowSubmenuTop] = useState(22);
  const [musicScopePopupOpen, setMusicScopePopupOpen] = useState(false);
  // The whole window shakes along while a song is playing.
  const shouldShakeMusicUi = strudelPlaying && layout === "normal";

  useEffect(() => {
    if (!shouldShakeMusicUi) {
      setMusicJitter({ x: 0, y: 0 });
      setMusicTextJitter({ x: 0, y: 0 });
      return;
    }
    const timer = window.setInterval(() => {
      const range = 1.6;
      const textRange = 0.2;
      setMusicJitter({
        x: (Math.random() * 2 - 1) * range,
        y: (Math.random() * 2 - 1) * range,
      });
      setMusicTextJitter({
        x: (Math.random() * 2 - 1) * textRange,
        y: (Math.random() * 2 - 1) * textRange,
      });
    }, 120);
    return () => {
      window.clearInterval(timer);
      setMusicJitter({ x: 0, y: 0 });
      setMusicTextJitter({ x: 0, y: 0 });
    };
  }, [shouldShakeMusicUi]);

  // A click anywhere outside the File menu puts it away.
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inFileMenu = fileMenuRef.current?.contains(target) ?? false;
      if (!inFileMenu) {
        setMusicFileOpen(false);
        setMusicFileOpenSubmenu(false);
        setMusicFileShowSubmenu(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  useEffect(() => {
    if (musicFileOpen) return;
    setMusicFileOpenSubmenu(false);
    setMusicFileShowSubmenu(false);
  }, [musicFileOpen]);

  const toolbar = (
    <>
      <div ref={fileMenuRef} style={{ position: "relative", display: "inline-block" }}>
        <Button
          variant="menu"
          size="sm"
          style={{ transform: `translate(${musicTextJitter.x}px, ${musicTextJitter.y}px)` }}
          active={musicFileOpen}
          aria-label="File"
          title="File"
          onClick={() => {
            setMusicFileOpen((prev) => {
              const next = !prev;
              if (!next) {
                setMusicFileOpenSubmenu(false);
                setMusicFileShowSubmenu(false);
              }
              return next;
            });
          }}
        >
          File
        </Button>
        {musicFileOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% - 2px)",
              left: 0,
              zIndex: 1000,
              width: "max-content",
            }}
            onMouseLeave={() => {
              setMusicFileOpenSubmenu(false);
              setMusicFileShowSubmenu(false);
              setMusicFileOpen(false);
            }}
          >
            <MenuList style={{ marginTop: 0 }}>
              <MenuListItem
                size="sm"
                onMouseEnter={() => {
                  setMusicFileShowSubmenu(false);
                  setMusicFileOpenSubmenu(true);
                }}
                onClick={() =>
                  setMusicFileOpenSubmenu((prev) => {
                    const next = !prev;
                    if (next) setMusicFileShowSubmenu(false);
                    return next;
                  })
                }
              >
                <span style={{ flex: "1 1 auto" }}>Open</span>
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
                  <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                    <path d="M2 1l4 3-4 3z" fill="currentColor" />
                  </svg>
                </span>
              </MenuListItem>
              <MenuListItem
                size="sm"
                onMouseEnter={(event) => {
                  setMusicFileShowSubmenuTop(submenuTopForRow(event.currentTarget));
                  setMusicFileOpenSubmenu(false);
                  setMusicFileShowSubmenu(true);
                }}
                onClick={(event) => {
                  setMusicFileShowSubmenuTop(submenuTopForRow(event.currentTarget));
                  setMusicFileShowSubmenu((prev) => {
                    const next = !prev;
                    if (next) setMusicFileOpenSubmenu(false);
                    return next;
                  });
                }}
              >
                <span style={{ flex: "1 1 auto" }}>Show</span>
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
                  <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                    <path d="M2 1l4 3-4 3z" fill="currentColor" />
                  </svg>
                </span>
              </MenuListItem>
            </MenuList>
            {musicFileOpenSubmenu && (
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% - 2px)",
                  top: 0,
                  zIndex: 1001,
                  minWidth: 180,
                }}
              >
                <MenuList style={{ marginTop: 0 }}>
                  {strudelSongs.map((song, index) => (
                    <MenuListItem
                      size="sm"
                      key={song.id}
                      onClick={() => {
                        strudelRef.current?.setCode(song.code);
                        setMusicFileOpenSubmenu(false);
                        setMusicFileOpen(false);
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <img
                          src={SONG_ICON_FILES[index % SONG_ICON_FILES.length]}
                          alt=""
                          aria-hidden
                          width={16}
                          height={16}
                          style={{ display: "inline-block", imageRendering: "pixelated" }}
                        />
                        <span>{song.name}</span>
                      </span>
                    </MenuListItem>
                  ))}
                </MenuList>
              </div>
            )}
            {musicFileShowSubmenu && (
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% - 2px)",
                  top: musicFileShowSubmenuTop,
                  zIndex: 1001,
                  minWidth: 160,
                }}
              >
                <MenuList style={{ marginTop: 0 }}>
                  <MenuListItem
                    size="sm"
                    onClick={() => {
                      setMusicScopePopupOpen((prev) => !prev);
                      setMusicFileShowSubmenu(false);
                      setMusicFileOpen(false);
                    }}
                  >
                    Scope
                  </MenuListItem>
                  <MenuListItem
                    size="sm"
                    onClick={() => {
                      window.open("https://strudel.cc/workshop/getting-started/", "_blank", "noopener,noreferrer");
                      setMusicFileShowSubmenu(false);
                      setMusicFileOpen(false);
                    }}
                  >
                    Docs
                  </MenuListItem>
                </MenuList>
              </div>
            )}
          </div>
        )}
      </div>
      <Button
        size="sm"
        style={{
          transform: `translate(${musicTextJitter.x}px, ${musicTextJitter.y}px)`,
          fontWeight: "bold",
        }}
        active={strudelPlaying}
        aria-label="Play"
        title="Play"
        onClick={() => void strudelRef.current?.play()}
      >
        Play
      </Button>
      <Button
        size="sm"
        style={{
          transform: `translate(${musicTextJitter.x}px, ${musicTextJitter.y}px)`,
          fontWeight: "bold",
        }}
        active={!strudelPlaying}
        aria-label="Stop"
        title="Stop"
        onClick={() => void strudelRef.current?.stop()}
      >
        Stop
      </Button>
      <Button
        size="sm"
        style={{
          transform: `translate(${musicTextJitter.x}px, ${musicTextJitter.y}px)`,
          fontWeight: "bold",
        }}
        active={strudelInSync}
        disabled={strudelPlaying && strudelInSync}
        aria-label="Set"
        title="Set"
        onClick={() => void strudelRef.current?.update()}
      >
        Set
      </Button>
    </>
  );

  return (
    <DesktopWindow
      {...windowFrame("music", props)}
      jitterX={musicJitter.x}
      jitterY={musicJitter.y}
      titleJitterX={musicTextJitter.x}
      titleJitterY={musicTextJitter.y}
      toolbarJitterX={musicTextJitter.x * 0.5}
      toolbarJitterY={musicTextJitter.y * 0.5}
      toolbar={toolbar}
    >
      <StrudelReplWindow
        ref={strudelRef}
        onPlayingChange={setStrudelPlaying}
        onSyncChange={setStrudelInSync}
        scopePopupOpen={musicScopePopupOpen}
        scopePopupCompact={layout !== "maximized"}
      />
    </DesktopWindow>
  );
}
