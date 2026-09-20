"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button, MenuList, MenuListItem, ScrollView, Slider } from "react95";
import { auToWav, isAuName } from "@/lib/sunAu";

export type PlayerWindowHandle = {
  /** Replace the playlist with these files (a pick, a folder, a drop). */
  openFiles: (files: FileList | File[]) => void;
  /** Add these files to the end of the playlist. */
  addFiles: (files: FileList | File[]) => void;
  clear: () => void;
};

type Kind = "audio" | "video";

type Track = {
  key: string;
  /** A file off this machine, or a URL on this site (fetched only when played). */
  source: File | string;
  name: string;
  /** Folder-relative path when it came from a folder, else the file name. */
  path: string;
  kind: Kind;
  /** Set once the browser has refused to play it. */
  failed?: boolean;
};

const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "au", "snd"];
const VIDEO_EXT = ["mp4", "m4v", "webm", "ogv", "mov", "mkv", "avi", "3gp"];

/** What the file-picker offers — the same list the folder scan keeps. */
export const PLAYER_ACCEPT = [
  "audio/*",
  "video/*",
  ...AUDIO_EXT.map((ext) => `.${ext}`),
  ...VIDEO_EXT.map((ext) => `.${ext}`),
].join(",");

function kindOf(file: File): Kind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/") && !file.type.includes("midi")) return "audio";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

let keySeq = 0;
const nextKey = () => `t${++keySeq}`;

// What the playlist starts with, every time the window opens.
const STARTER: Track[] = [
  { key: "drone", source: "/drone-loop.au", name: "drone-loop.au", path: "drone-loop.au", kind: "audio" },
];

