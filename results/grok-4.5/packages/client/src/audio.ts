/** Web Audio chiptune SFX + simple looping music */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let muted = false;
let musicNodes: OscillatorNode[] = [];
let musicInterval: ReturnType<typeof setInterval> | null = null;
let showdown = false;

export function initAudio(): void {
  if (ctx) return;
  ctx = new AudioContext();
  masterGain = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.gain.value = 0.35;
  musicGain.gain.value = 0.12;
  sfxGain.connect(masterGain);
  musicGain.connect(masterGain);
  masterGain.connect(ctx.destination);
}

function ensure(): AudioContext {
  if (!ctx) initAudio();
  if (ctx!.state === 'suspended') ctx!.resume();
  return ctx!;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 1;
}

export function toggleMute(): boolean {
  setMuted(!muted);
  return muted;
}

export function setSfxVolume(v: number): void {
  if (sfxGain) sfxGain.gain.value = v;
}

export function setMusicVolume(v: number): void {
  if (musicGain) musicGain.gain.value = v;
}

function beep(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3): void {
  if (muted) return;
  const c = ensure();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g);
  g.connect(sfxGain!);
  o.start();
  o.stop(c.currentTime + dur);
}

function noise(dur: number, vol = 0.15): void {
  if (muted) return;
  const c = ensure();
  const bufferSize = c.sampleRate * dur;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(g);
  g.connect(sfxGain!);
  src.start();
}

export const sfx = {
  drop: () => beep(220, 0.08, 'square', 0.2),
  burst: () => {
    noise(0.12, 0.2);
    beep(120, 0.1, 'triangle', 0.25);
  },
  chain: (depth: number) => {
    const base = 400 + depth * 80;
    beep(base, 0.1, 'square', 0.3);
    setTimeout(() => beep(base * 1.25, 0.12, 'square', 0.25), 60);
    if (depth >= 3) setTimeout(() => beep(base * 1.5, 0.15, 'square', 0.2), 120);
  },
  pickup: () => {
    beep(520, 0.06, 'square', 0.2);
    setTimeout(() => beep(780, 0.08, 'square', 0.2), 50);
  },
  soak: () => {
    noise(0.2, 0.25);
    beep(80, 0.25, 'triangle', 0.3);
  },
  tide: () => beep(180, 0.3, 'sawtooth', 0.15),
  victory: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'square', 0.25), i * 120));
  },
  click: () => beep(600, 0.04, 'square', 0.15),
  emote: () => beep(300 + Math.random() * 200, 0.1, 'triangle', 0.2),
  countdown: () => beep(440, 0.1, 'square', 0.2),
  splash: () => beep(880, 0.15, 'square', 0.3),
};

const MENU_NOTES = [262, 294, 330, 349, 392, 330, 294, 262];
const GAME_NOTES = [196, 220, 247, 262, 294, 262, 247, 220];
const SHOWDOWN_NOTES = [294, 330, 370, 392, 440, 392, 370, 330];

export function playMusic(screen: 'menu' | 'game' | 'showdown'): void {
  stopMusic();
  showdown = screen === 'showdown';
  const notes = screen === 'menu' ? MENU_NOTES : screen === 'showdown' ? SHOWDOWN_NOTES : GAME_NOTES;
  const tempo = screen === 'showdown' ? 140 : screen === 'game' ? 200 : 280;
  let i = 0;
  musicInterval = setInterval(() => {
    if (muted || !ctx || !musicGain) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = notes[i % notes.length]!;
    g.gain.value = 0.08;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o.connect(g);
    g.connect(musicGain);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    musicNodes = [o];
    i++;
  }, tempo);
}

export function stopMusic(): void {
  if (musicInterval) clearInterval(musicInterval);
  musicInterval = null;
  for (const n of musicNodes) {
    try { n.stop(); } catch { /* */ }
  }
  musicNodes = [];
}

export function setShowdown(on: boolean): void {
  if (on && !showdown) playMusic('showdown');
  else if (!on && showdown) playMusic('game');
}
