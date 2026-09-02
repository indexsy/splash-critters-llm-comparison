// Web Audio SFX + chiptune. Square/triangle/noise oscillators, no assets.
import { app } from './state.js';
let ctx = null;
let musicTimer = null;
let musicStep = 0;
let mode = 'menu';
let showdown = false;
function ac() {
    if (app.settings.muted)
        return null;
    if (!ctx) {
        try {
            ctx = new AudioContext();
        }
        catch {
            return null;
        }
    }
    if (ctx.state === 'suspended')
        void ctx.resume();
    return ctx;
}
function env(g, t, vol, dur) {
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
}
function tone(freq, dur = 0.12, type = 'square', vol = 0.2, slideTo) {
    const c = ac();
    if (!c)
        return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo)
        o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env(g, t, vol * app.settings.sfx, dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
}
function noise(dur = 0.2, vol = 0.25, lp = 1200) {
    const c = ac();
    if (!c)
        return;
    const t = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const g = c.createGain();
    g.gain.value = vol * app.settings.sfx;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
}
export const sfx = {
    drop() { tone(220, 0.1, 'square', 0.25, 330); },
    burst() { noise(0.3, 0.4, 2000); tone(160, 0.25, 'triangle', 0.3, 60); },
    chain(n) {
        const base = 440 + Math.min(n, 6) * 110;
        tone(base, 0.09, 'square', 0.25);
        setTimeout(() => tone(base * 1.25, 0.09, 'square', 0.25), 70);
        if (n >= 3)
            setTimeout(() => tone(base * 1.5, 0.14, 'square', 0.3), 140);
    },
    pickup() { tone(660, 0.08, 'square', 0.22); setTimeout(() => tone(880, 0.1, 'square', 0.22), 70); },
    soak() { noise(0.35, 0.35, 900); tone(300, 0.3, 'triangle', 0.3, 90); },
    kick() { tone(180, 0.08, 'square', 0.25, 420); },
    tide() { tone(440, 0.2, 'square', 0.25, 440); setTimeout(() => tone(415, 0.2, 'square', 0.25), 220); },
    fanfare() {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.28), i * 130));
    },
    click() { tone(700, 0.05, 'square', 0.15); },
    emote(id) {
        const f = [500, 350, 800, 250][(id - 1) % 4];
        tone(f, 0.12, 'square', 0.25, f * 1.4);
    },
};
const SONGS = {
    menu: [262, 294, 330, 392, 440, 392, 330, 294],
    game: [196, 220, 196, 262, 196, 220, 294, 220],
    showdown: [220, 220, 262, 220, 294, 262, 294, 330],
    title: [330, 392, 523, 392, 440, 523, 659, 523],
};
export function startMusic(m) {
    mode = m;
    stopMusic();
    musicStep = 0;
    const tick = () => {
        const c = ac();
        if (c && !app.settings.muted) {
            const song = SONGS[showdown && mode === 'game' ? 'showdown' : mode] ?? SONGS.menu;
            const f = song[musicStep % song.length];
            const o = c.createOscillator();
            const g = c.createGain();
            o.type = 'triangle';
            o.frequency.value = f;
            g.gain.value = 0.08 * app.settings.music;
            o.connect(g).connect(c.destination);
            const t = c.currentTime;
            o.start(t);
            o.stop(t + 0.22);
        }
        musicStep++;
    };
    tick();
    musicTimer = window.setInterval(tick, showdown ? 200 : 300);
}
export function setShowdown(b) {
    showdown = b;
}
export function stopMusic() {
    if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
    }
}
export function toggleMute() {
    app.settings.muted = !app.settings.muted;
    return app.settings.muted;
}