// Folders come back in whatever order the OS lists them; sort the way a person
// would read them, so "2 - intro" plays before "10 - outro".
function toTracks(files: FileList | File[]): Track[] {
  return Array.from(files)
    .map((file) => {
      const kind = kindOf(file);
      if (!kind) return null;
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const track: Track = { key: nextKey(), source: file, name: file.name, path, kind };
      return track;
    })
    .filter((track): track is Track => track !== null)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

async function fetchBlob(url: string, onProgress: (fraction: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    got += value.length;
    onProgress(got / total);
  }
  return new Blob(chunks);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const stripExt = (name: string) => name.replace(/\.[^.]*$/, "") || name;

// Seek bar resolution: the Slider works in whole steps, so tenths of a second.
const SEEK_STEPS = 10;
// react95's Slider centres its 18px thumb on the value, so it overhangs each
// end of the track by half that — pad for it, and measure positions inside it.
const THUMB_INSET = 9;

/* Toolbar glyphs, drawn on a 12px grid in flat black, square-edged so they
   stay crisp like Windows 95's. Every button in the window uses one — the
   transport included, rather than the ⏮ ⏹ ⏭ characters, which a font draws
   in its own weight and shape and so never quite matched the rest. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/* Transport trio. All three sit on the same 8×8 footprint as PauseIcon — a
   bar and a stepped triangle either side of centre, mirrored between prev and
   next — so the four buttons read as one row. */
const PrevIcon = () => (
  <Glyph>
    <path d="M2 2h2v8H2z" fill="currentColor" />
    <path d="M6 5h1v2H6zM7 4h1v4H7zM8 3h1v6H8zM9 2h1v8H9z" fill="currentColor" />
  </Glyph>
);

const StopIcon = () => (
  <Glyph>
    <path d="M2 2h8v8H2z" fill="currentColor" />
  </Glyph>
);

const NextIcon = () => (
  <Glyph>
    <path d="M2 2h1v8H2zM3 3h1v6H3zM4 4h1v4H4zM5 5h1v2H5z" fill="currentColor" />
    <path d="M8 2h2v8H8z" fill="currentColor" />
  </Glyph>
);

const PlayIcon = () => (
  <Glyph>
    <path d="M3 1h1v10H3zM4 2h1v8H4zM5 3h1v6H5zM6 4h1v4H6zM7 5h1v2H7z" fill="currentColor" />
  </Glyph>
);

const PauseIcon = () => (
  <Glyph>
    <path d="M2 2h3v8H2zM7 2h3v8H7z" fill="currentColor" />
  </Glyph>
);

const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <Glyph>
    <path d="M0 4h2v4H0zM2 4h1v4H2zM3 3h1v6H3zM4 2h1v8H4zM5 1h1v10H5z" fill="currentColor" />
    {muted ? (
      <path d="M7 4h1v1H7zM8 5h1v1H8zM9 6h1v1H9zM10 7h1v1h-1zM10 4h1v1h-1zM9 5h1v1H9zM8 6h1v1H8zM7 7h1v1H7z" fill="currentColor" />
    ) : (
      <path d="M7 5h1v2H7zM8 3h1v1H8zM9 4h1v4H9zM8 8h1v1H8zM10 2h1v1h-1zM11 3h1v6h-1zM10 9h1v1h-1z" fill="currentColor" />
    )}
  </Glyph>
);

const ShuffleIcon = () => (
  <Glyph>
    <path
      d="M0 2h3v1H0zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v2H5zM6 7h1v1H6zM7 8h1v1H7zM8 9h2v1H8zM0 9h3v1H0zM3 8h1v1H3zM4 7h1v1H4zM6 4h1v1H6zM7 3h1v1H7zM8 2h2v1H8z"
      fill="currentColor"
    />
    <path d="M10 0h1v5h-1zM11 1h1v3h-1zM10 7h1v5h-1zM11 8h1v3h-1z" fill="currentColor" />
  </Glyph>
);

const RepeatIcon = () => (
  <Glyph>
    <path d="M1 3h8v1H1zM1 4h1v4H1zM3 8h8v1H3zM10 4h1v4h-1z" fill="currentColor" />
    <path d="M8 1h1v5H8zM9 2h1v3H9zM3 6h1v5H3zM2 7h1v3H2z" fill="currentColor" />
  </Glyph>
);

const RemoveIcon = () => (
  <Glyph>
    <path
      d="M2 2h2v1H2zM3 3h2v1H3zM4 4h2v1H4zM5 5h2v2H5zM6 7h2v1H6zM7 8h2v1H7zM8 9h2v1H8zM8 2h2v1H8zM7 3h2v1H7zM6 4h2v1H6zM4 7h2v1H4zM3 8h2v1H3zM2 9h2v1H2z"
      fill="currentColor"
    />
  </Glyph>
);

// A Windows 95 tooltip: pale yellow, hairline black border, no shadow.
const TOOLTIP_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  transform: "translateX(-50%)",
  marginBottom: 2,
  padding: "1px 4px",
  background: "#ffffe1",
  color: "#000",
  border: "1px solid #000",
  fontSize: 11,
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 2,
};

export type VizMode = "bars" | "wave" | "spectrum";

/** What each view is called in the View menu, in the order it's listed. */
export const VIZ_MODES: { id: VizMode; label: string; title: string }[] = [
  { id: "bars", label: "Bars", title: "A level meter, loudest band by band" },
  { id: "wave", label: "Wave", title: "The waveform as it plays" },
  { id: "spectrum", label: "Spectrum", title: "A spectrogram scrolling past" },
];

// One phosphor green, the way an old scope tube only ever had one: a soft
// body, a brighter core where the beam sits, and a glow around it.
const CRT_BODY = "rgba(61, 255, 106, 0.45)";
const CRT_TRACE = "rgba(61, 255, 106, 0.85)";
const CRT_CORE = "#ccffd6";
const CRT_GLOW = "rgba(61, 255, 106, 0.75)";

/**
 * The visualiser under an audio track's name, drawn straight onto the screen's
 * black as a little monochrome CRT: one phosphor green, a faint scanline
 * raster punched through it, and persistence — each frame fades the last
 * rather than wiping it, so the beam leaves an afterglow behind it. The View
 * menu picks between three:
 *
 * - bars: a band-by-band level meter, each bar a lit column with a bright cap
 *   riding the loudest it has lately been.
 * - wave: the waveform as a single glowing trace, scaled to whatever the track
 *   is doing, smearing as it moves like a scope with a slow tube.
 * - spectrum: a spectrogram scrolling leftwards, bass at the bottom, the
 *   brightest moments burning white-green before they fade away.
 *
 * All three settle to nothing when the track stops; the spectrogram holds the
 * last of what it drew rather than scrolling silence across itself.
 */
