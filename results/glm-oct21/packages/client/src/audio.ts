let ctx: AudioContext | null = null
let master: GainNode | null = null
let sfxGain: GainNode | null = null
let musicGain: GainNode | null = null
const listeners = new Set<(muted: boolean) => void>()

export const AudioFlags = { muted: false, sfxVol: 0.7, musicVol: 0.5 }

function ensure(): AudioContext | null {
  if (ctx) return ctx
  try {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = AudioFlags.muted ? 0 : 1
    master.connect(ctx.destination)
    sfxGain = ctx.createGain()
    sfxGain.gain.value = AudioFlags.sfxVol
    sfxGain.connect(master)
    musicGain = ctx.createGain()
    musicGain.gain.value = AudioFlags.musicVol * 0.5
    musicGain.connect(master)
    return ctx
  } catch {
    return null
  }
}

export function applySettings(): void {
  if (master) master.gain.value = AudioFlags.muted ? 0 : 1
  if (sfxGain) sfxGain.gain.value = AudioFlags.sfxVol
  if (musicGain) musicGain.gain.value = AudioFlags.musicVol * 0.5
  for (const l of listeners) l(AudioFlags.muted)
}

export function setMuted(v: boolean): void {
  AudioFlags.muted = v
  applySettings()
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3, slide = 0, music = false): void {
  const c = ensure()
  if (!c || AudioFlags.muted && !music) return
  const osc = c.createOscillator()
  const g = (music ? musicGain : sfxGain) ?? c.createGain()
  osc.type = type
  const t0 = c.currentTime
  osc.frequency.setValueAtTime(freq, t0)
  if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur)
  g.gain.cancelScheduledValues(t0)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.connect(g)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, vol = 0.25, hp = 400): void {
  const c = ensure()
  if (!c || AudioFlags.muted) return
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = sfxGain ?? c.createGain()
  const t0 = c.currentTime
  g.gain.cancelScheduledValues(t0)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  src.connect(f)
  f.connect(g)
  src.start()
}

export const Sfx = {
  blip: () => tone(660, 0.05, 'square', 0.25),
  move: () => tone(220 + Math.random() * 20, 0.03, 'triangle', 0.06),
  drop: () => {
    tone(180, 0.12, 'sine', 0.3, 60)
    noise(0.05, 0.1, 800)
  },
  burst: () => {
    noise(0.28, 0.5, 240)
    tone(90, 0.22, 'sawtooth', 0.4, -50)
  },
  chain(n: number): void {
    const base = 520 + (n - 1) * 90
    const notes = [base, base * 1.25, base * 1.5, base * 2]
    for (let i = 0; i < Math.min(4, n); i++) {
      setTimeout(() => tone(notes[i]!, 0.12, 'square', 0.3), i * 70)
    }
  },
  pickup: () => {
    tone(660, 0.07, 'square', 0.3)
    setTimeout(() => tone(990, 0.09, 'square', 0.3), 70)
  },
  reveal: () => tone(440, 0.16, 'triangle', 0.25, 220),
  soaked: () => {
    noise(0.5, 0.6, 120)
    tone(300, 0.5, 'sine', 0.35, -180)
  },
  kick: () => noise(0.08, 0.3, 1000),
  duck: () => tone(700, 0.16, 'sawtooth', 0.25, -300),
  emote: (id: number) => {
    const f = [520, 400, 950, 300][id % 4]!
    tone(f, 0.14, 'square', 0.22, 60)
  },
  tide: () => {
    noise(0.6, 0.35, 90)
    tone(150, 0.5, 'triangle', 0.3, 60)
  },
  roundWin: () => {
    const seq = [523, 659, 784, 1047]
    seq.forEach((f, i) => setTimeout(() => tone(f, 0.14, 'square', 0.3), i * 110))
  },
  fanfare: () => {
    const seq = [523, 659, 784, 1047, 784, 1047, 1319]
    seq.forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.3), i * 130))
  },
  joined: () => tone(520, 0.09, 'square', 0.2),
}

interface Track {
  bpm: number
  notes: (number | 0)[]
  wave: OscillatorType
}

const TRACKS: Record<string, Track> = {
  title: { bpm: 96, wave: 'square', notes: [262, 0, 196, 0, 233, 0, 220, 0, 196, 0, 165, 0, 220, 0, 233, 0] },
  menu: { bpm: 104, wave: 'square', notes: [196, 247, 294, 247, 220, 294, 349, 294, 233, 294, 349, 466, 294, 349, 294, 233] },
  lobby: { bpm: 88, wave: 'triangle', notes: [262, 0, 330, 0, 392, 330, 262, 0, 294, 0, 370, 0, 440, 370, 294, 0] },
  match: { bpm: 128, wave: 'square', notes: [147, 147, 0, 165, 175, 0, 196, 0, 175, 165, 0, 147, 0, 131, 0, 0] },
  showdown: { bpm: 152, wave: 'square', notes: [196, 196, 208, 196, 233, 0, 208, 196, 175, 0, 165, 175, 208, 0, 196, 0] },
  results: { bpm: 112, wave: 'triangle', notes: [349, 0, 440, 0, 523, 0, 440, 349, 392, 0, 523, 0, 659, 0, 440, 0] }
}

export class MusicPlayer {
  private timer: ReturnType<typeof setInterval> | null = null
  private track: Track | null = null
  private beat = 0

  play(name: keyof typeof TRACKS | null): void {
    if (!name) return this.stop()
    const t = TRACKS[name] as Track | undefined
    if (!t) return
    if (this.track === t) return
    this.track = t
    this.beat = 0
    this.stop()
    const c = ensure()
    if (!c) return
    const interval = (60 / t.bpm) * 1000 / 2
    this.timer = setInterval(() => {
      if (AudioFlags.muted) return
      const n = t.notes[this.beat % t.notes.length]
      this.beat++
      if (n) {
        tone(n, interval / 1000 * 0.9, t.wave, 0.14, 0, true)
        if (this.beat % 4 === 1) tone(n / 2, interval / 1000, 'triangle', 0.12, 0, true)
      }
    }, interval)
  }

  speedup(): void {
    if (this.track && this.track !== TRACKS.showdown) {
      this.play('showdown')
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

export const Music = new MusicPlayer()

export function onMuteChange(fn: (muted: boolean) => void): void {
  listeners.add(fn)
}
