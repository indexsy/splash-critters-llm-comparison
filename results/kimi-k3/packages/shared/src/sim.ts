import { CONFIG } from './config.js';
import { generateMap } from './map.js';
import {
  BalloonState,
  DIR_DOWN,
  DIR_LEFT,
  DIR_NONE,
  DIR_RIGHT,
  DIR_UP,
  DIR_VECTORS,
  Dir,
  ExposedPowerUp,
  GameState,
  InputFrame,
  PlayerState,
  SimOptions,
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_FLOOR,
  tileIndex,
} from './types.js';

const DT = 1 / CONFIG.TICK_RATE;

export function createGame(options: SimOptions): GameState {
  const dims = options.mode === 'duel' ? CONFIG.ARENA.DUEL : CONFIG.ARENA.FFA;
  const state: GameState = {
    tick: 0,
    phase: 'countdown',
    w: dims.w,
    h: dims.h,
    tiles: [],
    castleContents: new Map(),
    exposedPowerUps: [],
    players: [],
    balloons: [],
    splashes: [],
    tideRing: 0,
    roundNo: 1,
    nextBalloonId: 1,
    nextPowerUpId: 1,
    nextBurstGroup: 1,
    events: [],
    roundEndTick: 0,
    roundWinner: -1,
    matchWinner: -1,
    countdownUntilTick: 0,
    roundStartTick: 0,
    options,
    biggestChain: 0,
  };
  for (let i = 0; i < options.playerCount; i++) {
    state.players.push(freshPlayer(i));
  }
  setupRound(state, options.mapSeed);
  state.phase = 'countdown';
  state.countdownUntilTick = CONFIG.TICK_RATE * 3;
  return state;
}

function freshPlayer(slot: number): PlayerState {
  return {
    slot,
    x: 1.5,
    y: 1.5,
    alive: true,
    dir: DIR_NONE,
    speed: CONFIG.STATS.SPEED_BASE,
    balloonCount: CONFIG.STATS.BALLOON_BASE,
    splashRange: CONFIG.STATS.RANGE_BASE,
    hasBoots: false,
    activeBalloons: 0,
    roundWins: 0,
    soaks: 0,
    castlesWashed: 0,
    longestAliveTicks: 0,
    roundAliveTicks: 0,
    overlappedBalloonIds: [],
    isDuck: false,
    duckPos: 0,
    duckLastLobTick: -999999,
    emoteId: -1,
    emoteUntilTick: 0,
  };
}

function resetPlayerForRound(p: PlayerState): void {
  p.alive = true;
  p.dir = DIR_NONE;
  p.speed = CONFIG.STATS.SPEED_BASE;
  p.balloonCount = CONFIG.STATS.BALLOON_BASE;
  p.splashRange = CONFIG.STATS.RANGE_BASE;
  p.hasBoots = false;
  p.activeBalloons = 0;
  p.overlappedBalloonIds = [];
  p.isDuck = false;
  p.duckPos = 0;
  p.duckLastLobTick = -999999;
  p.roundAliveTicks = 0;
  p.emoteId = -1;
  p.emoteUntilTick = 0;
}

function setupRound(state: GameState, seed: number): void {
  const map = generateMap(state.w, state.h, state.options.mode, state.options.playerCount, seed);
  state.tiles = map.tiles;
  state.castleContents = map.castleContents;
  state.exposedPowerUps = [];
  state.balloons = [];
  state.splashes = [];
  state.tideRing = 0;
  state.roundStartTick = state.tick + CONFIG.TICK_RATE * 3;
  for (const p of state.players) {
    resetPlayerForRound(p);
    const spawn = map.spawns[p.slot % map.spawns.length]!;
    p.x = spawn.x + 0.5;
    p.y = spawn.y + 0.5;
  }
}

export function getTile(state: GameState, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return TILE_BOULDER;
  return state.tiles[tileIndex(state.w, x, y)] ?? TILE_BOULDER;
}

