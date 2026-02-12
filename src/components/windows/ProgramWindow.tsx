"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Anchor,
  Button,
  MenuList,
  MenuListItem,
  ScrollView,
  TextInput,
} from "react95";
import IssuesTreeView, { IssuesTreeViewHandle } from "@/components/issues/IssuesTreeView";
import ChangesTreeView, { ChangesTreeViewHandle } from "@/components/changes/ChangesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
import StrudelReplWindow, { StrudelReplHandle } from "@/components/windows/StrudelReplWindow";
import { Layout, ProgramWindowId } from "@/components/windows/windowTypes";
import { GitChangeEntry } from "@/lib/gitChanges.types";
import strudelSongs from "@/data/strudelSongs.json";

type ProgramWindowProps = {
  id: ProgramWindowId;
  layout: Layout;
  gitChanges: GitChangeEntry[];
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
};

export default function ProgramWindow({
  id,
  layout,
  gitChanges,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
}: ProgramWindowProps) {
  const issuesTreeRef = useRef<IssuesTreeViewHandle>(null);
  const changesTreeRef = useRef<ChangesTreeViewHandle>(null);
  const strudelRef = useRef<StrudelReplHandle>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const [strudelPlaying, setStrudelPlaying] = useState(false);
  const [strudelInSync, setStrudelInSync] = useState(false);
  const [musicJitter, setMusicJitter] = useState({ x: 0, y: 0 });
  const [musicTextJitter, setMusicTextJitter] = useState({ x: 0, y: 0 });
  const [musicFileOpen, setMusicFileOpen] = useState(false);
  const [musicFileOpenSubmenu, setMusicFileOpenSubmenu] = useState(false);

  const title =
    id === "notepad"
      ? "notepad.exe"
      : id === "issues"
        ? "issues.exe"
        : id === "changes"
          ? "changes.exe"
          : id === "music"
            ? "strudel.cc"
        : "mrwr.dev";

  const normalHeight = id === "welcome" ? 160 : id === "changes" ? 360 : id === "music" ? 220 : 300;
  const normalWidth = id === "changes" ? 320 : undefined;
  const musicFrameEffect = 0;
  const shouldShakeMusicUi = id === "music" && strudelPlaying && layout === "normal";

  useEffect(() => {
    if (!shouldShakeMusicUi) {
      setMusicJitter({ x: 0, y: 0 });
      setMusicTextJitter({ x: 0, y: 0 });
      if (id !== "music") {
        setStrudelInSync(false);
      }
      return;
    }
    const timer = window.setInterval(() => {
      const range = 2.5;
      const textRange = 1.1;
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
  }, [id, shouldShakeMusicUi]);

  useEffect(() => {
    if (id !== "music") {
      setMusicFileOpen(false);
      setMusicFileOpenSubmenu(false);
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inFileMenu = fileMenuRef.current?.contains(target) ?? false;
      if (!inFileMenu) {
        setMusicFileOpen(false);
        setMusicFileOpenSubmenu(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [id]);

  useEffect(() => {
    if (musicFileOpen) return;
    setMusicFileOpenSubmenu(false);
  }, [musicFileOpen]);

  const toolbar =
    id === "issues" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandOpen()}>
          ⚠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandClosed()}>
          ✅
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandAll()}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.collapseAll()}>
          ➖
        </Button>
      </>
    ) : id === "changes" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandFeatures()}>
          ✨
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandFixes()}>
          🛠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandDocs()}>
          📝
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandOther()}>
          📦
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.expandAll()}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => changesTreeRef.current?.collapseAll()}>
          ➖
        </Button>
      </>
    ) : id === "music" ? (
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
                setMusicFileOpen(false);
              }}
            >
              <MenuList style={{ marginTop: 0 }}>
                <MenuListItem
                  size="sm"
                  onMouseEnter={() => setMusicFileOpenSubmenu(true)}
                  onClick={() => setMusicFileOpenSubmenu((prev) => !prev)}
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
                    {strudelSongs.map((song) => (
                      <MenuListItem
                        size="sm"
                        key={song.id}
                        onClick={() => {
                          strudelRef.current?.setCode(song.code);
                          setMusicFileOpenSubmenu(false);
                          setMusicFileOpen(false);
                        }}
                      >
                        {song.name}
                      </MenuListItem>
                    ))}
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
          disabled={!strudelPlaying || strudelInSync}
          aria-label="Set"
          title="Set"
          onClick={() => void strudelRef.current?.update()}
        >
          Set
        </Button>
        <Button
          variant="menu"
          size="sm"
          style={{ transform: `translate(${musicTextJitter.x}px, ${musicTextJitter.y}px)` }}
          aria-label="Help"
          title="Help"
          onClick={() => window.open("https://strudel.cc/workshop/getting-started/", "_blank", "noopener,noreferrer")}
        >
          ?
        </Button>
      </>
    ) : undefined;

  return (
    <DesktopWindow
      title={title}
      layout={layout}
      normalWidth={normalWidth}
      normalHeight={normalHeight}
      effectOutline={musicFrameEffect}
      jitterX={id === "music" ? musicJitter.x : 0}
      jitterY={id === "music" ? musicJitter.y : 0}
      titleJitterX={id === "music" ? musicTextJitter.x : 0}
      titleJitterY={id === "music" ? musicTextJitter.y : 0}
      toolbarJitterX={id === "music" ? musicTextJitter.x * 0.5 : 0}
      toolbarJitterY={id === "music" ? musicTextJitter.y * 0.5 : 0}
      onClose={onClose}
      onMinimize={onMinimize}
      onRestore={onRestore}
      onToggleMaximize={onToggleMaximize}
      toolbar={toolbar}
    >
      {id === "welcome" && (
        <div
          style={{
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "stretch",
          }}
        >
          <div style={{ textAlign: "center" }}>coming soon…</div>
          <div style={{ textAlign: "left", marginTop: 6 }}>
            you can help:
            <ul>
              <li>- found a bug? let me know!</li>
              <li>- type brief description in search bar</li>
              <li>
                - buy me a{" "}
                <Anchor href="https://buymeacoffee.com/rattmouse" target="_blank">
                  ☕
                </Anchor>
              </li>
            </ul>
          </div>
        </div>
      )}

      {id === "notepad" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, width: "100%", minWidth: 0 }}>
          <TextInput
            multiline
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              minWidth: 0,
              minHeight: 0,
            }}
          />
        </div>
      )}

      {id === "issues" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <IssuesTreeView ref={issuesTreeRef} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "changes" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <ChangesTreeView ref={changesTreeRef} entries={gitChanges} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "music" && (
        <StrudelReplWindow
          ref={strudelRef}
          onPlayingChange={setStrudelPlaying}
          onSyncChange={setStrudelInSync}
        />
      )}
    </DesktopWindow>
  );
}
