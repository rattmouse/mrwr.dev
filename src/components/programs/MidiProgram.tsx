"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, MenuList, MenuListItem } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import MidiWindow, { MidiWindowHandle } from "@/components/windows/MidiWindow";
import { ProgramProps, downloadBlob, submenuTopForRow, windowFrame } from "@/components/programs/programFrame";

export default function MidiProgram(props: ProgramProps) {
  const { layout, active = true } = props;
  const midiRef = useRef<MidiWindowHandle>(null);
  const midiFileMenuRef = useRef<HTMLDivElement | null>(null);
  const midiViewMenuRef = useRef<HTMLDivElement | null>(null);
  const midiFileInputRef = useRef<HTMLInputElement | null>(null);
  const [midiFileOpen, setMidiFileOpen] = useState(false);
  const [midiViewOpen, setMidiViewOpen] = useState(false);
  const [midiSaveAsOpen, setMidiSaveAsOpen] = useState(false);
  const [midiSaveAsTop, setMidiSaveAsTop] = useState(0);
  const [midiMetersOpen, setMidiMetersOpen] = useState(false);
  const [midiScopeOpen, setMidiScopeOpen] = useState(false);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [midiHasMessages, setMidiHasMessages] = useState(false);

  // A click anywhere outside a menu puts it away.
  useEffect(() => {
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
  }, []);

  const toolbar = (
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
                  setMidiSaveAsTop(submenuTopForRow(event.currentTarget));
                  setMidiSaveAsOpen(true);
                }}
                onClick={(event) => {
                  if (!midiHasMessages) return;
                  setMidiSaveAsTop(submenuTopForRow(event.currentTarget));
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
  );

  return (
    <DesktopWindow {...windowFrame("midi", props)} toolbar={toolbar}>
      <MidiWindow
        ref={midiRef}
        active={active}
        maximized={layout === "maximized"}
        onMetersOpenChange={setMidiMetersOpen}
        onScopeOpenChange={setMidiScopeOpen}
        onPlayingChange={setMidiPlaying}
        onHasMessagesChange={setMidiHasMessages}
      />
    </DesktopWindow>
  );
}