export function ringDepth(state: GameState, x: number, y: number): number {
  return Math.min(x, y, state.w - 1 - x, state.h - 1 - y);
}

export function isFlooded(state: GameState, x: number, y: number): boolean {
  return state.tideRing > 0 && ringDepth(state, x, y) < state.tideRing;
}

export function computeSplashTiles(state: GameState, tx: number, ty: number, range: number): number[] {
  const out: number[] = [tileIndex(state.w, tx, ty)];
  const dirs = [DIR_VECTORS[1], DIR_VECTORS[2], DIR_VECTORS[3], DIR_VECTORS[4]];
  for (const d of dirs) {
    for (let i = 1; i <= range; i++) {
      const x = tx + d.x * i;
      const y = ty + d.y * i;
      const t = getTile(state, x, y);
      if (t === TILE_BOULDER) break;
      out.push(tileIndex(state.w, x, y));
      if (t === TILE_CASTLE) break;
    }
  }
  return out;
}

export function balloonAt(state: GameState, tx: number, ty: number): BalloonState | undefined {
  for (const b of state.balloons) {
    if (b.tx === tx && b.ty === ty && !b.flying) return b;
  }
  return undefined;
}

export function circleOverlapsTile(px: number, py: number, r: number, tx: number, ty: number): boolean {
  const cx = Math.max(tx, Math.min(px, tx + 1));
  const cy = Math.max(ty, Math.min(py, ty + 1));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy < r * r;
}

function tileBlockedForPlayer(state: GameState, player: PlayerState, tx: number, ty: number): boolean {
  const t = getTile(state, tx, ty);
  if (t !== TILE_FLOOR) return true;
  for (const b of state.balloons) {
    if (b.flying) continue;
    if (b.tx === tx && b.ty === ty) {
      if (player.overlappedBalloonIds.includes(b.id)) continue;
      return true;
    }
  }
  return false;
}

function movePlayer(state: GameState, p: PlayerState, dir: Dir): void {
  if (dir === DIR_NONE) return;
  const v = DIR_VECTORS[dir as Exclude<Dir, 0>];
  const dist = p.speed * DT;
  const r = CONFIG.PLAYER_RADIUS;

  const tryAxis = (dx: number, dy: number): boolean => {
    const nx = p.x + dx;
    const ny = p.y + dy;
    const minTx = Math.floor(nx - r);
    const maxTx = Math.floor(nx + r);
    const minTy = Math.floor(ny - r);
    const maxTy = Math.floor(ny + r);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tileBlockedForPlayer(state, p, tx, ty) && circleOverlapsTile(nx, ny, r, tx, ty)) {
          return false;
        }
      }
    }
    p.x = nx;
    p.y = ny;
    return true;
  };

  if (v.x !== 0) {
    const moved = tryAxis(v.x * dist, 0);
    if (!moved) {
      const lane = Math.floor(p.y) + 0.5;
      const delta = lane - p.y;
      if (Math.abs(delta) > 0.02) {
        const dy = Math.sign(delta) * Math.min(dist, Math.abs(delta));
        tryAxis(0, dy);
      }
    }
  } else if (v.y !== 0) {
    const moved = tryAxis(0, v.y * dist);
    if (!moved) {
      const lane = Math.floor(p.x) + 0.5;
      const delta = lane - p.x;
      if (Math.abs(delta) > 0.02) {
        const dx = Math.sign(delta) * Math.min(dist, Math.abs(delta));
        tryAxis(dx, 0);
      }
    }
  }
}

