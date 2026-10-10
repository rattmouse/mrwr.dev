"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Window, WindowContent, WindowHeader } from "react95";
import DesktopWindow from "@/components/windows/DesktopWindow";
import FileMenu from "@/components/windows/FileMenu";
import FacadeWindow, { FacadeWindowHandle } from "@/components/windows/FacadeWindow";
import { ProgramProps, windowFrame } from "@/components/programs/programFrame";
import { FileFacts, buildSpec, readFacts } from "@/lib/facade";

/**
 * facade.exe: a program with no purpose that looks like it has one. It is an
 * empty frame until a file is opened; then the file's hash seeds the whole
 * interface — name, menus, toolbar, panes — and the panes are filled from
 * the file itself, wired to one another and busy even when left alone.
 * Everything stays in the browser.
 */
export default function FacadeProgram(props: ProgramProps) {
  const [facts, setFacts] = useState<FileFacts | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Ready");
  const [about, setAbout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const windowRef = useRef<FacadeWindowHandle>(null);
  // The newest open wins, should two be read at once.
  const openCount = useRef(0);

  const spec = useMemo(() => (facts ? buildSpec(facts) : null), [facts]);

  // A picture's object URL lives as long as the file is open.
  useEffect(() => {
    const url = facts?.imageUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [facts]);

  const open = async (file: File) => {
    const n = ++openCount.current;
    setLoading(true);
    setMessage(`Reading ${file.name}…`);
    try {
      const next = await readFacts(file);
      if (n !== openCount.current) {
        if (next.imageUrl) URL.revokeObjectURL(next.imageUrl);
        return;
      }
      setFacts(next);
      setMessage("Ready");
    } catch {
      if (n === openCount.current) setMessage(`Could not read ${file.name}`);
    } finally {
      if (n === openCount.current) setLoading(false);
    }
  };

  const close = () => {
    openCount.current++;
    setFacts(null);
    setLoading(false);
    setMessage("Ready");
  };

  const toolbar = (
    <>
      <FileMenu
        items={[
          { label: <>Open&hellip;</>, title: "Open any file from your computer", onClick: () => fileInputRef.current?.click() },
          { label: "Close", disabled: !facts, onClick: close },
          ...(spec?.file ?? []).map((item) => ({ label: item.label, onClick: () => windowRef.current?.act(item.label, item.command) })),
        ]}
      />
      {spec?.menus.map((menu) => (
        <FileMenu
          key={menu.name}
          name={menu.name}
          items={menu.items.map((item) => ({ label: item.label, onClick: () => windowRef.current?.act(item.label, item.command) }))}
        />
      ))}
      <FileMenu
        name="Help"
        items={[
          { label: "About", onClick: () => setAbout(true) },
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void open(file);
        }}
      />
    </>
  );

  const frame = windowFrame("facade", props);
  return (
    <DesktopWindow {...frame} title={facts && !loading ? `${facts.name} - ${frame.title}` : frame.title} toolbar={toolbar}>
      <FacadeWindow
        ref={windowRef}
        facts={facts}
        running={props.layout !== "minimized"}
        spec={spec}
        loading={loading}
        message={message}
        onStatus={setMessage}
        onOpen={() => fileInputRef.current?.click()}
        onDropFile={(file) => void open(file)}
      />
      {about && <AboutBox onClose={() => setAbout(false)} />}
    </DesktopWindow>
  );
}

/**
 * Help → About: a message box over the window, the same whatever is open. It
 * takes every click on the window behind it until it's dismissed.
 */
function AboutBox({ onClose }: { onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Window role="dialog" aria-label="About" style={{ width: 260 }}>
        <WindowHeader style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>About</span>
          <Button size="sm" square aria-label="Close" onClick={onClose}>
            <span className="close-icon" />
          </Button>
        </WindowHeader>
        <WindowContent style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "16px 12px 12px" }}>
          <span>Open a file to analyze.</span>
          <Button ref={okRef} onClick={onClose} style={{ width: 80 }}>
            OK
          </Button>
        </WindowContent>
      </Window>
    </div>
  );
}
