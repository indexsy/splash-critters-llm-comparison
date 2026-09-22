import {
  CONFIG,
  DIRS,
  borderLength,
  tileRing,
  type Dir,
  type PlayerCard,
  type ServerMsg,
  type Snapshot,
} from '@splash/shared';
import type { App } from '../app.js';
import { Predictor } from '../prediction.js';
import { drawText, textWidth } from '../render/font.js';
import { burst, updateParticles, type Particle } from '../render/particles.js';
import { hudCards } from '../render/hud.js';
import { THEMES, animalSprite, balloonSprite, duckSprite, powerSprite, tileSprite, type ThemeName } from '../render/sprites.js';

type RoundStart = Extract<ServerMsg, { t: 'round_start' }>;

export function mountGame(root: HTMLElement, app: App): () => void {
  const pending = app.session.matchStart;
  const meId = app.profile?.id;
  if (!pending || !meId) {
    root.innerHTML = `<div class="shell"><div class="panel">Waiting for a match…</div></div>`;
    return () => {};
  }
  const start = pending;
  root.innerHTML = `
    <div class="shell">
      <div class="stage"><canvas class="play" width="256" height="224"></canvas><div class="scan"></div><div class="countdown"></div><div class="announce"></div><div class="killfeed"></div></div>
      <div class="hud"></div>
      <div class="tutorial-hint panel" style="margin-top:10px;display:none"></div>
    </div>`;
  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const countdownEl = root.querySelector('.countdown') as HTMLElement;
  const announceEl = root.querySelector('.announce') as HTMLElement;
  const feedEl = root.querySelector('.killfeed') as HTMLElement;
  const hudEl = root.querySelector('.hud') as HTMLElement;
  const hintEl = root.querySelector('.tutorial-hint') as HTMLElement;
  const predictor = new Predictor(meId);
  const snaps: { snap: Snapshot; at: number }[] = [];
  let round: RoundStart | null = null;
  let latest: Snapshot | null = null;
  let offset = 0;
  const particles: Particle[] = [];
  let shake = 0;
  let started = false;
  let hint = 'Move with WASD or arrows.';
  let moved = false;
  let dropped = false;
  let grabbed = false;
  let chained = false;
  const bubbles: { id: string; emote: number; until: number }[] = [];
  const feed: string[] = [];
  const names = new Map(start.players.map((p) => [p.id, `${p.name}#${p.tag}`]));
  const cards = new Map(start.players.map((p) => [p.id, p]));

  function fit() {
    const scale = Math.max(1, Math.min(4, Math.floor(Math.min((window.innerWidth - 40) / 256, 520 / 224))));
    canvas.style.width = `${256 * scale}px`;
    canvas.style.height = `${224 * scale}px`;
  }
  fit();
  window.addEventListener('resize', fit);

  const held = new Set<string>();
  const onDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    held.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const emote = app.settings.keys.emotes.indexOf(e.code);
    if (emote >= 0) app.net.send({ t: 'emote', id: emote + 1 });
  };
  const onUp = (e: KeyboardEvent) => held.delete(e.code);
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  function readDir(): Dir {
    const k = app.settings.keys;
    const up = held.has(k.up) || held.has('ArrowUp');
    const down = held.has(k.down) || held.has('ArrowDown');
    const left = held.has(k.left) || held.has('ArrowLeft');
    const right = held.has(k.right) || held.has('ArrowRight');
    if (up && !down) return 'up';
    if (down && !up) return 'down';
    if (left && !right) return 'left';
    if (right && !left) return 'right';
    return 'none';
  }

  function nameOf(id: string): string {
    return names.get(id) ?? id;
  }

  const off = app.net.on((msg) => {
    if (msg.t === 'ping') offset = msg.serverTime - Date.now() + msg.rtt / 2;
    if (msg.t === 'round_start') {
      round = msg;
      latest = null;
      snaps.length = 0;
      predictor.seed(msg, start.players);
      started = false;
      countdownEl.textContent = '3';
    }
    if (msg.t === 'snapshot') {
      latest = msg.snap;
      snaps.push({ snap: msg.snap, at: msg.snap.serverTime });
      if (snaps.length > 30) snaps.shift();
      predictor.onSnapshot(msg.snap);
      for (const p of msg.snap.players) {
        names.set(p.id, p.name);
        const card = cards.get(p.id);
        if (card) {
          card.animal = p.animal;
          card.hat = p.hat;
        }
      }
    }
    if (msg.t === 'event') {
      const e = msg.event;
      if (e.t === 'balloon_placed' && e.playerId === app.profile?.id) {
        dropped = true;
        app.audio.play('drop');
      }
      if (e.t === 'castle_washed') burst(particles, e.x + 0.5, e.y + 0.5, '#e2b85a', 8);
      if (e.t === 'powerup_collected') {
        app.audio.play('pickup');
        if (e.playerId === app.profile?.id) grabbed = true;
      }
      if (e.t === 'player_soaked') {
        app.audio.play('soak');
        shake = app.settings.shake ? 4 : 0;
        const dramatic = cards.get(e.playerId)?.animal === 'cat';
        burst(particles, e.x + 0.5, e.y + 0.5, dramatic ? '#73eff7' : '#41a6f6', dramatic ? 22 : 12);
        const by = e.by === 'tide' ? 'The tide took' : e.by === e.playerId ? `${nameOf(e.playerId)} soaked themselves` : `${nameOf(e.by)} soaked`;
        const line = e.by === e.playerId ? by : e.by === 'tide' ? `${by} ${nameOf(e.playerId)}` : `${by} ${nameOf(e.playerId)}`;
        feed.unshift(line);
        if (feed.length > 4) feed.pop();
        if (e.playerId !== app.profile?.id && start.kind === 'tutorial') hint = 'You soaked them. Nice.';
      }
      if (e.t === 'chain_burst') {
        chained = true;
        app.audio.play('chain', e.count);
        announceEl.textContent = e.count >= 3 ? 'TRIPLE SPLASH!' : 'DOUBLE SPLASH!';
        setTimeout(() => {
          if (announceEl.textContent?.includes('SPLASH')) announceEl.textContent = '';
        }, 900);
        shake = app.settings.shake ? 3 : 0;
      }
      if (e.t === 'tide_advance') app.audio.play('tide');
      if (e.t === 'balloon_kicked') app.audio.play('drop');
    }
    if (msg.t === 'emote') bubbles.push({ id: msg.playerId, emote: msg.id, until: performance.now() + 900 });
    if (msg.t === 'round_end') {
      countdownEl.textContent = msg.draw ? 'DRAW' : `${nameOf(msg.winnerId ?? '')} WINS THE ROUND`;
    }
  });

  if (start.kind === 'tutorial') hintEl.style.display = 'block';

  let acc = 0;
  let last = performance.now();
  let raf = 0;
  const loop = (now: number) => {
    const dt = Math.min(50, now - last);
    last = now;
    const goAt = round?.goAt ?? Infinity;
    const serverNow = Date.now() + offset;
    if (round && serverNow >= goAt) {
      if (!started) {
        started = true;
        countdownEl.textContent = 'SPLASH!';
        setTimeout(() => {
          if (countdownEl.textContent === 'SPLASH!') countdownEl.textContent = '';
        }, 400);
      }
      acc += dt;
      const dir = readDir();
      if (dir !== 'none') moved = true;
      const balloon = held.has(app.settings.keys.balloon) || held.has(app.settings.keys.balloon2);
      while (acc >= 1000 / CONFIG.TICK_RATE) {
        acc -= 1000 / CONFIG.TICK_RATE;
        const step = predictor.push(dir, balloon);
        if (step) app.net.send({ t: 'input', seq: step.seq, tick: step.tick, dir, balloonPressed: balloon });
      }
    } else if (round) {
      const left = goAt - serverNow;
      countdownEl.textContent = left > 2000 ? '3' : left > 1000 ? '2' : left > 0 ? '1' : 'SPLASH!';
    }
    if (shake > 0) shake *= 0.86;
    updateParticles(particles, dt);
    render(now);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  function theme(): ThemeName {
    return (round?.theme ?? start.theme) as ThemeName;
  }

  function render(now: number) {
    const pal = THEMES[theme()] ?? THEMES.backyard;
    const w = round?.width ?? 13;
    const h = round?.height ?? 11;
    const tile = Math.floor(Math.min(240 / w, 200 / h));
    const ox = Math.floor((256 - w * tile) / 2);
    const oy = Math.floor((214 - h * tile) / 2) + 8;
    ctx.save();
    ctx.fillStyle = '#0e1620';
    ctx.fillRect(0, 0, 256, 224);
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const tiles = round?.castleGrid ?? [];
    const castles = new Set(latest?.castles ?? []);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let kind: 'floor' | 'floor2' | 'boulder' | 'castle' = (x + y) % 2 ? 'floor2' : 'floor';
        const base = tiles[i];
        if (base === 1) kind = 'boulder';
        else if (latest ? castles.has(i) : base === 2) kind = 'castle';
        const flooded = (latest?.tide ?? 0) > 0 && tileRing(x, y, w, h) <= (latest?.tide ?? 0);
        if (flooded && kind !== 'boulder') {
          ctx.fillStyle = (Math.floor(now / 180) + x + y) % 2 ? '#1f6fbf' : '#2f8fe0';
          ctx.fillRect(ox + x * tile, oy + y * tile, tile, tile);
          ctx.fillStyle = 'rgba(255,255,255,.25)';
          ctx.fillRect(ox + x * tile, oy + y * tile + ((now / 30 + x * 3) % tile), tile, 1);
        } else {
          ctx.drawImage(tileSprite(theme(), kind), ox + x * tile, oy + y * tile, tile, tile);
        }
      }
    }
    for (const pu of latest?.powerups ?? []) {
      ctx.drawImage(powerSprite(pu.kind), ox + pu.x * tile, oy + pu.y * tile, tile, tile);
    }
    const estTick = latest ? latest.tick + (Date.now() + offset - latest.serverTime) / (1000 / CONFIG.TICK_RATE) : 0;
    for (const b of latest?.balloons ?? []) {
      const fuseLeft = Math.max(0, b.fuse - (estTick - (latest?.tick ?? estTick)));
      const wob = Math.sin(now / 80 + b.id) * (1 - fuseLeft / CONFIG.FUSE_TICKS);
      const d = b.slideDir ? DIRS[b.slideDir] : { x: 0, y: 0 };
      const px = ox + (b.tx + d.x * b.slideProg) * tile;
      const py = oy + (b.ty + d.y * b.slideProg) * tile + wob;
      ctx.drawImage(balloonSprite(Math.floor(now / 120) % 2), px, py, tile, tile);
    }
    const extra = predictor.state?.balloons.filter(
      (b) => b.ownerId === app.profile?.id && !(latest?.balloons ?? []).some((s) => s.id === b.id),
    );
    for (const b of extra ?? []) {
      ctx.drawImage(balloonSprite(0), ox + b.tx * tile, oy + b.ty * tile, tile, tile);
    }
    const splashColor = app.settings.colorblind ? '#ffcd75' : '#73eff7';
    for (const s of latest?.splashes ?? []) {
      ctx.fillStyle = splashColor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(ox + s.x * tile + 2, oy + s.y * tile + 2, tile - 4, tile - 4);
      ctx.globalAlpha = 1;
    }
    const renderTime = Date.now() + offset - CONFIG.INTERP_DELAY_MS;
    for (const card of start.players) {
      const remote = samplePlayer(card.id, renderTime);
      const local = card.id === app.profile?.id ? predictor.local() : null;
      const pos = local?.alive ? local : remote;
      if (!pos) continue;
      if (!pos.alive && pos.ducking && round) {
        const path = borderPoint(round.width, round.height, pos.duckPos);
        ctx.drawImage(duckSprite(), ox + path.x * tile, oy + path.y * tile, tile, tile);
        continue;
      }
      if (!pos.alive) continue;
      const frame = Math.floor(now / 160) % 2;
      const spr = animalSprite(pos.animal || card.animal, frame, pos.hat || card.hat);
      ctx.drawImage(spr, ox + pos.x * tile - tile * 0.15, oy + pos.y * tile - tile * 0.55, tile * 1.1, tile * 1.1);
      const bubble = bubbles.find((b) => b.id === card.id && b.until > now);
      if (bubble) {
        drawText(ctx, ['QUACK', 'RIBBIT', 'SQUEAK', 'HONK'][bubble.emote - 1] ?? '!', ox + pos.x * tile - 8, oy + pos.y * tile - tile - 8, '#ffcd75', 1);
      }
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(ox + p.x * tile, oy + p.y * tile, p.size + 1, p.size + 1);
      ctx.globalAlpha = 1;
    }
    const timeLeft = latest ? Math.max(0, latest.timeLeft - (estTick - latest.tick)) : CONFIG.ROUND_TIME_TICKS;
    const secs = Math.ceil(timeLeft / CONFIG.TICK_RATE);
    const clock = latest && latest.tide > 0 ? 'TIDE' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    drawText(ctx, clock, 8, 4, latest && latest.tide > 0 ? '#ef7d57' : '#f4f4f4', 2);
    const roundLabel = `R${latest?.round ?? round?.roundNo ?? 1}`;
    drawText(ctx, roundLabel, 256 - textWidth(roundLabel, 1) - 6, 6, '#94b0c2', 1);
    ctx.restore();
    void pal;
    paintHud();
    feedEl.innerHTML = feed.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
    if (start.kind === 'tutorial') {
      if (!moved) hint = 'Move with WASD or arrows.';
      else if (!dropped) hint = 'Press Space or E to drop a balloon. Dodge the splash.';
      else if (!grabbed) hint = 'Wash a sandcastle and grab the power-up.';
      else if (!chained) hint = 'Drop two balloons so one splash pops the other.';
      else hint = 'Soak the easy critter. Last one dry wins.';
      hintEl.textContent = hint;
    }
    const alive = (latest?.players ?? []).filter((p) => p.alive).length;
    app.audio.setShowdown(alive === 2 && started);
  }

  function samplePlayer(id: string, renderTime: number) {
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i]!.at <= renderTime && snaps[i + 1]!.at >= renderTime) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const pa = (a ?? b)?.snap.players.find((p) => p.id === id);
    const pb = (b ?? a)?.snap.players.find((p) => p.id === id);
    if (!pa && !pb) return null;
    const from = pa ?? pb!;
    const to = pb ?? pa!;
    const span = (b?.at ?? 0) - (a?.at ?? 0);
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - (a?.at ?? renderTime)) / span)) : 1;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      alive: to.alive,
      ducking: to.ducking,
      duckPos: to.duckPos,
      animal: to.animal,
      hat: to.hat,
      dir: to.dir,
    };
  }

  function paintHud() {
    const snapPlayers = latest?.players ?? [];
    hudEl.innerHTML = hudCards(start.players, snapPlayers, app.profile?.id ?? '', start.roundsToWin, start.ranked);
  }

  paintHud();
  countdownEl.textContent = 'GET READY';

  return () => {
    cancelAnimationFrame(raf);
    off();
    window.removeEventListener('resize', fit);
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    app.audio.setShowdown(false);
  };
}

function borderPoint(w: number, h: number, pos: number): { x: number; y: number } {
  const len = borderLength(w, h);
  const i = Math.floor(pos) % len;
  let n = i;
  if (n < w - 1) return { x: n, y: 0 };
  n -= w - 1;
  if (n < h - 1) return { x: w - 1, y: n };
  n -= h - 1;
  if (n < w - 1) return { x: w - 1 - n, y: h - 1 };
  n -= w - 1;
  return { x: 0, y: h - 1 - n };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

void DIRS;
export type { PlayerCard };
