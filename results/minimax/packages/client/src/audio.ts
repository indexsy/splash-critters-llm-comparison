/** Chiptune audio built entirely from Web Audio oscillators and noise. */

type SfxName =
  | 'drop'
  | 'burst'
  | 'pickup'
  | 'soak'
  | 'tide'
  | 'victory'
  | 'click'
  | 'error'
  | 'emote'
  | 'kick';

export interface MusicTrack {
  name: string;
  bpm: number;
  bass: string[];
  lead: string[];
  wave: OscillatorType;
}

const NOTE: Record<string, number> = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568.0,
  R: 0,
};

export const TRACKS: Record<string, MusicTrack> = {
  title: {
    name: 'title',
    bpm: 108,
    wave: 'square',
    bass: ['C3', 'C3', 'G3', 'G3', 'A3', 'A3', 'F3', 'G3'],
    lead: ['E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'C5', 'D5', 'E5', 'G5', 'C6', 'B5', 'A5', 'G5', 'E5', 'R'],
  },
  menu: {
    name: 'menu',
    bpm: 96,
    wave: 'triangle',
    bass: ['C3', 'A3', 'F3', 'G3'],
    lead: ['C5', 'E5', 'G5', 'E5', 'F5', 'A5', 'C6', 'A5', 'G5', 'E5', 'D5', 'F5', 'E5', 'C5', 'D5', 'R'],
  },
  battle: {
    name: 'battle',
    bpm: 140,
    wave: 'square',
    bass: ['E3', 'E3', 'F3', 'F3', 'G3', 'G3', 'A3', 'A3'],
    lead: ['E5', 'G5', 'B5', 'A5', 'G5', 'E5', 'D5', 'E5', 'F5', 'A5', 'C6', 'B5', 'A5', 'G5', 'E5', 'D5'],
  },
  showdown: {
    name: 'showdown',
    bpm: 186,
    wave: 'square',
    bass: ['E3', 'E3', 'E3', 'F3', 'G3', 'G3', 'A3', 'B3'],
    lead: ['E6', 'D6', 'C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'F6', 'G6'],
  },
  victory: {
    name: 'victory',
    bpm: 120,
    wave: 'square',
    bass: ['C3', 'C3', 'C3', 'G3'],
    lead: ['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6', 'R'],
  },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private scheduler: number | null = null;
  private track: MusicTrack | null = null;
  private step = 0;
  private nextNoteTime = 0;
  private tempoScale = 1;

  sfxVolume = 0.6;
  musicVolume = 0.35;
  muted = false;

  /** Must be called from a user gesture (browsers block audio otherwise). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    const length = Math.floor(this.ctx.sampleRate * 0.5);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  setVolumes(sfx: number, music: number, muted: boolean): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, volume: number, filterFreq = 1200, delay = 0): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(200, t0 + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  play(name: SfxName, depth = 0): void {
    if (!this.ctx) return;
    switch (name) {
      case 'drop':
        this.tone(520, 0.09, 'square', 0.16, 240);
        break;
      case 'burst':
        this.noise(0.22, 0.3, 2200);
        this.tone(180, 0.14, 'triangle', 0.12, 80);
        break;
      case 'pickup':
        this.tone(660, 0.07, 'square', 0.16);
        this.tone(880, 0.07, 'square', 0.16, undefined, 0.07);
        this.tone(1174, 0.12, 'square', 0.16, undefined, 0.14);
        break;
      case 'soak':
        this.noise(0.4, 0.42, 900);
        this.tone(140, 0.3, 'sine', 0.22, 60);
        break;
      case 'tide':
        this.tone(300, 0.2, 'sawtooth', 0.12, 220);
        this.tone(300, 0.2, 'sawtooth', 0.12, 220, 0.25);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.18, undefined, i * 0.12));
        break;
      case 'click':
        this.tone(760, 0.04, 'square', 0.12);
        break;
      case 'error':
        this.tone(180, 0.16, 'sawtooth', 0.14, 120);
        break;
      case 'emote':
        this.tone(880, 0.06, 'triangle', 0.14, 1320);
        break;
      case 'kick':
        this.tone(400, 0.08, 'square', 0.14, 900);
        break;
      default:
        break;
    }
    if (name === 'burst' && depth >= 2) {
      const base = 440 * Math.pow(1.18, depth - 2);
      for (let i = 0; i < depth; i++) {
        this.tone(base * Math.pow(1.26, i), 0.1, 'square', 0.14, undefined, i * 0.07);
      }
    }
  }

  playMusic(trackName: string): void {
    const track = TRACKS[trackName];
    if (!this.ctx) return;
    if (this.track?.name === trackName) return;
    this.track = track;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    if (!this.scheduler) {
      this.scheduler = window.setInterval(() => this.schedule(), 25);
    }
  }

  stopMusic(): void {
    this.track = null;
    if (this.scheduler !== null) {
      window.clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  /** Speeds the music up for the showdown. */
  setTempoScale(scale: number): void {
    this.tempoScale = Math.max(0.5, Math.min(2.5, scale));
  }

  private schedule(): void {
    if (!this.ctx || !this.track || !this.musicBus) return;
    const secondsPerBeat = 60 / (this.track.bpm * this.tempoScale);
    const stepDur = secondsPerBeat / 2;
    while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
      const track = this.track;
      const leadNote = track.lead[this.step % track.lead.length];
      const bassNote = track.bass[Math.floor(this.step / 2) % track.bass.length];
      const leadFreq = Number(NOTE[leadNote] ?? 0);
      const bassFreq = Number(NOTE[bassNote] ?? 0);
      if (leadFreq > 0) this.playNote(leadFreq, stepDur * 0.9, track.wave, 0.09, this.nextNoteTime);
      if (bassFreq > 0 && this.step % 2 === 0) {
        this.playNote(bassFreq, stepDur * 1.8, 'triangle', 0.11, this.nextNoteTime);
      }
      this.nextNoteTime += stepDur;
      this.step += 1;
    }
  }

  private playNote(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    when: number,
  ): void {
    if (!this.ctx || !this.musicBus) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}

export const audio = new AudioEngine();
