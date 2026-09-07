"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ScrollView } from "react95";
import { MidiSynth, type Waveform } from "@/lib/midiSynth";
import { decodeSmf, encodeSmf } from "@/lib/smf";

export type MidiWindowHandle = {
  newSession: () => void;
  toggleMeters: () => void;
  toggleKeys: () => void;
  setWaveform: (waveform: Waveform) => void;
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
  onKeysOpenChange?: (open: boolean) => void;
  onWaveformChange?: (waveform: Waveform) => void;
  onPlayingChange?: (playing: boolean) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
};

type MidiStatus = "checking" | "unsupported" | "needsGesture" | "denied" | "ready";

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
// Compact range for the normal window; full 88-key piano when maximised.
const RANGE_NORMAL = { low: 48, high: 77 }; // C3–F5
const RANGE_FULL = { low: 21, high: 108 }; // A0–C8
const KEY_HEIGHT_NORMAL = 84;
const KEY_HEIGHT_FULL = 132;

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
      <span style={{ flex: "0 0 40px", color: "#404040" }}>{label}</span>
      <div
        style={{
          flex: "1 1 auto",
          height: 9,
          background: "#ffffff",
          border: "1px solid #808080",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "#000080" }} />
      </div>
      <span style={{ flex: "0 0 26px", textAlign: "right" }}>
        {hasValue ? Math.round(value) : "—"}
      </span>
    </div>
  );
}

