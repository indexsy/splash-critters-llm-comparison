export class AudioEngine {
  muted = false;
  sfxVolume = 0.5;
  musicVolume = 0.2;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private note = 0;
  private screen = "menu";
  private showdown = false;
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      this.master.connect(limiter);
      limiter.connect(this.context.destination);
      this.setMuted(this.muted);
      this.timer = window.setInterval(() => this.music(), 120);
    }
    void this.context.resume();
  }
  setScreen(screen: string): void {
    if (screen !== this.screen) {
      this.screen = screen;
      this.note = 0;
    }
  }
  setShowdown(active: boolean): void {
    this.showdown = active;
  }
  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        value ? 0 : 0.6,
        this.context.currentTime,
        0.02,
      );
  }
  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    endFrequency?: number,
  ): void {
    const c = this.context;
    if (!c || !this.master || this.muted) return;
    const osc = c.createOscillator();
    const volume = c.createGain();
    const t = c.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (endFrequency)
      osc.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    volume.gain.setValueAtTime(0, t);
    volume.gain.linearRampToValueAtTime(gain, t + 0.005);
    volume.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(volume);
    volume.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.01);
    osc.onended = () => {
      osc.disconnect();
      volume.disconnect();
    };
  }
  private noise(duration: number, gain: number): void {
    const c = this.context;
    if (!c || !this.master || this.muted) return;
    const buffer = c.createBuffer(
      1,
      Math.floor(c.sampleRate * duration),
      c.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++)
      samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
    const source = c.createBufferSource();
    source.buffer = buffer;
    const volume = c.createGain();
    volume.gain.value = gain;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2100;
    source.connect(filter);
    filter.connect(volume);
    volume.connect(this.master);
    source.start();
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      volume.disconnect();
    };
  }
  play(name: string, count = 2): void {
    const v = this.sfxVolume * 0.18;
    if (name === "click") this.tone(650, 0.065, "square", v);
    if (name === "balloon_dropped" || name === "revenge_lob")
      this.tone(210, 0.12, "triangle", v * 2, 0, 480);
    if (name === "balloon_burst") {
      this.noise(0.2, v * 2);
      this.tone(160, 0.22, "triangle", v, 0, 45);
    }
    if (name === "player_soaked") {
      this.noise(0.4, v * 2);
      this.tone(550, 0.35, "square", v * 0.6, 0, 90);
    }
    if (name === "powerup_collected")
      [523, 659, 784].forEach((f, i) =>
        this.tone(f, 0.13, "square", v, i * 0.065),
      );
    if (name === "chain_burst")
      [523, 659, 784, 1047, 1319]
        .slice(0, Math.min(5, count + 1))
        .forEach((f, i) => this.tone(f, 0.15, "square", v, i * 0.07));
    if (name === "tide_advance")
      [330, 440, 330].forEach((f, i) =>
        this.tone(f, 0.15, "square", v, i * 0.18),
      );
    if (name === "victory")
      [523, 523, 659, 784, 659, 1047].forEach((f, i) =>
        this.tone(f, 0.25, "square", v, i * 0.16),
      );
    if (name.startsWith("emote")) {
      const f = [260, 130, 900, 380][Number(name.at(-1))] ?? 260;
      this.tone(f, 0.12, "square", v, 0, f * 0.7);
      this.tone(f * 1.1, 0.15, "square", v, 0.15, f * 0.8);
    }
  }
  private music(): void {
    if (document.hidden || !this.context || this.muted) return;
    this.note++;
    if (!this.showdown && this.note % 2) return;
    const step = Math.floor(this.note / (this.showdown ? 1 : 2));
    const melody =
      this.screen === "game"
        ? [64, 67, 71, 67, 62, 66, 69, 66, 60, 64, 67, 64, 62, 66, 69, 74]
        : [72, 0, 76, 79, 0, 76, 74, 72, 69, 0, 72, 76, 74, 0, 67, 0];
    const midi = melody[step % melody.length];
    const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
    if (midi) this.tone(hz(midi), 0.12, "square", this.musicVolume * 0.065);
    if (step % 2 === 0)
      this.tone(
        hz([48, 45, 41, 43][Math.floor(step / 4) % 4]),
        0.24,
        "triangle",
        this.musicVolume * 0.12,
      );
  }
  destroy(): void {
    if (this.timer) window.clearInterval(this.timer);
    void this.context?.close();
  }
}
