import {
  CONFIG,
  Dir,
  duckPosition,
  type AnimalId,
  type PublicPlayer,
  type SnapshotPlayer,
} from '@splash/shared';
import { app, mount } from '../app.js';
import { audio } from '../audio.js';
import { net } from '../net.js';
import { Interp, notePing, Predictor, serverNow } from '../prediction.js';
import { hudHtml } from '../render/hud.js';
import { burst, drawParticles, updateParticles, type Particle } from '../render/particles.js';
import {
  drawAnimal,
  drawBalloon,
  drawDuckie,
  drawPowerup,
  drawSplash,
  drawTile,
  slideOffset,
} from '../render/sprites.js';

const EMOTE = ['', 'RIBBIT!', 'QUACK!', 'SQUEEK!', 'HONK!'];

export function showGame() {
  audio.setMusic('game');
  audio.setShowdown(false);
  const root = mount(`
    <div class="shell" style="padding-top:12px">
      <div class="stage-wrap">
        <div>
          <div class="stage" id="stage">
            <canvas class="view" id="view" width="208" height="176"></canvas>
            <div class="announce" id="announce"></div>
            <div class="overlay" id="vs" style="display:none"><div class="box" id="vsbox"></div></div>
          </div>
          <div class="feed" id="feed"></div>
        </div>
        <div class="side" id="hud"></div>
      </div>
      <p class="sub" id="status" style="margin-top:8px"></p>
    </div>`);
  const canvas = root.querySelector('#view') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const predictor = new Predictor();
  const interp = new Interp();
  const particles: Particle[] = [];
  const bubbles = new Map<string, { text: string; until: number }>();
  const feed: string[] = [];
  let announce = '';
  let announceUntil = 0;
  let shake = 0;
  let hitStop = 0;
  let last = performance.now();
  let acc = 0;
  let balloonEdge = false;
  let roundKey = '';
  let raf = 0;
  const keys = new Set<string>();
  const names = new Map<string, string>();

  function players(): PublicPlayer[] {
    return app.match?.players ?? [];
  }

  function ensureRound() {
    const round = app.round;
    const match = app.match;
    if (!round || !match) return;
    const key = `${match.matchId}:${round.roundNo}`;
    if (key === roundKey) return;
    roundKey = key;
    canvas.width = round.width * 16;
    canvas.height = round.height * 16;
    const scale = Math.max(1, Math.min(4, Math.floor(Math.min((window.innerWidth - 300) / canvas.width, (window.innerHeight - 120) / canvas.height))));
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
    predictor.reset(round, players(), match.you, match.mode, match.roundsToWin);
    interp.clear();
    if (app.snap) {
      interp.push(app.snap);
      predictor.reconcile(app.snap);
    }
    announce = '';
    for (const p of players()) names.set(p.id, p.name);
  }

  function say(text: string, ms = 900) {
    announce = text;
    announceUntil = performance.now() + ms;
  }

  function dirFromKeys(): number {
    const b = app.settings.binds;
    if (b.up.some((k) => keys.has(k))) return Dir.Up;
    if (b.down.some((k) => keys.has(k))) return Dir.Down;
    if (b.left.some((k) => keys.has(k))) return Dir.Left;
    if (b.right.some((k) => keys.has(k))) return Dir.Right;
    return Dir.None;
  }

  function onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    if (app.settings.binds.balloon.includes(e.code)) {
      balloonEdge = true;
      e.preventDefault();
    }
    if (app.settings.binds.mute.includes(e.code)) audio.toggleMute();
    if (e.code === 'Digit1') net.send({ t: 'emote', id: 1 });
    if (e.code === 'Digit2') net.send({ t: 'emote', id: 2 });
    if (e.code === 'Digit3') net.send({ t: 'emote', id: 3 });
    if (e.code === 'Digit4') net.send({ t: 'emote', id: 4 });
  }
  function onUp(e: KeyboardEvent) { keys.delete(e.code); }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onUp);

  const off = net.on((msg) => {
    if (msg.t === 'ping') notePing(msg.serverTime, msg.rtt);
    if (msg.t === 'round_start') ensureRound();
    if (msg.t === 'snapshot') {
      interp.push(msg);
      predictor.reconcile(msg);
      const alive = msg.players.filter((p) => p.alive).length;
      audio.setShowdown(alive === 2 && msg.warmup === 0);
    }
    if (msg.t === 'event') {
      predictor.applyEvent(msg.event);
      const ev = msg.event;
      const col = app.settings.colorblind ? '#ffb000' : '#5ce1e6';
      if (ev.type === 'balloon_placed' && ev.ownerId === app.match?.you) audio.drop();
      if (ev.type === 'castle_washed') burst(particles, ev.x * 16 + 8, ev.y * 16 + 8, '#e6c07b', 6);
      if (ev.type === 'player_soaked') {
        audio.soak();
        hitStop = performance.now() + (names.get(ev.playerId) && players().find((p) => p.id === ev.playerId)?.animal === 'cat' ? 140 : 70);
        const who = names.get(ev.playerId) ?? 'Critter';
        const by = ev.by === 'tide' ? 'the tide' : names.get(ev.by) ?? 'a splash';
        feed.unshift(`${by} soaked ${who}`);
        feed.splice(4);
        say(`${who} soaked!`, 700);
      }
      if (ev.type === 'chain_burst') {
        audio.chain(ev.count);
        shake = app.settings.shake ? 6 : 0;
        say(ev.count === 2 ? 'DOUBLE SPLASH!' : 'TRIPLE SPLASH!+', 900);
        burst(particles, ev.x * 16 + 8, ev.y * 16 + 8, col, 16);
      }
      if (ev.type === 'powerup_collected') audio.pickup();
      if (ev.type === 'powerup_revealed') burst(particles, ev.x * 16 + 8, ev.y * 16 + 8, '#f6f1e6', 5);
      if (ev.type === 'tide_advance') {
        audio.tide();
        say('RISING TIDE!', 900);
      }
      if (ev.type === 'balloon_kicked') shake = app.settings.shake ? 2 : 0;
    }
    if (msg.t === 'emote') {
      bubbles.set(msg.playerId, { text: EMOTE[msg.id] ?? '!', until: performance.now() + 1400 });
      if (msg.playerId === app.match?.you) audio.emote(msg.id);
    }
    if (msg.t === 'round_end') {
      const name = msg.winnerId ? names.get(msg.winnerId) ?? 'Critter' : '';
      say(msg.draw ? 'DRAW ROUND' : `${name} takes the round`, 1600);
    }
  });

  function draw() {
    ensureRound();
    const round = app.round;
    const match = app.match;
    const vs = root.querySelector('#vs') as HTMLElement;
    if (!round || !predictor.state) {
      vs.style.display = 'flex';
      const box = root.querySelector('#vsbox')!;
      const list = players().map((p) => `<div>${p.name}${p.tier ? ` · ${p.tier}` : ''}${p.rating != null ? ` ${Math.round(p.rating)}` : ''}</div>`).join('');
      box.innerHTML = `<h2>${match?.ranked ? 'RANKED' : 'CASUAL'} ${match?.mode === 'ffa' ? 'FREE-FOR-ALL' : 'DUEL'}</h2><p class="sub">${list}</p>`;
      return;
    }
    vs.style.display = 'none';
    const st = predictor.state;
    const now = performance.now();
    if (now < hitStop) return;
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= 0.85;
    }
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < round.height; y++) {
      for (let x = 0; x < round.width; x++) {
        drawTile(ctx, round.theme, predictor.tiles[y * round.width + x] ?? 0, x, y, st.tick);
      }
    }
    const sample = interp.at(serverNow());
    const snap = sample?.b ?? app.snap;
    const remote = new Map<string, { x: number; y: number; facing: number }>();
    if (sample) {
      const u = sample.u;
      for (const pb of sample.b.players) {
        const pa = sample.a.players.find((p) => p.id === pb.id) ?? pb;
        remote.set(pb.id, { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u, facing: pb.facing });
      }
    }
    for (const u of snap?.powerups ?? []) drawPowerup(ctx, u.kind, u.x * 16, u.y * 16, st.tick);
    const balloons = [
      ...(snap?.balloons.filter((b) => b.ownerId !== match?.you) ?? []),
      ...st.balloons.filter((b) => b.ownerId === match?.you).map((b) => ({ ...b, slideDir: b.slideDir })),
    ];
    for (const b of balloons) {
      const off = b.sliding ? slideOffset(b.slideDir, b.slideAcc) : { x: 0, y: 0 };
      const fuseLeft = Math.max(0, b.fuse - (serverNow() - (snap?.serverTime ?? serverNow())) / (1000 / CONFIG.TICK_RATE));
      drawBalloon(ctx, b.x * 16 + off.x, b.y * 16 + off.y, fuseLeft, st.tick, b.sliding);
    }
    for (const s of snap?.splashes ?? []) {
      drawSplash(ctx, s.x * 16, s.y * 16, s.ttl, app.settings.colorblind);
    }
    const roster: SnapshotPlayer[] = snap?.players ?? [];
    for (const sp of roster) {
      const local = sp.id === match?.you ? st.players.find((p) => p.id === sp.id) : null;
      const pos = local
        ? { x: local.x, y: local.y, facing: local.facing }
        : remote.get(sp.id) ?? { x: sp.x, y: sp.y, facing: sp.facing };
      const alive = local ? local.alive : sp.alive;
      const ducking = local ? local.ducking : sp.ducking;
      const duckT = local ? local.duckT : sp.duckT;
      if (ducking && st) {
        const d = duckPosition(st, duckT);
        drawDuckie(ctx, d.x * 16, d.y * 16, st.tick);
      } else if (alive) {
        const frame = Math.floor(st.tick / 6);
        drawAnimal(ctx, sp.animal as AnimalId, pos.x * 16 - 8, pos.y * 16 - 10, frame, sp.hat, pos.facing);
      } else {
        ctx.globalAlpha = 0.35;
        drawAnimal(ctx, sp.animal as AnimalId, pos.x * 16 - 8, pos.y * 16 - 6, 0, sp.hat, pos.facing);
        ctx.globalAlpha = 1;
      }
      const bub = bubbles.get(sp.id);
      if (bub && bub.until > now) {
        ctx.fillStyle = '#f6f1e6';
        ctx.fillRect(pos.x * 16 - 18, pos.y * 16 - 28, 40, 12);
        ctx.fillStyle = '#1b1c2a';
        ctx.font = '6px monospace';
        ctx.fillText(bub.text, pos.x * 16 - 16, pos.y * 16 - 20);
      }
    }
    updateParticles(particles, 1 / 60);
    drawParticles(ctx, particles);
    ctx.restore();

    if (st.warmup > 0) {
      const n = st.warmup > 60 ? '3' : st.warmup > 30 ? '2' : st.warmup > 8 ? '1' : 'SPLASH!';
      if (announce !== n) {
        say(n, 400);
        if (n !== 'SPLASH!') audio.countdown();
        else audio.burst();
      }
    }
    const ann = root.querySelector('#announce')!;
    ann.textContent = now < announceUntil ? announce : '';
    const hudPlayers = (snap?.players ?? []).map((p) => {
      const local = p.id === match?.you ? st.players.find((x) => x.id === p.id) : null;
      return local
        ? { ...p, x: local.x, y: local.y, alive: local.alive, speed: local.speed, balloonCount: local.balloonCount, splashRange: local.splashRange, hasKick: local.hasKick, roundWins: local.roundWins }
        : p;
    });
    root.querySelector('#hud')!.innerHTML = hudHtml(hudPlayers, match?.you ?? '', match?.roundsToWin ?? 3);
    root.querySelector('#feed')!.innerHTML = feed.map((f) => `<div>${f}</div>`).join('');
    const left = Math.max(0, CONFIG.TIDE_START_SEC - Math.max(0, st.tick - CONFIG.WARMUP_TICKS) / CONFIG.TICK_RATE);
    const m = Math.floor(left / 60);
    const s = Math.floor(left % 60).toString().padStart(2, '0');
    (root.querySelector('#status') as HTMLElement).textContent = st.warmup > 0
      ? 'Get ready'
      : left > 0
        ? `Tide in ${m}:${s}`
        : 'The tide is rising';
  }

  const loop = (t: number) => {
    const dt = Math.min(50, t - last);
    last = t;
    if (app.round && predictor.state && !predictor.state.over && performance.now() >= hitStop) {
      acc += dt;
      const dir = dirFromKeys();
      while (acc >= 1000 / CONFIG.TICK_RATE) {
        acc -= 1000 / CONFIG.TICK_RATE;
        const inp = predictor.step(dir, balloonEdge);
        balloonEdge = false;
        if (inp) net.send({ t: 'input', seq: inp.seq, tick: inp.tick, dir: inp.dir, balloon: inp.balloon });
      }
    }
    draw();
    audio.tick();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onUp);
    off();
    audio.setShowdown(false);
  };
}