function dropBalloon(state: GameState, p: PlayerState): void {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (getTile(state, tx, ty) !== TILE_FLOOR) return;
  if (balloonAt(state, tx, ty)) return;
  if (p.activeBalloons >= p.balloonCount) return;
  const b: BalloonState = {
    id: state.nextBalloonId++,
    ownerSlot: p.slot,
    tx,
    ty,
    fx: tx + 0.5,
    fy: ty + 0.5,
    slideDir: DIR_NONE,
    placedTick: state.tick,
    burstTick: state.tick + CONFIG.FUSE_TICKS,
    flying: false,
    flyDir: DIR_NONE,
    flyTilesLeft: 0,
  };
  state.balloons.push(b);
  p.activeBalloons++;
  if (!p.overlappedBalloonIds.includes(b.id)) p.overlappedBalloonIds.push(b.id);
  state.events.push({ type: 'balloon_dropped', slot: p.slot, tx, ty });
}

function tryKick(state: GameState, p: PlayerState): void {
  if (!CONFIG.ENABLE_KICK || !p.hasBoots || p.dir === DIR_NONE) return;
  const v = DIR_VECTORS[p.dir as Exclude<Dir, 0>];
  const ptx = Math.floor(p.x);
  const pty = Math.floor(p.y);
  const tx = ptx + v.x;
  const ty = pty + v.y;
  const b = balloonAt(state, tx, ty);
  if (!b || b.slideDir !== DIR_NONE || b.flying) return;
  const touching =
    Math.abs(p.x - (tx + 0.5)) < 1.0 - CONFIG.PLAYER_RADIUS * 0.2 &&
    Math.abs(p.y - (ty + 0.5)) < 1.0 - CONFIG.PLAYER_RADIUS * 0.2;
  if (!touching) return;
  b.slideDir = p.dir;
  state.events.push({ type: 'balloon_kicked', balloonId: b.id, dir: p.dir });
}

function slideBlocked(state: GameState, tx: number, ty: number): boolean {
  const t = getTile(state, tx, ty);
  if (t !== TILE_FLOOR) return true;
  if (balloonAt(state, tx, ty)) return true;
  for (const p of state.players) {
    if (p.alive && !p.isDuck && Math.floor(p.x) === tx && Math.floor(p.y) === ty) return true;
  }
  return false;
}

function moveBalloons(state: GameState): void {
  for (const b of state.balloons) {
    if (b.flying) {
      const v = DIR_VECTORS[b.flyDir as Exclude<Dir, 0>];
      let remaining = CONFIG.KICK_SPEED * DT;
      while (remaining > 1e-9 && b.flyTilesLeft > 0) {
        const along = (b.fx - (b.tx + 0.5)) * v.x + (b.fy - (b.ty + 0.5)) * v.y;
        const toNext = 1 - along;
        const mv = Math.min(remaining, toNext);
        b.fx += v.x * mv;
        b.fy += v.y * mv;
        remaining -= mv;
        if (mv >= toNext - 1e-9) {
          const ntx = b.tx + v.x;
          const nty = b.ty + v.y;
          const t = getTile(state, ntx, nty);
          if (t !== TILE_FLOOR || balloonAt(state, ntx, nty)) {
            b.flyTilesLeft = 0;
            break;
          }
          b.tx = ntx;
          b.ty = nty;
          b.fx = ntx + 0.5;
          b.fy = nty + 0.5;
          b.flyTilesLeft--;
        }
      }
      if (b.flyTilesLeft <= 0) {
        b.flying = false;
        b.fx = b.tx + 0.5;
        b.fy = b.ty + 0.5;
        b.placedTick = state.tick;
        b.burstTick = state.tick + CONFIG.FUSE_TICKS;
      }
      continue;
    }
    if (b.slideDir === DIR_NONE) continue;
    const v = DIR_VECTORS[b.slideDir as Exclude<Dir, 0>];
    let remaining = CONFIG.KICK_SPEED * DT;
    while (remaining > 1e-9) {
      const along = (b.fx - (b.tx + 0.5)) * v.x + (b.fy - (b.ty + 0.5)) * v.y;
      const toNext = 1 - along;
      const mv = Math.min(remaining, toNext);
      b.fx += v.x * mv;
      b.fy += v.y * mv;
      remaining -= mv;
      if (mv >= toNext - 1e-9) {
        const ntx = b.tx + v.x;
        const nty = b.ty + v.y;
        if (slideBlocked(state, ntx, nty)) {
          b.slideDir = DIR_NONE;
          b.fx = b.tx + 0.5;
          b.fy = b.ty + 0.5;
          break;
        }
        b.tx = ntx;
        b.ty = nty;
        b.fx = ntx + 0.5;
        b.fy = nty + 0.5;
      }
    }
  }
}

