// audio.ts — Web Audio API chiptune SFX (spec §10). Oscillator-based, no assets.
// drop, burst, chain jingle, pickup, soak sploosh, tide alarm, victory.

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicGain: GainNode | null = null;
  muted = false;
  sfxVol = 0.5;
  musicVol = 0.25;
  musicTimer: ReturnType<typeof setInterval> | null = null;
  musicNote = 0;

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol;
      this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVol;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    this.ctx?.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  private blip(freq: number, dur: number, type: OscillatorType = "square", gain = 1) {
    if (!this.ctx || !this.sfxGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain * 0.3, this.ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  drop() { this.blip(220, 0.08, "square"); }
  burst() {
    this.blip(140, 0.15, "triangle");
    // noise splash
    if (!this.ctx || !this.sfxGain) return;
    const buffer = this.ctx.createBuffer(1, 4410, 44100);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = 0.2;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }
  chain(n: number) {
    // escalating jingle — higher with chain size
    const base = 440 * Math.pow(1.12, Math.min(n, 8));
    this.blip(base, 0.1, "square");
    setTimeout(() => this.blip(base * 1.5, 0.1, "square"), 60);
    if (n >= 3) setTimeout(() => this.blip(base * 2, 0.12, "square"), 120);
  }
  pickup() { this.blip(660, 0.06, "square"); setTimeout(() => this.blip(880, 0.08, "square"), 50); }
  soak() { this.burst(); this.blip(110, 0.3, "sawtooth", 0.7); }
  tide() { this.blip(80, 0.5, "sawtooth", 0.6); }
  victory() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.18, "square"), i * 120));
  }

  startMusic(speed = 1) {
    this.stopMusic();
    if (!this.ctx) return;
    const scale = [262, 294, 330, 349, 392, 440, 494, 523];
    const interval = 220 / speed;
    this.musicNote = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.musicGain || !this.ctx) return;
      const note = scale[Math.floor(Math.random() * scale.length)];
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = note;
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.2, this.ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
      o.connect(g);
      g.connect(this.musicGain);
      o.start();
      o.stop(this.ctx.currentTime + 0.2);
      this.musicNote++;
    }, interval);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new AudioEngine();
