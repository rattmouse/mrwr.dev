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
  getAnalyzerData?: (kind: "time" | "frequency", id: number) => ArrayLike<number> | undefined;
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
const ANALYZER_ID = 1;

type StrudelReplWindowProps = {
  onPlayingChange?: (playing: boolean) => void;
  onLevelChange?: (level: number) => void;
};

function withAnalyzer(code: string): string {
  const trimmed = code.trim().replace(/;+\s*$/, "");
  if (!trimmed) return code;
  if (/\banalyze\s*\(/.test(trimmed)) return trimmed;
  return `(${trimmed}).analyze(${ANALYZER_ID})`;
}

function withAnalyzerSuffix(code: string): string {
  const trimmed = code.trim().replace(/;+\s*$/, "");
  if (!trimmed) return code;
  if (/\banalyze\s*\(/.test(trimmed)) return trimmed;
  return `${trimmed}\n.analyze(${ANALYZER_ID})`;
}

const StrudelReplWindow = forwardRef<StrudelReplHandle, StrudelReplWindowProps>(function StrudelReplWindow(
  { onPlayingChange, onLevelChange },
  ref
) {
  const [ready, setReady] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const waveGlowPathRef = useRef<SVGPathElement | null>(null);
  const wavePathRef = useRef<SVGPathElement | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const webRef = useRef<StrudelWebModule | null>(null);
  const codeRef = useRef(DEFAULT_CODE);
  const levelLastEmitAtRef = useRef(0);
  const levelLastValueRef = useRef(0);

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
      try {
        await web.evaluate(withAnalyzer(codeRef.current), true);
      } catch (wrappedErr) {
        try {
          await web.evaluate(withAnalyzerSuffix(codeRef.current), true);
        } catch {
          console.warn("Analyzer injection failed, running raw code.", wrappedErr);
          await web.evaluate(codeRef.current, true);
        }
      }
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

  useEffect(() => {
    let raf = 0;
    const animate = (now: number) => {
      const wave = wavePathRef.current;
      const waveGlow = waveGlowPathRef.current;
      if (wave && waveGlow) {
        const samples = webRef.current?.getAnalyzerData?.("time", ANALYZER_ID);
        const pointCount = 64;
        const dParts: string[] = ["M 0 50"];

        if (samples && samples.length > 0) {
          const sampleCount = samples.length;
          let triggerIndex = 0;
          for (let i = 1; i < sampleCount; i += 1) {
            const prevRaw = Number(samples[i - 1] ?? 0);
            const currRaw = Number(samples[i] ?? 0);
            const prev = prevRaw >= -1 && prevRaw <= 1 ? prevRaw : (prevRaw / 128) - 1;
            const curr = currRaw >= -1 && currRaw <= 1 ? currRaw : (currRaw / 128) - 1;
            if (prev > 0 && curr <= 0) {
              triggerIndex = i;
              break;
            }
          }
          for (let i = 0; i <= pointCount; i += 1) {
            const x = (i / pointCount) * 100;
            const idx = (triggerIndex + Math.floor((i / pointCount) * (sampleCount - 1))) % sampleCount;
            const raw = Number(samples[idx] ?? 0);
            const normalized = raw >= -1 && raw <= 1 ? raw : (raw / 128) - 1;
            const y = 50 - normalized * 40;
            dParts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
          }
        } else {
          dParts.push("L 100 50");
        }
        const d = dParts.join(" ");
        wave.setAttribute("d", d);
        waveGlow.setAttribute("d", d);
      }
      raf = window.requestAnimationFrame(animate);
    };
    raf = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const data = webRef.current?.getAnalyzerData?.("time", ANALYZER_ID);
      let level = 0;
      if (data && data.length) {
        let sum = 0;
        const count = data.length;
        for (let i = 0; i < count; i += 1) {
          const v = Number(data[i] ?? 0);
          const normalized = v >= -1 && v <= 1 ? v : (v / 128) - 1;
          sum += Math.abs(normalized);
        }
        level = Math.min(1, (sum / count) * 2.2);
      }
      if (onLevelChange && (now - levelLastEmitAtRef.current > 66 || Math.abs(level - levelLastValueRef.current) > 0.08)) {
        levelLastEmitAtRef.current = now;
        levelLastValueRef.current = level;
        onLevelChange(level);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      onLevelChange?.(0);
    };
  }, [onLevelChange]);

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
    >
      <div
        style={{
          flex: "0 0 20px",
          minHeight: 20,
          borderTop: "1px solid #808080",
          background: "#121414",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <path ref={waveGlowPathRef} d="M 0 50 L 100 50" fill="none" stroke="rgba(0,245,179,0.30)" strokeWidth="10" />
          <path ref={wavePathRef} d="M 0 50 L 100 50" fill="none" stroke="#00f5b3" strokeWidth="2" />
        </svg>
      </div>
      <div
        ref={editorRootRef}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {!ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#cfcfcf",
              fontFamily: "monospace",
              fontSize: 12,
              background: "#121414",
              zIndex: 1,
            }}
          >
            loading strudel...
          </div>
        )}
      </div>
    </div>
  );
});

export default StrudelReplWindow;
