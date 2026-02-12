"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type StrudelReplHandle = {
  play: () => Promise<void>;
  stop: () => Promise<void>;
  update: () => Promise<void>;
  setCode: (code: string) => void;
  setTone: (tone: string) => void;
  appendCode: (code: string) => void;
};

type StrudelWebModule = {
  initStrudel: () => Promise<unknown>;
  initAudio?: () => Promise<unknown>;
  initAudioOnFirstClick?: () => void;
  getAudioContext?: () => AudioContext | null;
  getSuperdoughAudioController?: () => unknown;
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
  setCode?: (code: string) => void;
  state?: { doc?: { length: number } };
  dispatch?: (update: { changes: { from: number; to: number; insert: string } }) => void;
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

const DEFAULT_CODE = `$: note("c a f e").s("sine").lpf(800)`;
const ANALYZER_ID = 1;
const SCOPE_STRIP_HEIGHT_PX = 14;

type StrudelCompositePanelProps = {
  isPlaying: boolean;
  ready: boolean;
  editorRootRef: React.RefObject<HTMLDivElement | null>;
  waveGlowPathRef: React.RefObject<SVGPathElement | null>;
  wavePathRef: React.RefObject<SVGPathElement | null>;
};

function StrudelCompositePanel({
  isPlaying,
  ready,
  editorRootRef,
  waveGlowPathRef,
  wavePathRef,
}: StrudelCompositePanelProps) {
  return (
    <div
      style={{
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: SCOPE_STRIP_HEIGHT_PX,
          marginBottom: 2,
          background: "#c0c0c0",
          overflow: "hidden",
          borderTop: "1px solid #dfdfdf",
          borderBottom: "1px solid #7f7f7f",
          pointerEvents: "none",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 5,
            height: 1,
            background: "#ffffff",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 6,
            height: 1,
            background: "#5d5d5d",
          }}
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            opacity: isPlaying ? 1 : 0.9,
            transition: "opacity 120ms ease",
            position: "relative",
          }}
        >
          <path ref={waveGlowPathRef} d="M 0 50 L 100 50" fill="none" stroke="rgba(120,120,120,0.25)" strokeWidth="4" />
          <path ref={wavePathRef} d="M 0 50 L 100 50" fill="none" stroke="#3a3a3a" strokeWidth="1.6" />
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
}

