// A tiny polyphonic Web Audio synth for the Keys (midi.exe) window. One
// oscillator per held note, a short attack, an exponential-ish release tail.
// No dependencies, no samples — just enough to make MIDI audible.

export type Waveform = "square" | "sawtooth" | "triangle" | "sine";

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  /** performance-time (ctx.currentTime) at which the release was scheduled. */
  releasedAt: number | null;
};

const ATTACK = 0.005;
const RELEASE = 0.12;
// Master level. Kept low so a fistful of keys doesn't clip.
const MASTER_GAIN = 0.14;
// Per-voice ceiling before the master stage.
const VOICE_GAIN = 0.9;

function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export class MidiSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>();
  private waveform: Waveform = "square";
  /** Current pitch-bend offset in cents, applied to every voice. */
  private bendCents = 0;

  /** Create the context on first use; safe to call repeatedly. */
  private ensure(): { ctx: AudioContext; master: GainNode } | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx && this.master ? { ctx: this.ctx, master: this.master } : null;
  }

  /** Call from a user gesture so the browser lets audio through. */
  resume(): void {
    const parts = this.ensure();
    if (parts && parts.ctx.state === "suspended") void parts.ctx.resume();
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

  noteOn(note: number, velocity = 100): void {
    const parts = this.ensure();
    if (!parts) return;
    const { ctx, master } = parts;
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
    gain.gain.linearRampToValueAtTime(level, now + ATTACK);

    osc.connect(gain);
    gain.connect(master);
    osc.start();

    this.voices.set(note, { osc, gain, releasedAt: null });
  }

  noteOff(note: number): void {
    this.stopVoice(note, RELEASE);
  }

  allNotesOff(): void {
    this.voices.forEach((_voice, note) => this.stopVoice(note, RELEASE));
  }

  private stopVoice(note: number, release: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.ctx) return;
    this.voices.delete(note);
    const now = this.ctx.currentTime;
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
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
    this.voices.clear();
  }
}