function washCastle(state: GameState, tx: number, ty: number, byTide: boolean, looter: number, defer?: ExposedPowerUp[], group = 0): void {
  const idx = tileIndex(state.w, tx, ty);
  if (state.tiles[idx] !== TILE_CASTLE) return;
  state.tiles[idx] = TILE_FLOOR;
  state.events.push({ type: 'castle_washed', tx, ty, byTide });
  if (looter >= 0 && looter < state.players.length) {
    const p = state.players[looter];
    if (p) p.castlesWashed++;
  }
  const content = state.castleContents.get(idx);
  state.castleContents.delete(idx);
  if (content && !byTide) {
    const pu: ExposedPowerUp = { id: state.nextPowerUpId++, tx, ty, kind: content, revealedTick: state.tick, revealGroup: group };
    if (defer) defer.push(pu);
    else state.exposedPowerUps.push(pu);
    state.events.push({ type: 'powerup_revealed', id: pu.id, tx, ty, kind: content });
  }
}

function soakPlayer(state: GameState, p: PlayerState, bySlot: number, byTide: boolean, chainDepth: number): void {
  if (!p.alive || p.isDuck) return;
  p.alive = false;
  p.longestAliveTicks = Math.max(p.longestAliveTicks, p.roundAliveTicks);
  state.events.push({ type: 'player_soaked', slot: p.slot, bySlot, byTide, chainDepth });
  if (bySlot >= 0 && bySlot !== p.slot) {
    const killer = state.players[bySlot];
    if (killer) killer.soaks++;
  }
  if (state.options.enableRevengeDucks && !byTide) {
    p.isDuck = true;
    p.duckPos = nearestRingPos(state, p.x, p.y);
    p.duckLastLobTick = state.tick;
  }
}

function ringPerimeter(state: GameState): number {
  return 2 * state.w + 2 * state.h - 4;
}

export function ringPosToTile(state: GameState, pos: number): { tx: number; ty: number; inward: Dir } {
  const w = state.w;
  const h = state.h;
  const P = ringPerimeter(state);
  let p = ((pos % P) + P) % P;
  if (p < w) return { tx: Math.floor(p), ty: 0, inward: DIR_DOWN };
  p -= w;
  if (p < h - 2) return { tx: w - 1, ty: 1 + Math.floor(p), inward: DIR_LEFT };
  p -= h - 2;
  if (p < w) return { tx: w - 1 - Math.floor(p), ty: h - 1, inward: DIR_UP };
  p -= w;
  return { tx: 0, ty: h - 2 - Math.floor(p), inward: DIR_RIGHT };
}

function nearestRingPos(state: GameState, x: number, y: number): number {
  const w = state.w;
  const h = state.h;
  const candidates: { pos: number; tx: number; ty: number }[] = [];
  for (let i = 0; i < w; i++) candidates.push({ pos: i, tx: i, ty: 0 });
  for (let i = 0; i < h - 2; i++) candidates.push({ pos: w + i, tx: w - 1, ty: 1 + i });
  for (let i = 0; i < w; i++) candidates.push({ pos: w + (h - 2) + i, tx: w - 1 - i, ty: h - 1 });
  for (let i = 0; i < h - 2; i++) candidates.push({ pos: w + (h - 2) + w + i, tx: 0, ty: h - 2 - i });
  let best = 0;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.tx + 0.5 - x) ** 2 + (c.ty + 0.5 - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.pos;
    }
  }
  return best;
}

