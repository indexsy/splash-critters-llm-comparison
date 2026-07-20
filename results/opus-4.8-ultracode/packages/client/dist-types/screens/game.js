import { CONFIG } from '@splash/shared';
import { audio } from '../audio';
import { input } from '../input';
import { net } from '../net';
import { WorldView } from '../prediction';
import { Particles } from '../render/particles';
import { clear, prepare } from '../render/pixel';
import { drawAnnounce, drawFeed, drawHud, HUD_H } from '../render/hud';
import { computeBoard, drawWorld } from '../render/world';
import { splashColor } from '../theme';
import { store } from '../store';
const STEP_MS = 1000 / CONFIG.TICK_RATE;
export function mount(root) {
    const config = store.matchConfig;
    const localId = store.profile?.id ?? '';
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    prepare(ctx);
    const world = new WorldView(config, localId, store.matchTheme);
    const particles = new Particles();
    let board = computeBoard(CONFIG.ARENA[config.mode].w, CONFIG.ARENA[config.mode].h, HUD_H);
    let snap = null;
    let acc = 0;
    let seq = 1;
    let introEndMs = 0;
    let shakeMs = 0;
    let lastIntroCount = -99;
    const feed = [];
    let announce = null;
    const nameOf = (slot) => config.players.find((p) => p.slot === slot)?.name.split('#')[0] ?? '?';
    const cxPx = (x) => board.ox + (x + 0.5) * board.tile;
    const cyPx = (y) => board.oy + (y + 0.5) * board.tile;
    function setAnnounce(text, color, big = true) {
        announce = { text, color, big, ms: performance.now() };
    }
    net.handlers = {
        onMatchStart: () => audio.startMusic('game'),
        onRoundStart: (msg) => {
            world.startRound(msg.mapSeed, msg.roundNo, msg.theme);
            board = computeBoard(world.width, world.height, HUD_H);
            snap = null;
            input.enabled = false;
            introEndMs = performance.now() + (msg.startAtTick / CONFIG.TICK_RATE) * 1000;
            audio.setShowdown(false);
            feed.length = 0;
        },
        onSnapshot: (s) => {
            snap = s;
            world.onSnapshot(s);
            const alive = s.players.filter((p) => p.alive).length;
            audio.setShowdown(alive <= 2 && alive > 0);
        },
        onEvent: (_tick, events) => {
            world.applyEvents(events);
            handleFx(events);
        },
        onRoundEnd: (msg) => {
            if (msg.winnerSlot === null)
                setAnnounce('DRAW ROUND', '#9fb4e6');
            else
                setAnnounce(`${nameOf(msg.winnerSlot)} WINS!`, splashColor(msg.winnerSlot, store.settings.colorblind));
            audio.sfx(msg.winnerSlot === world.localSlot ? 'victory' : 'count');
        },
        onMatchEnd: () => {
            audio.stopMusic();
        },
    };
    function handleFx(events) {
        const cb = store.settings.colorblind;
        for (const e of events) {
            switch (e.t) {
                case 'balloon_placed':
                    audio.sfx('drop');
                    break;
                case 'balloon_burst':
                    audio.sfx('burst');
                    shake(140);
                    for (const c of e.cells)
                        particles.splash(cxPx(c.x), cyPx(c.y), splashColor(e.ownerSlot, cb), 6);
                    break;
                case 'castle_washed':
                    particles.crumble(cxPx(e.x), cyPx(e.y), '#d9b36a');
                    break;
                case 'powerup_collected':
                    audio.sfx('pickup');
                    particles.sparkle(cxPx(e.x), cyPx(e.y), '#ffd23f');
                    break;
                case 'powerup_revealed':
                    particles.sparkle(cxPx(e.x), cyPx(e.y), '#ffffff');
                    break;
                case 'player_soaked':
                    audio.sfx('soak');
                    shake(180);
                    particles.splash(cxPx(e.x), cyPx(e.y), splashColor(e.bySlot, cb), 14);
                    feed.push({ text: soakText(e), ms: performance.now(), color: splashColor(e.bySlot, cb) });
                    break;
                case 'chain_burst':
                    audio.sfx('chain', e.count);
                    setAnnounce(chainWord(e.count), '#34d1ff');
                    shake(220);
                    break;
                case 'balloon_kicked':
                    audio.sfx('kick');
                    break;
                case 'tide_advance':
                    if (e.level === 1) {
                        audio.sfx('tide');
                        setAnnounce('RISING TIDE!', '#34d1ff');
                    }
                    break;
                case 'emote':
                    audio.sfx('emote', e.emoteId);
                    break;
            }
        }
    }
    function soakText(e) {
        const victim = nameOf(config.players.find((p) => p.id === e.playerId)?.slot ?? -1);
        if (e.bySlot === -1)
            return `🌊 ${victim} was swept away`;
        const attacker = config.players.find((p) => p.slot === e.bySlot);
        if (!attacker || attacker.id === e.playerId)
            return `${victim} soaked themselves!`;
        return `${nameOf(e.bySlot)} soaked ${victim}!`;
    }
    function shake(ms) {
        if (!store.settings.reduceShake)
            shakeMs = Math.max(shakeMs, ms);
    }
    function fixedTick() {
        const now = performance.now();
        if (now < introEndMs) {
            // drain any pre-round key edges so they don't fire a phantom balloon at spawn
            input.enabled = false;
            input.takeBalloon();
            input.takeEmote();
            return;
        }
        input.enabled = true;
        const dir = input.pollDir();
        const balloon = input.takeBalloon();
        const inp = { seq: seq++, tick: 0, dir, balloon };
        net.send({ type: 'input', inputs: [inp] });
        world.fixedStep(inp);
        const emote = input.takeEmote();
        if (emote)
            net.send({ type: 'emote', id: emote });
    }
    root.append(hint());
    return {
        unmount() {
            net.handlers = {};
            input.enabled = false;
            audio.stopMusic();
            root.replaceChildren();
        },
        onFrame(dt, now) {
            acc += dt;
            let steps = 0;
            while (acc >= STEP_MS && steps < 5) {
                acc -= STEP_MS;
                fixedTick();
                steps++;
            }
            particles.update(dt / 1000);
            // render
            let ox = 0;
            let oy = 0;
            if (shakeMs > 0) {
                shakeMs -= dt;
                const amp = Math.min(3, shakeMs / 60);
                ox = (Math.random() - 0.5) * amp * 2;
                oy = (Math.random() - 0.5) * amp * 2;
            }
            clear(ctx, '#0a0f24');
            ctx.save();
            ctx.translate(Math.round(ox), Math.round(oy));
            const view = world.renderView(now);
            if (view)
                drawWorld(ctx, view, world.grid, board, world.theme, particles, { colorblind: store.settings.colorblind, nowMs: now });
            ctx.restore();
            drawHud(ctx, snap, config, store.ping, world.roundNo, now, store.settings.colorblind);
            drawFeed(ctx, feed, now);
            // countdown beeps (3-2-1-SPLASH!)
            const remain = introEndMs - now;
            if (remain > -400) {
                const c = remain > 2000 ? 3 : remain > 1000 ? 2 : remain > 0 ? 1 : 0;
                if (c !== lastIntroCount) {
                    lastIntroCount = c;
                    audio.sfx(c === 0 ? 'go' : 'count');
                }
            }
            drawIntro(ctx, now, introEndMs);
            drawAnnounce(ctx, announce, now);
        },
    };
}
function drawIntro(ctx, now, introEndMs) {
    const remain = introEndMs - now;
    if (remain <= -500)
        return;
    let text;
    if (remain > 2000)
        text = '3';
    else if (remain > 1000)
        text = '2';
    else if (remain > 0)
        text = '1';
    else
        text = 'SPLASH!';
    const a = { text, color: text === 'SPLASH!' ? '#4ee66a' : '#ffd23f', big: true, ms: now - 40 };
    drawAnnounce(ctx, a, now);
}
function chainWord(count) {
    if (count >= 5)
        return 'MEGA SPLASH!';
    if (count === 4)
        return 'QUAD SPLASH!';
    if (count === 3)
        return 'TRIPLE SPLASH!';
    return 'DOUBLE SPLASH!';
}
function hint() {
    const el = document.createElement('div');
    el.className = 'announce';
    el.style.top = 'auto';
    el.style.bottom = '8px';
    el.style.fontSize = '11px';
    el.style.color = '#9fb4e6';
    el.textContent = 'WASD/Arrows move · Space/E balloon · 1-4 emotes · M mute';
    setTimeout(() => el.remove(), 4000);
    return el;
}
//# sourceMappingURL=game.js.map