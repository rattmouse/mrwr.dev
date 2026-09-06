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

export type MidiWindowHandle = {
  clear: () => void;
};

type MidiStatus = "checking" | "unsupported" | "denied" | "ready";

type DeviceInfo = {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
};

type LogEntry = {
  id: number;
  clock: string;
  source: string;
  channel: number | null;
  type: string;
  detail: string;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAX_ENTRIES = 250;
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

function describe(
  data: Uint8Array,
): { channel: number | null; type: string; detail: string } | null {
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
      return { channel, type: "Note Off", detail: `${noteName(d1)}  vel ${d2}` };
    case 0x90:
      return {
        channel,
        type: d2 === 0 ? "Note Off" : "Note On",
        detail: `${noteName(d1)}  vel ${d2}`,
      };
    case 0xa0:
      return { channel, type: "Poly Aftertouch", detail: `${noteName(d1)}  ${d2}` };
    case 0xb0:
      return { channel, type: "Control Change", detail: `CC ${d1}  val ${d2}` };
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

const MidiWindow = forwardRef<MidiWindowHandle>(function MidiWindow(_props, ref) {
  const [status, setStatus] = useState<MidiStatus>("checking");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const nextId = useRef(0);
  const startedAt = useRef(0);

  useImperativeHandle(ref, () => ({
    clear: () => setEntries([]),
  }));

  const pushEntry = useCallback((source: string, data: Uint8Array) => {
    const parsed = describe(data);
    if (!parsed) return;
    const entry: LogEntry = {
      id: nextId.current++,
      clock: formatClock(performance.now() - startedAt.current),
      source,
      channel: parsed.channel,
      type: parsed.type,
      detail: parsed.detail,
    };
    setEntries((prev) => {
      const next = [entry, ...prev];
      return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    let access: MIDIAccess | null = null;
    startedAt.current = performance.now();

    const handleMessage = (event: Event) => {
      const msg = event as MIDIMessageEvent;
      const target = msg.target as MIDIInput | null;
      if (!msg.data) return;
      pushEntry(target?.name ?? "input", msg.data);
    };

    const syncDevices = () => {
      if (!access) return;
      const list: DeviceInfo[] = [];
      access.inputs.forEach((input) => {
        list.push({
          id: input.id,
          name: input.name ?? "Unknown",
          manufacturer: input.manufacturer ?? "",
          state: input.state,
        });
        input.removeEventListener("midimessage", handleMessage);
        input.addEventListener("midimessage", handleMessage);
      });
      setDevices(list);
    };

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((granted) => {
        if (cancelled) return;
        access = granted;
        setStatus("ready");
        access.addEventListener("statechange", syncDevices);
        syncDevices();
      })
      .catch(() => {
        if (!cancelled) setStatus("denied");
      });

    return () => {
      cancelled = true;
      if (access) {
        access.removeEventListener("statechange", syncDevices);
        access.inputs.forEach((input) => {
          input.removeEventListener("midimessage", handleMessage);
        });
      }
    };
  }, [pushEntry]);

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
        {status === "denied" && <div>MIDI access was blocked. Allow it and reopen this window.</div>}
        {status === "ready" && devices.length === 0 && <div>No MIDI inputs detected. Plug one in.</div>}
        {status === "ready" && devices.length > 0 && (
          <div>
            <div style={{ fontWeight: "bold" }}>Inputs</div>
            {devices.map((device) => (
              <div key={device.id}>
                {device.name}
                {device.manufacturer ? ` — ${device.manufacturer}` : ""} [{device.state}]
              </div>
            ))}
          </div>
        )}
      </div>

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }}>
        {entries.length === 0 ? (
          <div style={{ opacity: 0.6 }}>Waiting for messages…</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} style={{ whiteSpace: "pre" }}>
              {entry.clock}  {entry.channel === null ? "  --" : `CH${String(entry.channel).padStart(2, "0")}`}  {entry.type.padEnd(18)}{entry.detail}
            </div>
          ))
        )}
      </ScrollView>

      <div style={{ flex: "0 0 auto", opacity: 0.6 }}>
        {entries.length} message{entries.length === 1 ? "" : "s"}
        {entries.length >= MAX_ENTRIES ? " (capped)" : ""}
      </div>
    </div>
  );
});

export default MidiWindow;
