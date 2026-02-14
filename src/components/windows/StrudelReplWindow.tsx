"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import OscilloscopeWindow from "@/components/windows/OscilloscopeWindow";

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
const WINDOW_CONTENT_PAD_PX = 6;
const SCOPE_EDITOR_GAP_PX = 2;
const DEFAULT_SCOPE_POPUP_SIZE = { width: 112, height: 78 };
const POPUP_SIDE_GAP_PX = 8;
const POPUP_BOTTOM_GAP_PX = 8;
const POPUP_TOP_GAP_PX = 18;

type PopupCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

function getScopePopupSize(containerWidth: number, containerHeight: number, compact: boolean) {
  const w = Math.max(1, containerWidth);
  const h = Math.max(1, containerHeight);

  if (compact) {
    return {
      width: Math.max(96, Math.min(156, Math.round(w * 0.4))),
      height: Math.max(68, Math.min(112, Math.round(h * 0.34))),
    };
  }

  return {
    width: Math.max(160, Math.min(320, Math.round(w * 0.36))),
    height: Math.max(108, Math.min(220, Math.round(h * 0.32))),
  };
}

type StrudelCompositePanelProps = {
  isPlaying: boolean;
  ready: boolean;
  editorRootRef: React.RefObject<HTMLDivElement | null>;
  topWaveGlowPathRef: React.RefObject<SVGPathElement | null>;
  topWavePathRef: React.RefObject<SVGPathElement | null>;
};

