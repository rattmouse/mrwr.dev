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
  toggleHex: () => void;
  toggleMeters: () => void;
  scan: () => void;
};

type MidiWindowProps = {
  onHexOpenChange?: (open: boolean) => void;
  onMetersOpenChange?: (open: boolean) => void;
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
      return { channel, type: "Note Off", detail: `${noteName(d1)}  vel ${d2}` };
    case 0x90:
      return {
        channel,
        type: d2 === 0 ? "Note Off" : "Note On",
        detail: `${noteName(d1)}  vel ${d2}`,
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

const MidiWindow = forwardRef<MidiWindowHandle, MidiWindowProps>(function MidiWindow(
  { onHexOpenChange, onMetersOpenChange },
  ref,
) {
  const [status, setStatus] = useState<MidiStatus>("checking");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [hexOpen, setHexOpen] = useState(true);
  const [metersOpen, setMetersOpen] = useState(true);
  const [meters, setMeters] = useState<Meters>(() => ({
    channels: new Array(16).fill(0),
    velocity: 0,
    cc: null,
    ccValue: 0,
  }));

  const nextId = useRef(0);
  const startedAt = useRef(0);
  const accessRef = useRef<MIDIAccess | null>(null);
  const epochRef = useRef(0);
  // Shared in-flight requestMIDIAccess promise, so a dev StrictMode double-mount
  // (or a fast double Scan) fires one browser request, not two — Firefox blocks
  // an origin after repeated gesture-less attempts.
  const pendingRef = useRef<Promise<MIDIAccess> | null>(null);
  const metersRef = useRef<Meters>({
    channels: new Array(16).fill(0),
    velocity: 0,
    cc: null,
    ccValue: 0,
  });

  const pushEntry = useCallback((source: string, data: Uint8Array) => {
    const parsed = describe(data);
    if (!parsed) return;

    const m = metersRef.current;
    if (parsed.channel != null) m.channels[parsed.channel - 1] = 1;
    if (parsed.velocity != null) m.velocity = parsed.velocity;
    if (parsed.cc != null) {
      m.cc = parsed.cc;
      m.ccValue = parsed.ccValue ?? 0;
    }

    const entry: LogEntry = {
      id: nextId.current++,
      clock: formatClock(performance.now() - startedAt.current),
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
  }, []);

  const handleMessage = useCallback(
    (event: MIDIMessageEvent) => {
      const target = event.target as MIDIInput | null;
      if (!event.data) return;
      pushEntry(target?.name ?? "input", event.data);
    },
    [pushEntry],
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

  const connect = useCallback(
    (userInitiated = false) => {
      if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
        setStatus("unsupported");
        return;
      }

      const epoch = ++epochRef.current;
      setStatus("checking");
      if (startedAt.current === 0) startedAt.current = performance.now();

      // A Scan click should force a fresh request even if one is already pending.
      if (userInitiated) pendingRef.current = null;
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
          setStatus(userInitiated ? "denied" : "needsGesture");
        })
        .finally(() => {
          if (pendingRef.current === req) pendingRef.current = null;
        });
    },
    [detachAccess, syncDevices],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
        setStatus("unsupported");
        return;
      }

      // If the permission is already decided, honour it without firing a
      // gesture-less request (which Firefox penalises). Otherwise try once;
      // on failure we fall back to asking the user to press Scan.
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
      connect(false);
    };

    bootstrap();
    return () => {
      cancelled = true;
      epochRef.current++;
      detachAccess();
    };
  }, [connect, detachAccess]);

  // Decay the channel-activity cells and publish a throttled snapshot for the meters.
  useEffect(() => {
    if (status !== "ready" || !metersOpen) return;
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
  }, [status, metersOpen]);

  useEffect(() => {
    onHexOpenChange?.(hexOpen);
  }, [hexOpen, onHexOpenChange]);

  useEffect(() => {
    onMetersOpenChange?.(metersOpen);
  }, [metersOpen, onMetersOpenChange]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => setEntries([]),
      toggleHex: () => setHexOpen((v) => !v),
      toggleMeters: () => setMetersOpen((v) => !v),
      scan: () => connect(true),
    }),
    [connect],
  );

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
        {status === "needsGesture" && <div>MIDI needs your permission. Press Scan to connect.</div>}
        {status === "denied" && (
          <div>MIDI access is blocked. Allow it in your browser settings, then press Scan.</div>
        )}
        {status === "ready" && devices.length === 0 && <div>No MIDI inputs detected. Plug one in.</div>}
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

      <ScrollView style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }}>
        {entries.length === 0 ? (
          <div style={{ opacity: 0.6 }}>Waiting for messages…</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} style={{ whiteSpace: "pre" }}>
              {entry.clock}  {entry.channel === null ? "  --" : `CH${String(entry.channel).padStart(2, "0")}`}  {entry.type.padEnd(18)}{entry.detail}
              {hexOpen && <span style={{ opacity: 0.55 }}>{"   "}{entry.bytes}</span>}
            </div>
          ))
        )}
      </ScrollView>

      <div style={{ flex: "0 0 auto", opacity: 0.6 }}>
        {entries.length} message{entries.length === 1 ? "" : "s"}
        {entries.length >= MAX_ENTRIES ? " (capped)" : ""}
        {"  ·  "}
        {hexOpen ? "hex on" : "hex off"}
      </div>
    </div>
  );
});

export default MidiWindow;