function Visualizer({
  analyser,
  playing,
  mode,
}: {
  analyser: AnalyserNode | null;
  playing: boolean;
  mode: VizMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const size = { width: 0, height: 0 };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      size.width = Math.max(1, Math.floor(rect.width));
      size.height = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(size.width * dpr));
      canvas.height = Math.max(1, Math.floor(size.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
    const BAR_W = 5;
    const BAR_GAP = 2;
    const COL_W = 2;
    const SCANLINE = 2;
    // The trace scales itself to the loudest swing it has seen lately: byte
    // frequency data is in decibels, so quiet tracks still light the bars,
    // but the waveform is linear and a quiet one would be a flat line.
    let waveScale = 0.05;
    let raf = 0;

    // The loudest bin in a band, bands spaced geometrically over the part of
    // the spectrum music lives in: the top quarter is mostly air, and a linear
    // split would give the first band everything from bass drum to vocals.
    const bandLevel = (b: number, count: number) => {
      if (!bins || !bins.length) return 0;
      const top = Math.max(8, Math.floor(bins.length * 0.75));
      const from = Math.floor(Math.pow(top, b / count));
      const to = Math.max(from + 1, Math.floor(Math.pow(top, (b + 1) / count)));
      let level = 0;
      for (let i = from; i < Math.min(to, bins.length); i++) level = Math.max(level, bins[i]);
      return level;
    };

    // Persistence: take a little alpha out of everything already on the canvas
    // so the last few frames linger and decay instead of vanishing. Working on
    // alpha rather than painting black keeps the screen's own black showing.
    const fade = (amount: number) => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${amount})`;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.globalCompositeOperation = "source-over";
    };

    // The raster: every other row punched back out, so the black behind shows
    // through in stripes the way a tube's scanlines do.
    const scanlines = (x = 0, w = size.width) => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      for (let y = 0; y < size.height; y += SCANLINE) ctx.fillRect(x, y, w, 1);
      ctx.globalCompositeOperation = "source-over";
    };

    const glow = (blur: number) => {
      ctx.shadowColor = CRT_GLOW;
      ctx.shadowBlur = blur;
    };
    const noGlow = () => {
      ctx.shadowBlur = 0;
    };

    const drawBars = (width: number, height: number) => {
      const step = BAR_W + BAR_GAP;
      const bars = Math.max(8, Math.min(72, Math.floor((width + BAR_GAP) / step)));
      const left = Math.max(0, Math.floor((width - (bars * step - BAR_GAP)) / 2));
      glow(6);
      for (let b = 0; b < bars; b++) {
        const level = bandLevel(b, bars) / 255;
        const lit = Math.round(level * height);
        const x = left + b * step;
        if (lit > 0) {
          ctx.fillStyle = CRT_BODY;
          ctx.fillRect(x, height - lit, BAR_W, lit);
          // The beam is brightest where it turns around, at the bar's top.
          ctx.fillStyle = CRT_TRACE;
          ctx.fillRect(x, height - lit, BAR_W, 1);
        }
        // The cap: where this band's loudest recent moment was, sinking back.
        const peak = Math.max(lit, (peaksRef.current[b] ?? 0) - height * 0.01);
        peaksRef.current[b] = peak;
        if (peak > 1) {
          ctx.fillStyle = CRT_CORE;
          ctx.fillRect(x, Math.max(0, height - Math.round(peak) - 1), BAR_W, 1);
        }
      }
      noGlow();
    };

    const drawWave = (width: number, height: number) => {
      if (!samples || !samples.length) return;
      let loudest = 0;
      for (let i = 0; i < samples.length; i++) {
        loudest = Math.max(loudest, Math.abs((samples[i] - 128) / 128));
      }
      // Snap up to a louder passage at once, ease back down from it.
      waveScale = Math.max(loudest, waveScale * 0.99, 0.01);
      const gain = 0.85 / waveScale;
      const mid = height / 2;

      ctx.beginPath();
      for (let x = 0; x <= width; x++) {
        const i = Math.min(samples.length - 1, Math.floor((x / width) * samples.length));
        const v = Math.max(-1, Math.min(1, ((samples[i] - 128) / 128) * gain));
        const y = mid - v * (mid - 2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Twice over: a soft wide pass for the glow, a hairline for the beam.
      glow(8);
      ctx.strokeStyle = CRT_TRACE;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      noGlow();
      ctx.strokeStyle = CRT_CORE;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const drawSpectrum = (width: number, height: number) => {
      // Shift what's there a column to the left, then paint the newest moment
      // at the right edge. "copy" keeps the black behind it clear.
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(canvas, -COL_W, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(width - COL_W, 0, COL_W, height);

      for (let r = 0; r < height; r++) {
        const level = bandLevel(r, height) / 255;
        if (level < 0.06) continue;
        // Bass at the bottom, treble at the top, the loudest burning white.
        // The curve lifts the quiet detail that a flat scale would lose.
        const bright = Math.min(1, Math.pow(level, 0.7) + 0.15);
        ctx.fillStyle = level > 0.8 ? CRT_CORE : `rgba(61, 255, 106, ${bright})`;
        ctx.fillRect(width - COL_W, height - r - 1, COL_W, 1);
      }
      // Only the new column gets the raster; the rest already has it and
      // punching it again every frame would rub the picture out as it scrolls.
      scanlines(width - COL_W, COL_W);
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { width, height } = size;
      const live = Boolean(analyser && playing);

      if (live && analyser) {
        if (mode === "wave") {
          if (samples) analyser.getByteTimeDomainData(samples as Uint8Array<ArrayBuffer>);
        } else if (bins) {
          analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
        }
      } else {
        bins?.fill(0);
        samples?.fill(128);
      }

      if (mode === "spectrum") {
        // Stopped: hold the last of it on screen rather than scrolling
        // a stripe of silence across the tube.
        if (!live) return;
        drawSpectrum(width, height);
        return;
      }

      fade(mode === "wave" ? 0.22 : 0.3);
      if (live) {
        if (mode === "bars") drawBars(width, height);
        else drawWave(width, height);
      }
      scanlines();
    };
    // A fresh view starts from an empty tube rather than the last one's marks.
    ctx.clearRect(0, 0, size.width, size.height);
    peaksRef.current = [];
    draw();

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [analyser, playing, mode]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        // Out to the edges of the black screen: the card's padding is pulled
        // back so the meter spans it rather than sitting in a column.
        width: "calc(100% + 24px)",
        margin: "0 -12px",
        height: 46,
        background: "transparent",
        imageRendering: "pixelated",
      }}
    />
  );
}

/**
 * A plain Windows-style media player: one screen for video (or a card naming
 * the song), transport buttons, a seek bar and volume, and a playlist
 * underneath. Files come in from File → Open, File → Open folder (every
 * playable file in it, subfolders and all, in name order) or a drop onto the
 * window. .au files, which browsers won't play, are decoded here into WAV.
 * Files stay on this machine — they're played straight from object URLs and
 * nothing is uploaded or remembered between visits. The playlist starts with
 * drone-loop.au from this site, fetched only once it's actually played.
 */
const PlayerWindow = forwardRef<PlayerWindowHandle, { viz?: VizMode }>(function PlayerWindow(
  { viz = "bars" },
  ref,
) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>(STARTER);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(STARTER[0].key);
  const [src, setSrc] = useState<string | undefined>();
  // Fetch/decode progress for the track being readied: 0–1, or null when idle.
  const [loading, setLoading] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Seeking: while the thumb is dragged it holds the target, and nothing seeks
  // until it's let go. Hover shows where a click would land.
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  // Start playing once the next source is on the element.
  const autoplayRef = useRef(false);
  // Decoded .au and fetched tracks, so replaying one doesn't redo the work.
  const blobCache = useRef(new Map<string, Blob>());
  // The spectrum's tap on the audio. Built on first play, because an
  // AudioContext needs a gesture, and kept for the life of the window: an
  // element can only ever be handed to createMediaElementSource once.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const currentIndex = tracks.findIndex((t) => t.key === currentKey);
  const track = currentIndex >= 0 ? tracks[currentIndex] : undefined;
  const readyKey = track && !track.failed ? track.key : null;

  const startAnalyser = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      try {
        const ctx = new Ctx();
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        node.smoothingTimeConstant = 0.7;
        // Through the analyser and straight back out — volume, mute and
        // seeking all still belong to the element itself.
        ctx.createMediaElementSource(el).connect(node);
        node.connect(ctx.destination);
        audioCtxRef.current = ctx;
        setAnalyser(node);
      } catch {
        // No Web Audio here: the player works, it just has no spectrum.
        return;
      }
    }
    void audioCtxRef.current?.resume();
  }, []);

  useEffect(() => () => void audioCtxRef.current?.close(), []);

  const markFailed = useCallback((key: string) => {
    setTracks((prev) => prev.map((t) => (t.key === key ? { ...t, failed: true } : t)));
  }, []);

  // Ready the current track: fetch it if it lives on the site, decode it if
  // it's .au, then hand the element one object URL — freed when it moves on.
  useEffect(() => {
    setSrc(undefined);
    setTime(0);
    setDuration(0);
    if (!readyKey) {
      setLoading(null);
      setPlaying(false);
      return;
    }
    const t = tracksRef.current.find((x) => x.key === readyKey);
    if (!t) return;
    let cancelled = false;
    let url: string | undefined;
    setLoading(0);
    (async () => {
      let blob = blobCache.current.get(t.key);
      if (!blob) {
        const raw =
          typeof t.source === "string"
            ? await fetchBlob(t.source, (p) => !cancelled && setLoading(p))
            : t.source;
        if (cancelled) return;
        setLoading(1);
        if (isAuName(t.name)) {
          // Give "Decoding…" a frame to paint before the busy loop.
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
          if (cancelled) return;
          blob = await auToWav(raw);
        } else {
          blob = raw;
        }
        if (typeof t.source === "string" || isAuName(t.name)) blobCache.current.set(t.key, blob);
      }
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
      setLoading(null);
    })().catch(() => {
      if (cancelled) return;
      setLoading(null);
      markFailed(t.key);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [readyKey, markFailed]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = volume / 100;
    el.muted = muted;
  }, [volume, muted, src]);

  useEffect(() => {
    const el = mediaRef.current;
    if (el && src && autoplayRef.current) el.play().catch(() => setPlaying(false));
  }, [src]);

  const nextIndex = useCallback(
    (from: number, step: 1 | -1): number => {
      const playable = tracks.map((t, i) => (t.failed ? -1 : i)).filter((i) => i >= 0);
      if (playable.length === 0) return -1;
      if (shuffle && step === 1) {
        const others = playable.filter((i) => i !== from);
        return others.length ? others[Math.floor(Math.random() * others.length)] : from;
      }
      for (let n = 1; n <= tracks.length; n++) {
        const i = from + step * n;
        if ((i < 0 || i >= tracks.length) && !repeat) return -1;
        const wrapped = ((i % tracks.length) + tracks.length) % tracks.length;
        if (!tracks[wrapped].failed) return wrapped;
      }
      return -1;
    },
    [tracks, shuffle, repeat],
  );

  const playKey = useCallback(
    (key: string) => {
      autoplayRef.current = true;
      setSelectedKey(key);
      setCurrentKey(key);
      const el = mediaRef.current;
      // Same track again: the source doesn't change, so restart it by hand.
      if (el && key === currentKey && src) {
        el.currentTime = 0;
        el.play().catch(() => setPlaying(false));
      }
    },
    [currentKey, src],
  );
  const playAt = (index: number) => {
    const t = tracks[index];
    if (t) playKey(t.key);
  };

  const load = useCallback(
    (incoming: FileList | File[], append: boolean) => {
      const added = toTracks(incoming);
      if (added.length === 0) return;
      if (append && tracks.length) {
        setTracks([...tracks, ...added]);
        return;
      }
      autoplayRef.current = true;
      setTracks(added);
      setCurrentKey(added[0].key);
      setSelectedKey(added[0].key);
    },
    [tracks],
  );

  const clear = useCallback(() => {
    autoplayRef.current = false;
    blobCache.current.clear();
    setTracks([]);
    setCurrentKey(null);
    setSelectedKey(null);
  }, []);

  const remove = (key: string) => {
    const index = tracks.findIndex((t) => t.key === key);
    if (index < 0) return;
    const rest = tracks.filter((t) => t.key !== key);
    blobCache.current.delete(key);
    setTracks(rest);
    // The row that slides into its place takes over the selection.
    if (selectedKey === key) setSelectedKey(rest[Math.min(index, rest.length - 1)]?.key ?? null);
    if (currentKey === key) {
      // Pulled the one playing: carry on with whatever followed it.
      const next = playing ? rest[index] ?? (repeat ? rest[0] : undefined) : undefined;
      autoplayRef.current = Boolean(next);
      setCurrentKey(next?.key ?? null);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      openFiles: (files) => load(files, false),
      addFiles: (files) => load(files, true),
      clear,
    }),
    [load, clear],
  );

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (!track) {
      // Nothing loaded yet: play the highlighted row, else the first playable.
      const selected = tracks.find((t) => t.key === selectedKey && !t.failed);
      if (selected) playKey(selected.key);
      else playAt(nextIndex(-1, 1));
      return;
    }
    if (!src) {
      // Still loading: Play/Pause just decides whether it starts once ready.
      autoplayRef.current = !autoplayRef.current;
      return;
    }
    autoplayRef.current = true;
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const stop = () => {
    const el = mediaRef.current;
    autoplayRef.current = false;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTime(0);
  };

  const skip = (step: 1 | -1) => {
    // Back within the first few seconds goes to the previous track; later
    // than that it restarts this one, like every player since forever.
    const el = mediaRef.current;
    if (step === -1 && el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const i = nextIndex(currentIndex, step);
    if (i >= 0) playAt(i);
  };

  const onEnded = () => {
    const i = nextIndex(currentIndex, 1);
    if (i >= 0) playAt(i);
    else {
      autoplayRef.current = false;
      setPlaying(false);
    }
  };

  const onError = () => {
    if (!track || !src) return;
    const failedAt = currentIndex;
    markFailed(track.key);
    // Keep going past a file the browser can't decode, rather than stalling.
    if (autoplayRef.current) {
      const i = nextIndex(failedAt, 1);
      if (i >= 0 && i !== failedAt) playAt(i);
    }
  };

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && (event.target as HTMLElement).closest?.("[data-player-menu]")) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus());
  };

  const isVideo = track?.kind === "video" && !track.failed;
  const seekable = Boolean(src) && Number.isFinite(duration) && duration > 0;
  const shownTime = scrub ?? time;
  const seekMax = Math.max(1, Math.floor(duration * SEEK_STEPS));
  const pct = (seconds: number) => (seekable ? Math.min(100, (seconds / duration) * 100) : 0);
  const shown = track ?? tracks.find((t) => t.key === selectedKey);
  const tip = scrub ?? hover;

  const hoverAt = (clientX: number) => {
    const box = seekRef.current?.getBoundingClientRect();
    if (!box || !seekable) return null;
    const span = box.width - THUMB_INSET * 2;
    return Math.max(0, Math.min(1, (clientX - box.left - THUMB_INSET) / span)) * duration;
  };

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        outline: dragOver ? "2px dashed #000080" : undefined,
        outlineOffset: -2,
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files.length) load(event.dataTransfer.files, false);
      }}
    >
      {/* The screen: the video itself, or a card naming the song. */}
      <div
        style={{
          flex: "1 1 60%",
          minHeight: 80,
          position: "relative",
          background: "#000",
          color: "#c0c0c0",
          border: "2px solid",
          borderColor: "#808080 #fff #fff #808080",
          overflow: "hidden",
        }}
        onDoubleClick={() => {
          if (isVideo) void mediaRef.current?.requestFullscreen?.().catch(() => {});
        }}
        onClick={() => {
          if (isVideo && src) togglePlay();
        }}
      >
        <video
          ref={mediaRef}
          src={src}
          playsInline
          preload="metadata"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: isVideo && src ? "block" : "none",
          }}
          onPlay={() => {
            setPlaying(true);
            startAnalyser();
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onEnded={onEnded}
          onError={onError}
        />
        {!(isVideo && src) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 12,
              textAlign: "center",
              fontSize: 13,
            }}
          >
            {track?.failed ? (
              <>
                <span style={{ fontSize: 28 }} aria-hidden>
                  ⚠️
                </span>
                <span>This browser can&rsquo;t play {track.name}</span>
              </>
            ) : shown ? (
              <>
                <span
                  aria-hidden
                  style={{
                    fontSize: 32,
                    display: "inline-block",
                    animation: playing ? "player-bob 1s ease-in-out infinite" : undefined,
                  }}
                >
                  {shown.kind === "video" ? "🎞️" : "🎵"}
                </span>
                <span style={{ color: "#fff", fontWeight: "bold", wordBreak: "break-word" }}>
                  {stripExt(shown.name)}
                </span>
                {shown.kind === "audio" && src && (
                  <Visualizer analyser={analyser} playing={playing} mode={viz} />
                )}
                {loading !== null ? (
                  <span style={{ fontSize: 11 }}>
                    {loading < 1 ? `Loading… ${Math.round(loading * 100)}%` : "Decoding…"}
                  </span>
                ) : (
                  shown.path !== shown.name && (
                    <span style={{ fontSize: 11, opacity: 0.7, wordBreak: "break-word" }}>
                      {shown.path.slice(0, -shown.name.length - 1)}
                    </span>
                  )
                )}
              </>
            ) : (
              <>
                <span>No media</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  File &rarr; Open a file or a folder, or drop files here
                </span>
              </>
            )}
          </div>
        )}
        <style>{`@keyframes player-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }`}</style>
      </div>

      {/* Seek bar and clock. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <div
          ref={seekRef}
          style={{ flex: "1 1 auto", minWidth: 0, position: "relative", padding: `0 ${THUMB_INSET}px` }}
          onMouseMove={(event) => setHover(hoverAt(event.clientX))}
          onMouseLeave={() => setHover(null)}
        >
          {/* How far in it's got: a navy fill along the groove, under the thumb. */}
          {seekable && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: THUMB_INSET,
                top: "50%",
                height: 4,
                marginTop: -2,
                width: `calc((100% - ${THUMB_INSET * 2}px) * ${pct(shownTime) / 100})`,
                background: "#000080",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
          )}
          {/* Where the thumb is headed while it's dragged, or where a click would land. */}
          {seekable && tip !== null && (
            <div
              style={{
                ...TOOLTIP_STYLE,
                left: `calc(${THUMB_INSET}px + (100% - ${THUMB_INSET * 2}px) * ${pct(tip) / 100})`,
              }}
            >
              {formatTime(tip)}
              {scrub !== null && ` (${scrub >= time ? "+" : "−"}${formatTime(Math.abs(scrub - time))})`}
            </div>
          )}
          <Slider
            size="100%"
            min={0}
            max={seekMax}
            step={1}
            value={seekable ? Math.min(seekMax, Math.floor(shownTime * SEEK_STEPS)) : 0}
            disabled={!seekable}
            onChange={(v) => setScrub(v / SEEK_STEPS)}
            onChangeCommitted={(v) => {
              const el = mediaRef.current;
              if (el) el.currentTime = v / SEEK_STEPS;
              setTime(v / SEEK_STEPS);
              setScrub(null);
            }}
            aria-label="Seek"
            // react95 leaves room under the track for tick labels; there are none.
            style={{ marginBottom: 0 }}
          />
        </div>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            whiteSpace: "nowrap",
            color: scrub !== null ? "#000080" : undefined,
            fontWeight: scrub !== null ? "bold" : undefined,
          }}
        >
          {formatTime(shownTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Transport. */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto", flexWrap: "wrap" }}>
        <Button size="sm" square title="Previous" aria-label="Previous" disabled={!tracks.length} onClick={() => skip(-1)}>
          <PrevIcon />
        </Button>
        <Button
          size="sm"
          square
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
          active={playing}
          disabled={!tracks.length}
          onClick={togglePlay}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button size="sm" square title="Stop" aria-label="Stop" disabled={!track} onClick={stop}>
          <StopIcon />
        </Button>
        <Button size="sm" square title="Next" aria-label="Next" disabled={!tracks.length} onClick={() => skip(1)}>
          <NextIcon />
        </Button>
        <span aria-hidden style={{ width: 6 }} />
        <Button
          size="sm"
          square
          title="Shuffle"
          aria-label="Shuffle"
          aria-pressed={shuffle}
          active={shuffle}
          onClick={() => setShuffle((prev) => !prev)}
        >
          <ShuffleIcon />
        </Button>
        <Button
          size="sm"
          square
          title="Repeat the playlist"
          aria-label="Repeat"
          aria-pressed={repeat}
          active={repeat}
          onClick={() => setRepeat((prev) => !prev)}
        >
          <RepeatIcon />
        </Button>
        <Button
          size="sm"
          square
          title="Remove from playlist (Del)"
          aria-label="Remove from playlist"
          disabled={!selectedKey}
          onClick={() => selectedKey && remove(selectedKey)}
        >
          <RemoveIcon />
        </Button>
        <span style={{ flex: "1 1 auto" }} />
        <Button
          size="sm"
          square
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          active={muted}
          onClick={() => setMuted((prev) => !prev)}
        >
          <SpeakerIcon muted={muted || volume === 0} />
        </Button>
        <div style={{ width: 90, padding: `0 ${THUMB_INSET}px` }} title={`Volume ${volume}%`}>
          <Slider
            size="100%"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(v) => {
              setVolume(v);
              if (v > 0) setMuted(false);
            }}
            aria-label="Volume"
            style={{ marginBottom: 0 }}
          />
        </div>
      </div>

      {/* Playlist: click selects, double-click or Enter plays, Delete removes. */}
      <div ref={listRef} style={{ flex: "1 1 40%", minHeight: 60, position: "relative", display: "flex" }}>
        <ScrollView style={{ flex: "1 1 auto", background: "#fff" }}>
          {tracks.length === 0 ? (
            <div style={{ padding: 6, fontSize: 12, color: "#808080" }}>Playlist is empty</div>
          ) : (
            <ol role="listbox" aria-label="Playlist" style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}>
              {tracks.map((t, i) => {
                const isCurrent = t.key === currentKey;
                const isSelected = t.key === selectedKey;
                return (
                  <li
                    key={t.key}
                    data-key={t.key}
                    role="option"
                    aria-selected={isSelected}
                    title={t.failed ? `${t.path} — can't be played here` : t.path}
                    tabIndex={isSelected || (!selectedKey && i === 0) ? 0 : -1}
                    onClick={() => setSelectedKey(t.key)}
                    onDoubleClick={() => playKey(t.key)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedKey(t.key);
                      const box = listRef.current?.getBoundingClientRect();
                      if (box) setMenu({ key: t.key, x: event.clientX - box.left, y: event.clientY - box.top });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        playKey(t.key);
                      } else if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        remove(t.key);
                        focusRow((tracks[i + 1] ?? tracks[i - 1])?.key);
                      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const to = tracks[i + (event.key === "ArrowDown" ? 1 : -1)];
                        if (to) {
                          setSelectedKey(to.key);
                          focusRow(to.key);
                        }
                      }
                    }}
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "2px 6px",
                      cursor: "default",
                      background: isSelected ? "#000080" : undefined,
                      color: isSelected ? "#fff" : t.failed ? "#808080" : undefined,
                      fontWeight: isCurrent ? "bold" : undefined,
                      textDecoration: t.failed ? "line-through" : undefined,
                      userSelect: "none",
                      outline: "none",
                    }}
                  >
                    <span aria-hidden style={{ width: 14, flex: "0 0 14px" }}>
                      {isCurrent && playing ? "▶" : t.kind === "video" ? "🎞" : "♪"}
                    </span>
                    <span style={{ flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {stripExt(t.name)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollView>
        {menu && (
          <div data-player-menu style={{ position: "absolute", left: menu.x, top: menu.y, zIndex: 1000 }}>
            <MenuList style={{ marginTop: 0 }}>
              <MenuListItem
                size="sm"
                onClick={() => {
                  playKey(menu.key);
                  setMenu(null);
                }}
              >
                Play
              </MenuListItem>
              <MenuListItem
                size="sm"
                onClick={() => {
                  remove(menu.key);
                  setMenu(null);
                }}
              >
                Remove from playlist
              </MenuListItem>
            </MenuList>
          </div>
        )}
      </div>
    </div>
  );
});

export default PlayerWindow;
