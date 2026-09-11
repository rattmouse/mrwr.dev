"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TextInput } from "react95";

export type NotepadWindowHandle = {
  newFile: () => void;
  openFile: (file: File) => Promise<void>;
  save: () => { blob: Blob; name: string };
};

export type NotepadDoc = { text: string; name: string };

/**
 * Text handed in from elsewhere (e.g. a past search). Replaces the page like
 * File → Open, or with `append`, goes on a new line at the end and keeps the
 * page's name.
 */
export type NotepadIncoming = NotepadDoc & { append?: boolean };

type NotepadWindowProps = {
  incoming?: NotepadIncoming | null;
  /** Called once `incoming` is on the page, so the caller can drop it. */
  onIncomingApplied?: () => void;
};

const STORAGE_KEY = "mrwr:notepad";
const UNTITLED = "untitled.txt";

function loadStored(): NotepadDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { text: "", name: UNTITLED };
    const parsed = JSON.parse(raw) as Partial<NotepadDoc>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : UNTITLED,
    };
  } catch {
    return { text: "", name: UNTITLED };
  }
}

function saveStored(stored: NotepadDoc) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or quota — the note just doesn't outlive the tab.
  }
}

/**
 * Notepad: one text sheet that keeps itself in localStorage, so closing the
 * window, refreshing, or shutting down doesn't wipe it. File → Open reads a
 * text file off disk; Save hands it back as a download.
 */
const NotepadWindow = forwardRef<NotepadWindowHandle, NotepadWindowProps>(function NotepadWindow(
  { incoming, onIncomingApplied },
  ref,
) {
  const [text, setText] = useState("");
  const [name, setName] = useState(UNTITLED);
  const [loaded, setLoaded] = useState(false);

  // localStorage is browser-only; read it after mount so SSR and the first
  // client render agree.
  useEffect(() => {
    const stored = loadStored();
    setText(stored.text);
    setName(stored.name);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveStored({ text, name });
  }, [loaded, text, name]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const scrollToEndRef = useRef(false);

  // Wait for the stored page to load first, or it would land on top of this.
  useEffect(() => {
    if (!loaded || !incoming) return;
    if (incoming.append) {
      setText((prev) => (prev && !prev.endsWith("\n") ? `${prev}\n${incoming.text}` : prev + incoming.text));
      scrollToEndRef.current = true;
    } else {
      setText(incoming.text);
      setName(incoming.name);
    }
    onIncomingApplied?.();
  }, [loaded, incoming, onIncomingApplied]);

  // After an append renders, scroll the page down to show it.
  useEffect(() => {
    if (!scrollToEndRef.current) return;
    scrollToEndRef.current = false;
    const textarea = wrapperRef.current?.querySelector("textarea");
    if (textarea) textarea.scrollTop = textarea.scrollHeight;
  }, [text]);

  useImperativeHandle(
    ref,
    () => ({
      newFile: () => {
        setText("");
        setName(UNTITLED);
      },
      openFile: async (file: File) => {
        setText(await file.text());
        setName(file.name || UNTITLED);
      },
      save: () => ({ blob: new Blob([text], { type: "text/plain" }), name }),
    }),
    [text, name],
  );

  return (
    <div ref={wrapperRef} style={{ flex: "1 1 auto", minHeight: 0, width: "100%", minWidth: 0 }}>
      <TextInput
        multiline
        value={text}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
        aria-label={name}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
        }}
      />
    </div>
  );
});

export default NotepadWindow;
