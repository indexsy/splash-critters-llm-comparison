// All audio is synthesized with Web Audio oscillators + noise. No assets.

import type { Settings } from "./settings.js";

export type SfxName =
  | "click"
  | "drop"
  | "burst"
  | "pickup"
  | "soak"
  | "tide"
  | "victory"
  | "kick"
  | "lob"
  | "countdown"
  | "go"
  | "denied"
  | "emote0"
  | "emote1"
  | "emote2"
  | "emote3";

export type MusicTrack = "menu" | "battle" | "showdown" | "off";

const A4 = 440;
const note = (semis: number): number => A4 * Math.pow(2, semis / 12);

// Patterns: [semitone offset | null][] — null = rest. 8th notes.
const TUNES: Record<Exclude<MusicTrack, "off">, { bpm: number; bass: (number | null)[]; lead: (number | null)[] }> = {
  menu: {
    bpm: 92,
    bass: [-21, null, -14, null, -17, null, -9, null, -21, null, -14, null, -12, null, -14, null],
    lead: [3, null, 7, 10, null, 7, 3, null, 5, null, 8, null, 7, 5, 3, null],
  },
  battle: {
    bpm: 132,
    bass: [-21, -21, -9, -21, -17, -17, -5, -17, -19, -19, -7, -19, -14, -14, -2, -14],
    lead: [3, 7, 10, 15, 10, 7, 3, null, 5, 8, 12, 17, 12, 8, 5, null],
  },
  showdown: {
    bpm: 168,
    bass: [-21, -9, -21, -9, -17, -5, -17, -5, -19, -7, -19, -7, -14, -2, -14, -2],
    lead: [15, 10, 7, 10, 15, 10, 19, null, 17, 12, 8, 12, 17, 12, 20, null],
  },
};

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private track: MusicTrack = "off";
  private step = 0;
  private nextStepTime = 0;
  private schedTimer: number | null = null;

  constructor(private settings: Settings) {}

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    // 1s of white noise for percussive sounds
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyVolumes();
    this.schedTimer = window.setInterval(() => this.pump(), 40);
  }

  applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    this.sfxBus.gain.value = this.settings.sfxVolume * 0.5;
    this.musicBus.gain.value = this.settings.musicVolume * 0.16;
  }

  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.applyVolumes();
    return this.settings.muted;
  }

  private tone(
    bus: GainNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t0: number,
    dur: number,
    vol: number
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(bus: GainNode, t0: number, dur: number, vol: number, playback = 1): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = playback;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(gain).connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  sfx(name: SfxName): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const b = this.sfxBus;
    switch (name) {
      case "click":
        this.tone(b, "square", 880, 660, t, 0.05, 0.25);
        break;
      case "drop":
        this.tone(b, "square", 520, 180, t, 0.12, 0.4);
        break;
      case "burst":
        this.noise(b, t, 0.25, 0.55, 0.7);
        this.tone(b, "square", 140, 60, t, 0.2, 0.45);
        break;
      case "pickup":
        this.tone(b, "square", note(3), note(3), t, 0.06, 0.35);
        this.tone(b, "square", note(10), note(10), t + 0.07, 0.09, 0.35);
        break;
      case "soak":
        this.noise(b, t, 0.35, 0.5, 0.4);
        this.tone(b, "triangle", 700, 90, t, 0.4, 0.5);
        break;
      case "tide":
        this.tone(b, "square", 620, 620, t, 0.12, 0.3);
        this.tone(b, "square", 470, 470, t + 0.16, 0.12, 0.3);
        break;
      case "victory":
        [0, 4, 7, 12].forEach((s, i) => this.tone(b, "square", note(s + 3), note(s + 3), t + i * 0.12, 0.14, 0.35));
        this.tone(b, "square", note(19), note(19), t + 0.5, 0.35, 0.35);
        break;
      case "kick":
        this.tone(b, "square", 300, 700, t, 0.08, 0.35);
        break;
      case "lob":
        this.tone(b, "triangle", 220, 660, t, 0.18, 0.4);
        break;
      case "countdown":
        this.tone(b, "square", 660, 660, t, 0.09, 0.35);
        break;
      case "go":
        this.tone(b, "square", 880, 1320, t, 0.25, 0.4);
        break;
      case "denied":
        this.tone(b, "square", 220, 160, t, 0.15, 0.35);
        break;
      case "emote0": // quack
        this.tone(b, "square", 480, 300, t, 0.09, 0.4);
        this.tone(b, "square", 430, 260, t + 0.1, 0.11, 0.4);
        break;
      case "emote1": // ribbit
        this.tone(b, "square", 160, 240, t, 0.09, 0.4);
        this.tone(b, "square", 150, 90, t + 0.1, 0.14, 0.4);
        break;
      case "emote2": // squeak
        this.tone(b, "square", 1200, 1700, t, 0.08, 0.3);
        this.tone(b, "square", 1500, 1100, t + 0.09, 0.1, 0.3);
        break;
      case "emote3": // honk
        this.tone(b, "sawtooth", 340, 300, t, 0.18, 0.35);
        break;
    }
  }

  /** Escalating chain jingle: more balloons = longer, higher arpeggio. */
  chainJingle(size: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const steps = Math.min(6, size + 1);
    for (let i = 0; i < steps; i++) {
      this.tone(this.sfxBus, "square", note(3 + i * 5), note(3 + i * 5), t + i * 0.07, 0.1, 0.35);
    }
  }

  music(track: MusicTrack): void {
    if (this.track === track) return;
    this.track = track;
    this.step = 0;
    if (this.ctx) this.nextStepTime = this.ctx.currentTime + 0.05;
  }

  private pump(): void {
    if (!this.ctx || !this.musicBus || this.track === "off") return;
    const tune = TUNES[this.track];
    const stepDur = 60 / tune.bpm / 2; // 8th notes
    while (this.nextStepTime < this.ctx.currentTime + 0.15) {
      const i = this.step % 16;
      const bass = tune.bass[i];
      const lead = tune.lead[i];
      if (bass !== null) this.tone(this.musicBus, "triangle", note(bass), note(bass), this.nextStepTime, stepDur * 0.95, 0.9);
      if (lead !== null) this.tone(this.musicBus, "square", note(lead), note(lead), this.nextStepTime, stepDur * 0.6, 0.5);
      if (i % 4 === 0) this.noise(this.musicBus, this.nextStepTime, 0.03, 0.25, 1.5);
      this.step++;
      this.nextStepTime += stepDur;
    }
  }
}