type StrudelReplWindowProps = {
  onPlayingChange?: (playing: boolean) => void;
  onLevelChange?: (level: number) => void;
  onSyncChange?: (inSync: boolean) => void;
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

function hasLabelPatterns(code: string): boolean {
  return /(^|\n)\s*[$A-Za-z_][\w$]*\s*:/m.test(code);
}

function withTone(code: string, tone: string): string {
  const toneCall = `.s("${tone}")`;
  if (/\.s\(\s*["'][^"']+["']\s*\)/.test(code)) {
    return code.replace(/\.s\(\s*["'][^"']+["']\s*\)/, toneCall);
  }
  const trimmed = code.trimEnd();
  return `${trimmed}\n  ${toneCall}`;
}

function extractNoteTokens(code: string): string[] {
  const tokens: string[] = [];
  const noteRegex = /note\(\s*["']([^"']*)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = noteRegex.exec(code)) !== null) {
    const body = (match[1] ?? "").trim();
    if (!body) continue;
    const parts = body.split(/\s+/).filter(Boolean);
    tokens.push(...parts);
  }
  return tokens;
}

function hashToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const StrudelReplWindow = forwardRef<StrudelReplHandle, StrudelReplWindowProps>(function StrudelReplWindow(
  { onPlayingChange, onLevelChange, onSyncChange },
  ref
) {
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const waveGlowPathRef = useRef<SVGPathElement | null>(null);
  const wavePathRef = useRef<SVGPathElement | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const webRef = useRef<StrudelWebModule | null>(null);
  const codeRef = useRef(DEFAULT_CODE);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserDataRef = useRef<Float32Array | null>(null);
  const outputAnalyserSourceRef = useRef<AudioNode | null>(null);
  const lastEvaluatedCodeRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const levelLastEmitAtRef = useRef(0);
  const levelLastValueRef = useRef(0);

  const normalizeCode = (code: string): string => code.trim().replace(/;+\s*$/, "");

  const emitSync = () => {
    const inSync =
      playingRef.current &&
      lastEvaluatedCodeRef.current !== null &&
      normalizeCode(lastEvaluatedCodeRef.current) === normalizeCode(codeRef.current);
    onSyncChange?.(inSync);
  };

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

  const ensureOutputAnalyser = () => {
    const web = webRef.current;
    if (!web) return;
    if (outputAnalyserRef.current) return;
    const ctx = web.getAudioContext?.();
    const controller = web.getSuperdoughAudioController?.() as { output?: { destinationGain?: AudioNode } } | undefined;
    const source = controller?.output?.destinationGain;
    if (!ctx || !source) return;
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      outputAnalyserRef.current = analyser;
      outputAnalyserDataRef.current = new Float32Array(analyser.fftSize);
      outputAnalyserSourceRef.current = source;
    } catch (err) {
      console.warn("Failed to attach output analyser:", err);
    }
  };

  const getScopeSamples = (): ArrayLike<number> | undefined => {
    const analyser = outputAnalyserRef.current;
    const data = outputAnalyserDataRef.current;
    if (analyser && data) {
      (analyser as unknown as { getFloatTimeDomainData: (array: ArrayLike<number>) => void }).getFloatTimeDomainData(data);
      return data;
    }
    return webRef.current?.getAnalyzerData?.("time", ANALYZER_ID);
  };

  const run = async () => {
    const web = webRef.current;
    if (!ready || !web?.evaluate) return;
      try {
        await ensureAudio();
        ensureOutputAnalyser();
        if (hasLabelPatterns(codeRef.current)) {
          await web.evaluate(codeRef.current, true);
          lastEvaluatedCodeRef.current = codeRef.current;
          playingRef.current = true;
          setIsPlaying(true);
          onPlayingChange?.(true);
          emitSync();
          return;
        }
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
      lastEvaluatedCodeRef.current = codeRef.current;
      playingRef.current = true;
      setIsPlaying(true);
      onPlayingChange?.(true);
      emitSync();
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
      playingRef.current = false;
      setIsPlaying(false);
      onPlayingChange?.(false);
      emitSync();
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
      setCode: (code: string) => {
        codeRef.current = code;
        const editor = editorRef.current;
        if (!editor) {
          emitSync();
          return;
        }
        if (typeof editor.setCode === "function") {
          editor.setCode(code);
          emitSync();
          return;
        }
        const docLength = editor.state?.doc?.length;
        if (typeof editor.dispatch === "function" && typeof docLength === "number") {
          editor.dispatch({
            changes: {
              from: 0,
              to: docLength,
              insert: code,
            },
          });
        }
        emitSync();
      },
      setTone: (tone: string) => {
        const nextCode = withTone(codeRef.current, tone);
        codeRef.current = nextCode;
        const editor = editorRef.current;
        if (!editor) {
          emitSync();
          return;
        }
        if (typeof editor.setCode === "function") {
          editor.setCode(nextCode);
          emitSync();
          return;
        }
        const docLength = editor.state?.doc?.length;
        if (typeof editor.dispatch === "function" && typeof docLength === "number") {
          editor.dispatch({
            changes: {
              from: 0,
              to: docLength,
              insert: nextCode,
            },
          });
        }
        emitSync();
      },
      appendCode: (code: string) => {
        const prefix = codeRef.current.trimEnd().length ? "\n" : "";
        const nextCode = `${codeRef.current}${prefix}${code}`;
        codeRef.current = nextCode;
        const editor = editorRef.current;
        if (!editor) {
          emitSync();
          return;
        }
        if (typeof editor.setCode === "function") {
          editor.setCode(nextCode);
          emitSync();
          return;
        }
        const docLength = editor.state?.doc?.length;
        if (typeof editor.dispatch === "function" && typeof docLength === "number") {
          editor.dispatch({
            changes: {
              from: 0,
              to: docLength,
              insert: nextCode,
            },
          });
        }
        emitSync();
      },
    }),
    [ready, onPlayingChange, onSyncChange]
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
        ensureOutputAnalyser();
        if (!mounted || !editorRootRef.current) return;

        editorRef.current = cm.initEditor({
          root: editorRootRef.current,
          initialCode: codeRef.current,
          onChange: (event) => {
            if (!event.docChanged) return;
            const nextCode = event.state?.doc?.toString();
            if (typeof nextCode === "string") {
              codeRef.current = nextCode;
              emitSync();
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
      if (outputAnalyserSourceRef.current && outputAnalyserRef.current) {
        try {
          outputAnalyserSourceRef.current.disconnect(outputAnalyserRef.current);
        } catch {
          // noop
        }
      }
      outputAnalyserSourceRef.current = null;
      outputAnalyserDataRef.current = null;
      outputAnalyserRef.current = null;
      setIsPlaying(false);
      webRef.current = null;
      onSyncChange?.(false);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const animate = (now: number) => {
      const wave = wavePathRef.current;
      const waveGlow = waveGlowPathRef.current;
      if (wave && waveGlow) {
        const samples = getScopeSamples();
        const pointCount = 180;
        const dParts: string[] = ["M 0 50"];
        let usedAudioSamples = false;
        if (samples && samples.length > 0) {
          const sampleCount = samples.length;
          let energy = 0;
          for (let i = 0; i < sampleCount; i += 1) {
            const raw = Number(samples[i] ?? 0);
            const normalized = raw >= -1 && raw <= 1 ? raw : (raw / 128) - 1;
            energy += Math.abs(normalized);
          }
          const avgEnergy = energy / sampleCount;
          usedAudioSamples = avgEnergy > 0.004;
          if (usedAudioSamples) {
            const scroll = Math.floor((now * 0.06) % sampleCount);
            for (let i = 0; i <= pointCount; i += 1) {
              const x = (i / pointCount) * 100;
              const idx = (scroll + Math.floor((i / pointCount) * (sampleCount - 1))) % sampleCount;
              const raw = Number(samples[idx] ?? 0);
              const normalized = raw >= -1 && raw <= 1 ? raw : (raw / 128) - 1;
              const y = 50 - normalized * 42;
              dParts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
            }
          }
        }
        if (!usedAudioSamples && playingRef.current) {
          const tokens = extractNoteTokens(codeRef.current);
          if (tokens.length > 0) {
            const total = Math.max(1, tokens.length);
            for (let i = 0; i <= pointCount; i += 1) {
              const xRatio = i / pointCount;
              const x = xRatio * 100;
              const noteIndex = Math.min(total - 1, Math.floor(xRatio * total));
              const token = tokens[noteIndex] ?? "c4";
              const h = hashToken(token);
              const amp = 0.2 + (h % 100) / 200; // 0.2..0.7
              const freq = 1 + ((h >> 7) % 3); // 1..3 cycles within segment
              const localX = (xRatio * total) - noteIndex;
              const phase = (now / 1000) * (1.4 + ((h >> 11) % 5) * 0.2);
              const y = 50 - Math.sin((localX * freq * Math.PI * 2) + phase) * (amp * 30);
              dParts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
            }
          } else {
            dParts.push("L 100 50");
          }
        } else if (!usedAudioSamples) {
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
      const data = getScopeSamples();
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
      <StrudelCompositePanel
        isPlaying={isPlaying}
        ready={ready}
        editorRootRef={editorRootRef}
        waveGlowPathRef={waveGlowPathRef}
        wavePathRef={wavePathRef}
      />
    </div>
  );
});

export default StrudelReplWindow;
