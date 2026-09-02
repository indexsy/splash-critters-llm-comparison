// Skippable <2min tutorial: scripted small arena vs one Easy bot, local sim.
import { CONFIG, createInitialState, simulateTick, TILE_EMPTY, TILE_CASTLE } from '@splash/shared';
import { drawAnimal, drawBalloon, drawCastle, drawBoulder, drawSplash, drawPowerup, TILE } from '../render/sprites.js';
import { sfx } from '../audio.js';
const STEPS = [
    'Move with WASD / arrows — reach the ★ star tile!',
    'Drop a balloon (SPACE) behind the sandcastle, then RUN away!',
    'Grab the power-up that pops out!',
    'Soak the dummy bot to finish! (balloons chain — overlap them)',
];
export function renderTutorial(root, nav) {
    root.innerHTML = '';
    const d = document.createElement('div');
    d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Menu</button><button id="skip" class="secondary">Skip tutorial</button><b>Tutorial</b></div>
      <div id="step" style="margin:8px 0;font-weight:bold"></div>
      <canvas id="cv" width="208" height="176" class="pixel" style="width:416px"></canvas>
      <div class="small">Step <span id="n">1</span>/4 · local practice, no matchmaking</div>
    </div>`;
    root.appendChild(d);
    const cv = d.querySelector('#cv');
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    // small local arena: handcraft 13x11 empty with a few castles
    const W = 13;
    const H = 11;
    const st = createInitialState({ mode: 'duel', mapSeed: 42, theme: 'backyard', roundsToWin: 1, revengeDucks: false }, [
        { id: 'you', nickname: 'You', animal: 'frog', hat: 'none' },
        { id: 'bot', nickname: 'Dummy', animal: 'duck', hat: 'none' },
    ]);
    // simplify: clear all castles, place 3 scripted ones near spawn
    for (let y = 0; y < st.height; y++)
        for (let x = 0; x < st.width; x++)
            if (st.tiles[y][x] === TILE_CASTLE) {
                st.tiles[y][x] = TILE_EMPTY;
                st.contents[y][x] = null;
            }
    st.tiles[1][3] = TILE_CASTLE;
    st.contents[1][3] = 'extra_balloon';
    st.tiles[2][2] = TILE_CASTLE;
    st.contents[2][2] = null;
    st.players[0].x = 1.5;
    st.players[0].y = 1.5;
    st.players[1].x = 10.5;
    st.players[1].y = 8.5;
    st.players[1].speed = 1.2;
    let step = 0;
    let done = false;
    const keys = { dx: 0, dy: 0, balloon: false };
    const star = { x: 5, y: 5 };
    let botWander = 0;
    const keyDown = (e) => {
        if (e.code === 'KeyW' || e.code === 'ArrowUp')
            keys.dy = -1;
        if (e.code === 'KeyS' || e.code === 'ArrowDown')
            keys.dy = 1;
        if (e.code === 'KeyA' || e.code === 'ArrowLeft')
            keys.dx = -1;
        if (e.code === 'KeyD' || e.code === 'ArrowRight')
            keys.dx = 1;
        if (e.code === 'Space' || e.code === 'KeyE') {
            keys.balloon = true;
            e.preventDefault();
        }
    };
    const keyUp = (e) => {
        if (['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'].includes(e.code))
            keys.dy = 0;
        if (['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].includes(e.code))
            keys.dx = 0;
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    const stepEl = d.querySelector('#step');
    const nEl = d.querySelector('#n');
    const setStep = (n) => {
        step = n;
        nEl.textContent = String(Math.min(n + 1, 4));
        stepEl.textContent = STEPS[Math.min(n, 3)];
        sfx.pickup();
    };
    setStep(0);
    function complete() {
        if (done)
            return;
        done = true;
        localStorage.setItem('sc_tutorial', '1');
        sfx.fanfare();
        // award XP server-side (best effort)
        fetch('/api/tutorial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: localStorage.getItem('sc_token') }) }).catch(() => { });
        stepEl.textContent = '🎉 Tutorial complete! +50 XP — heading to menu…';
        setTimeout(() => nav('#/menu'), 1400);
    }
    d.querySelector('#back').onclick = () => nav('#/menu');
    d.querySelector('#skip').onclick = () => {
        localStorage.setItem('sc_tutorial', '1');
        nav('#/menu');
    };
    let frame = 0;
    const iv = window.setInterval(() => {
        frame++;
        // dummy bot wander
        botWander++;
        const bot = st.players[1];
        if (bot.alive && botWander % 40 === 0) {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
            bot.wx = dx;
            bot.wy = dy;
        }
        const bwx = bot.wx ?? 0;
        const bwy = bot.wy ?? 0;
        const inputs = {
            you: { seq: frame, tick: st.tick, dx: keys.dx, dy: keys.dy, balloon: keys.balloon },
            bot: { seq: frame, tick: st.tick, dx: bwx, dy: bwy, balloon: false },
        };
        keys.balloon = false;
        const evs = simulateTick(st, inputs);
        for (const e of evs) {
            if (e.t === 'balloon_burst')
                sfx.burst();
            if (e.t === 'powerup_collected')
                sfx.pickup();
            if (e.t === 'player_soaked')
                sfx.soak();
        }
        const me = st.players[0];
        // step logic
        if (step === 0 && Math.floor(me.x) === star.x && Math.floor(me.y) === star.y)
            setStep(1);
        else if (step === 1 && st.balloons.length > 0)
            setStep(2);
        else if (step === 2 && (me.balloonCount > 1 || me.splashRange > 2 || me.speed > CONFIG.BASE_SPEED))
            setStep(3);
        else if (step === 3 && !st.players[1].alive)
            complete();
        // draw
        g.fillStyle = '#2e7d32';
        g.fillRect(0, 0, cv.width, cv.height);
        const ox = 0;
        const oy = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const t = st.tiles[y][x];
                const cx = ox + x * TILE + TILE / 2;
                const cy = oy + y * TILE + TILE / 2;
                if ((x + y) % 2 === 0) {
                    g.fillStyle = '#3fa34d';
                    g.fillRect(ox + x * TILE, oy + y * TILE, TILE, TILE);
                }
                if (t === 1)
                    drawBoulder(g, cx, cy);
                else if (t === 2)
                    drawCastle(g, cx, cy, 'backyard');
            }
        }
        // star
        g.fillStyle = '#ffd23f';
        g.font = '12px monospace';
        g.fillText('★', ox + star.x * TILE + 3, oy + star.y * TILE + 12);
        for (const pu of st.powerups)
            drawPowerup(g, ox + pu.tx * TILE + 8, oy + pu.ty * TILE + 8, pu.kind);
        for (const b of st.balloons)
            drawBalloon(g, ox + b.tx * TILE + 8, oy + b.ty * TILE + 8, b.fuse, CONFIG.FUSE_TICKS, false);
        for (const s of st.splashes)
            drawSplash(g, ox + s.tx * TILE + 8, oy + s.ty * TILE + 8, s.ttl, false);
        st.players.forEach((p, i) => {
            if (!p.alive)
                return;
            drawAnimal(g, p.animal, p.hat, ox + p.x * TILE, oy + p.y * TILE, Math.floor(frame / 12) + i, 1, false);
        });
    }, 1000 / 30);
    return () => {
        clearInterval(iv);
        window.removeEventListener('keydown', keyDown);
        window.removeEventListener('keyup', keyUp);
    };
}