function duckLob(state: GameState, p: PlayerState): void {
  if (state.tick - p.duckLastLobTick < CONFIG.DUCK_LOB_COOLDOWN_TICKS) return;
  const { tx, ty, inward } = ringPosToTile(state, p.duckPos);
  const v = DIR_VECTORS[inward as Exclude<Dir, 0>];
  const sx = tx + v.x;
  const sy = ty + v.y;
  if (getTile(state, sx, sy) !== TILE_FLOOR) return;
  if (balloonAt(state, sx, sy)) return;
  p.duckLastLobTick = state.tick;
  const b: BalloonState = {
    id: state.nextBalloonId++,
    ownerSlot: p.slot,
    tx: sx,
    ty: sy,
    fx: sx + 0.5,
    fy: sy + 0.5,
    slideDir: DIR_NONE,
    placedTick: state.tick,
    burstTick: state.tick + CONFIG.FUSE_TICKS + 60,
    flying: true,
    flyDir: inward,
    flyTilesLeft: CONFIG.DUCK_LOB_RANGE,
  };
  state.balloons.push(b);
  state.events.push({ type: 'revenge_lob', slot: p.slot, tx: sx, ty: sy });
}

function burstBalloons(state: GameState, initial: BalloonState[]): void {
  const queue: { b: BalloonState; depth: number }[] = initial.map((b) => ({ b, depth: 0 }));
  const seen = new Set<number>();
  const deferredReveals: ExposedPowerUp[] = [];
  const group = state.nextBurstGroup++;
  let maxChain = 0;
  while (queue.length > 0) {
    const { b, depth } = queue.shift()!;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const idx = state.balloons.indexOf(b);
    if (idx < 0) continue;
    state.balloons.splice(idx, 1);
    const owner = state.players[b.ownerSlot];
    if (owner && !b.flying) owner.activeBalloons = Math.max(0, owner.activeBalloons - 1);
    const range = owner ? owner.splashRange : CONFIG.STATS.RANGE_BASE;
    state.events.push({ type: 'balloon_burst', balloonId: b.id, tx: b.tx, ty: b.ty, chainDepth: depth });
    if (depth > 0) {
      maxChain = Math.max(maxChain, depth + 1);
      state.events.push({ type: 'chain_burst', depth: depth + 1, tx: b.tx, ty: b.ty });
    }
    const tiles = computeSplashTiles(state, b.tx, b.ty, range);
    state.splashes.push({ tiles, untilTick: state.tick + CONFIG.SPLASH_TICKS, ownerSlot: b.ownerSlot, depth, group });
    for (const tIdx of tiles) {
      const tx = tIdx % state.w;
      const ty = Math.floor(tIdx / state.w);
      if (state.tiles[tIdx] === TILE_CASTLE) {
        washCastle(state, tx, ty, false, b.ownerSlot, deferredReveals, group);
      }
      for (let i = state.exposedPowerUps.length - 1; i >= 0; i--) {
        const pu = state.exposedPowerUps[i]!;
        if (pu.tx === tx && pu.ty === ty && pu.revealGroup !== group) {
          state.exposedPowerUps.splice(i, 1);
          state.events.push({ type: 'powerup_destroyed', id: pu.id, tx, ty });
        }
      }
      for (const p of state.players) {
        if (p.alive && !p.isDuck && circleOverlapsTile(p.x, p.y, CONFIG.PLAYER_RADIUS, tx, ty)) {
          soakPlayer(state, p, b.ownerSlot, false, depth);
        }
      }
      for (const other of state.balloons) {
        if (!seen.has(other.id) && !other.flying && other.tx === tx && other.ty === ty) {
          queue.push({ b: other, depth: depth + 1 });
        }
      }
    }
  }
  state.exposedPowerUps.push(...deferredReveals);
  if (maxChain > state.biggestChain) state.biggestChain = maxChain;
}

