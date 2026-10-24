import type { ClientSettings } from "./settings.js";

export type MusicTrack = "title" | "menu" | "match" | "results" | "none";
export type SoundEffect = "drop" | "burst" | "chain" | "pickup" | "soak" | "tide" | "victory" | "kick" | "emote1" | "emote2" | "emote3" | "emote4" | "click";

const TRACKS: Record<Exclude<MusicTrack, "none">, number[]> = {
  title: [262, 330, 392, 523, 392, 330, 294, 392, 440, 587, 523, 392, 330, 294, 262, 0],
  menu: [220, 0, 262, 330, 294, 0, 262, 196, 220, 0, 330, 392, 330, 294, 262, 0],
  match: [196, 262, 330, 262, 220, 294, 349, 294, 196, 262, 330, 392, 349, 294, 262, 220],
  results: [262, 330, 392, 523, 659, 523, 784, 659, 523, 392, 440, 523, 587, 659, 784, 0]
};

export class AudioManager {
  private context: AudioContext | null = null;
  private track: MusicTrack = "title";
  private step = 0;
  private nextNote = 0;
  private showdown = false;
  private scheduler: number | null = null;

  constructor(private readonly settings: ClientSettings) {}

  resume(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.nextNote = this.context.currentTime + 0.05;
      this.scheduler = window.setInterval(() => this.scheduleMusic(), 60);
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  pause(): void {
    if (this.context?.state === "running") void this.context.suspend();
  }

  setTrack(track: MusicTrack): void {
    if (this.track === track) return;
    this.track = track;
    this.step = 0;
    if (this.context) this.nextNote = this.context.currentTime + 0.05;
  }

  setShowdown(showdown: boolean): void {
    this.showdown = showdown;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0, endFrequency = frequency, music = false): void {
    if (!this.context || this.settings.muted) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    const level = volume * (music ? this.settings.music : this.settings.sfx);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), now + Math.min(0.015, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(duration: number, volume: number, delay = 0): void {
    if (!this.context || this.settings.muted) return;
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume * this.settings.sfx;
    source.connect(gain).connect(this.context.destination);
    source.start(this.context.currentTime + delay);
  }

  private scheduleMusic(): void {
    if (!this.context || this.context.state !== "running" || this.track === "none" || this.settings.muted || this.settings.music <= 0) return;
    const sequence = TRACKS[this.track];
    const beat = this.showdown && this.track === "match" ? 0.09 : this.track === "match" ? 0.14 : 0.18;
    while (this.nextNote < this.context.currentTime + 0.18) {
      const note = sequence[this.step % sequence.length];
      if (note > 0) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = this.step % 4 === 0 ? "triangle" : "square";
        oscillator.frequency.value = note;
        gain.gain.setValueAtTime(0.0001, this.nextNote);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.035 * this.settings.music), this.nextNote + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.nextNote + beat * 0.82);
        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start(this.nextNote);
        oscillator.stop(this.nextNote + beat);
      }
      this.step += 1;
      this.nextNote += beat;
    }
  }

  play(effect: SoundEffect, intensity = 1): void {
    if (!this.context || this.settings.muted) return;
    if (effect === "drop") this.tone(240, 0.08, "square", 0.08, 0, 150);
    if (effect === "burst") {
      this.noise(0.16, 0.11);
      this.tone(150, 0.18, "triangle", 0.09, 0, 55);
    }
    if (effect === "chain") {
      const root = 330 * Math.min(3, 1 + intensity * 0.2);
      [1, 1.25, 1.5].forEach((ratio, index) => this.tone(root * ratio, 0.11, "square", 0.055, index * 0.055));
    }
    if (effect === "pickup") {
      this.tone(440, 0.08, "square", 0.06);
      this.tone(660, 0.12, "square", 0.06, 0.07);
    }
    if (effect === "soak") {
      this.noise(0.3, 0.13);
      this.tone(240, 0.32, "triangle", 0.09, 0, 45);
    }
    if (effect === "tide") {
      this.tone(180, 0.18, "square", 0.07);
      this.tone(180, 0.18, "square", 0.07, 0.24);
    }
    if (effect === "victory") [262, 330, 392, 523, 659].forEach((note, index) => this.tone(note, 0.2, "square", 0.06, index * 0.1));
    if (effect === "kick") this.tone(110, 0.09, "square", 0.08, 0, 260);
    if (effect === "emote1") this.tone(420, 0.12, "square", 0.06, 0, 260);
    if (effect === "emote2") this.tone(180, 0.09, "square", 0.06, 0, 240);
    if (effect === "emote3") this.tone(880, 0.07, "square", 0.045, 0, 1050);
    if (effect === "emote4") this.tone(220, 0.2, "sawtooth", 0.045, 0, 180);
    if (effect === "click") this.tone(520, 0.035, "square", 0.025);
  }
}
