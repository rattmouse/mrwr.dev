"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type StrudelReplHandle = {
  play: () => Promise<void>;
  stop: () => Promise<void>;
  update: () => Promise<void>;
};

type StrudelWebModule = {
  initStrudel: () => Promise<unknown>;
  initAudio?: () => Promise<unknown>;
  initAudioOnFirstClick?: () => void;
  getAudioContext?: () => AudioContext | null;
  evaluate?: (code: string, autostart?: boolean) => Promise<unknown>;
  hush?: () => void;
};

type EditorChangeEvent = {
  docChanged?: boolean;
  state?: { doc?: { toString: () => string } };
};

type EditorInstance = {
  destroy?: () => void;
};

type StrudelCodeMirrorModule = {
  initEditor: (options: {
    root: HTMLElement;
    initialCode: string;
    onChange?: (event: EditorChangeEvent) => void;
    onEvaluate?: () => void;
    onStop?: () => void;
  }) => EditorInstance;
};

const DEFAULT_CODE = `note("c2 e2 g2 b2")
  .s("sawtooth")
  .slow(2)
  .gain(0.5)`;

type StrudelReplWindowProps = {
  onPlayingChange?: (playing: boolean) => void;
};

const StrudelReplWindow = forwardRef<StrudelReplHandle, StrudelReplWindowProps>(function StrudelReplWindow(
  { onPlayingChange },
  ref
) {
  const [ready, setReady] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const webRef = useRef<StrudelWebModule | null>(null);
  const codeRef = useRef(DEFAULT_CODE);

  const ensureAudio = async () => {
    const web = webRef.current;
    if (!web) return;
    web.initAudioOnFirstClick?.();
    await web.initAudio?.();
    const ctx = web.getAudioContext?.();
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
  };

  const run = async () => {
    const web = webRef.current;
    if (!ready || !web?.evaluate) return;
    try {
      await ensureAudio();
      await web.evaluate(codeRef.current, true);
      onPlayingChange?.(true);
    } catch (err) {
      console.error("Strudel update error:", err);
    }
  };

  const play = async () => {
    await run();
  };

  const stop = async () => {
    const web = webRef.current;
    if (!web) return;
    try {
      web.hush?.();
      if (web.evaluate) {
        await web.evaluate("hush()", false);
      }
      onPlayingChange?.(false);
    } catch (err) {
      console.error("Strudel stop error:", err);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      play,
      stop,
      update: run,
    }),
    [ready, onPlayingChange]
  );

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        const [webImport, cmImport] = await Promise.all([import("@strudel/web"), import("@strudel/codemirror")]);
        if (!mounted || !editorRootRef.current) return;

        const web = webImport as unknown as StrudelWebModule;
        const cm = cmImport as unknown as StrudelCodeMirrorModule;
        webRef.current = web;

        await web.initStrudel();
        if (!mounted || !editorRootRef.current) return;

        editorRef.current = cm.initEditor({
          root: editorRootRef.current,
          initialCode: DEFAULT_CODE,
          onChange: (event) => {
            if (!event.docChanged) return;
            const nextCode = event.state?.doc?.toString();
            if (typeof nextCode === "string") {
              codeRef.current = nextCode;
            }
          },
          onEvaluate: () => {
            void run();
          },
          onStop: () => {
            void stop();
          },
        });

        const cmEditor = editorRootRef.current.querySelector<HTMLElement>(".cm-editor");
        const cmScroller = editorRootRef.current.querySelector<HTMLElement>(".cm-scroller");
        const cmContent = editorRootRef.current.querySelector<HTMLElement>(".cm-content");

        if (cmEditor) {
          cmEditor.style.height = "100%";
        }
        if (cmScroller) {
          cmScroller.style.height = "100%";
          cmScroller.style.fontFamily = "monospace";
        }
        if (cmContent) {
          cmContent.style.paddingTop = "8px";
        }

        if (!mounted) return;
        setReady(true);
      } catch (err) {
        if (!mounted) return;
        console.error("Failed to initialize Strudel editor:", err);
      }
    }

    void boot();

    return () => {
      mounted = false;
      void stop();
      editorRef.current?.destroy?.();
      editorRef.current = null;
      webRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--background, #222)",
        overflow: "hidden",
      }}
      ref={editorRootRef}
    />
  );
});

export default StrudelReplWindow;
