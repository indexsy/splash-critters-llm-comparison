import { CONFIG } from '@splash/shared';
import { net, latencyFlag } from '../net.js';
import { app } from '../state.js';
import { session, resetMatch } from '../session.js';
import { Predictor } from '../prediction.js';
import { drawAnimal, drawBalloon, drawBoulder, drawCastle, drawDuck, drawPowerup, drawSplash, themeColors, TILE } from '../render/sprites.js';
import { burstParticles, soakParticles, addShake, addHitStop, announce, currentAnnounce, updateFx, drawParticles } from '../render/particles.js';
import { renderHud, Feed } from '../render/hud.js';
import { sfx, startMusic, setShowdown } from '../audio.js';
export function renderGame(root, nav) {
    resetMatchIfNew();
    startMusic('game');
    root.innerHTML = '';
    const d = document.createElement('div');
    d.innerHTML = `
    <div class="announce" id="ann"></div>
    <canvas id="cv" width="240" height="208" class="pixel"></canvas>
    <div id="hud"></div>
    <div class="feed" id="feed"></div>
    <div class="row"><button id="leave" class="warn">Forfeit / Leave</button><span class="small">Ducks (casual): move + SPACE to lob every 5s</span></div>`;
    root.appendChild(d);
    const cv = d.querySelector('#cv');
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const hudEl = d.querySelector('#hud');
    const feed = new Feed(d.querySelector('#feed'));
    const annEl = d.querySelector('#ann');
    d.querySelector('#leave').onclick = () => {
        net.send({ kind: 'leave_room' });
        session.room = null;
        nav('#/menu');
    };
    const pred = new Predictor();
    const myId = app.profile?.playerId ?? '';
    const keys = { up: false, down: false, left: false, right: false };
    let balloonQueued = false;
    const bubbles = new Map();
    const EMOTE_TXT = ['', 'quack!', 'ribbit!', 'squeak!', 'honk!'];
    let roundBanner = '';
    let roundBannerT = 0;
    let localCastles = [];
    const latMs = latencyFlag();
    const keyDown = (e) => {
        const k = app.settings.keys;
        if (e.code === k.up || e.code === 'ArrowUp')
            keys.up = true;
        if (e.code === k.down || e.code === 'ArrowDown')
            keys.down = true;
        if (e.code === k.left || e.code === 'ArrowLeft')
            keys.left = true;
        if (e.code === k.right || e.code === 'ArrowRight')
            keys.right = true;
        if (e.code === k.balloon || e.code === 'KeyE') {
            if (!e.repeat)
                balloonQueued = true;
            e.preventDefault();
        }
        if (e.code === 'KeyM') {
            app.settings.muted = !app.settings.muted;
        }
        if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
            const id = Number(e.code.slice(5));
            net.send({ kind: 'emote', id });
            bubbles.set(myId, { id, until: performance.now() + 2000 });
            sfx.emote(id);
        }
    };
    const keyUp = (e) => {
        const k = app.settings.keys;
        if (e.code === k.up || e.code === 'ArrowUp')
            keys.up = false;
        if (e.code === k.down || e.code === 'ArrowDown')
            keys.down = false;
        if (e.code === k.left || e.code === 'ArrowLeft')
            keys.left = false;
        if (e.code === k.right || e.code === 'ArrowRight')
            keys.right = false;
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    const sendInput = (seq, dx, dy, balloon) => {
        const msg = { kind: 'input', seq, tick: 0, dx, dy, balloon };
        if (latMs > 0)
            setTimeout(() => net.send(msg), latMs);
        else
            net.send(msg);
    };
    const off = net.on((m) => {
        if (m.kind === 'round_start') {
            session.roundNo = m.roundNo;
            session.w = m.w;
            session.h = m.h;
            localCastles = m.castles.map((r) => [...r]);
            cv.width = m.w * TILE;
            cv.height = m.h * TILE;
            roundBanner = `ROUND ${m.roundNo} — 3 · 2 · 1 · SPLASH!`;
            roundBannerT = 2.2;
            announce(`ROUND ${m.roundNo}`);
            setShowdown(false);
        }
        else if (m.kind === 'snapshot') {
            session.players = m.players;
            session.balloons = m.balloons;
            session.splashes = m.splashes;
            session.powerups = m.powerups;
            session.tideRing = m.tideRing;
            const me = m.players.find((p) => p.id === myId);
            if (me) {
                if (pred.myId !== myId)
                    pred.reset(myId, me.x, me.y);
                pred.reconcile(me, me.speed);
            }
            for (const p of m.players) {
                if (p.id !== myId)
                    pred.pushRemote(p.id, p.x, p.y);
            }
            const alive = m.players.filter((p) => p.alive).length;
            setShowdown(alive === 2);
            renderHud(hudEl, m.players, myId, net.pingMs, session.roundNo, session.scores);
        }
        else if (m.kind === 'event') {
            const cb = app.settings.colorblind;
            if (m.ev === 'balloon_placed')
                sfx.drop();
            else if (m.ev === 'balloon_burst') {
                sfx.burst();
                burstParticles((m.tx ?? 0) * TILE + 8, (m.ty ?? 0) * TILE + 8, cb);
                addShake(2.5, app.settings.shake);
            }
            else if (m.ev === 'chain_burst') {
                sfx.chain(m.count ?? 2);
                announce(m.text ?? 'DOUBLE SPLASH!');
                addShake(4, app.settings.shake);
            }
            else if (m.ev === 'player_soaked') {
                sfx.soak();
                soakParticles((m.tx ?? 0) * TILE + 8, (m.ty ?? 0) * TILE + 8);
                addHitStop(2);
                addShake(3, app.settings.shake);
                const an = session.players.find((p) => p.id === m.a)?.nick ?? m.a ?? '?';
                const bn = m.b ? (session.players.find((p) => p.id === m.b)?.nick ?? m.b) : 'The tide';
                feed.push(`🌊 ${bn} soaked ${an}!`);
            }
            else if (m.ev === 'powerup_revealed') {
                // sparkle
            }
            else if (m.ev === 'powerup_collected') {
                sfx.pickup();
                if (m.a === myId)
                    feed.push('✨ Power-up!');
            }
            else if (m.ev === 'castle_washed') {
                if (localCastles[m.ty ?? 0])
                    localCastles[m.ty ?? 0][m.tx ?? 0] = 0;
            }
            else if (m.ev === 'balloon_kicked') {
                sfx.kick();
            }
            else if (m.ev === 'tide_advance') {
                sfx.tide();
                announce('🌊 RISING TIDE!');
            }
            else if (m.ev === 'revenge_lob') {
                sfx.drop();
            }
        }
        else if (m.kind === 'round_end') {
            for (const s of m.scores)
                session.scores[s.id] = s.roundsWon;
            const w = Array.isArray(m.winner) ? 'DRAW!' : m.winner ? `${session.players.find((p) => p.id === m.winner)?.nick ?? 'Someone'} takes the round!` : 'Round over';
            roundBanner = String(w);
            roundBannerT = 2.4;
        }
        else if (m.kind === 'match_end') {
            session.placements = m.placements;
            session.ratingDeltas = m.ratingDeltas ?? null;
            session.xp = m.xp;
            nav('#/results');
        }
        else if (m.kind === 'emote_broadcast') {
            bubbles.set(m.from, { id: m.id, until: performance.now() + 2000 });
            sfx.emote(m.id);
        }
        else if (m.kind === 'match_start') {
            session.theme = m.theme;
        }
    });
    let frame = 0;
    let last = performance.now();
    let raf = 0;
    const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        frame++;
        // input sample 60Hz, send 30Hz
        const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
        const inp = pred.pushLocal(dx, dy);
        if (frame % 2 === 0) {
            const b = balloonQueued;
            balloonQueued = false;
            sendInput(inp.seq, dx, dy, b);
            if (b)
                sfx.drop();
        }
        const { ox, oy } = updateFx(dt);
        // draw
        const W = session.w;
        const H = session.h;
        const th = themeColors(session.theme);
        g.save();
        g.translate(ox, oy);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const flooded = session.tideRing > 0 && (x < session.tideRing || y < session.tideRing || x >= W - session.tideRing || y >= H - session.tideRing);
                if (flooded) {
                    const shimmer = (Math.sin(now / 300 + x + y) + 1) / 2;
                    g.fillStyle = shimmer > 0.5 ? th.water : '#0096c7';
                    g.fillRect(x * TILE, y * TILE, TILE, TILE);
                    continue;
                }
                g.fillStyle = (x + y) % 2 === 0 ? th.a : th.b;
                g.fillRect(x * TILE, y * TILE, TILE, TILE);
                const t = localCastles[y]?.[x];
                const cx = x * TILE + TILE / 2;
                const cy = y * TILE + TILE / 2;
                if (t === 1)
                    drawBoulder(g, cx, cy);
                else if (t === 2)
                    drawCastle(g, cx, cy, session.theme);
            }
        }
        for (const pu of session.powerups)
            drawPowerup(g, pu.x * TILE + 8, pu.y * TILE + 8, pu.kind);
        const cb = app.settings.colorblind;
        for (const b of session.balloons)
            drawBalloon(g, b.x * TILE + 8, b.y * TILE + 8, b.fuse, CONFIG.FUSE_TICKS, cb);
        for (const s of session.splashes)
            drawSplash(g, s.x * TILE + 8, s.y * TILE + 8, s.ttl, cb);
        const wframe = Math.floor(frame / 14);
        for (const p of session.players) {
            let rx = p.x * TILE;
            let ry = p.y * TILE;
            if (p.id === myId) {
                rx = pred.px * TILE;
                ry = pred.py * TILE;
            }
            else {
                const rp = pred.remotePos(p.id);
                if (rp) {
                    rx = rp.x * TILE;
                    ry = rp.y * TILE;
                }
            }
            if (!p.alive && !p.isDuck)
                continue; // fully out (ranked)
            if (p.isDuck)
                drawDuck(g, rx, ry, wframe);
            else if (p.alive)
                drawAnimal(g, p.animal, p.hat, rx, ry, wframe, 1, false);
            // emote bubble
            const bb = bubbles.get(p.id);
            if (bb && bb.until > now) {
                g.fillStyle = '#fff';
                g.fillRect(rx + 4, ry - 22, 44, 12);
                g.fillStyle = '#000';
                g.font = '8px monospace';
                g.fillText(EMOTE_TXT[bb.id] ?? '!', rx + 6, ry - 13);
            }
        }
        drawParticles(g);
        g.restore();
        const a = currentAnnounce();
        const show = a || (roundBannerT > 0 ? roundBanner : '');
        roundBannerT -= dt;
        annEl.textContent = show;
    };
    raf = requestAnimationFrame(loop);
    return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
        off();
    };
}
function resetMatchIfNew() {
    if (!session.code)
        return;
}
void resetMatch;
