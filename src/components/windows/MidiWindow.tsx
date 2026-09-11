"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView } from "react95";
import {
  KNOB_DEFAULTS,
  KNOB_PARAMS,
  MidiSynth,
  drumForNote,
  type ScopeFrame,
  type Waveform,
} from "@/lib/midiSynth";
import { decodeSmf, encodeSmf } from "@/lib/smf";
import {
  BrandBar,
  Chassis,
  Cluster,
  Fader,
  Joystick,
  KNOB_CC_BASE,
  Knob,
  Legend,
  PAD_BANKS,
  PAD_BANK_SIZE,
  PAD_BASE_NOTE,
  PAD_CHANNEL,
  PANEL,
  Pad,
  PanelButton,
  padBankBase,
  STICK_CC_X,
  STICK_CC_Y,
  STICK_CENTRE,
  Well,
} from "@/components/windows/MpkPanel";

export type MidiWindowHandle = {
  newSession: () => void;
  toggleMeters: () => void;
  toggleScope: () => void;
  loadSmf: (bytes: Uint8Array, name: string) => void;
  play: () => void;
  stop: () => void;
  hasMessages: () => boolean;
  exportMid: () => Uint8Array | null;
  exportLog: (fmt: "csv" | "json") => string;
};

type MidiWindowProps = {
  maximized?: boolean;
  onMetersOpenChange?: (open: boolean) => void;
  onScopeOpenChange?: (open: boolean) => void;
  onPlayingChange?: (playing: boolean) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
};

type MidiStatus = "checking" | "unsupported" | "needsGesture" | "denied" | "ready";

/** The faceplate's control clusters, one per tab when the panel is narrow. */
type PanelTab = "wheels" | "pads" | "knobs";

const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "wheels", label: "Wheels" },
  { id: "pads", label: "Pads" },
  { id: "knobs", label: "Knobs" },
];

type DeviceInfo = {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
};

type LogEntry = {
  id: number;
  atMs: number;
  raw: number[];
  clock: string;
  source: string;
  channel: number | null;
  type: string;
  detail: string;
  bytes: string;
};

type Parsed = {
  channel: number | null;
  type: string;
  detail: string;
  note?: number;
  velocity?: number;
  cc?: number;
  ccValue?: number;
  /** Raw 14-bit pitch-bend value, 8192 = centre. */
  bend?: number;
};

type Meters = {
  channels: number[];
  velocity: number;
  cc: number | null;
  ccValue: number;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAX_ENTRIES = 250;
// Raw bytes past this are trimmed with an ellipsis (keeps SysEx from bloating rows).
const MAX_HEX_BYTES = 8;
// How long a channel-activity cell takes to fade back to idle, in ms.
const DECAY_MS = 600;
// System real-time messages that would otherwise flood the log.
const SKIP_STATUS = new Set<number>([0xf8, 0xfe]);

// Byte columns the Bits panel shows. The newest byte is leftmost; columns not
// yet reached by a message stay blank.
const SPOTLIGHT_BYTES = 16;
// Secret unlock: play these pitch classes in order (C, A, F, E — any octave) to
// swap the scrolling message log for the Bits view, and again to swap back.
const SPOTLIGHT_CODE = [0, 9, 5, 4];
// Bits-panel accent per message type: note-on green, note-off red, everything
// else the default navy.
const SPOTLIGHT_ON = "#1d9e75";
const SPOTLIGHT_OFF = "#a80000";
const SPOTLIGHT_STATUS = "#000080";

const SYSTEM_NAMES: Record<number, string> = {
  0xf0: "SysEx",
  0xf1: "MTC Quarter Frame",
  0xf2: "Song Position",
  0xf3: "Song Select",
  0xf6: "Tune Request",
  0xf7: "SysEx End",
  0xfa: "Start",
  0xfb: "Continue",
  0xfc: "Stop",
  0xff: "Reset",
};

// On-screen keyboard: pitch classes with a white key, and the ones that have a
// black key to their immediate right.
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const BLACK_AFTER = new Set([0, 2, 5, 7, 9]);
// The MPK's own 37 mini keys in the normal window, transposed by the OCT
// buttons; the full 88-key piano when maximised — or a scrollable window of it,
// with octave buttons, when the screen is too narrow.
const MINI_KEY_SPAN = 36; // 37 keys, C to C
const RANGE_NORMAL = { low: 36, high: 36 + MINI_KEY_SPAN }; // C2–C5 at octave 0
const RANGE_FULL = { low: 21, high: 108 }; // A0–C8
const FULL_WHITE_COUNT = 52;
// Below this the full keyboard's keys are too small to hit — window it instead.
const MIN_WHITE_PX = 22;
// Under this the faceplate can't hold bend, mod, stick, pads and knobs side by
// side without them wrapping into a tower, so they go behind tabs instead. It's
// the panel's own width, not the browser's — these windows resize.
const COMPACT_WIDTH = 470;
const KEY_HEIGHT_NORMAL = 72;
// Bend / mod fader travel; the stick cluster is sized to match.
const FADER_HEIGHT = 78;
const KEY_HEIGHT_FULL = 132;

// The stick's axes run -1..1 on screen and 0..127 on the wire, resting at 64.
// The halves are scaled separately so full deflection reaches 0 and 127 either
// way rather than stopping one short at the bottom.
function axisToCc(axis: number): number {
  const a = Math.max(-1, Math.min(1, axis));
  return Math.round(STICK_CENTRE + a * (a < 0 ? STICK_CENTRE : 127 - STICK_CENTRE));
}

function ccToAxis(value: number): number {
  const v = Math.max(0, Math.min(127, value));
  return (v - STICK_CENTRE) / (v < STICK_CENTRE ? STICK_CENTRE : 127 - STICK_CENTRE);
}

// Computer-keyboard mapping: physical key code -> semitones above the base note.
const KEY_SEMITONES: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
};
const KEY_BASE_NOTE = 60; // C4

function noteName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const millis = Math.floor(total % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatTransport(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(data: Uint8Array): string {
  const hex = Array.from(data, (b) => b.toString(16).toUpperCase().padStart(2, "0"));
  return hex.length > MAX_HEX_BYTES ? `${hex.slice(0, MAX_HEX_BYTES).join(" ")} …` : hex.join(" ");
}

// A knob CC reads out as what it actually did — "Cutoff  4.2 kHz" — rather
// than as the raw controller number the log row already carries.
function knobReadout(entry: LogEntry): string | null {
  const [status, cc, value] = entry.raw;
  if (entry.raw.length < 3 || (status & 0xf0) !== 0xb0) return null;
  const param = KNOB_PARAMS[cc - KNOB_CC_BASE];
  return param ? `${param.name}  ${param.format(value)}` : null;
}

function describe(data: Uint8Array): Parsed | null {
  if (data.length === 0) return null;
  const status = data[0];
  if (SKIP_STATUS.has(status)) return null;

  if (status >= 0xf0) {
    return {
      channel: null,
      type: SYSTEM_NAMES[status] ?? `System 0x${status.toString(16)}`,
      detail: "",
    };
  }

  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;

  switch (kind) {
    case 0x80:
      return { channel, type: "Note Off", detail: `${noteName(d1)}  vel ${d2}`, note: d1 };
    case 0x90:
      return {
        channel,
        type: d2 === 0 ? "Note Off" : "Note On",
        detail: `${noteName(d1)}  vel ${d2}`,
        note: d1,
        velocity: d2 === 0 ? undefined : d2,
      };
    case 0xa0:
      return { channel, type: "Poly Aftertouch", detail: `${noteName(d1)}  ${d2}` };
    case 0xb0:
      return {
        channel,
        type: "Control Change",
        detail: `CC ${d1}  val ${d2}`,
        cc: d1,
        ccValue: d2,
      };
    case 0xc0:
      return { channel, type: "Program Change", detail: `#${d1}` };
    case 0xd0:
      return { channel, type: "Channel Aftertouch", detail: `${d1}` };
    case 0xe0:
      return {
        channel,
        type: "Pitch Bend",
        detail: `${(d2 << 7) | d1} (${((d2 << 7) | d1) - 8192 >= 0 ? "+" : ""}${((d2 << 7) | d1) - 8192})`,
        bend: (d2 << 7) | d1,
      };
    default:
      return { channel, type: `0x${kind.toString(16)}`, detail: "" };
  }
}

function MeterBar({
  label,
  value,
  hasValue = true,
}: {
  label: string;
  value: number;
  hasValue?: boolean;
}) {
  const pct = hasValue ? Math.max(0, Math.min(1, value / 127)) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: "0 0 40px", color: PANEL.dim }}>{label}</span>
      <div
        style={{
          flex: "1 1 auto",
          height: 9,
          background: PANEL.canvas,
          border: `1px solid ${PANEL.shadow}`,
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: PANEL.accent }} />
      </div>
      <span style={{ flex: "0 0 26px", textAlign: "right" }}>
        {hasValue ? Math.round(value) : "—"}
      </span>
    </div>
  );
}

