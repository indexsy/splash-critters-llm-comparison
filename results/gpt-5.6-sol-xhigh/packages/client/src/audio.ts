type CueName =
  | "click" | "back" | "confirm" | "error" | "tab"
  | "drop" | "splash" | "chain" | "kick" | "powerup" | "soaked" | "tide"
  | "win" | "lose" | "round" | "match" | "tick" | "join" | "found" | "ping";

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

interface ActiveVoice { stop: (when: number) => void }

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private voices = new Set<ActiveVoice>();
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private settings: AudioSettings = { master: 0.8, sfx: 0.9, music: 0.5, muted: false };
  private startedAt = 0;
  public lastCue: CueName | null = null;

  apply(s: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...s };
    if (this.master) this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    if (this.sfxGain) this.sfxGain.gain.value = this.settings.sfx;
    if (this.musicGain) this.musicGain.gain.value = this.settings.music;
  }

  get current(): AudioSettings { return this.settings; }

  resume(): void {
    if (!this.ctx) this.ensure();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.sfxGain.gain.value = this.settings.sfx;
    this.musicGain.gain.value = this.settings.music;
    this.noiseBuffer = this.makeNoise(0.6);
    this.startedAt = this.ctx.currentTime;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  play(cue: CueName, opts: { detune?: number; gain?: number; rate?: number } = {}): void {
    this.ensure();
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    if (this.settings.muted || this.settings.sfx <= 0) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    this.lastCue = cue;
    const gain = opts.gain ?? 1;

    switch (cue) {
      case "click": this.blip(t0, 520, 0.05, "square", 0.18 * gain); break;
      case "tab": this.blip(t0, 720, 0.05, "square", 0.16 * gain); break;
      case "back": this.blip(t0, 320, 0.08, "square", 0.18 * gain); break;
      case "confirm": this.upSweep(t0, 0.18, gain); break;
      case "error": this.downBuzz(t0, 0.22, gain); break;
      case "join": this.upSweep(t0, 0.18, gain * 0.8); break;
      case "found": this.upSweep(t0, 0.3, gain); this.blip(t0 + 0.05, 880, 0.1, "square", 0.2 * gain); break;
      case "tick": this.blip(t0, 1200, 0.03, "square", 0.08 * gain); break;
      case "ping": this.blip(t0, 1800, 0.04, "sine", 0.06 * gain); break;
      case "drop": this.drop(t0, gain); break;
      case "splash": this.splash(t0, gain); break;
      case "chain": this.chain(t0, gain); break;
      case "kick": this.blip(t0 + 0.02, 220, 0.06, "square", 0.22 * gain); this.noiseBurst(t0, 0.08, 0.15 * gain, 1500); break;
      case "powerup": this.powerup(t0, gain); break;
      case "soaked": this.soaked(t0, gain); break;
      case "tide": this.tide(t0, gain); break;
      case "win": this.fanfare(t0, gain, true); break;
      case "lose": this.fanfare(t0, gain, false); break;
      case "round": this.blip(t0, 660, 0.1, "square", 0.22 * gain); break;
      case "match": this.fanfare(t0, gain, true); break;
    }
  }

  private blip(t0: number, freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.track(osc, g, t0 + dur + 0.05);
  }

  private upSweep(t0: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(1100, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18 * gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.track(osc, g, t0 + dur + 0.05);
  }

  private downBuzz(t0: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(80, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.22 * gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    this.track(osc, g, t0 + dur + 0.05);
  }

  private drop(t0: number, gain: number): void {
    this.blip(t0, 660, 0.06, "square", 0.18 * gain);
    this.blip(t0 + 0.04, 440, 0.05, "triangle", 0.12 * gain);
  }

  private splash(t0: number, gain: number): void {
    this.noiseBurst(t0, 0.25, 0.32 * gain, 1800);
    this.blip(t0, 520, 0.12, "triangle", 0.14 * gain);
    this.blip(t0 + 0.02, 780, 0.08, "sine", 0.1 * gain);
  }

  private chain(t0: number, gain: number): void {
    this.splash(t0, gain * 0.7);
    this.blip(t0 + 0.02, 900, 0.06, "square", 0.18 * gain);
    this.blip(t0 + 0.05, 1320, 0.06, "square", 0.16 * gain);
  }

  private powerup(t0: number, gain: number): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.blip(t0 + i * 0.05, n, 0.08, "square", 0.16 * gain));
  }

  private soaked(t0: number, gain: number): void {
    this.noiseBurst(t0, 0.4, 0.3 * gain, 1200);
    this.downBuzz(t0, 0.18, gain * 0.6);
  }

  private tide(t0: number, gain: number): void {
    this.noiseBurst(t0, 0.6, 0.18 * gain, 800);
    this.blip(t0, 180, 0.4, "sine", 0.14 * gain);
  }

  private fanfare(t0: number, gain: number, win: boolean): void {
    const notes = win ? [523, 659, 784, 1046, 1318] : [440, 392, 349, 294];
    notes.forEach((n, i) => this.blip(t0 + i * 0.12, n, 0.16, "square", 0.2 * gain));
  }

  private noiseBurst(t0: number, dur: number, gain: number, lp: number): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain!);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    this.track(src, g, t0 + dur + 0.05);
  }

  private track(node: AudioScheduledSourceNode, gain: GainNode, stopAt: number): void {
    const voice: ActiveVoice = {
      stop: (when: number) => {
        try { node.stop(when); } catch { /* already */ }
        try { gain.disconnect(); } catch { /* noop */ }
      }
    };
    this.voices.add(voice);
    const ctx = this.ctx!;
    const ms = Math.max(0, (stopAt - ctx.currentTime) * 1000);
    window.setTimeout(() => this.voices.delete(voice), ms + 50);
  }

  startMusic(): void {
    this.ensure();
    if (this.musicTimer !== null) return;
    const bass = [55, 55, 82.41, 73.42];
    const lead = [330, 392, 440, 523, 440, 392, 330, 294];
    this.musicStep = 0;
    const tick = () => {
      if (!this.ctx || !this.musicGain || this.settings.muted || this.settings.music <= 0) return;
      const t0 = this.ctx.currentTime;
      const step = this.musicStep++;
      const bassFreq = bass[step % bass.length]!;
      const leadFreq = lead[step % lead.length]!;
      this.simpleTone(t0, bassFreq, 0.18, "triangle", 0.08, this.musicGain);
      if (step % 2 === 0) this.simpleTone(t0, leadFreq, 0.14, "square", 0.05, this.musicGain);
      if (step % 4 === 0) this.simpleTone(t0, leadFreq * 2, 0.06, "square", 0.03, this.musicGain);
    };
    tick();
    this.musicTimer = window.setInterval(tick, 250);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) { window.clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  private simpleTone(t0: number, freq: number, dur: number, type: OscillatorType, gain: number, out: GainNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  dispose(): void {
    this.stopMusic();
    for (const v of this.voices) v.stop(0);
    this.voices.clear();
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ctx = null;
  }

  get uptime(): number {
    if (!this.ctx || !this.startedAt) return 0;
    return this.ctx.currentTime - this.startedAt;
  }
}
