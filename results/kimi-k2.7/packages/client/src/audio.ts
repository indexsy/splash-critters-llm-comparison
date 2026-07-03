export class AudioManager {
  ctx?: AudioContext;
  muted = false;
  currentOsc?: OscillatorNode;
  currentGain?: GainNode;
  tuneName = "";

  constructor() {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      // no audio
    }
  }

  toggleMute() {
    this.muted = !this.muted;
  }

  ensure() {
    if (this.ctx?.state === "suspended") this.ctx.resume();
  }

  playTone(freq: number, type: OscillatorType, duration: number, when = 0) {
    if (this.muted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + when + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(this.ctx.currentTime + when);
    osc.stop(this.ctx.currentTime + when + duration);
  }

  playNoise(duration: number) {
    if (this.muted || !this.ctx) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  sfx(name: string) {
    this.ensure();
    switch (name) {
      case "drop":
        this.playTone(220, "square", 0.08);
        break;
      case "burst":
        this.playNoise(0.15);
        this.playTone(440, "sawtooth", 0.1);
        break;
      case "chain":
        this.playTone(523, "square", 0.1);
        this.playTone(659, "square", 0.1, 0.1);
        this.playTone(784, "square", 0.2, 0.2);
        break;
      case "pickup":
        this.playTone(880, "triangle", 0.15);
        break;
      case "soak":
        this.playTone(150, "sawtooth", 0.3);
        break;
      case "win":
        this.playTone(523, "square", 0.15);
        this.playTone(659, "square", 0.15, 0.15);
        this.playTone(784, "square", 0.15, 0.3);
        this.playTone(1047, "square", 0.4, 0.45);
        break;
    }
  }

  playTune(name: string) {
    if (this.muted || !this.ctx) return;
    if (this.tuneName === name) return;
    this.tuneName = name;
    this.currentOsc?.stop();
    this.currentOsc = undefined;
    // Simple arpeggio loop
    const notes = name === "title" ? [261, 329, 392, 523] : [196, 246, 293, 392];
    let idx = 0;
    const loop = () => {
      if (this.tuneName !== name || this.muted) return;
      this.playTone(notes[idx], "square", 0.25);
      idx = (idx + 1) % notes.length;
      setTimeout(loop, 250);
    };
    loop();
  }
}