// Draws a rolling window of the most recent MIDI bytes, newest on the left, each
// as a column of 8 bits with the MSB on top. Bit 7 is pulled out tall and
// tinted: set means a status byte, clear means data. A bar sits before every
// byte that starts a new message — the only cue for a running-status message,
// which carries no status byte of its own. A note-on message is tinted green, a
// note-off red. Columns no message has reached yet stay blank.
function BitSpotlight({
  cells,
  empty,
  truncated,
}: {
  cells: { value: number; boundary: boolean; blank: boolean; accent: "on" | "off" | null }[];
  empty: boolean;
  truncated: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", gap: 2, alignItems: "stretch" }}>
        {cells.map((cell, i) => {
          const status = !cell.blank && (cell.value & 0x80) !== 0;
          const mark =
            cell.accent === "on"
              ? SPOTLIGHT_ON
              : cell.accent === "off"
                ? SPOTLIGHT_OFF
                : SPOTLIGHT_STATUS;
          const tint =
            cell.accent === "on"
              ? "rgba(29, 158, 117, 0.14)"
              : cell.accent === "off"
                ? "rgba(168, 0, 0, 0.12)"
                : undefined;
          return (
            <React.Fragment key={i}>
              {cell.boundary && i > 0 && (
                <div style={{ flex: "0 0 2px", alignSelf: "stretch", background: PANEL.dim }} />
              )}
              <div
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  opacity: cell.blank ? 0.5 : 1,
                  background: tint,
                  borderRadius: 2,
                }}
              >
                <div style={{ textAlign: "center", color: PANEL.dim, minHeight: 13 }}>
                  {cell.blank ? "" : cell.value.toString(16).toUpperCase().padStart(2, "0")}
                </div>
                {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => {
                  const on = !cell.blank && ((cell.value >> bit) & 1) === 1;
                  const top = bit === 7;
                  return (
                    <div
                      key={bit}
                      style={{
                        height: top ? 14 : 8,
                        marginBottom: top ? 2 : 0,
                        border: `1px solid ${PANEL.shadow}`,
                        background: on ? (top ? mark : PANEL.dim) : PANEL.canvas,
                      }}
                    />
                  );
                })}
                <div
                  style={{
                    textAlign: "center",
                    fontWeight: "bold",
                    minHeight: 13,
                    color: status ? mark : "#9a9a9a",
                  }}
                >
                  {cell.blank ? "" : status ? "S" : "D"}
                </div>
                <div style={{ textAlign: "center", fontSize: 9, color: PANEL.dim, minHeight: 11 }}>
                  {cell.blank ? "" : cell.value}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {truncated && (
          <div style={{ alignSelf: "center", color: "#9a9a9a", fontSize: 9 }}>…</div>
        )}
      </div>
      <div style={{ fontSize: 9, color: PANEL.dim }}>
        {empty ? "waiting for bytes" : "recent bytes"} · newest on the left · top cell = bit 7 (1 =
        status, 0 = data) · green note on / red note off · bar = message start
      </div>
    </div>
  );
}

type KeyCell = { note: number; leftPct: number; widthPct: number };


// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

// Height of the scope canvas, windowed and maximised, and how much of it the
// trace gets — the rest is the spectrogram underneath it.
const SCOPE_HEIGHT = 108;
const SCOPE_HEIGHT_FULL = 180;
const SCOPE_TRACE_SHARE = 0.44;
// The spectrogram's axis runs log, like hearing does, over these ends.
const SPECTRUM_LO_HZ = 40;
const SPECTRUM_HI_HZ = 16000;
// How coarse the spectrogram is: bands across, rows back, and how often a new
// row lands. Low-res on purpose — it's a panel meter, not an analysis tool, and
// coarse hills read better at this size than a wall of hair.
const SPEC_BANDS = 24;
const SPEC_ROWS = 7;
const SPEC_ROW_MS = 90;
/** Below this fraction of the analyser's scale is floor noise, not signal. */
const SPEC_FLOOR = 0.32;
/** How many held notes the readout names before it starts counting instead. */
const SCOPE_MAX_NAMED = 6;
// The readout is text, not a trace — a few updates a second is plenty, and it
// keeps the panel from re-rendering sixty times a second.
const READOUT_MS = 100;

type ScopeReadout = {
  pitchHz: number | null;
  level: number;
  notes: { note: number; hz: number }[];
};

/** Nearest note to a frequency, and how far off it is in cents. */
function nearestNote(hz: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  return { name: noteName(rounded), cents: Math.round((midi - rounded) * 100) };
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${hz.toFixed(hz < 100 ? 2 : 1)} Hz`;
}

/**
 * The scope: what the synth's output actually looks like. The trace on top is
 * the waveform, started at a rising zero crossing so a held note stands still
 * instead of sliding across; below it a low-res spectrogram, the last couple of
 * seconds of spectra stacked back into the distance, with the detected
 * fundamental ticked on the front row. Draws from the synth's analyser every
 * frame while it's open, and reads out the pitch a few times a second.
 */
function ScopeView({
  read,
  waveform,
  playing,
  tall,
}: {
  read: () => ScopeFrame | null;
  waveform: Waveform;
  playing: boolean;
  tall: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Spectrogram rows (newest first) and the trace's gain live outside the draw
  // loop, so a re-render that restarts the loop doesn't wipe the history or
  // snap the trace back to unity.
  const historyRef = useRef<Float32Array[]>([]);
  const gainRef = useRef(1);
  const [readout, setReadout] = useState<ScopeReadout>({ pitchHz: null, level: 0, notes: [] });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let lastReadout = 0;
    let lastRow = 0;
    const history = historyRef.current;
    const draw = (now: number) => {
      raf = window.requestAnimationFrame(draw);
      const frame = read();
      const traceH = Math.floor(height * SCOPE_TRACE_SHARE);
      const specTop = traceH + 1;
      const specH = height - specTop;

      ctx.fillStyle = PANEL.canvas;
      ctx.fillRect(0, 0, width, height);

      // Graticule: the zero line, and the divide between trace and spectrum.
      ctx.strokeStyle = "#d0d0d0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 8; i++) {
        const x = Math.round((width * i) / 8) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, traceH);
      }
      ctx.stroke();
      ctx.strokeStyle = "#a0a0a0";
      ctx.beginPath();
      ctx.moveTo(0, Math.round(traceH / 2) + 0.5);
      ctx.lineTo(width, Math.round(traceH / 2) + 0.5);
      ctx.moveTo(0, traceH + 0.5);
      ctx.lineTo(width, traceH + 0.5);
      ctx.stroke();

      if (!frame) {
        ctx.fillStyle = PANEL.dim;
        ctx.font = "10px monospace";
        ctx.fillText("no signal — play something", 6, Math.round(traceH / 2) - 5);
        return;
      }

      // The spectrogram: the last couple of seconds of spectra, stacked into
      // the distance. Each row is one sample of the spectrum, low-res on
      // purpose — a few dozen log-spaced bands, each taking the loudest bin
      // that falls in it, so a narrow peak isn't averaged away. Rows land at a
      // fixed rate rather than one a frame, so the hills drift back at the same
      // speed whatever the browser is doing.
      const { spectrum, binHz, wave } = frame;
      const logLo = Math.log2(SPECTRUM_LO_HZ);
      const logSpan = Math.log2(SPECTRUM_HI_HZ) - logLo;
      if (now - lastRow >= SPEC_ROW_MS) {
        lastRow = now;
        const row = new Float32Array(SPEC_BANDS);
        for (let b = 0; b < SPEC_BANDS; b++) {
          const from = 2 ** (logLo + (b / SPEC_BANDS) * logSpan);
          const to = 2 ** (logLo + ((b + 1) / SPEC_BANDS) * logSpan);
          const first = Math.max(1, Math.floor(from / binHz));
          const last = Math.min(spectrum.length - 1, Math.max(first, Math.ceil(to / binHz) - 1));
          let peak = 0;
          for (let bin = first; bin <= last; bin++) peak = Math.max(peak, spectrum[bin]);
          // The analyser's bytes run from a very quiet floor, so the bottom
          // third of the scale is hiss and room tone rather than anything you
          // played — cut it off, then curve what's left so quiet harmonics
          // still make a hill instead of a flat line with one spike on it.
          row[b] = Math.max(0, (peak / 255 - SPEC_FLOOR) / (1 - SPEC_FLOOR)) ** 0.75;
        }
        history.unshift(row);
        if (history.length > SPEC_ROWS) history.length = SPEC_ROWS;
      }

      // Straight oblique projection — no vanishing point, just a fixed shove
      // right and up per row back. Rows are drawn back to front and filled with
      // the panel's own white, so a near hill hides the one behind it: the
      // cheapest hidden-line removal there is, and the one every scope of this
      // vintage used.
      const skewX = specH * 0.7;
      const rowW = width - skewX - 2;
      const stepX = skewX / (SPEC_ROWS - 1);
      // Each row back steps up by enough that its ridge clears the one in
      // front — otherwise the stack collapses into a single hill and the depth
      // is lost, which is the whole point of drawing it this way.
      const stepY = (specH * 0.62) / (SPEC_ROWS - 1);
      const peakH = specH * 0.36;
      for (let r = history.length - 1; r >= 0; r--) {
        const row = history[r];
        const ox = 1 + r * stepX;
        const base = height - 1 - r * stepY;
        ctx.beginPath();
        ctx.moveTo(ox, base);
        for (let b = 0; b < SPEC_BANDS; b++) {
          const x = ox + (b / (SPEC_BANDS - 1)) * rowW;
          ctx.lineTo(x, base - row[b] * peakH);
        }
        ctx.lineTo(ox + rowW, base);
        ctx.closePath();
        ctx.fillStyle = PANEL.canvas;
        ctx.fill();
        // The front row is the sound right now, in the panel's ink; the ones
        // behind it grey out with distance. Solid greys rather than a fading
        // alpha — a hairline at 20% on white is not there at all.
        const age = r / (SPEC_ROWS - 1);
        const shade = Math.round(40 + age * 120);
        ctx.strokeStyle = r === 0 ? PANEL.accent : `rgb(${shade}, ${shade}, ${shade + 45})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Where the axis runs, marked at the near corner rather than across the
      // hills, where the labels would be in the way.
      ctx.fillStyle = PANEL.dim;
      ctx.font = "8px monospace";
      ctx.fillText("40", 2, height - 2);
      ctx.fillText("16k", rowW - 8, height - 2);

      // The fundamental, ticked on the front row.
      if (frame.pitchHz != null) {
        const band = (Math.log2(frame.pitchHz) - logLo) / logSpan;
        if (band >= 0 && band <= 1) {
          const x = Math.round(1 + band * rowW) + 0.5;
          ctx.strokeStyle = "#a80000";
          ctx.beginPath();
          ctx.moveTo(x, height - 1);
          ctx.lineTo(x, height - 5);
          ctx.stroke();
        }
      }

      // The trace, drawn to fill the height rather than at true scale — the
      // synth's own output sits around a tenth of full swing, and a shape you
      // can't see isn't worth a panel. The gain eases between frames so a note
      // decaying doesn't make the trace breathe. The dB readout below is what
      // says how loud it actually is.
      let peak = 0;
      for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i]));
      const target = peak > 0.01 ? Math.min(0.92 / peak, 12) : 1;
      gainRef.current += (target - gainRef.current) * 0.12;
      const gain = gainRef.current;

      // One period of the detected pitch per eighth of the window where there
      // is one, so the shape reads at any pitch; otherwise the whole buffer.
      // Either way it starts at a rising zero crossing.
      const span = frame.pitchHz
        ? Math.min(wave.length, Math.round((frame.sampleRate / frame.pitchHz) * 8))
        : wave.length;
      let start = 0;
      for (let i = 1; i < wave.length - span; i++) {
        if (wave[i - 1] <= 0 && wave[i] > 0) {
          start = i;
          break;
        }
      }
      ctx.strokeStyle = PANEL.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const mid = traceH / 2;
      for (let i = 0; i < span; i++) {
        const x = (i / (span - 1)) * width;
        const y = mid - Math.max(-1, Math.min(1, wave[start + i] * gain)) * (traceH / 2 - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (now - lastReadout >= READOUT_MS) {
        lastReadout = now;
        setReadout({ pitchHz: frame.pitchHz, level: frame.level, notes: frame.notes });
      }
    };
    raf = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [read]);

  const near = readout.pitchHz == null ? null : nearestNote(readout.pitchHz);
  const dB = readout.level > 0.0002 ? Math.round(20 * Math.log10(readout.level)) : null;
  // A held chord is worth naming; a forearm on the keybed is not, so past a
  // handful the rest are a count.
  const held =
    readout.notes.length > SCOPE_MAX_NAMED
      ? `${readout.notes
          .slice(0, SCOPE_MAX_NAMED)
          .map((n) => noteName(n.note))
          .join(" ")} +${readout.notes.length - SCOPE_MAX_NAMED}`
      : readout.notes.map((n) => noteName(n.note)).join(" ");

  return (
    <Well style={{ gap: 2, padding: "3px 4px" }}>
      <canvas
        ref={canvasRef}
        aria-label="Waveform and spectrum of the sound playing"
        style={{
          display: "block",
          width: "100%",
          height: tall ? SCOPE_HEIGHT_FULL : SCOPE_HEIGHT,
          background: PANEL.canvas,
          border: `1px solid ${PANEL.shadow}`,
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          fontFamily: "monospace",
          fontSize: 11,
          color: PANEL.text,
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        <span>
          {readout.pitchHz == null || near == null
            ? "— Hz"
            : `${formatHz(readout.pitchHz)} · ${near.name}${
                near.cents === 0 ? "" : ` ${near.cents > 0 ? "+" : ""}${near.cents}¢`
              }`}
        </span>
        <span
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: PANEL.dim }}
        >
          {held || (playing ? "playing" : "—")}
        </span>
        <span style={{ color: PANEL.dim }}>
          {waveform.slice(0, 3)} · {dB == null ? "−∞" : `${dB}`} dB
        </span>
      </div>
    </Well>
  );
}

