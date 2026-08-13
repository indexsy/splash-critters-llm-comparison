export const audio = {
  ctx: null as AudioContext | null,
  sfx: 0.7,
  music: 0.45,
  muted: false,
  musicNodes: [] as { stop: () => void }[],
  showdown: false,

  ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  },

  beep(freq: number, dur: number, type: OscillatorType = "square", gain = 0.08, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain * this.sfx, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur: number, gain = 0.06): void {
    if (this.muted) return;
    const ctx = this.ensure();
    const n = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = n;
    const g = ctx.createGain();
    g.gain.value = gain * this.sfx;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(g);
    g.connect(ctx.destination);
    src.start();
  },

  drop(): void {
    this.beep(220, 0.08, "square", 0.06);
    this.beep(180, 0.1, "triangle", 0.04, 0.04);
  },
  burst(): void {
    this.noise(0.12, 0.07);
    this.beep(140, 0.15, "sawtooth", 0.05);
  },
  chain(n: number): void {
    for (let i = 0; i < Math.min(n, 5); i++) this.beep(440 + i * 160, 0.1, "square", 0.07, i * 0.07);
  },
  pickup(): void {
    this.beep(660, 0.07, "square");
    this.beep(880, 0.08, "square", 0.06, 0.06);
  },
  soak(): void {
    this.noise(0.2, 0.09);
    this.beep(90, 0.25, "triangle", 0.08);
  },
  tide(): void {
    this.beep(200, 0.2, "square", 0.08);
    this.beep(160, 0.25, "square", 0.06, 0.1);
  },
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.beep(f, 0.18, "square", 0.07, i * 0.12));
  },
  emote(id: number): void {
    const freqs = [480, 220, 720, 160];
    this.beep(freqs[id - 1] ?? 400, 0.18, "square", 0.08);
  },
  click(): void {
    this.beep(520, 0.04, "square", 0.04);
  },

  startMusic(kind: "title" | "menu" | "battle" | "showdown"): void {
    this.stopMusic();
    if (this.muted) return;
    const ctx = this.ensure();
    const tempo = kind === "showdown" ? 0.18 : kind === "battle" ? 0.28 : 0.36;
    this.showdown = kind === "showdown";
    const notes =
      kind === "title"
        ? [262, 330, 392, 330, 294, 330, 392, 523]
        : kind === "menu"
          ? [196, 247, 294, 247, 220, 247, 294, 392]
          : [262, 294, 330, 392, 330, 294, 262, 196];
    let step = 0;
    let stopped = false;
    const tick = () => {
      if (stopped || this.muted) return;
      this.beep(notes[step % notes.length]!, tempo * 0.85, "triangle", 0.035 * this.music);
      if (step % 2 === 0) this.beep(98, tempo * 0.4, "square", 0.02 * this.music);
      step++;
      const id = window.setTimeout(tick, tempo * 1000);
      this.musicNodes.push({ stop: () => { stopped = true; clearTimeout(id); } });
    };
    tick();
    this.musicNodes.push({
      stop: () => {
        stopped = true;
      },
    });
    void ctx;
  },

  stopMusic(): void {
    for (const n of this.musicNodes) n.stop();
    this.musicNodes = [];
  },

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic();
  },
};
