"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Anchor,
  Button,
  MenuList,
  MenuListItem,
  ScrollView,
} from "react95";
import IssuesTreeView, { IssuesTreeViewHandle } from "@/components/issues/IssuesTreeView";
import ChangesTreeView, { ChangesTreeViewHandle } from "@/components/changes/ChangesTreeView";
import DesktopWindow from "@/components/windows/DesktopWindow";
import StrudelReplWindow, { StrudelReplHandle } from "@/components/windows/StrudelReplWindow";
import MidiWindow, { MidiWindowHandle } from "@/components/windows/MidiWindow";
import PaintWindow, { PaintWindowHandle } from "@/components/windows/PaintWindow";
import DndWindow, { DndWindowHandle } from "@/components/windows/DndWindow";
import NotepadWindow, { NotepadIncoming, NotepadWindowHandle } from "@/components/windows/NotepadWindow";
import FileMenu from "@/components/windows/FileMenu";
import { Layout, ProgramWindowId } from "@/components/windows/windowTypes";
import { VersionEntry } from "@/lib/versions.types";
import type { SearchIssueLink } from "@/lib/searchHistory.types";
import strudelSongs from "@/data/strudelSongs.json";

const SONG_ICON_FILES = [
  "../w98_midi_bl.ico",
  "../w98_midi_gr.ico",
  "../w98_midi_mg.ico",
  "../w98_midi_tl.ico",
] as const;

// Paint's fixed palette and the three pencil widths, in CSS px.
const PAINT_COLORS = [
  "#000000",
  "#7f7f7f",
  "#a80000",
  "#ff7f00",
  "#ffd400",
  "#008000",
  "#0000c0",
  "#7f007f",
] as const;
const PAINT_SIZES = [2, 6, 14] as const;


// Hand the browser a file to save — midi.exe's, Notepad's and Paint's Save all
// land here. Nothing touches the network.
function downloadBlob(data: string | Uint8Array | Blob, filename: string, mime?: string) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ProgramWindowProps = {
  id: ProgramWindowId;
  layout: Layout;
  versions: VersionEntry[];
  notepadDoc?: NotepadIncoming | null;
  onNotepadDocApplied?: () => void;
  issueReveal?: SearchIssueLink | null;
  onIssueRevealed?: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleMaximize: () => void;
};