function buildKeyboard(low: number, high: number): { whites: KeyCell[]; blacks: KeyCell[] } {
  const whiteNotes: number[] = [];
  for (let n = low; n <= high; n++) {
    if (WHITE_PCS.has(n % 12)) whiteNotes.push(n);
  }
  const count = whiteNotes.length;
  const whiteWidth = 100 / count;
  const whites: KeyCell[] = whiteNotes.map((note, i) => ({
    note,
    leftPct: i * whiteWidth,
    widthPct: whiteWidth,
  }));
  const blackWidth = whiteWidth * 0.62;
  const blacks: KeyCell[] = [];
  whiteNotes.forEach((note, i) => {
    if (BLACK_AFTER.has(note % 12) && note + 1 <= high) {
      blacks.push({
        note: note + 1,
        leftPct: (i + 1) * whiteWidth - blackWidth / 2,
        widthPct: blackWidth,
      });
    }
  });
  return { whites, blacks };
}

const KEYBOARD_NORMAL = buildKeyboard(RANGE_NORMAL.low, RANGE_NORMAL.high);
const KEYBOARD_FULL = buildKeyboard(RANGE_FULL.low, RANGE_FULL.high);

function PlayableKeyboard({
  layout,
  height,
  held,
  disabled,
  onNoteOn,
  onNoteOff,
}: {
  layout: { whites: KeyCell[]; blacks: KeyCell[] };
  height: number;
  held: number[];
  disabled: boolean;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
}) {
  const activeRef = useRef<number | null>(null);

  useEffect(() => {
    const release = () => {
      if (activeRef.current != null) {
        onNoteOff(activeRef.current);
        activeRef.current = null;
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [onNoteOff]);

  const press = (note: number) => {
    if (activeRef.current === note) return;
    if (activeRef.current != null) onNoteOff(activeRef.current);
    activeRef.current = note;
    onNoteOn(note);
  };

  // Hit-test by point rather than per-key pointerenter: touch drags keep their
  // pointer captured on the first key, so pointerenter never fires on the keys
  // the finger slides over. elementFromPoint is geometric and works for both.
  const noteAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const raw = el?.getAttribute?.("data-note");
    return raw ? Number(raw) : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const note = noteAt(e.clientX, e.clientY);
    if (note != null) press(note);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (disabled || (e.buttons !== 1 && activeRef.current == null)) return;
    const note = noteAt(e.clientX, e.clientY);
    if (note != null) press(note);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      style={{
        position: "relative",
        width: "100%",
        height,
        userSelect: "none",
        touchAction: "none",
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {layout.whites.map(({ note, leftPct, widthPct }) => (
        <div
          key={note}
          data-note={note}
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            top: 0,
            height: "100%",
            boxSizing: "border-box",
            border: "1px solid #404040",
            background: held.includes(note) ? "#1d9e75" : "#fafafa",
          }}
        />
      ))}
      {layout.blacks.map(({ note, leftPct, widthPct }) => (
        <div
          key={note}
          data-note={note}
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            top: 0,
            height: "62%",
            boxSizing: "border-box",
            border: "1px solid #404040",
            background: held.includes(note) ? "#0f6e56" : "#202020",
            zIndex: 2,
          }}
        />
      ))}
    </div>
  );
}

