// A tiny polyphonic Web Audio synth for the Keys (midi.exe) window. One
// oscillator per held note through a filter, a short attack, an exponential-ish
// release tail — plus a drum kit on channel 10 for the pads and an eight-slot
// parameter set for the knobs. No dependencies, no samples.

export type Waveform = "square" | "sawtooth" | "triangle" | "sine";

// Channel 10 is percussion, the way General MIDI has it — the pads play here,
// and so does any drum track in an imported .mid.
export const DRUM_CHANNEL = 10;
// Pad 1 of bank A. Sixteen kit pieces, so banks A and B cover 36–51.
export const DRUM_BASE_NOTE = 36;

// Floor of the attack ramp — K3 opens it up from here.
const ATTACK = 0.005;
// Per-voice ceiling before the master stage.
const VOICE_GAIN = 0.9;

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

// Each piece is a recipe rather than a sample: an optional pitched `body` that
// sweeps downward (kicks, toms), an optional filtered `noise` burst (snares,
// hats, cymbals), and optional `metal` partials (cowbell, clave, ride ping).
type DrumDef = {
  /** Full name, for the pad's tooltip and the aria label. */
  name: string;
  /** Four or five characters — all that fits silkscreened on a pad. */
  short: string;
  body?: {
    type: OscillatorType;
    /** Start and end of the pitch drop, in Hz. */
    from: number;
    to: number;
    /** How long the pitch takes to fall, in seconds. */
    pitchDecay: number;
    /** How long the body rings, in seconds. */
    decay: number;
    level: number;
  };
  noise?: {
    filter: BiquadFilterType;
    freq: number;
    q: number;
    decay: number;
    level: number;
  };
  metal?: {
    type: OscillatorType;
    freqs: number[];
    decay: number;
    level: number;
  };
  /** Retriggered noise bursts, for the stacked slap of a handclap. */
  bursts?: number;
};

export const DRUM_KIT: readonly DrumDef[] = [
  // Bank A — the eight you reach for first.
  {
    name: "Kick",
    short: "KICK",
    body: { type: "sine", from: 120, to: 45, pitchDecay: 0.055, decay: 0.34, level: 1 },
  },
  {
    name: "Snare",
    short: "SNARE",
    body: { type: "triangle", from: 190, to: 140, pitchDecay: 0.03, decay: 0.11, level: 0.5 },
    noise: { filter: "highpass", freq: 1400, q: 0.8, decay: 0.18, level: 0.7 },
  },
  {
    name: "Closed hat",
    short: "HAT",
    noise: { filter: "highpass", freq: 8000, q: 1, decay: 0.045, level: 0.45 },
  },
  {
    name: "Open hat",
    short: "OPEN",
    noise: { filter: "highpass", freq: 7000, q: 1, decay: 0.32, level: 0.4 },
  },
  {
    name: "Clap",
    short: "CLAP",
    noise: { filter: "bandpass", freq: 1500, q: 1.2, decay: 0.16, level: 0.6 },
    bursts: 3,
  },
  {
    name: "Low tom",
    short: "TOM L",
    body: { type: "sine", from: 160, to: 70, pitchDecay: 0.12, decay: 0.4, level: 0.9 },
  },
  {
    name: "Rim",
    short: "RIM",
    body: { type: "square", from: 400, to: 220, pitchDecay: 0.012, decay: 0.03, level: 0.3 },
    noise: { filter: "bandpass", freq: 2200, q: 4, decay: 0.04, level: 0.5 },
  },
  {
    name: "Crash",
    short: "CRASH",
    noise: { filter: "highpass", freq: 5000, q: 0.7, decay: 1.1, level: 0.35 },
  },
  // Bank B — the second shelf.
  {
    name: "Sub kick",
    short: "SUB",
    body: { type: "sine", from: 90, to: 35, pitchDecay: 0.085, decay: 0.6, level: 1 },
  },
  {
    name: "Rimshot",
    short: "SNR 2",
    body: { type: "triangle", from: 240, to: 180, pitchDecay: 0.02, decay: 0.08, level: 0.4 },
    noise: { filter: "highpass", freq: 2500, q: 0.8, decay: 0.1, level: 0.7 },
  },
  {
    name: "Shaker",
    short: "SHKR",
    noise: { filter: "bandpass", freq: 6000, q: 1.5, decay: 0.09, level: 0.45 },
  },
  {
    name: "Cowbell",
    short: "BELL",
    metal: { type: "square", freqs: [540, 800], decay: 0.28, level: 0.3 },
  },
  {
    name: "Mid tom",
    short: "TOM M",
    body: { type: "sine", from: 230, to: 110, pitchDecay: 0.1, decay: 0.32, level: 0.85 },
  },
  {
    name: "High tom",
    short: "TOM H",
    body: { type: "sine", from: 320, to: 160, pitchDecay: 0.09, decay: 0.26, level: 0.85 },
  },
  {
    name: "Ride",
    short: "RIDE",
    noise: { filter: "highpass", freq: 6000, q: 0.7, decay: 0.85, level: 0.28 },
    metal: { type: "square", freqs: [1200, 1800], decay: 0.5, level: 0.1 },
  },
  {
    name: "Clave",
    short: "CLAVE",
    metal: { type: "triangle", freqs: [1200, 2400], decay: 0.09, level: 0.4 },
  },
];

