export type SoundName =
  | 'drop'
  | 'burst'
  | 'chain2'
  | 'chain3'
  | 'pickup'
  | 'soak'
  | 'tide'
  | 'victory'
  | 'kick'
  | 'emote';

export type MusicName =
  | 'title'
  | 'menu'
  | 'game'
  | 'showdown'
  | 'results'
  | 'leaderboard'
  | 'lobby';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicInterval: ReturnType<typeof setInterval> | null = null;
  private currentMusic: MusicName | null = null;
  private bpm = 120;
  private musicNoteIndex = 0;
  private showdownMode = false;
  private _sfxVolume = 0.8;
  private _musicVolume = 0.6;

  muted = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.updateVolumes();
    }
    return this.ctx;
  }

  private updateVolumes(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.muted ? 0 : this._sfxVolume;
    if (this.musicGain) this.musicGain.gain.value = this.muted ? 0 : this._musicVolume;
  }

  private playTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    volume: number
  ): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.sfxGain!);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  private playNoise(duration: number, volume: number): void {
    const ctx = this.ensureContext();
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(gain).connect(this.sfxGain!);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  play(name: SoundName): void {
    if (this.muted) return;
    this.ensureContext();

    switch (name) {
      case 'drop':
        this.playTone(440, 'square', 0.08, 0.2);
        this.playTone(330, 'square', 0.08, 0.15);
        break;
      case 'burst':
        this.playNoise(0.18, 0.35);
        break;
      case 'chain2':
        this.playTone(523.25, 'square', 0.08, 0.25);
        setTimeout(() => this.playTone(659.25, 'square', 0.08, 0.25), 80);
        break;
      case 'chain3':
        this.playTone(523.25, 'square', 0.08, 0.25);
        setTimeout(() => this.playTone(659.25, 'square', 0.08, 0.25), 60);
        setTimeout(() => this.playTone(783.99, 'square', 0.08, 0.25), 120);
        break;
      case 'pickup':
        this.playTone(880, 'triangle', 0.12, 0.3);
        this.playTone(1318.51, 'triangle', 0.1, 0.2);
        break;
      case 'soak':
        this.playNoise(0.3, 0.3);
        this.playTone(200, 'sawtooth', 0.25, 0.15);
        break;
      case 'tide':
        this.playTone(100, 'sine', 0.5, 0.2);
        break;
      case 'victory':
        this.playTone(523.25, 'square', 0.15, 0.3);
        setTimeout(() => this.playTone(659.25, 'square', 0.15, 0.3), 150);
        setTimeout(() => this.playTone(783.99, 'square', 0.15, 0.3), 300);
        setTimeout(() => this.playTone(1046.5, 'square', 0.3, 0.35), 450);
        break;
      case 'kick':
        this.playTone(120, 'square', 0.08, 0.3);
        this.playNoise(0.05, 0.2);
        break;
      case 'emote':
        {
          const chirp = 600 + Math.random() * 400;
          this.playTone(chirp, 'triangle', 0.1, 0.2);
        }
        break;
      default:
        break;
    }
  }

  private musicPatterns: Record<MusicName, number[]> = {
    title: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 261.63, 196.0],
    menu: [392.0, 392.0, 349.23, 392.0, 523.25, 392.0, 349.23, 293.66],
    game: [261.63, 329.63, 261.63, 392.0, 329.63, 261.63, 196.0, 261.63],
    showdown: [440.0, 440.0, 493.88, 440.0, 523.25, 440.0, 493.88, 587.33],
    results: [329.63, 392.0, 493.88, 523.25, 493.88, 392.0, 329.63, 261.63],
    leaderboard: [392.0, 349.23, 329.63, 349.23, 392.0, 440.0, 392.0, 349.23],
    lobby: [261.63, 311.13, 329.63, 311.13, 261.63, 196.0, 261.63, 329.63],
  };

  playMusic(name: MusicName): void {
    this.stopMusic();
    this.currentMusic = name;
    this.musicNoteIndex = 0;
    this.bpm = this.showdownMode ? 180 : 120;
    const interval = (60 / this.bpm / 4) * 1000;
    this.musicInterval = setInterval(() => this.playMusicNote(), interval);
  }

  private playMusicNote(): void {
    if (!this.currentMusic || this.muted) return;
    const pattern = this.musicPatterns[this.currentMusic];
    if (!pattern) return;

    const note = pattern[this.musicNoteIndex % pattern.length];
    this.musicNoteIndex++;

    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = note;
    gain.gain.value = this._musicVolume * 0.25;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(this.musicGain!);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  stopMusic(): void {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    this.currentMusic = null;
  }

  setShowdownMode(showdown: boolean): void {
    if (this.showdownMode === showdown) return;
    this.showdownMode = showdown;
    if (this.currentMusic) {
      this.playMusic(this.currentMusic);
    }
  }

  setSfxVolume(v: number): void {
    this._sfxVolume = Math.max(0, Math.min(1, v));
    this.updateVolumes();
  }

  setMusicVolume(v: number): void {
    this._musicVolume = Math.max(0, Math.min(1, v));
    this.updateVolumes();
  }

  mute(): void {
    this.muted = true;
    this.updateVolumes();
  }

  unmute(): void {
    this.muted = false;
    this.updateVolumes();
  }
}
