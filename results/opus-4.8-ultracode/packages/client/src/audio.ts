/**
 * Chiptune audio via Web Audio oscillators + noise. All SFX are synthesized;
 * a tiny sequencer loops a per-screen tune that speeds up in showdown.
 */

type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine';

const NOTE: Record<string, number> = {
  C3: 130.81, E3: 164.81, G3: 196.0, A3: 220.0,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5,
};

const MENU_ARP = ['C4', 'E4', 'G4', 'B4', 'C5', 'B4', 'G4', 'E4'];
const GAME_ARP = ['C4', 'G4', 'E4', 'G4', 'A4', 'E4', 'C4', 'G4'];
const MENU_BASS = ['C3', 'C3', 'G3', 'A3'];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  sfxVol = 0.7;
  musicVol = 0.4;
  muted = false;

  private noise: AudioBuffer | null = null;
  private seqTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private stepMs = 150;
  private track: 'menu' | 'game' | null = null;
  private showdown = false;

  resume(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.applyVolumes();
    // pre-render a noise buffer
    const len = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setVolumes(sfx: number, music: number, muted: boolean): void {
    this.sfxVol = sfx;
    this.musicVol = music;
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.muted ? 0 : this.sfxVol;
    if (this.musicGain) this.musicGain.gain.value = this.muted ? 0 : this.musicVol * 0.6;
  }

  private tone(freq: number, dur: number, wave: Wave, when = 0, gain = 0.4, target?: GainNode): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(target ?? this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, gain = 0.4, hp = 400): void {
    if (!this.ctx || !this.sfxGain || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  sfx(name: string, arg = 0): void {
    if (!this.ctx) return;
    switch (name) {
      case 'click':
        this.tone(520, 0.06, 'square', 0, 0.25);
        break;
      case 'count':
        this.tone(660, 0.12, 'square', 0, 0.35);
        break;
      case 'go':
        this.tone(880, 0.25, 'square', 0, 0.4);
        this.tone(1320, 0.25, 'square', 0.02, 0.2);
        break;
      case 'drop':
        this.tone(320, 0.12, 'square', 0, 0.3);
        this.tone(200, 0.12, 'square', 0.04, 0.25);
        break;
      case 'burst':
        this.noiseBurst(0.25, 0.5, 300);
        this.tone(120, 0.2, 'triangle', 0, 0.4);
        break;
      case 'chain': {
        const n = Math.min(6, Math.max(2, arg));
        const notes = ['C5', 'E5', 'G5', 'C6', 'E5', 'G5'];
        for (let i = 0; i < n; i++) this.tone(NOTE[notes[i % notes.length]], 0.12, 'square', i * 0.06, 0.35);
        break;
      }
      case 'pickup':
        this.tone(NOTE.E5, 0.08, 'square', 0, 0.35);
        this.tone(NOTE.G5, 0.1, 'square', 0.07, 0.35);
        break;
      case 'soak':
        this.noiseBurst(0.3, 0.4, 800);
        this.tone(500, 0.2, 'sine', 0, 0.2);
        this.tone(180, 0.25, 'sine', 0.05, 0.2);
        break;
      case 'tide':
        this.tone(300, 0.2, 'sawtooth', 0, 0.3);
        this.tone(240, 0.2, 'sawtooth', 0.22, 0.3);
        break;
      case 'victory':
        ['C4', 'E4', 'G4', 'C5'].forEach((k, i) => this.tone(NOTE[k], 0.18, 'square', i * 0.12, 0.4));
        break;
      case 'lose':
        ['G4', 'E4', 'C4', 'G3'].forEach((k, i) => this.tone(NOTE[k], 0.2, 'triangle', i * 0.12, 0.35));
        break;
      case 'emote':
        this.tone(240 + arg * 60, 0.1, 'square', 0, 0.3);
        this.tone(200 + arg * 60, 0.08, 'square', 0.08, 0.25);
        break;
      case 'kick':
        this.tone(700, 0.06, 'square', 0, 0.3);
        this.noiseBurst(0.08, 0.2, 1000);
        break;
    }
  }

  startMusic(track: 'menu' | 'game'): void {
    if (this.track === track && this.seqTimer) return;
    this.track = track;
    this.step = 0;
    this.showdown = false;
    this.stepMs = track === 'menu' ? 170 : 150;
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = setInterval(() => this.tick(), this.stepMs);
  }

  setShowdown(on: boolean): void {
    if (this.showdown === on) return;
    this.showdown = on;
    if (this.track === 'game' && this.seqTimer) {
      clearInterval(this.seqTimer);
      this.stepMs = on ? 100 : 150;
      this.seqTimer = setInterval(() => this.tick(), this.stepMs);
    }
  }

  stopMusic(): void {
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = null;
    this.track = null;
  }

  private tick(): void {
    if (!this.ctx || !this.musicGain || this.muted || this.musicVol <= 0) return;
    const arp = this.track === 'menu' ? MENU_ARP : GAME_ARP;
    const note = arp[this.step % arp.length];
    this.tone(NOTE[note], this.stepMs / 1000, 'square', 0, 0.18, this.musicGain);
    if (this.step % 4 === 0) {
      const bass = MENU_BASS[(this.step / 4) % MENU_BASS.length];
      this.tone(NOTE[bass] / 2, (this.stepMs * 3) / 1000, 'triangle', 0, 0.22, this.musicGain);
    }
    this.step++;
  }
}

export const audio = new AudioEngine();