/** The kit piece a channel-10 note plays. Wraps, so any drum track lands on one. */
export function drumForNote(note: number): DrumDef {
  const slot = (((note - DRUM_BASE_NOTE) % DRUM_KIT.length) + DRUM_KIT.length) % DRUM_KIT.length;
  return DRUM_KIT[slot];
}

// ---------------------------------------------------------------------------
// The knobs
// ---------------------------------------------------------------------------

const cutoffHz = (v: number) => 120 * (12000 / 120) ** (v / 127);
const resonanceQ = (v: number) => 0.7 + (v / 127) * 14;
const attackSec = (v: number) => ATTACK + (v / 127) ** 2 * 1.5;
const releaseSec = (v: number) => 0.03 + (v / 127) ** 2 * 2.5;
const tuneSemis = (v: number) => ((v - 64) / 64) * 12;
const decayScale = (v: number) => 2 ** ((v - 64) / 32);
const echoMix = (v: number) => v / 127;
const volumeGain = (v: number) => (v / 127) ** 2 * 0.25;

const seconds = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const hertz = (hz: number) =>
  hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;

/**
 * What K1–K8 do. The panel reads `short` for the caption and `format` for the
 * display strip; `setKnob` below reads the index.
 */
export const KNOB_PARAMS = [
  {
    id: "K1",
    name: "Cutoff",
    short: "CUT",
    default: 127,
    format: (v: number) => hertz(cutoffHz(v)),
  },
  {
    id: "K2",
    name: "Resonance",
    short: "RES",
    default: 0,
    format: (v: number) => `Q ${resonanceQ(v).toFixed(1)}`,
  },
  {
    id: "K3",
    name: "Attack",
    short: "ATK",
    default: 0,
    format: (v: number) => seconds(attackSec(v)),
  },
  {
    id: "K4",
    name: "Release",
    short: "REL",
    default: 24,
    format: (v: number) => seconds(releaseSec(v)),
  },
  {
    id: "K5",
    name: "Drum tune",
    short: "TUNE",
    default: 64,
    format: (v: number) => `${tuneSemis(v) >= 0 ? "+" : ""}${tuneSemis(v).toFixed(1)} st`,
  },
  {
    id: "K6",
    name: "Drum decay",
    short: "DCY",
    default: 64,
    format: (v: number) => `×${decayScale(v).toFixed(2)}`,
  },
  {
    id: "K7",
    name: "Echo",
    short: "ECHO",
    default: 0,
    format: (v: number) => `${Math.round(echoMix(v) * 100)}%`,
  },
  {
    id: "K8",
    name: "Volume",
    short: "VOL",
    default: 96,
    format: (v: number) => `${Math.round((v / 127) * 100)}%`,
  },
] as const;

export const KNOB_COUNT = KNOB_PARAMS.length;
export const KNOB_DEFAULTS: number[] = KNOB_PARAMS.map((p) => p.default);

// The echo is one fixed tap with feedback; only its send level moves.
const ECHO_TIME = 0.26;

