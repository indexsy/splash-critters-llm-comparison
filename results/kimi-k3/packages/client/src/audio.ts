import { settings } from './settings.js';

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicTimer: number | null = null;
  currentTrack = '';
  trackStep = 0;

  ensure(): boolean {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.master);
      } catch {
        return false;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
    return true;
  }

  applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicGain || !this.sfxGain) return;
    const mute = settings.muted ? 0 : 1;
    this.master.gain.value = mute;
    this.musicGain.gain.value = settings.musicVolume * 0.5;
    this.sfxGain.gain.value = settings.sfxVolume;
  }

  private osc(type: OscillatorType, freq: number, t0: number, dur: number, vol: number, dest?: GainNode, freqEnd?: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(dest ?? this.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(t0: number, dur: number, vol: number, filterFreq = 1200): void {
    if (!this.ctx || !this.sfxGain) return;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t0);
  }

  drop(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    this.osc('square', 320, t, 0.08, 0.25, undefined, 180);
  }

  burst(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.25, 0.5, 900);
    this.osc('triangle', 140, t, 0.2, 0.4, undefined, 50);
  }

  chainJingle(depth: number): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    const notes = [523, 659, 784, 1047, 1319, 1568];
    const count = Math.min(2 + depth, 6);
    for (let i = 0; i < count; i++) {
      this.osc('square', notes[Math.min(i + depth - 1, notes.length - 1)]!, t + i * 0.07, 0.09, 0.2);
    }
  }

  pickup(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    this.osc('square', 660, t, 0.06, 0.22);
    this.osc('square', 990, t + 0.07, 0.1, 0.22);
  }

  soak(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.4, 0.5, 600);
    this.osc('triangle', 400, t, 0.35, 0.3, undefined, 60);
  }

  tideAlarm(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) {
      this.osc('square', 880, t + i * 0.18, 0.08, 0.25);
      this.osc('square', 620, t + i * 0.18 + 0.09, 0.08, 0.25);
    }
  }

  fanfare(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    const seq = [523, 523, 523, 659, 784, 784, 1047];
    const times = [0, 0.12, 0.24, 0.36, 0.55, 0.7, 0.9];
    seq.forEach((f, i) => this.osc('square', f, t + times[i]!, i === seq.length - 1 ? 0.4 : 0.11, 0.25));
  }

  roundLose(): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    [392, 330, 262].forEach((f, i) => this.osc('triangle', f, t + i * 0.15, 0.16, 0.25));
  }

  emote(id: number): void {
    if (!this.ensure()) return;
    const t = this.ctx!.currentTime;
    if (id === 0) {
      this.osc('square', 300, t, 0.08, 0.25, undefined, 200);
      this.osc('square', 300, t + 0.12, 0.08, 0.25, undefined, 200);
    } else if (id === 1) {
      this.osc('sine', 180, t, 0.15, 0.3, undefined, 90);
    } else if (id === 2) {
      this.osc('square', 1800, t, 0.04, 0.18);
      this.osc('square', 2200, t + 0.06, 0.04, 0.18);
    } else {
      this.osc('sawtooth', 220, t, 0.2, 0.22, undefined, 140);
    }
  }

  countdownBeep(final: boolean): void {
    if (!this.ensure()) return;
    this.osc('square', final ? 1047 : 523, this.ctx!.currentTime, final ? 0.3 : 0.1, 0.25);
  }

  playMusic(track: 'menu' | 'game' | 'showdown' | 'off'): void {
    if (track === 'off') {
      this.stopMusic();
      return;
    }
    if (this.currentTrack === track) return;
    this.stopMusic();
    this.currentTrack = track;
    if (!this.ensure()) return;
    this.trackStep = 0;
    const bpm = track === 'menu' ? 96 : track === 'game' ? 132 : 168;
    const stepDur = 60 / bpm / 2;
    const bassLines: Record<string, number[]> = {
      menu: [131, 0, 165, 0, 196, 0, 165, 0],
      game: [110, 0, 110, 131, 0, 98, 0, 147],
      showdown: [147, 147, 0, 147, 165, 0, 175, 0],
    };
    const melodies: Record<string, number[]> = {
      menu: [262, 330, 392, 330, 440, 392, 330, 262],
      game: [220, 0, 262, 330, 0, 262, 220, 0],
      showdown: [294, 0, 294, 330, 0, 349, 370, 0],
    };
    const bass = bassLines[track]!;
    const mel = melodies[track]!;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || settings.muted) return;
      const t = this.ctx.currentTime;
      const i = this.trackStep % 8;
      const bf = bass[i]!;
      const mf = mel[i]!;
      if (bf > 0) this.osc('triangle', bf, t, stepDur * 0.9, 0.35, this.musicGain);
      if (mf > 0 && this.trackStep % 2 === 0) this.osc('square', mf, t, stepDur * 0.7, 0.14, this.musicGain);
      this.trackStep++;
    }, stepDur * 1000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.currentTrack = '';
  }
}

export const audio = new AudioEngine();
