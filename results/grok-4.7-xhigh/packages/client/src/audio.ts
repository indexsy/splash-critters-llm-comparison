import { app } from './app.js';

type Kind = 'title' | 'menu' | 'game' | 'showdown';

const LOOPS: Record<Kind, number[]> = {
  title: [523, 659, 784, 659, 523, 392, 440, 523],
  menu: [392, 494, 587, 494, 440, 392, 349, 392],
  game: [330, 392, 494, 392, 330, 294, 330, 370],
  showdown: [440, 554, 659, 554, 494, 440, 494, 554],
};

class AudioEngine {
  ctx: AudioContext | null = null;
  kind: Kind = 'menu';
  step = 0;
  nextAt = 0;
  showdown = false;

  ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  toggleMute() {
    app.settings.mute = !app.settings.mute;
    localStorage.setItem('splash_settings', JSON.stringify(app.settings));
  }

  private gain(amount: number) {
    const ctx = this.ensure();
    const g = ctx.createGain();
    const vol = app.settings.mute ? 0 : amount * app.settings.sfx;
    g.gain.value = vol;
    g.connect(ctx.destination);
    return g;
  }

  tone(freq: number, dur: number, type: OscillatorType, amount = 0.2) {
    if (app.settings.mute || app.settings.sfx <= 0) return;
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    const g = this.gain(amount);
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur: number, amount = 0.2) {
    if (app.settings.mute || app.settings.sfx <= 0) return;
    const ctx = this.ensure();
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = this.gain(amount);
    src.connect(g);
    src.start();
  }

  drop() { this.tone(210, 0.07, 'square', 0.18); this.tone(320, 0.09, 'square', 0.1); }
  burst() { this.noise(0.16, 0.22); this.tone(130, 0.18, 'triangle', 0.16); }
  chain(n: number) {
    const notes = [523, 659, 784, 988, 1174];
    for (let i = 0; i < Math.min(n, notes.length); i++) {
      setTimeout(() => this.tone(notes[i], 0.12, 'square', 0.16), i * 70);
    }
  }
  pickup() { this.tone(523, 0.07, 'square', 0.14); this.tone(784, 0.1, 'square', 0.12); }
  soak() { this.noise(0.22, 0.28); this.tone(90, 0.28, 'triangle', 0.2); }
  tide() { this.tone(196, 0.16, 'square', 0.12); this.tone(146, 0.2, 'square', 0.1); }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.16), i * 110)); }
  emote(id: number) { this.tone(180 + id * 70, 0.1, 'square', 0.12); }
  countdown() { this.tone(440, 0.08, 'square', 0.1); }

  setMusic(kind: Kind) {
    this.kind = kind;
    this.step = 0;
  }

  setShowdown(on: boolean) {
    this.showdown = on;
    if (on) this.kind = 'showdown';
    else if (this.kind === 'showdown') this.kind = 'game';
  }

  tick() {
    if (app.settings.mute || app.settings.music <= 0) return;
    const ctx = this.ensure();
    if (ctx.currentTime < this.nextAt) return;
    const notes = LOOPS[this.kind];
    const freq = notes[this.step % notes.length];
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.04 * app.settings.music;
    o.connect(g);
    g.connect(ctx.destination);
    const beat = this.showdown || this.kind === 'showdown' ? 0.14 : 0.22;
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + beat * 0.85);
    this.nextAt = ctx.currentTime + beat;
    this.step++;
  }
}

export const audio = new AudioEngine();