// ---------------------------------------------------------------------------

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  /** performance-time (ctx.currentTime) at which the release was scheduled. */
  releasedAt: number | null;
};

type Graph = {
  ctx: AudioContext;
  /** Where held-note voices land: filtered, then mixed. */
  tone: GainNode;
  filter: BiquadFilterNode;
  /** Where drum hits land — no filter, so a low cutoff can't mute the kit. */
  drums: GainNode;
  /** Post-mix, pre-volume. Feeds both the dry path and the echo send. */
  mix: GainNode;
  send: GainNode;
  master: GainNode;
};

function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export class MidiSynth {
  private graph: Graph | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<number, Voice>();
  private waveform: Waveform = "square";
  /** Current pitch-bend offset in cents, applied to every voice. */
  private bendCents = 0;
  /** Raw 0–127 knob positions, index 0 = K1. */
  private knobs = [...KNOB_DEFAULTS];

  /** Create the context on first use; safe to call repeatedly. */
  private ensure(): Graph | null {
    if (typeof window === "undefined") return null;
    if (this.graph) return this.graph;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.connect(ctx.destination);

    const mix = ctx.createGain();
    mix.connect(master);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.connect(mix);

    const tone = ctx.createGain();
    tone.gain.value = 1;
    tone.connect(filter);

    const drums = ctx.createGain();
    drums.gain.value = 1;
    drums.connect(mix);

    // Echo: a send off the mix into one delay tap that feeds itself, returning
    // straight to the master so the dry signal stays untouched.
    const send = ctx.createGain();
    send.gain.value = 0;
    mix.connect(send);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = ECHO_TIME;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    send.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);

    this.graph = { ctx, tone, filter, drums, mix, send, master };
    // Jump straight to the knob positions rather than gliding — a fresh graph
    // starts at the node defaults, and gliding down from unity gain would put a
    // moment of full-volume, half-filtered sound in front of the first note.
    this.applyKnobs(true);
    return this.graph;
  }

  /** One second of white noise, shared by every hat, snare and cymbal. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /** Call from a user gesture so the browser lets audio through. */
  resume(): void {
    const g = this.ensure();
    if (g && g.ctx.state === "suspended") void g.ctx.resume();
  }

  setWaveform(waveform: Waveform): void {
    this.waveform = waveform;
    // Re-voice anything still sounding so the change is audible immediately.
    this.voices.forEach((voice) => {
      voice.osc.type = waveform;
    });
  }

  getWaveform(): Waveform {
    return this.waveform;
  }

  /**
   * Move one knob. Deliberately does not create the AudioContext — a reset can
   * set all eight before the user has done anything a browser counts as a
   * gesture; the values are stored and applied when the graph does come up.
   */
  setKnob(slot: number, value: number): void {
    if (slot < 0 || slot >= KNOB_COUNT) return;
    this.knobs[slot] = Math.max(0, Math.min(127, value));
    this.applyKnobs();
  }

  resetKnobs(): void {
    this.knobs = [...KNOB_DEFAULTS];
    this.applyKnobs();
  }

  private applyKnobs(immediate = false): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    // Ease rather than jump, so a fast sweep doesn't click.
    const set = (param: AudioParam, value: number) =>
      immediate ? param.setValueAtTime(value, now) : param.setTargetAtTime(value, now, 0.01);
    set(g.filter.frequency, cutoffHz(this.knobs[0]));
    set(g.filter.Q, resonanceQ(this.knobs[1]));
    set(g.send.gain, echoMix(this.knobs[6]) * 0.6);
    set(g.master.gain, volumeGain(this.knobs[7]));
  }

  /** Bend every sounding voice, and any that start while the bend is held. */
  setPitchBend(semitones: number): void {
    this.bendCents = semitones * 100;
    this.voices.forEach((voice) => {
      try {
        voice.osc.detune.value = this.bendCents;
      } catch {
        /* voice already stopped */
      }
    });
  }

  noteOn(note: number, velocity = 100, channel = 1): void {
    if (channel === DRUM_CHANNEL) {
      this.drumHit(note, velocity);
      return;
    }
    const g = this.ensure();
    if (!g) return;
    const { ctx, tone } = g;
    if (ctx.state === "suspended") void ctx.resume();

    // Retrigger: drop the old voice on this note first.
    this.stopVoice(note, 0);

    const osc = ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = midiToFreq(note);
    osc.detune.value = this.bendCents;

    const gain = ctx.createGain();
    const level = Math.max(0.05, Math.min(1, velocity / 127)) * VOICE_GAIN;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + attackSec(this.knobs[2]));

    osc.connect(gain);
    gain.connect(tone);
    osc.start();

    this.voices.set(note, { osc, gain, releasedAt: null });
  }

  noteOff(note: number, channel = 1): void {
    // Drums are one-shots — they ring out on their own timer, so letting go of
    // a pad is not supposed to cut them short.
    if (channel === DRUM_CHANNEL) return;
    this.stopVoice(note, releaseSec(this.knobs[3]));
  }

  allNotesOff(): void {
    const release = releaseSec(this.knobs[3]);
    this.voices.forEach((_voice, note) => this.stopVoice(note, release));
  }

  /** Fire one kit piece. Nothing is held; every node stops itself. */
  private drumHit(note: number, velocity: number): void {
    const g = this.ensure();
    if (!g) return;
    const { ctx, drums } = g;
    if (ctx.state === "suspended") void ctx.resume();

    const def = drumForNote(note);
    const t = ctx.currentTime;
    const vel = Math.max(0.1, Math.min(1, velocity / 127));
    const tune = 2 ** (tuneSemis(this.knobs[4]) / 12);
    const scale = decayScale(this.knobs[5]);

    // Every piece is built out of one-shot sources with a decay envelope. The
    // caller wires source -> [filter] -> gain; this puts the envelope on the
    // gain, connects it to the drum bus, fires the source and tidies up after.
    const shot = (
      source: AudioScheduledSourceNode,
      gain: GainNode,
      at: number,
      peak: number,
      decay: number,
      between: AudioNode[] = [],
    ) => {
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      gain.connect(drums);
      source.start(at);
      source.stop(at + decay + 0.02);
      source.onended = () => {
        try {
          source.disconnect();
          between.forEach((node) => node.disconnect());
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
    };

    if (def.body) {
      const { type, from, to, pitchDecay, decay, level } = def.body;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(from * tune, t);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, to * tune),
        t + Math.max(0.005, pitchDecay * scale),
      );
      const gain = ctx.createGain();
      osc.connect(gain);
      shot(osc, gain, t, level * vel, Math.max(0.02, decay * scale));
    }

    if (def.noise) {
      const { filter, freq, q, decay, level } = def.noise;
      const bursts = def.bursts ?? 1;
      for (let i = 0; i < bursts; i++) {
        const at = t + i * 0.013;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        src.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = filter;
        band.frequency.value = Math.min(ctx.sampleRate / 2 - 100, freq * tune);
        band.Q.value = q;
        const gain = ctx.createGain();
        src.connect(band);
        band.connect(gain);
        // The early claps in a stack are short slaps; the last one rings.
        const last = i === bursts - 1;
        const life = Math.max(0.02, decay * scale * (last ? 1 : 0.3));
        shot(src, gain, at, level * vel * (last ? 1 : 0.7), life, [band]);
      }
    }

    if (def.metal) {
      const { type, freqs, decay, level } = def.metal;
      const life = Math.max(0.02, decay * scale);
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f * tune;
        const gain = ctx.createGain();
        osc.connect(gain);
        shot(osc, gain, t, (level * vel) / (i + 1), life);
      });
    }
  }

  private stopVoice(note: number, release: number): void {
    const voice = this.voices.get(note);
    const ctx = this.graph?.ctx;
    if (!voice || !ctx) return;
    this.voices.delete(note);
    const now = ctx.currentTime;
    const { osc, gain } = voice;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      if (release > 0) {
        gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
        osc.stop(now + release + 0.02);
      } else {
        gain.gain.setValueAtTime(0.0001, now);
        osc.stop(now);
      }
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* already gone */
        }
      };
    } catch {
      /* context torn down mid-flight */
    }
  }

  dispose(): void {
    this.allNotesOff();
    if (this.graph) {
      void this.graph.ctx.close();
      this.graph = null;
    }
    this.noise = null;
    this.voices.clear();
  }
}