const MidiWindow = forwardRef<MidiWindowHandle, MidiWindowProps>(function MidiWindow(
  {
    maximized = false,
    onMetersOpenChange,
    onScopeOpenChange,
    onPlayingChange,
    onHasMessagesChange,
  },
  ref,
) {
  const [status, setStatus] = useState<MidiStatus>("checking");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [metersOpen, setMetersOpen] = useState(false);
  // The scope: waveform + spectrum of whatever the synth is making right now.
  const [scopeOpen, setScopeOpen] = useState(false);
  // Swapped for the scrolling message log once the secret note code is played.
  const [bitsView, setBitsView] = useState(false);
  const [waveform, setWaveformState] = useState<Waveform>("square");
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const [playTotal, setPlayTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [octaveShift, setOctaveShift] = useState(0);
  // Maximised-window keyboard: measured panel width + the lowest note of the
  // windowed view (only used when the full 88 keys don't fit).
  const [keysWidth, setKeysWidth] = useState(0);
  const [rangeLow, setRangeLow] = useState(48); // C3
  const [meters, setMeters] = useState<Meters>(() => ({
    channels: new Array(16).fill(0),
    velocity: 0,
    cc: null,
    ccValue: 0,
  }));
  const [held, setHeld] = useState<number[]>([]);
  // Panel state: knob positions, lit pads, and the latching function buttons.
  // K1–K8 rest where KNOB_PARAMS says, not at zero — a knob has a physical
  // position, and cutoff parked at 0 would mean silence.
  const [knobs, setKnobs] = useState<number[]>(() => [...KNOB_DEFAULTS]);
  const [padHeld, setPadHeld] = useState<number[]>([]);
  const [bendValue, setBendValue] = useState(8192);
  const [modValue, setModValue] = useState(0);
  // Stick position as the two CC values it sends, 64 at rest.
  const [stick, setStick] = useState({ x: STICK_CENTRE, y: STICK_CENTRE });
  const [latch, setLatch] = useState(false);
  // Which of the two pad banks the grid is showing / playing.
  const [padBank, setPadBank] = useState(0);
  const [fullLevel, setFullLevel] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  // Which control cluster the tabs are showing, when the panel is too narrow to
  // show them all at once.
  const [panelTab, setPanelTab] = useState<PanelTab>("pads");

  const nextId = useRef(0);
  const startedAt = useRef(0);
  const accessRef = useRef<MIDIAccess | null>(null);
  const epochRef = useRef(0);
  // Shared in-flight requestMIDIAccess promise, so a dev StrictMode double-mount
  // fires one browser request, not two — Firefox blocks an origin after repeated
  // gesture-less attempts.
  const pendingRef = useRef<Promise<MIDIAccess> | null>(null);
  const metersRef = useRef<Meters>({
    channels: new Array(16).fill(0),
    velocity: 0,
    cc: null,
    ccValue: 0,
  });
  // Held-note count keyed by MIDI note number, across every source and channel.
  // Pad notes (channel 10, 36–43) are counted separately so a pad hit lights the
  // pad rather than the key that shares its note number.
  const heldRef = useRef<Map<number, number>>(new Map());
  const padHeldRef = useRef<Map<number, number>>(new Map());
  const latchRef = useRef(false);
  const padBankRef = useRef(0);
  const fullLevelRef = useRef(false);
  // Current bend / mod / stick, so the panel controls and incoming MIDI all agree
  // and a drag only emits when the value actually moves.
  const benderRef = useRef({ bend: 8192, mod: 0 });
  const stickRef = useRef({ x: STICK_CENTRE, y: STICK_CENTRE });
  const panelRef = useRef<HTMLDivElement | null>(null);

  const synthRef = useRef<MidiSynth | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const playingRef = useRef(false);
  const playTimeoutsRef = useRef<number[]>([]);
  const playIntervalRef = useRef<number | null>(null);
  const octaveShiftRef = useRef(0);
  const pressedCodesRef = useRef<Map<string, number>>(new Map());
  const keysWrapRef = useRef<HTMLDivElement | null>(null);
  // Last few note-on pitch classes, for matching the secret Bits-view code.
  const codeBufRef = useRef<number[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    octaveShiftRef.current = octaveShift;
  }, [octaveShift]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Track the faceplate's width so the display and pads can sit side by side
  // once there's room for them.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track the keyboard panel's width so it can decide how many octaves fit at a
  // playable key size, and whether it has to window them.
  useEffect(() => {
    const el = keysWrapRef.current;
    if (!el) return;
    const measure = () => setKeysWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maximized]);

  // Which keys the on-screen keyboard shows, and how tall. The keybed asks for
  // three octaves normally and the whole 88 maximised, but what it gets is what
  // the panel is wide enough to draw at a size you can actually hit — a phone
  // gets two octaves and the ◀ oct / oct ▶ buttons to move them.
  const kb = useMemo(() => {
    const octavesFit =
      keysWidth === 0 ? 7 : Math.max(1, Math.floor(keysWidth / (7 * MIN_WHITE_PX)));

    if (maximized && (keysWidth === 0 || keysWidth >= FULL_WHITE_COUNT * MIN_WHITE_PX)) {
      return {
        layout: KEYBOARD_FULL,
        height: KEY_HEIGHT_FULL,
        windowed: false,
        lowNote: RANGE_FULL.low,
        highNote: RANGE_FULL.high,
        octavesVisible: 7,
      };
    }

    // The mini keybed, whole and transposed by Oct − / Oct +, whenever its three
    // octaves fit.
    if (!maximized && octavesFit >= 3) {
      const low = RANGE_NORMAL.low + octaveShift * 12;
      return {
        layout: octaveShift === 0 ? KEYBOARD_NORMAL : buildKeyboard(low, low + MINI_KEY_SPAN),
        height: KEY_HEIGHT_NORMAL,
        windowed: false,
        lowNote: low,
        highNote: low + MINI_KEY_SPAN,
        octavesVisible: 3,
      };
    }

    const octavesVisible = Math.min(7, octavesFit);
    const span = octavesVisible * 12;
    const low = Math.max(RANGE_FULL.low, Math.min(RANGE_FULL.high - span, rangeLow));
    return {
      layout: buildKeyboard(low, low + span),
      height: maximized ? KEY_HEIGHT_FULL : KEY_HEIGHT_NORMAL,
      windowed: true,
      lowNote: low,
      highNote: low + span,
      octavesVisible,
    };
  }, [maximized, keysWidth, rangeLow, octaveShift]);

  const shiftOctave = useCallback(
    (dir: 1 | -1) => {
      setRangeLow((l) => {
        const span = kb.octavesVisible * 12;
        return Math.max(RANGE_FULL.low, Math.min(RANGE_FULL.high - span, l + dir * 12));
      });
    },
    [kb.octavesVisible],
  );

  const ensureSynth = useCallback(() => {
    if (!synthRef.current) {
      synthRef.current = new MidiSynth();
      synthRef.current.setWaveform(waveform);
    }
    return synthRef.current;
  }, [waveform]);

  // The synth is always on, but its AudioContext still needs a user gesture to
  // start — resume it on the first key press / Open / Play.
  const ensureAudio = useCallback(() => {
    ensureSynth().resume();
  }, [ensureSynth]);

  // Sound + meters + held-note highlight for one message. No logging — used both
  // by pushEntry (which adds the log row) and by playback (which does not).
  const applyMessage = useCallback(
    (data: Uint8Array): Parsed | null => {
      const parsed = describe(data);
      if (!parsed) return null;

      if (parsed.note != null) {
        const synth = ensureSynth();
        // Channel 10 is the kit; everything else is the keybed's oscillators.
        const channel = parsed.channel ?? 1;
        if (parsed.type === "Note On") synth.noteOn(parsed.note, parsed.velocity ?? 96, channel);
        else if (parsed.type === "Note Off") synth.noteOff(parsed.note, channel);
      }
      // The bend fader and any bend from a real controller land here and detune
      // whatever is sounding, +/- 2 semitones.
      if (parsed.bend != null) {
        ensureSynth().setPitchBend(((parsed.bend - 8192) / 8192) * 2);
        benderRef.current.bend = parsed.bend;
        setBendValue(parsed.bend);
      }
      // Mod is vibrato depth, from the fader or a real mod wheel alike.
      if (parsed.cc === 1) {
        ensureSynth().setModWheel(parsed.ccValue ?? 0);
        benderRef.current.mod = parsed.ccValue ?? 0;
        setModValue(parsed.ccValue ?? 0);
      }
      // The stick sweeps the filter — across is cutoff, up and down resonance —
      // and mirrors its own two CCs the same way the faders mirror theirs.
      if (parsed.cc === STICK_CC_X || parsed.cc === STICK_CC_Y) {
        const axis = parsed.cc === STICK_CC_X ? "x" : "y";
        const value = parsed.ccValue ?? 0;
        stickRef.current[axis] = value;
        ensureSynth().setStick(stickRef.current.x, stickRef.current.y);
        setStick((prev) => (prev[axis] === value ? prev : { ...prev, [axis]: value }));
      }
      // K1–K8 mirror CC 70–77 whoever sent them — panel, hardware or playback —
      // and each one moves the synth parameter KNOB_PARAMS assigns to that slot.
      if (
        parsed.cc != null &&
        parsed.cc >= KNOB_CC_BASE &&
        parsed.cc < KNOB_CC_BASE + KNOB_PARAMS.length
      ) {
        const slot = parsed.cc - KNOB_CC_BASE;
        const value = parsed.ccValue ?? 0;
        ensureSynth().setKnob(slot, value);
        setKnobs((prev) => {
          if (prev[slot] === value) return prev;
          const next = [...prev];
          next[slot] = value;
          return next;
        });
      }

      const m = metersRef.current;
      if (parsed.channel != null) m.channels[parsed.channel - 1] = 1;
      if (parsed.velocity != null) m.velocity = parsed.velocity;
      if (parsed.cc != null) {
        m.cc = parsed.cc;
        m.ccValue = parsed.ccValue ?? 0;
      }
      if (parsed.note != null) {
        const isPad =
          parsed.channel === PAD_CHANNEL &&
          parsed.note >= PAD_BASE_NOTE &&
          parsed.note < PAD_BASE_NOTE + PAD_BANK_SIZE * PAD_BANKS.length;
        const counts = isPad ? padHeldRef.current : heldRef.current;
        if (parsed.type === "Note On") {
          counts.set(parsed.note, (counts.get(parsed.note) ?? 0) + 1);
        } else if (parsed.type === "Note Off") {
          const next = (counts.get(parsed.note) ?? 0) - 1;
          if (next <= 0) counts.delete(parsed.note);
          else counts.set(parsed.note, next);
        }
        if (isPad) setPadHeld(Array.from(counts.keys()));
        else setHeld(Array.from(counts.keys()));
      }
      return parsed;
    },
    [ensureSynth],
  );

  const pushEntry = useCallback(
    (source: string, data: Uint8Array, atMsOverride?: number) => {
      const parsed = applyMessage(data);
      if (!parsed) return;

      const atMs = atMsOverride ?? performance.now() - startedAt.current;
      const entry: LogEntry = {
        id: nextId.current++,
        atMs,
        raw: Array.from(data),
        clock: formatClock(atMs),
        source,
        channel: parsed.channel,
        type: parsed.type,
        detail: parsed.detail,
        bytes: formatBytes(data),
      };
      setEntries((prev) => {
        const next = [entry, ...prev];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });

      // Secret code: C A F E note-ons in a row toggle the Bits view.
      if (parsed.type === "Note On" && parsed.note != null) {
        const buf = codeBufRef.current;
        buf.push(parsed.note % 12);
        if (buf.length > SPOTLIGHT_CODE.length) buf.shift();
        if (
          buf.length === SPOTLIGHT_CODE.length &&
          buf.every((pc, i) => pc === SPOTLIGHT_CODE[i])
        ) {
          setBitsView((v) => !v);
          codeBufRef.current = [];
        }
      }
    },
    [applyMessage],
  );

  const handleMessage = useCallback(
    (event: MIDIMessageEvent) => {
      if (playingRef.current) return; // inputs are disabled during playback
      const target = event.target as MIDIInput | null;
      if (!event.data) return;
      pushEntry(target?.name ?? "input", event.data);
    },
    [pushEntry],
  );

  // Play a note from the on-screen or computer keyboard.
  const handleKeyNote = useCallback(
    (note: number, on: boolean) => {
      if (playingRef.current || note < 0 || note > 127) return;
      ensureAudio();
      if (startedAt.current === 0) startedAt.current = performance.now();
      const velocity = fullLevelRef.current ? 127 : 96;
      // LATCH holds a note until it's struck again, so releases are ignored and
      // a second press is what sends the note off.
      if (latchRef.current) {
        if (!on) return;
        const sounding = heldRef.current.has(note);
        pushEntry(
          "keys",
          Uint8Array.from(sounding ? [0x80, note, 0] : [0x90, note, velocity]),
        );
        return;
      }
      pushEntry("keys", Uint8Array.from(on ? [0x90, note, velocity] : [0x80, note, 0]));
    },
    [ensureAudio, pushEntry],
  );

  const keyboardNoteOn = useCallback((note: number) => handleKeyNote(note, true), [handleKeyNote]);
  const keyboardNoteOff = useCallback((note: number) => handleKeyNote(note, false), [handleKeyNote]);

  const stopPlayback = useCallback(() => {
    playTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    playTimeoutsRef.current = [];
    if (playIntervalRef.current != null) {
      window.clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    synthRef.current?.allNotesOff();
    synthRef.current?.setPitchBend(0);
    synthRef.current?.setModWheel(0);
    synthRef.current?.setStick(STICK_CENTRE, STICK_CENTRE);
    heldRef.current.clear();
    padHeldRef.current.clear();
    setHeld([]);
    setPadHeld([]);
    benderRef.current = { bend: 8192, mod: 0 };
    setBendValue(8192);
    setModValue(0);
    stickRef.current = { x: STICK_CENTRE, y: STICK_CENTRE };
    setStick({ x: STICK_CENTRE, y: STICK_CENTRE });
    playingRef.current = false;
    setPlaying(false);
    setPlayPos(0);
    setPlayTotal(0);
  }, []);

  // Replay every message currently in the log through the synth. Inputs stay
  // disabled (playingRef) until this finishes or Stop is pressed.
  const play = useCallback(() => {
    const msgs = entriesRef.current;
    if (msgs.length === 0) return;
    stopPlayback();
    ensureAudio();

    const ordered = [...msgs].sort((a, b) => a.atMs - b.atMs);
    const t0 = ordered[0].atMs;
    const total = ordered[ordered.length - 1].atMs - t0;

    playingRef.current = true;
    setPlaying(true);
    setPlayTotal(total);
    const startPerf = performance.now();

    for (const msg of ordered) {
      playTimeoutsRef.current.push(
        window.setTimeout(
          () => applyMessage(Uint8Array.from(msg.raw)),
          Math.max(0, msg.atMs - t0),
        ),
      );
    }
    playTimeoutsRef.current.push(window.setTimeout(() => stopPlayback(), total + 400));
    playIntervalRef.current = window.setInterval(() => {
      setPlayPos(performance.now() - startPerf);
    }, 100);
  }, [applyMessage, ensureAudio, stopPlayback]);

  const loadSmf = useCallback(
    (bytes: Uint8Array, name: string) => {
      stopPlayback();
      let decoded;
      try {
        decoded = decodeSmf(bytes);
      } catch (err) {
        setLoadError((err as Error).message || "Could not read that MIDI file");
        return;
      }
      if (decoded.events.length === 0) {
        setLoadError("That file has no playable messages");
        return;
      }
      setLoadError(null);
      if (startedAt.current === 0) startedAt.current = performance.now();

      // Replace the log with the file's messages, keeping the file's own timing
      // so Play and Save reproduce it. Newest-first for display, like live input.
      const rows: LogEntry[] = [];
      for (const ev of decoded.events.slice(-MAX_ENTRIES)) {
        const parsed = describe(ev.data);
        if (!parsed) continue;
        rows.unshift({
          id: nextId.current++,
          atMs: ev.atMs,
          raw: Array.from(ev.data),
          clock: formatClock(ev.atMs),
          source: name.slice(0, 8) || "file",
          channel: parsed.channel,
          type: parsed.type,
          detail: parsed.detail,
          bytes: formatBytes(ev.data),
        });
      }
      heldRef.current.clear();
      padHeldRef.current.clear();
      setHeld([]);
      setPadHeld([]);
      setEntries(rows);
    },
    [stopPlayback],
  );

  const syncDevices = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    const list: DeviceInfo[] = [];
    access.inputs.forEach((input) => {
      list.push({
        id: input.id,
        name: input.name ?? "Unknown",
        manufacturer: input.manufacturer ?? "",
        state: input.state,
        connection: input.connection,
      });
      // A port must be open before it delivers midimessage events, and neither
      // engine opens it reliably just from attaching a handler — call open()
      // explicitly. It's a no-op on an already-open port.
      input.onmidimessage = handleMessage;
      input.open().then(
        () => {
          setDevices((prev) =>
            prev.map((d) => (d.id === input.id ? { ...d, connection: input.connection } : d)),
          );
        },
        () => {},
      );
    });
    setDevices(list);
  }, [handleMessage]);

  const detachAccess = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    access.removeEventListener("statechange", syncDevices);
    access.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    accessRef.current = null;
  }, [syncDevices]);

  // Runs once on mount (i.e. every time the window is opened).
  const connect = useCallback(() => {
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
      setStatus("unsupported");
      return;
    }

    const epoch = ++epochRef.current;
    setStatus("checking");
    if (startedAt.current === 0) startedAt.current = performance.now();

    if (!pendingRef.current) {
      pendingRef.current = navigator.requestMIDIAccess({ sysex: false });
    }
    const req = pendingRef.current;

    req
      .then((granted) => {
        if (epoch !== epochRef.current) return;
        detachAccess();
        accessRef.current = granted;
        setStatus("ready");
        granted.addEventListener("statechange", syncDevices);
        syncDevices();
      })
      .catch(() => {
        if (epoch !== epochRef.current) return;
        // Firefox only shows the MIDI prompt on a user gesture; a gesture-less
        // attempt rejects. Distinguish that from a real block.
        setStatus("needsGesture");
      })
      .finally(() => {
        if (pendingRef.current === req) pendingRef.current = null;
      });
  }, [detachAccess, syncDevices]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
        setStatus("unsupported");
        return;
      }

      // If the permission is already decided, honour it without firing a
      // gesture-less request (which Firefox penalises). Otherwise scan.
      let permission: PermissionState | null = null;
      try {
        const result = await navigator.permissions?.query({ name: "midi" as PermissionName });
        permission = result?.state ?? null;
      } catch {
        permission = null;
      }
      if (cancelled) return;

      if (permission === "denied") {
        setStatus("denied");
        return;
      }
      connect();
    };

    bootstrap();
    return () => {
      cancelled = true;
      epochRef.current++;
      detachAccess();
    };
  }, [connect, detachAccess]);

  // Decay the channel-activity cells and publish a throttled snapshot for the
  // meters. Runs whenever the panel is open — the on-screen keyboard and
  // playback feed it too, not just hardware input.
  useEffect(() => {
    if (!metersOpen) return;
    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const m = metersRef.current;
      for (let i = 0; i < 16; i++) {
        if (m.channels[i] > 0) m.channels[i] = Math.max(0, m.channels[i] - dt / DECAY_MS);
      }
      if (now - lastPublish >= 33) {
        lastPublish = now;
        setMeters({
          channels: Array.from(m.channels),
          velocity: m.velocity,
          cc: m.cc,
          ccValue: m.ccValue,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [metersOpen]);

  // Computer-keyboard playing. A typing target — the search box, Notepad —
  // always wins so letters go there instead; playback disables it too.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      return (
        !!node &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable)
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (playingRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.code === "KeyZ") {
        if (!event.repeat) {
          octaveShiftRef.current = Math.max(-3, octaveShiftRef.current - 1);
          setOctaveShift(octaveShiftRef.current);
        }
        return;
      }
      if (event.code === "KeyX") {
        if (!event.repeat) {
          octaveShiftRef.current = Math.min(3, octaveShiftRef.current + 1);
          setOctaveShift(octaveShiftRef.current);
        }
        return;
      }
      const semi = KEY_SEMITONES[event.code];
      if (semi == null || event.repeat || pressedCodesRef.current.has(event.code)) return;
      const note = KEY_BASE_NOTE + octaveShiftRef.current * 12 + semi;
      pressedCodesRef.current.set(event.code, note);
      event.preventDefault();
      handleKeyNote(note, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const note = pressedCodesRef.current.get(event.code);
      if (note == null) return;
      pressedCodesRef.current.delete(event.code);
      handleKeyNote(note, false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleKeyNote]);

  useEffect(() => {
    return () => {
      playTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      if (playIntervalRef.current != null) window.clearInterval(playIntervalRef.current);
      synthRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    onMetersOpenChange?.(metersOpen);
  }, [metersOpen, onMetersOpenChange]);

  useEffect(() => {
    onScopeOpenChange?.(scopeOpen);
  }, [scopeOpen, onScopeOpenChange]);

  // The scope reads straight off the synth every frame. Nothing to read until
  // the audio graph exists, which is fine — it draws "no signal" until then.
  const readScope = useCallback(() => synthRef.current?.readScope() ?? null, []);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  const hasMessages = entries.length > 0;
  useEffect(() => {
    onHasMessagesChange?.(hasMessages);
  }, [hasMessages, onHasMessagesChange]);

  useImperativeHandle(
    ref,
    () => ({
      newSession: () => {
        stopPlayback();
        synthRef.current?.allNotesOff();
        heldRef.current.clear();
        padHeldRef.current.clear();
        setHeld([]);
        setPadHeld([]);
        setKnobs([...KNOB_DEFAULTS]);
        synthRef.current?.resetKnobs();
        setEntries([]);
        setLoadError(null);
      },
      toggleMeters: () => setMetersOpen((v) => !v),
      toggleScope: () => setScopeOpen((v) => !v),
      loadSmf,
      play,
      stop: stopPlayback,
      hasMessages: () => entriesRef.current.length > 0,
      exportMid: () => {
        const rows = [...entriesRef.current].sort((a, b) => a.atMs - b.atMs);
        if (rows.length === 0) return null;
        return encodeSmf(
          rows.map((r) => ({ atMs: r.atMs, data: r.raw })),
          { name: "Keys log" },
        );
      },
      exportLog: (fmt: "csv" | "json") => {
        const rows = entriesRef.current;
        if (fmt === "json") {
          return JSON.stringify(
            rows.map((r) => ({
              clock: r.clock,
              source: r.source,
              channel: r.channel,
              type: r.type,
              detail: r.detail,
              bytes: r.bytes,
            })),
            null,
            2,
          );
        }
        const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
        const header = "clock,source,channel,type,detail,bytes";
        const body = rows
          .map((r) =>
            [r.clock, r.source, r.channel ?? "", r.type, r.detail, r.bytes]
              .map((v) => esc(String(v)))
              .join(","),
          )
          .join("\n");
        return `${header}\n${body}`;
      },
    }),
    [ensureSynth, loadSmf, play, stopPlayback],
  );

  // The Bits panel window: the most recent raw bytes with the newest on the
  // left, each tagged with whether it starts a message. entries is already
  // newest-first, so walk it forwards and append each message's bytes (in wire
  // order) until the window is full, then pad the right with blanks.
  const spotlight = useMemo(() => {
    type Cell = { value: number; boundary: boolean; blank: boolean; accent: "on" | "off" | null };
    const cells: Cell[] = [];
    let total = 0;
    for (const entry of entries) {
      total += entry.raw.length;
      const accent: "on" | "off" | null =
        entry.type === "Note On" ? "on" : entry.type === "Note Off" ? "off" : null;
      for (let i = 0; i < entry.raw.length && cells.length < SPOTLIGHT_BYTES; i++) {
        cells.push({ value: entry.raw[i], boundary: i === 0, blank: false, accent });
      }
    }
    const truncated = total > SPOTLIGHT_BYTES;
    while (cells.length < SPOTLIGHT_BYTES) {
      cells.push({ value: 0, boundary: false, blank: true, accent: null });
    }
    return { cells, empty: entries.length === 0, truncated };
  }, [entries]);


  // ---- Faceplate controls ------------------------------------------------
  // Everything the panel touches goes out as a real MIDI message, so the log,
  // the meters, Save and Play all see it exactly like hardware input.

  const panelSend = useCallback(
    (bytes: number[]) => {
      if (playingRef.current) return;
      ensureAudio();
      if (startedAt.current === 0) startedAt.current = performance.now();
      pushEntry("panel", Uint8Array.from(bytes));
    },
    [ensureAudio, pushEntry],
  );

  const handleKnob = useCallback(
    (slot: number, value: number) => {
      panelSend([0xb0, KNOB_CC_BASE + slot, value]);
    },
    [panelSend],
  );

  // Latch is a keybed thing: the pads fire one-shot drums, which ring out on
  // their own, so holding one open would only leave the lamp stuck on.
  const padDown = useCallback(
    (index: number) => {
      const note = padBankBase(padBankRef.current) + index;
      if (padHeldRef.current.has(note)) return;
      panelSend([0x90 | (PAD_CHANNEL - 1), note, fullLevelRef.current ? 127 : 110]);
    },
    [panelSend],
  );

  const padUp = useCallback(
    (index: number) => {
      const note = padBankBase(padBankRef.current) + index;
      if (!padHeldRef.current.has(note)) return;
      panelSend([0x80 | (PAD_CHANNEL - 1), note, 0]);
    },
    [panelSend],
  );

  const sendBend = useCallback(
    (value: number) => {
      const bend = Math.max(0, Math.min(16383, Math.round(value)));
      if (bend === benderRef.current.bend) return;
      panelSend([0xe0, bend & 0x7f, bend >> 7]);
    },
    [panelSend],
  );

  const sendMod = useCallback(
    (value: number) => {
      const mod = Math.max(0, Math.min(127, Math.round(value)));
      if (mod === benderRef.current.mod) return;
      panelSend([0xb0, 1, mod]);
    },
    [panelSend],
  );

  // Pitch bend springs back to centre when you let go, like the wheel it stands
  // in for; the mod fader stays where it's left.
  const releaseBend = useCallback(() => sendBend(8192), [sendBend]);

  // Both stick axes are plain CCs of their own, so the Bend and Mod faders keep
  // pitch bend and CC 1 to themselves.
  const stickMove = useCallback(
    (x: number, y: number) => {
      const cx = axisToCc(x);
      const cy = axisToCc(y);
      if (cx !== stickRef.current.x) panelSend([0xb0, STICK_CC_X, cx]);
      if (cy !== stickRef.current.y) panelSend([0xb0, STICK_CC_Y, cy]);
    },
    [panelSend],
  );

  // Springs back to centre on release, like the stick it stands in for.
  const stickRelease = useCallback(() => stickMove(0, 0), [stickMove]);

  const bumpOctave = useCallback((dir: 1 | -1) => {
    octaveShiftRef.current = Math.max(-3, Math.min(3, octaveShiftRef.current + dir));
    setOctaveShift(octaveShiftRef.current);
  }, []);

  // Swapping banks re-points the grid at the next eight notes. Anything the old
  // bank is still holding — a latched pad, a pad under the pointer — is let go
  // first, so nothing sticks on out of sight.
  const cyclePadBank = useCallback(() => {
    Array.from(padHeldRef.current.keys()).forEach((note) =>
      panelSend([0x80 | (PAD_CHANNEL - 1), note, 0]),
    );
    const next = (padBankRef.current + 1) % PAD_BANKS.length;
    padBankRef.current = next;
    setPadBank(next);
  }, [panelSend]);

  const toggleLatch = useCallback(() => {
    const next = !latchRef.current;
    latchRef.current = next;
    setLatch(next);
    // Letting go of LATCH drops whatever it was holding.
    if (!next) {
      Array.from(heldRef.current.keys()).forEach((note) => panelSend([0x80, note, 0]));
      Array.from(padHeldRef.current.keys()).forEach((note) =>
        panelSend([0x80 | (PAD_CHANNEL - 1), note, 0]),
      );
    }
  }, [panelSend]);

  const toggleFullLevel = useCallback(() => {
    const next = !fullLevelRef.current;
    fullLevelRef.current = next;
    setFullLevel(next);
  }, []);

  // PROG steps through the synth's four waveforms — this panel's "programs".
  const cycleProgram = useCallback(() => {
    const order: Waveform[] = ["square", "sawtooth", "triangle", "sine"];
    const next = order[(order.indexOf(waveform) + 1) % order.length];
    setWaveformState(next);
    ensureSynth().setWaveform(next);
  }, [ensureSynth, waveform]);


  const wide = panelWidth >= 500;
  // Narrow panel: one cluster at a time, behind tabs.
  const compact = panelWidth > 0 && panelWidth < COMPACT_WIDTH;
  const showCluster = (tab: PanelTab) => !compact || panelTab === tab;
  const octaveLabel = `oct ${octaveShift > 0 ? "+" : ""}${octaveShift}`;
  const last = entries[0] ?? null;
  // The bend fader reads out in semitones — the raw 14-bit number is too wide
  // for a column this narrow, and means less.
  const bendSemitones = Math.round(((bendValue - 8192) / 8192) * 2 * 10) / 10;

  // The OLED strip stands in for the status line and the old footer: what the
  // panel is connected to, the last message through it, and the current setup.
  const screenNote =
    loadError ??
    (status === "checking"
      ? "requesting midi access…"
      : status === "unsupported"
        ? "web midi unsupported here"
        : status === "needsGesture"
          ? "reopen this window to allow midi"
          : status === "denied"
            ? "midi blocked — check browser settings"
            : devices.length === 0
              ? "no midi inputs — play the panel"
              : devices.map((d) => d.name).join(" · "));
  const ledColor =
    loadError || status === "denied" || status === "unsupported"
      ? "#a80000"
      : status === "ready" && devices.length > 0
        ? "#1d9e75"
        : "#c8a200";

  return (
    <Chassis containerRef={panelRef}>
      <BrandBar
        right={
          <span
            title={screenNote}
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: ledColor,
              border: `1px solid ${PANEL.shadow}`,
            }}
          />
        }
      />

      {/* Too narrow to lay the clusters out side by side: one at a time, and a
          tab to pick which. */}
      {compact && (
        <div style={{ flex: "0 0 auto", display: "flex", gap: 3 }}>
          {PANEL_TABS.map((t) => (
            <PanelButton
              key={t.id}
              label={t.label}
              active={panelTab === t.id}
              onClick={() => setPanelTab(t.id)}
            />
          ))}
        </div>
      )}

      {/* Left to right, the way they sit on the hardware: bend, mod, stick,
          pads, knobs. Wraps onto more lines when the window is narrow. */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: 4,
          minWidth: 0,
        }}
      >
        {showCluster("wheels") && (
        <Cluster label="Bend" style={{ flex: "0 0 auto", minWidth: 30 }}>
          <Fader
            ariaLabel="Pitch bend"
            value={bendValue}
            min={0}
            max={16383}
            size={FADER_HEIGHT}
            disabled={playing}
            readout={bendSemitones === 0 ? "0" : `${bendSemitones > 0 ? "+" : ""}${bendSemitones.toFixed(1)}`}
            onChange={sendBend}
            onCommit={releaseBend}
          />
        </Cluster>
        )}

        {showCluster("wheels") && (
        <Cluster label="Mod" style={{ flex: "0 0 auto", minWidth: 30 }}>
          <Fader
            ariaLabel="Modulation (vibrato) — CC 1"
            value={modValue}
            min={0}
            max={127}
            size={FADER_HEIGHT}
            disabled={playing}
            readout={String(modValue)}
            onChange={sendMod}
          />
        </Cluster>
        )}

        {showCluster("wheels") && (
        <Cluster label="Stick" style={{ flex: "0 0 auto", minWidth: 58 }}>
          <Joystick
            size={FADER_HEIGHT - 22}
            x={ccToAxis(stick.x)}
            y={ccToAxis(stick.y)}
            disabled={playing}
            ariaLabel={`Stick — filter cutoff across (CC ${STICK_CC_X}), resonance up (CC ${STICK_CC_Y})`}
            readout={`${stick.x}·${stick.y}`}
            onMove={stickMove}
            onRelease={stickRelease}
          />
        </Cluster>
        )}

        {/* The pads — eight notes on channel 10, from 36 (bank A) or 44 (bank B). */}
        {showCluster("pads") && (
        <Cluster label={`Pads · bank ${PAD_BANKS[padBank]}`} style={{ flex: "0 1 auto", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, width: 164 }}>
            {[
              [4, 5, 6, 7],
              [0, 1, 2, 3],
            ].map((row, ri) => (
              <div key={ri} style={{ display: "flex", gap: 3 }}>
                {row.map((i) => (
                  <Pad
                    key={i}
                    index={i}
                    label={String(i + 1)}
                    name={drumForNote(padBankBase(padBank) + i).name}
                    sub={drumForNote(padBankBase(padBank) + i).short}
                    active={padHeld.includes(padBankBase(padBank) + i)}
                    height={34}
                    disabled={playing}
                    onDown={() => padDown(i)}
                    onUp={() => padUp(i)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Cluster>
        )}

        {/* K1–K8, sending CC 70–77 the way the hardware ships — and each one
            wired to the synth parameter named under it. */}
        {showCluster("knobs") && (
        <Cluster label="Knobs · CC 70–77" style={{ flex: "0 0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[
              [0, 1, 2, 3],
              [4, 5, 6, 7],
            ].map((row, ri) => (
              <div key={ri} style={{ display: "flex", gap: 4 }}>
                {row.map((i) => (
                  <Knob
                    key={i}
                    id={KNOB_PARAMS[i].id}
                    name={KNOB_PARAMS[i].name}
                    label={KNOB_PARAMS[i].short}
                    cc={KNOB_CC_BASE + i}
                    value={knobs[i]}
                    size={30}
                    disabled={playing}
                    onChange={(next) => handleKnob(i, next)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Cluster>
        )}
      </div>

      {/* The display strip: what's plugged in, the last message through the
          panel, and the current program / octave / flags. */}
      <Well style={{ background: PANEL.canvas, padding: "2px 5px" }}>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.35,
            color: PANEL.text,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ whiteSpace: "nowrap" }}>
              {last
                ? `${last.channel == null ? "--" : `CH${String(last.channel).padStart(2, "0")}`} ${last.type}`
                : "MPK mini PLUS"}
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {last ? (knobReadout(last) ?? (last.detail || last.bytes)) : "ready"}
            </span>
          </div>
          <div
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: loadError ? "#a80000" : PANEL.dim,
            }}
          >
            {screenNote}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              color: PANEL.dim,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              prog {waveform} · {octaveLabel}
              {latch ? " · latch" : ""}
              {fullLevel ? " · full" : ""}
              {bitsView ? " · bits" : ""}
            </span>
            <span>
              {playing
                ? `▶ ${formatTransport(playPos)} / ${formatTransport(playTotal)}`
                : `${entries.length} msg${entries.length >= MAX_ENTRIES ? " max" : ""}`}
            </span>
          </div>
        </div>
      </Well>

      {/* The function buttons. Six across is more than a narrow panel can show
          without shaving them down to initials, so they break into two rows. */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          flexDirection: compact ? "column" : "row",
          gap: 3,
          alignItems: "stretch",
        }}
      >
        <div style={{ display: "flex", gap: 3, flex: "1 1 auto" }}>
          <PanelButton
            label="Oct −"
            disabled={playing || octaveShift <= -3}
            onClick={() => bumpOctave(-1)}
          />
          <PanelButton
            label="Oct +"
            disabled={playing || octaveShift >= 3}
            onClick={() => bumpOctave(1)}
          />
          <PanelButton
            label={wide || compact ? "Full level" : "Full"}
            active={fullLevel}
            disabled={playing}
            onClick={toggleFullLevel}
          />
        </div>
        <div style={{ display: "flex", gap: 3, flex: "1 1 auto" }}>
          <PanelButton label="Latch" active={latch} disabled={playing} onClick={toggleLatch} />
          <PanelButton
            label={wide || compact ? "Bank" : "Bk"}
            sub={PAD_BANKS[padBank]}
            disabled={playing}
            onClick={cyclePadBank}
          />
          <PanelButton
            label="Prog"
            sub={wide || compact ? waveform : waveform.slice(0, 3)}
            weight={1.35}
            disabled={playing}
            onClick={cycleProgram}
          />
        </div>
      </div>

      {metersOpen && (
        <Well style={{ gap: 3, fontFamily: "monospace", fontSize: 11, padding: "3px 4px" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {meters.channels.map((v, i) => (
              <div
                key={i}
                title={`CH${i + 1}`}
                style={{
                  flex: "1 1 0",
                  height: 12,
                  border: "1px solid #9a9a9a",
                  background: v > 0 ? `rgba(29, 158, 117, ${0.2 + 0.8 * v})` : "#e6e6e6",
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: PANEL.dim,
            }}
          >
            <span>CH 1</span>
            <span>16</span>
          </div>
          <MeterBar label="vel" value={meters.velocity} />
          <MeterBar
            label={meters.cc == null ? "cc —" : `cc ${meters.cc}`}
            value={meters.ccValue}
            hasValue={meters.cc != null}
          />
        </Well>
      )}

      {scopeOpen && (
        <ScopeView read={readScope} waveform={waveform} playing={playing} tall={maximized} />
      )}

      {/* The 37 mini keys, transposed by the Oct buttons. */}
      <Well style={{ padding: "4px 4px 3px" }}>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            {kb.windowed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <div style={{ flex: "0 0 64px", display: "flex" }}>
                  <PanelButton
                    label="◀ oct"
                    disabled={kb.lowNote <= RANGE_FULL.low}
                    onClick={() => shiftOctave(-1)}
                  />
                </div>
                <span style={{ flex: "1 1 auto", textAlign: "center" }}>
                  <Legend>
                    {noteName(kb.lowNote)} – {noteName(kb.highNote)}
                  </Legend>
                </span>
                <div style={{ flex: "0 0 64px", display: "flex" }}>
                  <PanelButton
                    label="oct ▶"
                    disabled={kb.highNote >= RANGE_FULL.high}
                    onClick={() => shiftOctave(1)}
                  />
                </div>
              </div>
            )}
            <div ref={keysWrapRef}>
              <PlayableKeyboard
                layout={kb.layout}
                height={kb.height}
                held={held}
                disabled={playing}
                onNoteOn={keyboardNoteOn}
                onNoteOff={keyboardNoteOff}
              />
            </div>
            <div style={{ marginTop: 3 }}>
              <Legend>
                {noteName(kb.lowNote)}–{noteName(kb.highNote)} · click, or type A–K (W E T Y U for
                sharps) · Z / X shifts octave
              </Legend>
            </div>
          </div>
        </div>
      </Well>

      {(!bitsView || maximized) && (
        <ScrollView
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            width: "100%",
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          {entries.length === 0 ? (
            <div style={{ opacity: 0.6 }}>Waiting for messages…</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} style={{ whiteSpace: "pre" }}>
                {entry.clock}  {entry.source.slice(0, 8).padEnd(8)}  {entry.channel === null ? "  --" : `CH${String(entry.channel).padStart(2, "0")}`}  {entry.type.padEnd(18)}{entry.detail}
                <span style={{ opacity: 0.55 }}>{"   "}{entry.bytes}</span>
              </div>
            ))
          )}
        </ScrollView>
      )}

      {/* Bits view: swapped in for the log in a normal window; a strip below it
          when maximised, where there's room for everything. */}
      {bitsView && (
        <Well
          grow={!maximized}
          style={{ overflow: "auto", fontFamily: "monospace", fontSize: 11, padding: "4px 4px 3px" }}
        >
          <BitSpotlight
            cells={spotlight.cells}
            empty={spotlight.empty}
            truncated={spotlight.truncated}
          />
        </Well>
      )}
    </Chassis>
  );
});

export default MidiWindow;
