import type { Settings } from './settings.js';

export class AudioEngine {
  ctx: AudioContext | null = null;
  settings: Settings;
  private musicTimer = 0;
  private step = 0;
  private screen = 'title';
  private showdown = false;
  private started = false;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.started) {
      this.started = true;
      this.loop();
    }
  }

  setScreen(screen: string): void {
    this.screen = screen;
    this.step = 0;
  }

  setShowdown(on: boolean): void {
    this.showdown = on;
  }

  toggleMute(): void {
    this.settings.mute = !this.settings.mute;
  }

  private gain(vol: number): number {
    if (this.settings.mute) return 0;
    return vol;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0): void {
    if (!this.ctx || this.gain(vol) <= 0) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(this.gain(vol) * this.settings.sfx, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number): void {
    if (!this.ctx || this.gain(vol) <= 0) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    g.gain.value = this.gain(vol) * this.settings.sfx;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    src.start();
  }

  play(name: string, extra = 0): void {
    this.unlock();
    if (name === 'drop') this.tone(520, 0.08, 'square', 0.15, -180);
    else if (name === 'burst') this.noise(0.18, 0.22);
    else if (name === 'chain') {
      const notes = 2 + Math.min(4, extra);
      for (let i = 0; i < notes; i++) this.tone(440 * 2 ** (i / 4), 0.12, 'square', 0.12);
    } else if (name === 'pickup') {
      this.tone(660, 0.07, 'square', 0.12);
      this.tone(880, 0.1, 'square', 0.12);
    } else if (name === 'soak') {
      this.noise(0.25, 0.2);
      this.tone(220, 0.3, 'triangle', 0.16, -120);
    } else if (name === 'tide') this.tone(140, 0.35, 'square', 0.12);
    else if (name === 'win') {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.14), i * 120));
    } else if (name === 'emote') this.tone(300 + extra * 80, 0.12, extra % 2 ? 'square' : 'triangle', 0.1);
    else if (name === 'ui') this.tone(300, 0.05, 'square', 0.08);
  }

  private pattern(): number[] {
    if (this.screen === 'game') return [262, 0, 330, 0, 392, 330, 294, 0, 262, 294, 330, 0, 349, 0, 330, 294];
    if (this.screen === 'results') return [392, 494, 587, 0, 494, 392, 0, 330];
    return [196, 0, 247, 0, 220, 0, 196, 262, 0, 220, 0, 196, 0, 165, 0, 196];
  }

  private loop = (): void => {
    const bpm = this.showdown ? 168 : this.screen === 'game' ? 124 : 100;
    const interval = (60 / bpm / 2) * 1000;
    const notes = this.pattern();
    const note = notes[this.step % notes.length] ?? 0;
    this.step += 1;
    if (note && this.ctx && this.settings.music > 0 && !this.settings.mute) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = this.screen === 'game' ? 'square' : 'triangle';
      osc.frequency.value = note;
      g.gain.value = 0.04 * this.settings.music;
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + interval / 1000 * 0.85);
    }
    this.musicTimer = window.setTimeout(this.loop, interval);
  };

  stop(): void {
    window.clearTimeout(this.musicTimer);
  }
}