type KeyCell = { note: number; leftPct: number; widthPct: number };

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
  held,
  disabled,
  full,
  onNoteOn,
  onNoteOff,
}: {
  held: number[];
  disabled: boolean;
  full: boolean;
  onNoteOn: (note: number) => void;
  onNoteOff: (note: number) => void;
}) {
  const layout = full ? KEYBOARD_FULL : KEYBOARD_NORMAL;
  const height = full ? KEY_HEIGHT_FULL : KEY_HEIGHT_NORMAL;
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

  const cellProps = (note: number) =>
    disabled
      ? {}
      : {
          onPointerDown: (e: React.PointerEvent) => {
            e.preventDefault();
            press(note);
          },
          onPointerEnter: (e: React.PointerEvent) => {
            if (e.buttons === 1) press(note);
          },
        };

  return (
    <div
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
          {...cellProps(note)}
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
          {...cellProps(note)}
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
    onKeysOpenChange,
    onWaveformChange,
    onPlayingChange,
    onHasMessagesChange,
  },
  ref,
) {
  const [status, setStatus] = useState<MidiStatus>("checking");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [metersOpen, setMetersOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(true);
  const [waveform, setWaveformState] = useState<Waveform>("square");
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const [playTotal, setPlayTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [octaveShift, setOctaveShift] = useState(0);
  const [meters, setMeters] = useState<Meters>(() => ({
    channels: new Array(16).fill(0),
    velocity: 0,
    cc: null,
    ccValue: 0,
  }));
  const [held, setHeld] = useState<number[]>([]);

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
  const heldRef = useRef<Map<number, number>>(new Map());

  const synthRef = useRef<MidiSynth | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const playingRef = useRef(false);
  const playTimeoutsRef = useRef<number[]>([]);
  const playIntervalRef = useRef<number | null>(null);
  const octaveShiftRef = useRef(0);
  const pressedCodesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    octaveShiftRef.current = octaveShift;
  }, [octaveShift]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

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
        if (parsed.type === "Note On") synth.noteOn(parsed.note, parsed.velocity ?? 96);
        else if (parsed.type === "Note Off") synth.noteOff(parsed.note);
      }

      const m = metersRef.current;
      if (parsed.channel != null) m.channels[parsed.channel - 1] = 1;
      if (parsed.velocity != null) m.velocity = parsed.velocity;
      if (parsed.cc != null) {
        m.cc = parsed.cc;
        m.ccValue = parsed.ccValue ?? 0;
      }
      if (parsed.note != null) {
        const counts = heldRef.current;
        if (parsed.type === "Note On") {
          counts.set(parsed.note, (counts.get(parsed.note) ?? 0) + 1);
        } else if (parsed.type === "Note Off") {
          const next = (counts.get(parsed.note) ?? 0) - 1;
          if (next <= 0) counts.delete(parsed.note);
          else counts.set(parsed.note, next);
        }
        setHeld(Array.from(counts.keys()));
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
      pushEntry("keys", Uint8Array.from(on ? [0x90, note, 96] : [0x80, note, 0]));
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
    heldRef.current.clear();
    setHeld([]);
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
      setHeld([]);
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
    onKeysOpenChange?.(keysOpen);
  }, [keysOpen, onKeysOpenChange]);

  useEffect(() => {
    onWaveformChange?.(waveform);
  }, [waveform, onWaveformChange]);

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
        setHeld([]);
        setEntries([]);
        setLoadError(null);
      },
      toggleMeters: () => setMetersOpen((v) => !v),
      toggleKeys: () => setKeysOpen((v) => !v),
      setWaveform: (next: Waveform) => {
        setWaveformState(next);
        ensureSynth().setWaveform(next);
      },
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

  const octaveLabel = octaveShift === 0 ? "" : ` · keys ${octaveShift > 0 ? "+" : ""}${octaveShift} oct`;

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: "monospace",
        fontSize: 11,
      }}
    >
      <div style={{ flex: "0 0 auto" }}>
        {status === "checking" && <div>Requesting MIDI access…</div>}
        {status === "unsupported" && (
          <div>Web MIDI is not supported in this browser. Try Chrome or Firefox.</div>
        )}
        {status === "needsGesture" && (
          <div>MIDI needs your permission — reopen this window to allow it.</div>
        )}
        {status === "denied" && <div>MIDI access is blocked. Allow it in your browser settings.</div>}
        {status === "ready" && devices.length === 0 && (
          <div>No MIDI inputs detected — play the on-screen keyboard or open a .mid file.</div>
        )}
        {status === "ready" && devices.length > 0 && (
          <div>
            <div style={{ fontWeight: "bold" }}>Inputs</div>
            {devices.map((device) => (
              <div key={device.id}>
                {device.name}
                {device.manufacturer ? ` — ${device.manufacturer}` : ""} [{device.state}/{device.connection}]
              </div>
            ))}
          </div>
        )}
        {loadError && <div style={{ color: "#a80000" }}>{loadError}</div>}
      </div>

      {metersOpen && (
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 3,
            padding: "3px 4px",
            border: "2px solid",
            borderColor: "#808080 #ffffff #ffffff #808080",
          }}
        >
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
              color: "#404040",
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
        </div>
      )}

      {keysOpen && (
        <div
          style={{
            flex: "0 0 auto",
            padding: "4px 4px 3px",
            border: "2px solid",
            borderColor: "#808080 #ffffff #ffffff #808080",
          }}
        >
          <PlayableKeyboard
            held={held}
            disabled={playing}
            full={maximized}
            onNoteOn={keyboardNoteOn}
            onNoteOff={keyboardNoteOff}
          />
          <div style={{ marginTop: 3, fontSize: 9, color: "#404040" }}>
            click, or type A–K (W E T Y U for sharps){octaveShift !== 0 ? ` · ${octaveShift > 0 ? "+" : ""}${octaveShift} oct` : ""} · Z / X shifts octave
          </div>
        </div>
      )}

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }}>
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

      <div style={{ flex: "0 0 auto", opacity: 0.6 }}>
        {entries.length} message{entries.length === 1 ? "" : "s"}
        {entries.length >= MAX_ENTRIES ? " (capped)" : ""}
        {"  ·  "}
        {`wave ${waveform}`}
        {playing ? `  ·  ▶ ${formatTransport(playPos)} / ${formatTransport(playTotal)}` : ""}
        {octaveLabel}
      </div>
    </div>
  );
});

export default MidiWindow;