export default function ProgramWindow({
  id,
  layout,
  versions,
  notepadDoc,
  onNotepadDocApplied,
  issueReveal,
  onIssueRevealed,
  onClose,
  onMinimize,
  onRestore,
  onToggleMaximize,
}: ProgramWindowProps) {
  const getSubmenuTopForRow = (target: EventTarget & Element) => {
    const row = target as HTMLElement;
    const parent = row.parentElement as HTMLElement | null;
    if (!parent) return 0;
    const rowRect = row.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return Math.max(0, Math.round(rowRect.top - parentRect.top) - 1);
  };

  const issuesTreeRef = useRef<IssuesTreeViewHandle>(null);
  const changesTreeRef = useRef<ChangesTreeViewHandle>(null);
  const strudelRef = useRef<StrudelReplHandle>(null);
  const midiRef = useRef<MidiWindowHandle>(null);
  const paintRef = useRef<PaintWindowHandle>(null);
  const dndRef = useRef<DndWindowHandle>(null);
  const notepadRef = useRef<NotepadWindowHandle>(null);
  const notepadFileInputRef = useRef<HTMLInputElement | null>(null);
  const paintFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const midiFileMenuRef = useRef<HTMLDivElement | null>(null);
  const midiViewMenuRef = useRef<HTMLDivElement | null>(null);
  const midiFileInputRef = useRef<HTMLInputElement | null>(null);
  const [strudelPlaying, setStrudelPlaying] = useState(false);
  const [strudelInSync, setStrudelInSync] = useState(false);
  const [musicJitter, setMusicJitter] = useState({ x: 0, y: 0 });
  const [musicTextJitter, setMusicTextJitter] = useState({ x: 0, y: 0 });
  const [musicFileOpen, setMusicFileOpen] = useState(false);
  const [musicFileOpenSubmenu, setMusicFileOpenSubmenu] = useState(false);
  const [musicFileShowSubmenu, setMusicFileShowSubmenu] = useState(false);
  const [musicFileShowSubmenuTop, setMusicFileShowSubmenuTop] = useState(22);
  const [musicScopePopupOpen, setMusicScopePopupOpen] = useState(false);
  const [contentModalOpen, setContentModalOpen] = useState(false);
  const [midiFileOpen, setMidiFileOpen] = useState(false);
  const [midiViewOpen, setMidiViewOpen] = useState(false);
  const [midiSaveAsOpen, setMidiSaveAsOpen] = useState(false);
  const [midiSaveAsTop, setMidiSaveAsTop] = useState(0);
  const [midiMetersOpen, setMidiMetersOpen] = useState(false);
  const [midiScopeOpen, setMidiScopeOpen] = useState(false);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [midiHasMessages, setMidiHasMessages] = useState(false);
  const [paintColor, setPaintColor] = useState<string>(PAINT_COLORS[0]);
  const [paintBrush, setPaintBrush] = useState<number>(6);
  const [dndState, setDndState] = useState({ saved: false, dirty: true, count: 0 });

  const title =
    id === "notepad"
      ? "notepad.exe"
      : id === "issues"
        ? "issues.exe"
        : id === "changes"
          ? "changes.exe"
          : id === "music"
            ? "strudel.cc"
            : id === "midi"
              ? "midi.exe"
              : id === "paint"
                ? "paint.exe"
                : id === "dnd"
                  ? "dnd.exe"
        : "mrwr.dev";
  const titleIcon =
    id === "welcome"
      ? "../w95_desktop.ico"
      : id === "notepad"
        ? "../w95_notepad.ico"
        : id === "issues"
          ? "../w98_issues.ico"
          : id === "changes"
            ? "../w95_changes.ico"
            : id === "midi"
              ? "../w98_music.ico"
              : id === "paint"
                ? "../w95_paint.ico"
                : id === "dnd"
                  ? "../w98_file_eye.ico"
                  : "../w98_repl.ico";

  const normalHeight =
    id === "welcome" ? 160
      : id === "changes" ? 420
        : id === "music" ? 220
          : id === "midi" ? 480
            : id === "paint" ? 320
              : id === "dnd" ? 520
                : 300;
  const normalWidth =
    id === "changes" ? 420 : id === "paint" ? 410 : id === "midi" ? 560 : id === "dnd" ? 560 : undefined;
  const musicFrameEffect = 0;
  const shouldShakeMusicUi = id === "music" && strudelPlaying && layout === "normal";
  const contentModalScale = 1;
  const useFakeModalButtonOnly = false;
  const useFakePreviewOnly = false;
  const openImagesInNewTab = layout === "normal";
  const modalHideTitleBar = layout === "maximized";
  const baseNormalWidth = normalWidth ?? 280;
  const modalButtonOnlyWidth = Math.max(88, Math.round(baseNormalWidth * 0.25));

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
  }, [id, shouldShakeMusicUi]);

  useEffect(() => {
    if (id !== "music") {
      setMusicFileOpen(false);
      setMusicFileOpenSubmenu(false);
      setMusicFileShowSubmenu(false);
      setMusicScopePopupOpen(false);
      return;
    }

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
  }, [id]);

  useEffect(() => {
    if (musicFileOpen) return;
    setMusicFileOpenSubmenu(false);
    setMusicFileShowSubmenu(false);
  }, [musicFileOpen]);

  useEffect(() => {
    if (id !== "midi") {
      setMidiFileOpen(false);
      setMidiSaveAsOpen(false);
      setMidiViewOpen(false);
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!(midiFileMenuRef.current?.contains(target) ?? false)) {
        setMidiFileOpen(false);
        setMidiSaveAsOpen(false);
      }
      if (!(midiViewMenuRef.current?.contains(target) ?? false)) {
        setMidiViewOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [id]);

  useEffect(() => {
    if (id !== "issues") {
      setContentModalOpen(false);
    }
  }, [id]);

  const toolbar =
    id === "notepad" ? (
      <>
        <FileMenu
          items={[
            { label: "New", title: "Start a blank page", onClick: () => notepadRef.current?.newFile() },
            {
              label: <>Open&hellip;</>,
              title: "Open a text file from your computer",
              onClick: () => notepadFileInputRef.current?.click(),
            },
            {
              label: "Save",
              title: "Download this page as a text file",
              onClick: () => {
                const file = notepadRef.current?.save();
                if (file) downloadBlob(file.blob, file.name);
              },
            },
          ]}
        />
        <input
          ref={notepadFileInputRef}
          type="file"
          accept=".txt,.md,.csv,.json,.log,text/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void notepadRef.current?.openFile(file);
          }}
        />
      </>
    ) : id === "issues" ? (
      <>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandOpen()} disabled={contentModalOpen}>
          ⚠️
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandClosed()} disabled={contentModalOpen}>
          ✅
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.expandAll()} disabled={contentModalOpen}>
          ➕
        </Button>
        <Button variant="menu" size="sm" onClick={() => issuesTreeRef.current?.collapseAll()} disabled={contentModalOpen}>
          ➖
        </Button>
      </>
    ) : id === "changes" ? (
      <>
        <Button variant="menu" size="sm" title="Handmade" onClick={() => changesTreeRef.current?.filterHandmade()}>
          ✋
        </Button>
        <Button variant="menu" size="sm" title="Chat GPT" onClick={() => changesTreeRef.current?.filterChatgpt()}>
          💬
        </Button>
        <Button variant="menu" size="sm" title="Codex" onClick={() => changesTreeRef.current?.filterCodex()}>
          ⚙️
        </Button>
        <Button variant="menu" size="sm" title="Claude" onClick={() => changesTreeRef.current?.filterClaude()}>
          🧹
        </Button>
        <Button variant="menu" size="sm" title="All versions" onClick={() => changesTreeRef.current?.filterAll()}>
          🌐
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
                    setMusicFileShowSubmenuTop(getSubmenuTopForRow(event.currentTarget));
                    setMusicFileOpenSubmenu(false);
                    setMusicFileShowSubmenu(true);
                  }}
                  onClick={(event) => {
                    setMusicFileShowSubmenuTop(getSubmenuTopForRow(event.currentTarget));
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
    ) : id === "midi" ? (
      <>
        <div ref={midiFileMenuRef} style={{ position: "relative", display: "inline-block" }}>
          <Button
            variant="menu"
            size="sm"
            active={midiFileOpen}
            disabled={midiPlaying}
            aria-label="File"
            title="File"
            onClick={() => {
              setMidiViewOpen(false);
              setMidiFileOpen((prev) => {
                setMidiSaveAsOpen(false);
                return !prev;
              });
            }}
          >
            File
          </Button>
          {midiFileOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% - 2px)",
                left: 0,
                zIndex: 1000,
                width: "max-content",
              }}
              onMouseLeave={() => {
                setMidiSaveAsOpen(false);
                setMidiFileOpen(false);
              }}
            >
              <MenuList style={{ marginTop: 0 }}>
                <MenuListItem
                  size="sm"
                  onMouseEnter={() => setMidiSaveAsOpen(false)}
                  onClick={() => {
                    midiRef.current?.newSession();
                    setMidiFileOpen(false);
                  }}
                >
                  New
                </MenuListItem>
                <MenuListItem
                  size="sm"
                  onMouseEnter={() => setMidiSaveAsOpen(false)}
                  onClick={() => {
                    midiFileInputRef.current?.click();
                    setMidiFileOpen(false);
                  }}
                >
                  Open&hellip;
                </MenuListItem>
                <MenuListItem
                  size="sm"
                  disabled={!midiHasMessages}
                  onMouseEnter={() => setMidiSaveAsOpen(false)}
                  onClick={() => {
                    const data = midiRef.current?.exportMid();
                    if (data) {
                      const stamp = new Date()
                        .toISOString()
                        .replace(/[:T]/g, "-")
                        .slice(0, 19);
                      downloadBlob(data, `keys-${stamp}.mid`, "audio/midi");
                    }
                    setMidiFileOpen(false);
                  }}
                >
                  Save
                </MenuListItem>
                <MenuListItem
                  size="sm"
                  disabled={!midiHasMessages}
                  onMouseEnter={(event) => {
                    if (!midiHasMessages) return;
                    setMidiSaveAsTop(getSubmenuTopForRow(event.currentTarget));
                    setMidiSaveAsOpen(true);
                  }}
                  onClick={(event) => {
                    if (!midiHasMessages) return;
                    setMidiSaveAsTop(getSubmenuTopForRow(event.currentTarget));
                    setMidiSaveAsOpen((prev) => !prev);
                  }}
                >
                  <span style={{ flex: "1 1 auto" }}>Save as&hellip;</span>
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
              {midiSaveAsOpen && (
                <div
                  style={{
                    position: "absolute",
                    left: "calc(100% - 2px)",
                    top: midiSaveAsTop,
                    zIndex: 1001,
                    minWidth: 140,
                  }}
                >
                  <MenuList style={{ marginTop: 0 }}>
                    <MenuListItem
                      size="sm"
                      onClick={() => {
                        const text = midiRef.current?.exportLog("csv");
                        if (text != null) downloadBlob(text, "keys-log.csv", "text/csv");
                        setMidiSaveAsOpen(false);
                        setMidiFileOpen(false);
                      }}
                    >
                      Log as CSV
                    </MenuListItem>
                    <MenuListItem
                      size="sm"
                      onClick={() => {
                        const text = midiRef.current?.exportLog("json");
                        if (text != null)
                          downloadBlob(text, "keys-log.json", "application/json");
                        setMidiSaveAsOpen(false);
                        setMidiFileOpen(false);
                      }}
                    >
                      Log as JSON
                    </MenuListItem>
                  </MenuList>
                </div>
              )}
            </div>
          )}
        </div>
        {/* View: the panel's optional readouts, each ticked while it's showing. */}
        <div ref={midiViewMenuRef} style={{ position: "relative", display: "inline-block" }}>
          <Button
            variant="menu"
            size="sm"
            active={midiViewOpen}
            aria-label="View"
            title="View"
            onClick={() => {
              setMidiFileOpen(false);
              setMidiSaveAsOpen(false);
              setMidiViewOpen((prev) => !prev);
            }}
          >
            View
          </Button>
          {midiViewOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% - 2px)",
                left: 0,
                zIndex: 1000,
                width: "max-content",
              }}
              onMouseLeave={() => setMidiViewOpen(false)}
            >
              <MenuList style={{ marginTop: 0 }}>
                {[
                  { label: "Meters", title: "Activity meters", checked: midiMetersOpen },
                  {
                    label: "Scope",
                    title: "Waveform and frequency of the sound playing",
                    checked: midiScopeOpen,
                  },
                ].map((item) => (
                  <MenuListItem
                    key={item.label}
                    size="sm"
                    role="menuitemcheckbox"
                    aria-checked={item.checked}
                    title={item.title}
                    onClick={() => {
                      if (item.label === "Meters") midiRef.current?.toggleMeters();
                      else midiRef.current?.toggleScope();
                      setMidiViewOpen(false);
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        marginRight: 6,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "0 0 12px",
                      }}
                    >
                      {item.checked && (
                        <svg width="8" height="8" viewBox="0 0 8 8" role="presentation">
                          <path d="M0 4l1-1 2 2 4-4 1 1-5 5z" fill="currentColor" />
                        </svg>
                      )}
                    </span>
                    <span style={{ flex: "1 1 auto" }}>{item.label}</span>
                  </MenuListItem>
                ))}
              </MenuList>
            </div>
          )}
        </div>
        <Button
          size="sm"
          style={{ fontWeight: "bold" }}
          title="Play the messages listed below"
          active={midiPlaying}
          disabled={midiPlaying || !midiHasMessages}
          onClick={() => midiRef.current?.play()}
        >
          Play
        </Button>
        <Button
          size="sm"
          style={{ fontWeight: "bold" }}
          title="Stop playing"
          active={!midiPlaying}
          disabled={!midiPlaying}
          onClick={() => midiRef.current?.stop()}
        >
          Stop
        </Button>
        <input
          ref={midiFileInputRef}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const buf = new Uint8Array(await file.arrayBuffer());
            midiRef.current?.loadSmf(buf, file.name);
          }}
        />
      </>
    ) : id === "paint" ? (
      <>
        <FileMenu
          items={[
            { label: "New", title: "Start a blank sheet", onClick: () => paintRef.current?.newFile() },
            {
              label: <>Open&hellip;</>,
              title: "Open a picture from your computer",
              onClick: () => paintFileInputRef.current?.click(),
            },
            {
              label: "Save",
              title: "Download this sheet as a PNG",
              onClick: () => {
                void paintRef.current?.save().then((file) => {
                  if (file) downloadBlob(file.blob, file.name);
                });
              },
            },
          ]}
        />
        <input
          ref={paintFileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void paintRef.current?.openFile(file);
          }}
        />
        <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
        {PAINT_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Colour ${swatch}`}
            aria-pressed={paintColor === swatch}
            title={swatch}
            onClick={() => setPaintColor(swatch)}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              flex: "0 0 auto",
              background: swatch,
              border: "2px solid",
              borderColor:
                paintColor === swatch
                  ? "#000000 #ffffff #ffffff #000000"
                  : "#ffffff #808080 #808080 #ffffff",
              cursor: "pointer",
            }}
          />
        ))}
        <span aria-hidden style={{ display: "inline-block", width: 6, flex: "0 0 auto" }} />
        {PAINT_SIZES.map((size) => (
          <Button
            key={size}
            variant="menu"
            size="sm"
            active={paintBrush === size}
            aria-label={`Brush ${size}px`}
            title={`${size}px brush`}
            onClick={() => setPaintBrush(size)}
          >
            <span
              style={{
                display: "inline-block",
                width: Math.min(size, 14),
                height: Math.min(size, 14),
                borderRadius: "50%",
                background: "currentColor",
              }}
            />
          </Button>
        ))}
        <Button variant="menu" size="sm" onClick={() => paintRef.current?.clear()}>
          Clear
        </Button>
      </>
    ) : id === "dnd" ? (
      <>
        <Button variant="menu" size="sm" title="Roll up a new adventurer" onClick={() => dndRef.current?.newCharacter()}>
          New
        </Button>
        <Button variant="menu" size="sm" title="Re-roll ability scores (4d6, drop lowest)" onClick={() => dndRef.current?.rollScores()}>
          Roll
        </Button>
        <Button
          variant="menu"
          size="sm"
          title={dndState.saved ? "Save changes to this sheet" : "Add this sheet to the party"}
          disabled={!dndState.dirty}
          onClick={() => dndRef.current?.save()}
        >
          Save
        </Button>
        <Button
          variant="menu"
          size="sm"
          title="Strike this character from the party"
          disabled={!dndState.saved}
          onClick={() => dndRef.current?.remove()}
        >
          Delete
        </Button>
        <Button
          variant="menu"
          size="sm"
          title="Send the whole party on its way now"
          disabled={dndState.count === 0}
          onClick={() => dndRef.current?.depart()}
        >
          Depart
        </Button>
      </>
    ) : undefined;

  return (
    <DesktopWindow
      title={title}
      titleIcon={titleIcon}
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
      controlsDisabled={contentModalOpen}
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
        <NotepadWindow ref={notepadRef} incoming={notepadDoc} onIncomingApplied={onNotepadDocApplied} />
      )}

      {id === "issues" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <IssuesTreeView
              ref={issuesTreeRef}
              showFrame={false}
              onModalOpenChange={setContentModalOpen}
              modalScale={contentModalScale}
              modalForceButtonOnly={useFakeModalButtonOnly}
              modalButtonOnlyWidth={modalButtonOnlyWidth}
              modalFakePreviewOnly={useFakePreviewOnly}
              openImagesInNewTab={openImagesInNewTab}
              modalHideTitleBar={modalHideTitleBar}
              reveal={issueReveal}
              onRevealed={onIssueRevealed}
            />
          </ScrollView>
        </div>
      )}

      {id === "changes" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }}>
          <ScrollView style={{ width: "100%", height: "100%" }}>
            <ChangesTreeView ref={changesTreeRef} versions={versions} showFrame={false} />
          </ScrollView>
        </div>
      )}

      {id === "music" && (
        <StrudelReplWindow
          ref={strudelRef}
          onPlayingChange={setStrudelPlaying}
          onSyncChange={setStrudelInSync}
          scopePopupOpen={musicScopePopupOpen}
          scopePopupCompact={layout !== "maximized"}
        />
      )}

      {id === "midi" && (
        <MidiWindow
          ref={midiRef}
          maximized={layout === "maximized"}
          onMetersOpenChange={setMidiMetersOpen}
          onScopeOpenChange={setMidiScopeOpen}
          onPlayingChange={setMidiPlaying}
          onHasMessagesChange={setMidiHasMessages}
        />
      )}

      {id === "paint" && (
        <PaintWindow ref={paintRef} color={paintColor} brushSize={paintBrush} />
      )}

      {id === "dnd" && <DndWindow ref={dndRef} onStateChange={setDndState} />}
    </DesktopWindow>
  );
}