function StrudelCompositePanel({
  isPlaying,
  ready,
  editorRootRef,
  topWaveGlowPathRef,
  topWavePathRef,
}: StrudelCompositePanelProps) {
  return (
    <div
      style={{
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -WINDOW_CONTENT_PAD_PX,
          right: -WINDOW_CONTENT_PAD_PX,
          top: -WINDOW_CONTENT_PAD_PX,
          height: SCOPE_STRIP_HEIGHT_PX,
          background: "#c0c0c0",
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        {!isPlaying && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: Math.floor(SCOPE_STRIP_HEIGHT_PX / 2) - 1,
                height: 1,
                background: "#7f7f7f",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: Math.floor(SCOPE_STRIP_HEIGHT_PX / 2),
                height: 1,
                background: "#ffffff",
              }}
            />
          </>
        )}
        {isPlaying && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              opacity: 1,
              position: "relative",
            }}
          >
            <path ref={topWaveGlowPathRef} d="M 0 50 L 100 50" fill="none" stroke="rgba(120,120,120,0.25)" strokeWidth="4" />
            <path ref={topWavePathRef} d="M 0 50 L 100 50" fill="none" stroke="#3a3a3a" strokeWidth="1.6" />
          </svg>
        )}
      </div>
      <div
        ref={editorRootRef}
        style={{
          position: "absolute",
          inset: `${SCOPE_STRIP_HEIGHT_PX + SCOPE_EDITOR_GAP_PX}px 0 0 0`,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          zIndex: 1,
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
  scopePopupOpen?: boolean;
  scopePopupCompact?: boolean;
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
  { onPlayingChange, onLevelChange, onSyncChange, scopePopupOpen = false, scopePopupCompact = true },
  ref
) {
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scopePopupSize, setScopePopupSize] = useState(DEFAULT_SCOPE_POPUP_SIZE);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [scopePopupCorner, setScopePopupCorner] = useState<PopupCorner>("bottom-left");
  const [scopePopupDragPos, setScopePopupDragPos] = useState<{ x: number; y: number } | null>(null);
  const scopePopupDragPosRef = useRef<{ x: number; y: number } | null>(null);
  const scopePopupDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const scopePopupDraggingRef = useRef(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const topWaveGlowPathRef = useRef<SVGPathElement | null>(null);
  const topWavePathRef = useRef<SVGPathElement | null>(null);
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
      const wave = topWavePathRef.current;
      const glow = topWaveGlowPathRef.current;
      if (wave && glow) {
        const samples = getScopeSamples();
        if (samples && samples.length > 0) {
          window.dispatchEvent(
            new CustomEvent("strudel-scope-data", {
              detail: { id: ANALYZER_ID, samples },
            })
          );
        }
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
        glow.setAttribute("d", d);
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

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
      setScopePopupSize(getScopePopupSize(rect.width, rect.height, scopePopupCompact));
    };

    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [scopePopupCompact]);

  useEffect(() => {
    if (!scopePopupOpen) {
      setScopePopupDragPos(null);
      scopePopupDragPosRef.current = null;
      scopePopupDragOffsetRef.current = null;
      scopePopupDraggingRef.current = false;
    }
  }, [scopePopupOpen]);

  const popupPadding = scopePopupCompact ? 2 : 3;
  const popupOuterWidth = scopePopupSize.width + popupPadding * 2 + 4;
  const popupOuterHeight = scopePopupSize.height + popupPadding * 2 + 4;
  const effectiveContainerWidth = containerSize.width || rootRef.current?.getBoundingClientRect().width || 0;
  const effectiveContainerHeight = containerSize.height || rootRef.current?.getBoundingClientRect().height || 0;

  const getSnappedPopupPosition = (corner: PopupCorner, containerW: number, containerH: number) => {
    if (corner === "top-left") return { x: POPUP_SIDE_GAP_PX, y: POPUP_TOP_GAP_PX };
    if (corner === "top-right") {
      return {
        x: Math.max(POPUP_SIDE_GAP_PX, containerW - popupOuterWidth - POPUP_SIDE_GAP_PX),
        y: POPUP_TOP_GAP_PX,
      };
    }
    if (corner === "bottom-left") {
      return {
        x: POPUP_SIDE_GAP_PX,
        y: Math.max(POPUP_TOP_GAP_PX, containerH - popupOuterHeight - POPUP_BOTTOM_GAP_PX),
      };
    }
    return {
      x: Math.max(POPUP_SIDE_GAP_PX, containerW - popupOuterWidth - POPUP_SIDE_GAP_PX),
      y: Math.max(POPUP_TOP_GAP_PX, containerH - popupOuterHeight - POPUP_BOTTOM_GAP_PX),
    };
  };

  const clampPopupPosition = (x: number, y: number, containerW: number, containerH: number) => {
    const minX = POPUP_SIDE_GAP_PX;
    const minY = POPUP_TOP_GAP_PX;
    const maxX = Math.max(minX, containerW - popupOuterWidth - POPUP_SIDE_GAP_PX);
    const maxY = Math.max(minY, containerH - popupOuterHeight - POPUP_BOTTOM_GAP_PX);
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  };

  const onPopupPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    const popupRect = event.currentTarget.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    scopePopupDraggingRef.current = true;
    scopePopupDragOffsetRef.current = {
      x: event.clientX - popupRect.left,
      y: event.clientY - popupRect.top,
    };
    const initial = {
      x: popupRect.left - rootRect.left,
      y: popupRect.top - rootRect.top,
    };
    scopePopupDragPosRef.current = initial;
    setScopePopupDragPos(initial);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPopupPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scopePopupDraggingRef.current) return;
    const root = rootRef.current;
    const offset = scopePopupDragOffsetRef.current;
    if (!root || !offset) return;
    const rootRect = root.getBoundingClientRect();
    const nextX = event.clientX - rootRect.left - offset.x;
    const nextY = event.clientY - rootRect.top - offset.y;
    const clamped = clampPopupPosition(nextX, nextY, rootRect.width, rootRect.height);
    scopePopupDragPosRef.current = clamped;
    setScopePopupDragPos(clamped);
  };

  const onPopupPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scopePopupDraggingRef.current) return;
    scopePopupDraggingRef.current = false;
    scopePopupDragOffsetRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // noop
    }

    const root = rootRef.current;
    if (!root) {
      scopePopupDragPosRef.current = null;
      setScopePopupDragPos(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const currentPos = scopePopupDragPosRef.current ?? getSnappedPopupPosition(scopePopupCorner, rootRect.width, rootRect.height);
    const centerX = currentPos.x + popupOuterWidth / 2;
    const centerY = currentPos.y + popupOuterHeight / 2;
    const horizontal = centerX < rootRect.width / 2 ? "left" : "right";
    const vertical = centerY < rootRect.height / 2 ? "top" : "bottom";
    setScopePopupCorner(`${vertical}-${horizontal}` as PopupCorner);
    scopePopupDragPosRef.current = null;
    setScopePopupDragPos(null);
  };

  return (
    <div
      ref={rootRef}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--background, #222)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {scopePopupOpen && (
        <div
          onPointerDown={onPopupPointerDown}
          onPointerMove={onPopupPointerMove}
          onPointerUp={onPopupPointerUp}
          style={{
            position: "absolute",
            left:
              scopePopupDragPos?.x ??
              getSnappedPopupPosition(
                scopePopupCorner,
                effectiveContainerWidth,
                effectiveContainerHeight
              ).x,
            top:
              scopePopupDragPos?.y ??
              getSnappedPopupPosition(
                scopePopupCorner,
                effectiveContainerWidth,
                effectiveContainerHeight
              ).y,
            zIndex: 5,
            pointerEvents: "auto",
            background: "#c0c0c0",
            borderTop: "2px solid #fff",
            borderLeft: "2px solid #fff",
            borderRight: "2px solid #000",
            borderBottom: "2px solid #000",
            boxSizing: "border-box",
            padding: popupPadding,
            cursor: scopePopupDragPos ? "grabbing" : "grab",
            touchAction: "none",
            width: "fit-content",
            height: "fit-content",
          }}
        >
          <div
            style={{
              width: scopePopupSize.width,
              height: scopePopupSize.height,
              border: "1px solid #808080",
              background: "#0d1010",
              overflow: "hidden",
              boxSizing: "border-box",
            }}
            aria-label={scopePopupCompact ? "Mini scope popup" : "Scope popup"}
          >
            <OscilloscopeWindow />
          </div>
        </div>
      )}
      <StrudelCompositePanel
        isPlaying={isPlaying}
        ready={ready}
        editorRootRef={editorRootRef}
        topWaveGlowPathRef={topWaveGlowPathRef}
        topWavePathRef={topWavePathRef}
      />
    </div>
  );
});

export default StrudelReplWindow;
