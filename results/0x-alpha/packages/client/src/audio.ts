/** Web Audio chiptune + SFX (square/triangle/noise oscillators). */

class AudioSys {
  private ctx: AudioContext | null = null;
  private musicTimer: number | null = null;
  private musicGain: GainNode | null = null;
  sfxVolume = 0.6;
  musicVolume = 0.35;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock(): void {
    this.ensure();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.stopMusic();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol = 1,
    when = 0,
    slideTo?: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol * this.sfxVolume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 1, when = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * this.sfxVolume * 0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  drop(): void {
    this.tone(300, 0.12, "square", 0.7, 0, 180);
  }
  burst(): void {
    this.noise(0.3, 1.2);
    this.tone(160, 0.25, "triangle", 0.8, 0, 60);
  }
  chain(level: number): void {
    const base = 440 * Math.pow(1.25, Math.min(4, level));
    [0, 0.09, 0.18].forEach((d, i) => this.tone(base * (1 + i * 0.26), 0.12, "square", 0.9, d));
  }
  pickup(): void {
    this.tone(660, 0.08, "square", 0.8);
    this.tone(990, 0.12, "square", 0.8, 0.08);
  }
  sploosh(): void {
    this.noise(0.45, 1.4);
    this.tone(220, 0.4, "sine", 0.9, 0, 70);
  }
  tideAlarm(): void {
    for (let i = 0; i < 3; i++) this.tone(520, 0.15, "square", 0.8, i * 0.2, 380);
  }
  victory(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "square", 0.9, i * 0.14));
  }
  defeat(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.9, i * 0.16));
  }
  emote(id: number): void {
    const freqs = [800, 500, 1100, 350];
    this.tone(freqs[(id - 1) % 4]!, 0.12, "square", 0.7, 0, freqs[(id - 1) % 4]! * 0.7);
  }
  uiClick(): void {
    this.tone(700, 0.05, "square", 0.4);
  }

  /** Simple looping chiptune per screen. */
  playMusic(kind: "menu" | "game" | "showdown"): void {
    this.stopMusic();
    const ctx = this.ensure();
    if (!ctx) return;
    const scales: Record<string, number[]> = {
      menu: [262, 330, 392, 523, 392, 330],
      game: [294, 370, 440, 587, 440, 370],
      showdown: [330, 415, 494, 659, 494, 415],
    };
    const seq = scales[kind]!;
    const interval = kind === "showdown" ? 130 : 200;
    let step = 0;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume * 0.15;
    this.musicGain.connect(ctx.destination);
    const tickFn = (): void => {
      const c = this.ensure();
      if (!c || !this.musicGain) return;
      const f = seq[step % seq.length]!;
      const osc = c.createOscillator();
      osc.type = step % 2 === 0 ? "square" : "triangle";
      osc.frequency.value = f;
      osc.connect(this.musicGain);
      osc.start();
      osc.stop(c.currentTime + interval / 1000 * 0.85);
      // bass every 3rd step
      if (step % 3 === 0) {
        const bass = c.createOscillator();
        bass.type = "triangle";
        bass.frequency.value = seq[0]! / 2;
        bass.connect(this.musicGain);
        bass.start();
        bass.stop(c.currentTime + 0.12);
      }
      step++;
    };
    tickFn();
    this.musicTimer = window.setInterval(tickFn, interval);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

export const audio = new AudioSys();