function applySplashLingering(state: GameState): void {
  for (let i = state.splashes.length - 1; i >= 0; i--) {
    const s = state.splashes[i]!;
    if (state.tick >= s.untilTick) {
      state.splashes.splice(i, 1);
      continue;
    }
    for (const tIdx of s.tiles) {
      const tx = tIdx % state.w;
      const ty = Math.floor(tIdx / state.w);
      for (const p of state.players) {
        if (p.alive && !p.isDuck && circleOverlapsTile(p.x, p.y, CONFIG.PLAYER_RADIUS, tx, ty)) {
          soakPlayer(state, p, s.ownerSlot, false, s.depth);
        }
      }
      for (let j = state.exposedPowerUps.length - 1; j >= 0; j--) {
        const pu = state.exposedPowerUps[j]!;
        if (pu.tx === tx && pu.ty === ty && pu.revealGroup !== s.group) {
          state.exposedPowerUps.splice(j, 1);
          state.events.push({ type: 'powerup_destroyed', id: pu.id, tx, ty });
        }
      }
    }
  }
}

function collectPowerUps(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive || p.isDuck) continue;
    const ptx = Math.floor(p.x);
    const pty = Math.floor(p.y);
    for (let i = state.exposedPowerUps.length - 1; i >= 0; i--) {
      const pu = state.exposedPowerUps[i]!;
      if (pu.tx !== ptx || pu.ty !== pty) continue;
      state.exposedPowerUps.splice(i, 1);
      switch (pu.kind) {
        case 'balloon':
          p.balloonCount = Math.min(CONFIG.STATS.BALLOON_CAP, p.balloonCount + 1);
          break;
        case 'range':
          p.splashRange = Math.min(CONFIG.STATS.RANGE_CAP, p.splashRange + 1);
          break;
        case 'speed':
          p.speed = Math.min(CONFIG.STATS.SPEED_CAP, p.speed + CONFIG.STATS.SPEED_PER_FLIPPERS);
          break;
        case 'boots':
          p.hasBoots = true;
          break;
      }
      state.events.push({ type: 'powerup_collected', slot: p.slot, kind: pu.kind });
    }
  }
}

function applyTide(state: GameState): void {
  if (state.tideRing >= Math.ceil(Math.min(state.w, state.h) / 2)) return;
  state.tideRing++;
  state.events.push({ type: 'tide_advance', ring: state.tideRing });
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      if (ringDepth(state, x, y) >= state.tideRing) continue;
      const idx = tileIndex(state.w, x, y);
      if (state.tiles[idx] === TILE_CASTLE) {
        washCastle(state, x, y, true, -1);
      }
      for (let i = state.exposedPowerUps.length - 1; i >= 0; i--) {
        const pu = state.exposedPowerUps[i]!;
        if (pu.tx === x && pu.ty === y) {
          state.exposedPowerUps.splice(i, 1);
          state.events.push({ type: 'powerup_destroyed', id: pu.id, tx: x, ty: y });
        }
      }
    }
  }
  const due: BalloonState[] = [];
  for (const b of state.balloons) {
    if (!b.flying && ringDepth(state, b.tx, b.ty) < state.tideRing) due.push(b);
  }
  if (due.length > 0) burstBalloons(state, due);
  for (const p of state.players) {
    if (p.alive && !p.isDuck && isFlooded(state, Math.floor(p.x), Math.floor(p.y))) {
      soakPlayer(state, p, -1, true, 0);
    }
  }
}

