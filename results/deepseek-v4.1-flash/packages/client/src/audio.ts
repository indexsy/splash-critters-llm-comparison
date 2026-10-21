import type { SettingsStore } from "./settings.js";

type MusicName = "title" | "menu" | "game" | "results" | "none";

interface Track {
  bpm: number;
  lead: Array<number | null>;
  bass: Array<number | null>;
  leadType: OscillatorType;
  bassType: OscillatorType;
}

const TRACKS: Record<Exclude<MusicName, "none">, Track> = {
  title: {
    bpm: 96,
    leadType: "triangle",
    bassType: "square",
    lead: [72, null, 67, null, 69, null, 64, null, 72, 74, 76, null, 72, null, 67, null],
    bass: [48, null, null, null, 52, null, null, null, 45, null, null, null, 43, null, null, null],
  },
  menu: {
    bpm: 112,
    leadType: "square",
    bassType: "triangle",
    lead: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 72],
    bass: [48, null, 55, null, 50, null, 57, null, 48, null, 55, null, 47, null, 54, null],
  },
  game: {
    bpm: 138,
    leadType: "square",
    bassType: "triangle",
    lead: [76, 79, 83, 79, 81, 84, 88, 84, 74, 77, 81, 77, 79, 83, 86, 83],
    bass: [40, null, 47, null, 45, null, 52, null, 38, null, 45, null, 43, null, 50, null],
  },
  results: {
    bpm: 104,
    leadType: "triangle",
    bassType: "square",
    lead: [72, 76, 79, 84, 83, 79, 76, 79, 77, 81, 84, 88, 86, 81, 77, 79],
    bass: [48, null, 48, null, 53, null, 53, null, 50, null, 50, null, 55, null, 55, null],
  },
};

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicName: MusicName = "none";
  private track: Track | null = null;
  private noteIndex = 0;
  private nextNoteTime = 0;
  private musicTimer: number | null = null;
  private showdown = false;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private readonly settings: SettingsStore) {}

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  unlock(): void {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoise();
      this.applyVolumes();
      const name = this.musicName;
      this.musicName = "none";
      if (name !== "none") this.setMusic(name);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  syncSettings(): void {
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicGain || !this.sfxGain) return;
    const muted = this.settings.data.muted;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this.musicGain.gain.setTargetAtTime(this.settings.data.musicVolume * 0.32, this.ctx.currentTime, 0.03);
    this.sfxGain.gain.setTargetAtTime(this.settings.data.sfxVolume * 0.5, this.ctx.currentTime, 0.02);
  }

  private createNoise(): AudioBuffer | null {
    if (!this.ctx) return null;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setMusic(name: MusicName): void {
    if (this.musicName === name) return;
    this.musicName = name;
    if (name === "none" || !this.ctx) {
      this.stopMusicTimer();
      this.track = null;
      return;
    }
    this.track = TRACKS[name];
    this.noteIndex = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.startMusicTimer();
  }

  private startMusicTimer(): void {
    if (this.musicTimer !== null) return;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40);
    this.scheduleMusic();
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  setShowdown(active: boolean): void {
    this.showdown = active;
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.track || !this.musicGain || this.musicName === "none") return;
    if (this.ctx.state !== "running") return;
    const speed = this.showdown ? 1.28 : 1;
    const step = 60 / (this.track.bpm * speed) / 2;
    while (this.nextNoteTime < this.ctx.currentTime + 0.16) {
      const index = this.noteIndex % this.track.lead.length;
      const lead = this.track.lead[index] ?? null;
      const bass = this.track.bass[index] ?? null;
      if (lead !== null) {
        this.note(midiToFreq(lead), step * 0.82, this.track.leadType, 0.12, this.nextNoteTime, this.musicGain);
      }
      if (bass !== null) {
        this.note(midiToFreq(bass), step * 1.6, this.track.bassType, 0.1, this.nextNoteTime, this.musicGain);
      }
      if (index % 4 === 0 && this.noiseBuffer) {
        this.noise(0.035, 0.035, this.nextNoteTime, this.musicGain, 2400);
      }
      this.noteIndex += 1;
      this.nextNoteTime += step;
    }
  }

  private note(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    at: number,
    destination: AudioNode,
    slideTo?: number,
  ): void {
    if (!this.ctx) return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
    if (slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private noise(
    duration: number,
    volume: number,
    at: number,
    destination: AudioNode,
    cutoff = 1200,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.exponentialRampToValueAtTime(180, at + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(at);
    source.stop(at + duration);
  }

  private get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  click(): void {
    if (!this.ctx || !this.sfxGain) return;
    this.note(660, 0.045, "square", 0.12, this.now, this.sfxGain);
  }

  drop(): void {
    if (!this.ctx || !this.sfxGain) return;
    this.note(300, 0.12, "sine", 0.18, this.now, this.sfxGain, 110);
    this.note(180, 0.08, "triangle", 0.09, this.now + 0.02, this.sfxGain, 90);
  }

  burst(): void {
    if (!this.ctx || !this.sfxGain) return;
    this.noise(0.24, 0.24, this.now, this.sfxGain, 1800);
    this.note(220, 0.2, "sine", 0.18, this.now, this.sfxGain, 60);
  }

  chain(level: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const notes = [72, 76, 79, 84, 88, 91, 96];
    const count = Math.min(notes.length, Math.max(2, level + 1));
    for (let i = 0; i < count; i += 1) {
      this.note(midiToFreq(notes[i]!), 0.12, "square", 0.13, this.now + i * 0.055, this.sfxGain);
    }
  }

  pickup(): void {
    if (!this.ctx || !this.sfxGain) return;
    this.note(660, 0.07, "square", 0.14, this.now, this.sfxGain);
    this.note(990, 0.12, "square", 0.12, this.now + 0.07, this.sfxGain);
  }

  soak(): void {
    if (!this.ctx || !this.sfxGain) return;
    this.noise(0.4, 0.3, this.now, this.sfxGain, 900);
    this.note(280, 0.35, "sine", 0.16, this.now, this.sfxGain, 55);
  }

  tideAlarm(): void {
    if (!this.ctx || !this.sfxGain) return;
    for (let i = 0; i < 3; i += 1) {
      this.note(520, 0.14, "square", 0.12, this.now + i * 0.22, this.sfxGain);
      this.note(390, 0.14, "square", 0.12, this.now + i * 0.22 + 0.11, this.sfxGain);
    }
  }

  countdown(final = false): void {
    if (!this.ctx || !this.sfxGain) return;
    this.note(final ? 880 : 440, final ? 0.3 : 0.1, "square", 0.13, this.now, this.sfxGain);
    if (final) this.note(1320, 0.35, "triangle", 0.12, this.now + 0.05, this.sfxGain);
  }

  victory(): void {
    if (!this.ctx || !this.sfxGain) return;
    const gain = this.sfxGain;
    const melody = [72, 76, 79, 84, 88, 84, 88, 96];
    melody.forEach((note, index) => {
      this.note(midiToFreq(note), 0.2, "square", 0.13, this.now + index * 0.13, gain);
    });
  }

  defeat(): void {
    if (!this.ctx || !this.sfxGain) return;
    const gain = this.sfxGain;
    const melody = [67, 64, 60, 55];
    melody.forEach((note, index) => {
      this.note(midiToFreq(note), 0.28, "triangle", 0.14, this.now + index * 0.2, gain);
    });
  }

  emote(id: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const base = [520, 380, 700, 240][id - 1] ?? 500;
    this.note(base, 0.12, "square", 0.12, this.now, this.sfxGain, base * 1.7);
    this.note(base * 1.5, 0.08, "triangle", 0.08, this.now + 0.09, this.sfxGain);
  }

  levelUp(): void {
    if (!this.ctx || !this.sfxGain) return;
    const gain = this.sfxGain;
    [72, 76, 79, 84, 88].forEach((note, index) => {
      this.note(midiToFreq(note), 0.16, "triangle", 0.13, this.now + index * 0.08, gain);
    });
  }
}
