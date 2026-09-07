// Standard MIDI File encode / decode, just enough for the Keys (midi.exe)
// window: record the live message stream to a Format 0 file, and read a
// Format 0/1 file back into a flat, absolute-time event list for playback.
// No dependencies.

export type TimedMessage = {
  /** Milliseconds from the start of the recording / file. */
  atMs: number;
  data: number[] | Uint8Array;
};

export type DecodedSmf = {
  ppq: number;
  events: { atMs: number; data: Uint8Array }[];
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

const ENC_PPQ = 480;
const ENC_US_PER_QN = 500_000; // 120 BPM
const TICKS_PER_MS = ENC_PPQ / (ENC_US_PER_QN / 1000); // 0.96

function writeVarLen(out: number[], value: number): void {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  out.push(...bytes);
}

function pushU32(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function isRealtimeOrClock(status: number): boolean {
  // 0xF8..0xFF real-time, plus active sensing / clock — nothing worth saving.
  return status >= 0xf8;
}

export function encodeSmf(messages: TimedMessage[], opts: { name?: string } = {}): Uint8Array {
  const track: number[] = [];

  // Track name (optional) + tempo, both at tick 0.
  if (opts.name) {
    const name = Array.from(opts.name).map((c) => c.charCodeAt(0) & 0x7f);
    writeVarLen(track, 0);
    track.push(0xff, 0x03, name.length, ...name);
  }
  writeVarLen(track, 0);
  track.push(
    0xff,
    0x51,
    0x03,
    (ENC_US_PER_QN >> 16) & 0xff,
    (ENC_US_PER_QN >> 8) & 0xff,
    ENC_US_PER_QN & 0xff,
  );

  const sorted = [...messages].sort((a, b) => a.atMs - b.atMs);
  let prevTick = 0;
  for (const msg of sorted) {
    const bytes = Array.from(msg.data);
    if (bytes.length === 0) continue;
    if (isRealtimeOrClock(bytes[0])) continue;
    if (bytes[0] < 0x80) continue; // no running status on the wire we captured
    const tick = Math.round(msg.atMs * TICKS_PER_MS);
    writeVarLen(track, Math.max(0, tick - prevTick));
    prevTick = tick;
    track.push(...bytes);
  }

  // End of track.
  writeVarLen(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const out: number[] = [];
  out.push(0x4d, 0x54, 0x68, 0x64); // "MThd"
  pushU32(out, 6);
  out.push(0x00, 0x00); // format 0
  out.push(0x00, 0x01); // one track
  out.push((ENC_PPQ >> 8) & 0xff, ENC_PPQ & 0xff);
  out.push(0x4d, 0x54, 0x72, 0x6b); // "MTrk"
  pushU32(out, track.length);
  out.push(...track);

  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

class Reader {
  pos = 0;
  private readonly view: DataView;
  constructor(view: DataView) {
    this.view = view;
  }
  get remaining(): number {
    return this.view.byteLength - this.pos;
  }
  u8(): number {
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    const b = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return new Uint8Array(b); // copy, detached from the source buffer
  }
  varLen(): number {
    let value = 0;
    for (;;) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  }
  fourcc(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }
}

type TickEvent = { tick: number; data: Uint8Array };
type TempoChange = { tick: number; usPerQn: number };

function messageLength(status: number): number {
  const kind = status & 0xf0;
  if (kind === 0xc0 || kind === 0xd0) return 2;
  if (status === 0xf1 || status === 0xf3) return 2;
  if (status === 0xf2) return 3;
  if (status >= 0xf4) return 1;
  return 3;
}

export function decodeSmf(bytes: Uint8Array): DecodedSmf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new Reader(view);

  if (r.remaining < 14 || r.fourcc() !== "MThd") {
    throw new Error("Not a MIDI file");
  }
  const headerLen = r.u32();
  const headerEnd = r.pos + headerLen;
  r.u16(); // format — we merge tracks regardless
  const ntrks = r.u16();
  const division = r.u16();
  r.pos = headerEnd;

  const smpte = (division & 0x8000) !== 0;
  const ppq = smpte ? ENC_PPQ : division || ENC_PPQ;

  const events: TickEvent[] = [];
  const tempos: TempoChange[] = [];

  for (let t = 0; t < ntrks && r.remaining >= 8; t++) {
    if (r.fourcc() !== "MTrk") break;
    const len = r.u32();
    const trackEnd = r.pos + len;
    let tick = 0;
    let runningStatus = 0;

    while (r.pos < trackEnd) {
      tick += r.varLen();
      let status = r.u8();
      if (status < 0x80) {
        // Running status: reuse the last, and the byte we read is data.
        r.pos--;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }

      if (status === 0xff) {
        const type = r.u8();
        const dataLen = r.varLen();
        const data = r.bytes(dataLen);
        if (type === 0x51 && dataLen === 3) {
          tempos.push({ tick, usPerQn: (data[0] << 16) | (data[1] << 8) | data[2] });
        }
        // 0x2f end-of-track and everything else: ignored for playback.
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const dataLen = r.varLen();
        r.pos += dataLen; // skip sysex
        continue;
      }

      const total = messageLength(status);
      const rest = total - 1;
      const msg = new Uint8Array(total);
      msg[0] = status;
      for (let i = 0; i < rest; i++) msg[i + 1] = r.u8();
      events.push({ tick, data: msg });
    }
    r.pos = trackEnd;
  }

  events.sort((a, b) => a.tick - b.tick);
  tempos.sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0 || tempos[0].tick > 0) {
    tempos.unshift({ tick: 0, usPerQn: ENC_US_PER_QN });
  }

  // Walk the tempo map, converting ticks to ms.
  const tickToMs = (targetTick: number): number => {
    let ms = 0;
    let lastTick = 0;
    let usPerQn = tempos[0].usPerQn;
    for (let i = 1; i < tempos.length; i++) {
      const seg = tempos[i];
      if (seg.tick >= targetTick) break;
      ms += ((seg.tick - lastTick) / ppq) * (usPerQn / 1000);
      lastTick = seg.tick;
      usPerQn = seg.usPerQn;
    }
    ms += ((targetTick - lastTick) / ppq) * (usPerQn / 1000);
    return ms;
  };

  const timed = events.map((e) => ({ atMs: tickToMs(e.tick), data: e.data }));
  const durationMs = timed.length ? timed[timed.length - 1].atMs : 0;
  return { ppq, events: timed, durationMs };
}