function checkRoundEnd(state: GameState): void {
  if (state.phase !== 'playing') return;
  const alive = state.players.filter((p) => p.alive && !p.isDuck);
  if (alive.length > 1) return;
  let winner = -1;
  let draw = false;
  if (alive.length === 1) {
    winner = alive[0]!.slot;
  } else {
    draw = true;
  }
  if (!draw && winner >= 0) {
    const wp = state.players[winner];
    if (wp) wp.roundWins++;
  }
  state.roundWinner = winner;
  state.events.push({ type: 'round_end', winnerSlot: winner, draw });
  const target = state.options.roundsToWin;
  const matchWinner = state.players.find((p) => p.roundWins >= target);
  if (matchWinner) {
    state.matchWinner = matchWinner.slot;
    state.phase = 'matchEnd';
    state.events.push({ type: 'match_end', winnerSlot: matchWinner.slot });
    for (const p of state.players) {
      p.longestAliveTicks = Math.max(p.longestAliveTicks, p.roundAliveTicks);
    }
  } else {
    state.phase = 'roundEnd';
    state.roundEndTick = state.tick + CONFIG.TICK_RATE * 3;
  }
}

function advanceRound(state: GameState): void {
  state.roundNo++;
  const seed = (state.options.mapSeed + state.roundNo * 7919) >>> 0;
  setupRound(state, seed);
  state.phase = 'countdown';
  state.countdownUntilTick = state.tick + CONFIG.TICK_RATE * 3;
}

export function setEmote(state: GameState, slot: number, emoteId: number): void {
  const p = state.players[slot];
  if (!p) return;
  p.emoteId = emoteId;
  p.emoteUntilTick = state.tick + CONFIG.TICK_RATE * 2;
  state.events.push({ type: 'emote', slot, emoteId });
}

export function simulateTick(state: GameState, inputs: Map<number, InputFrame>): void {
  state.events = [];
  if (state.phase === 'countdown') {
    if (state.tick >= state.countdownUntilTick) state.phase = 'playing';
    state.tick++;
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.tick >= state.roundEndTick) advanceRound(state);
    state.tick++;
    return;
  }
  if (state.phase === 'matchEnd') {
    state.tick++;
    return;
  }

  for (const p of state.players) {
    const input = inputs.get(p.slot);
    if (!input) continue;
    if (p.isDuck) {
      const P = ringPerimeter(state);
      if (input.dir === DIR_LEFT || input.dir === DIR_UP) {
        p.duckPos = (p.duckPos - CONFIG.DUCK_SPEED * DT + P) % P;
      } else if (input.dir === DIR_RIGHT || input.dir === DIR_DOWN) {
        p.duckPos = (p.duckPos + CONFIG.DUCK_SPEED * DT) % P;
      }
      if (input.balloon) duckLob(state, p);
      continue;
    }
    if (!p.alive) continue;
    p.dir = input.dir;
    movePlayer(state, p, input.dir);
    if (input.dir !== DIR_NONE) tryKick(state, p);
    if (input.balloon) dropBalloon(state, p);
    p.overlappedBalloonIds = p.overlappedBalloonIds.filter((id) => {
      const b = state.balloons.find((bb) => bb.id === id);
      if (!b || b.flying) return false;
      return circleOverlapsTile(p.x, p.y, CONFIG.PLAYER_RADIUS + 0.08, b.tx, b.ty);
    });
  }

  moveBalloons(state);

  const burstNow: BalloonState[] = [];
  for (const b of state.balloons) {
    if (b.flying) continue;
    if (b.burstTick <= state.tick) {
      burstNow.push(b);
      continue;
    }
    const bIdx = tileIndex(state.w, b.tx, b.ty);
    for (const s of state.splashes) {
      if (s.tiles.includes(bIdx)) {
        burstNow.push(b);
        break;
      }
    }
  }
  if (burstNow.length > 0) burstBalloons(state, burstNow);

  applySplashLingering(state);
  collectPowerUps(state);

  const roundTick = state.tick - state.roundStartTick;
  if (roundTick >= CONFIG.TIDE_START_TICKS && (roundTick - CONFIG.TIDE_START_TICKS) % CONFIG.TIDE_INTERVAL_TICKS === 0) {
    applyTide(state);
  }

  for (const p of state.players) {
    if (p.alive && !p.isDuck) p.roundAliveTicks++;
  }

  checkRoundEnd(state);
  state.tick++;
}
