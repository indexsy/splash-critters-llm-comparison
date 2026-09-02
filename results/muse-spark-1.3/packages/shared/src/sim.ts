import { CONFIG } from './config.js';
import { generateMap } from './map.js';
import {
  TILE_BOULDER,
  TILE_CASTLE,
  TILE_EMPTY,
  type BalloonState,
  type GameEvent,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type RoundConfig,
} from './types.js';

export function createInitialState(
  cfg: RoundConfig,
  playerMetas: { id: string; nickname: string; animal: PlayerState['animal']; hat: PlayerState['hat'] }[],
): GameState {
  const gen = generateMap(cfg.mode, cfg.mapSeed);
  const players: PlayerState[] = playerMetas.map((m, i) => {
    const sp = gen.spawns[i % gen.spawns.length];
    return {
      id: m.id,
      slot: i,
      x: sp.x + 0.5,
      y: sp.y + 0.5,
      dirX: 0,
      dirY: 1,
      alive: true,
      isDuck: false,
      duckCooldown: 0,
      speed: CONFIG.BASE_SPEED,
      balloonCount: CONFIG.BASE_BALLOONS,
      splashRange: CONFIG.BASE_RANGE,
      hasBoots: false,
      activeBalloons: 0,
      roundsWon: 0,
      soaks: 0,
      castlesWashed: 0,
      animal: m.animal,
      hat: m.hat,
      nickname: m.nickname,
      disconnected: false,
      lastMoveTick: 0,
    };
  });
  return {
    tick: 0,
    width: gen.width,
    height: gen.height,
    tiles: gen.tiles,
    contents: gen.contents,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    tideTick: 0,
    roundOver: false,
    roundWinner: null,
    nextBalloonId: 1,
    seed: cfg.mapSeed,
    revengeDucks: cfg.revengeDucks,
  };
}

function tileAt(s: GameState, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= s.width || ty >= s.height) return TILE_BOULDER;
  return s.tiles[ty][tx];
}

function balloonAt(s: GameState, tx: number, ty: number): BalloonState | undefined {
  return s.balloons.find((b) => b.tx === tx && b.ty === ty);
}

function isFlooded(s: GameState, tx: number, ty: number): boolean {
  const r = s.tideRing;
  if (r <= 0) return false;
  return tx < r || ty < r || tx >= s.width - r || ty >= s.height - r;
}

function passSet(b: BalloonState): Set<string> {
  if (b.passThrough instanceof Set) return b.passThrough;
  return new Set(b.passThrough as string[]);
}

function solidFor(s: GameState, tx: number, ty: number, pid: string): boolean {
  const t = tileAt(s, tx, ty);
  if (t === TILE_BOULDER || t === TILE_CASTLE) return true;
  const b = balloonAt(s, tx, ty);
  if (b) {
    const ps = passSet(b);
    if (ps.has(pid)) return false;
    return true;
  }
  return false;
}

function tryMovePlayer(s: GameState, p: PlayerState, dx: number, dy: number, events: GameEvent[]): void {
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  p.dirX = Math.abs(nx) > 0.01 ? Math.sign(nx) : 0;
  p.dirY = Math.abs(ny) > 0.01 ? Math.sign(ny) : p.dirX !== 0 ? 0 : Math.sign(ny);
  if (p.dirX !== 0) p.dirY = 0;
  const step = p.speed / CONFIG.TICK_RATE;
  const mx = nx * step;
  const my = ny * step;

  if (p.isDuck) {
    // Ghost: clamp to arena, pass through everything
    p.x = Math.min(Math.max(p.x + mx, 0.5), s.width - 0.5);
    p.y = Math.min(Math.max(p.y + my, 0.5), s.height - 0.5);
    p.lastMoveTick = s.tick;
    return;
  }

  // Axis-separated movement with radius
  const R = 0.35;
  // X axis
  let nxx = p.x + mx;
  if (!hitsSolid(s, nxx, p.y, R, p.id)) {
    // Kick check: tile in move dir has balloon?
    p.x = nxx;
  } else if (CONFIG.ENABLE_KICK && p.hasBoots) {
    const tx = Math.floor(p.x + (mx > 0 ? 0.5 + R : -0.5 - R + 1) + (mx > 0 ? 0.1 : -0.1));
    // simpler: target tile center step
    const ttx = Math.floor((mx > 0 ? p.x + R + 0.05 : p.x - R - 0.05));
    const tty = Math.floor(p.y);
    const b = balloonAt(s, ttx, tty);
    if (b && b.slideX === 0 && b.slideY === 0) {
      b.slideX = mx > 0 ? 1 : -1;
      b.slideY = 0;
      b.slideT = CONFIG.KICK_SLIDE_TICKS_PER_TILE;
      events.push({ t: 'balloon_kicked', tick: s.tick, a: p.id, tx: b.tx, ty: b.ty });
    }
  }
  // Y axis
  let nyy = p.y + my;
  if (!hitsSolid(s, p.x, nyy, R, p.id)) {
    p.y = nyy;
  } else if (CONFIG.ENABLE_KICK && p.hasBoots) {
    const ttx = Math.floor(p.x);
    const tty = Math.floor((my > 0 ? p.y + R + 0.05 : p.y - R - 0.05));
    const b = balloonAt(s, ttx, tty);
    if (b && b.slideX === 0 && b.slideY === 0) {
      b.slideX = 0;
      b.slideY = my > 0 ? 1 : -1;
      b.slideT = CONFIG.KICK_SLIDE_TICKS_PER_TILE;
      events.push({ t: 'balloon_kicked', tick: s.tick, a: p.id, tx: b.tx, ty: b.ty });
    }
  }
  // clamp
  p.x = Math.min(Math.max(p.x, 0.5), s.width - 0.5);
  p.y = Math.min(Math.max(p.y, 0.5), s.height - 0.5);
  p.lastMoveTick = s.tick;
}

function hitsSolid(s: GameState, cx: number, cy: number, r: number, pid: string): boolean {
  const corners: [number, number][] = [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx - r, cy + r],
    [cx + r, cy + r],
  ];
  for (const [x, y] of corners) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (solidFor(s, tx, ty, pid)) return true;
  }
  return false;
}

function computeSplashTiles(s: GameState, b: BalloonState): { tx: number; ty: number }[] {
  const out = [{ tx: b.tx, ty: b.ty }];
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    for (let i = 1; i <= b.range; i++) {
      const tx = b.tx + dx * i;
      const ty = b.ty + dy * i;
      const t = tileAt(s, tx, ty);
      if (t === TILE_BOULDER) break;
      out.push({ tx, ty });
      if (t === TILE_CASTLE) break; // washes first castle and stops
      // balloons do NOT block — chain continues
    }
  }
  return out;
}

export function simulateTick(s: GameState, inputs: Record<string, PlayerInput>): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.roundOver) return events;
  s.tick++;

  // 1. Movement
  for (const p of s.players) {
    if (p.disconnected) continue;
    if (!p.alive && !p.isDuck) continue;
    const inp = inputs[p.id];
    if (!inp) continue;
    const dx = Math.max(-1, Math.min(1, inp.dx || 0));
    const dy = Math.max(-1, Math.min(1, inp.dy || 0));
    if (dx !== 0 || dy !== 0) tryMovePlayer(s, p, dx, dy, events);
    if (p.duckCooldown > 0) p.duckCooldown--;
  }

  // 2. Update passThrough (owner walked off)
  for (const b of s.balloons) {
    const ps = passSet(b);
    for (const pid of [...ps]) {
      const pl = s.players.find((p) => p.id === pid);
      if (!pl || Math.floor(pl.x) !== b.tx || Math.floor(pl.y) !== b.ty) {
        ps.delete(pid);
      }
    }
    b.passThrough = ps;
  }

  // 3. Balloon placement (+ revenge lobs)
  for (const p of s.players) {
    if (p.disconnected) continue;
    const inp = inputs[p.id];
    if (!inp) continue;
    if (p.isDuck) {
      if ((inp.balloon || inp.revengeLob) && p.duckCooldown <= 0) {
        // lob 3 tiles in facing dir
        let fx = p.dirX;
        let fy = p.dirY;
        if (fx === 0 && fy === 0) fy = 1;
        const tx = Math.floor(p.x) + fx * CONFIG.REVENGE_LOB_DISTANCE;
        const ty = Math.floor(p.y) + fy * CONFIG.REVENGE_LOB_DISTANCE;
        if (tx > 0 && ty > 0 && tx < s.width - 1 && ty < s.height - 1 && tileAt(s, tx, ty) === TILE_EMPTY && !balloonAt(s, tx, ty)) {
          s.balloons.push({
            id: s.nextBalloonId++,
            tx,
            ty,
            ownerId: p.id,
            fuse: CONFIG.FUSE_TICKS,
            range: CONFIG.BASE_RANGE,
            slideX: 0,
            slideY: 0,
            slideT: 0,
            passThrough: new Set<string>(),
          });
          p.duckCooldown = CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
          events.push({ t: 'revenge_lob', tick: s.tick, a: p.id, tx, ty });
        }
      }
      continue;
    }
    if (!p.alive) continue;
    if (inp.balloon) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      const owned = s.balloons.filter((b) => b.ownerId === p.id).length;
      if (owned < p.balloonCount && !balloonAt(s, tx, ty) && tileAt(s, tx, ty) === TILE_EMPTY) {
        s.balloons.push({
          id: s.nextBalloonId++,
          tx,
          ty,
          ownerId: p.id,
          fuse: CONFIG.FUSE_TICKS,
          range: p.splashRange,
          slideX: 0,
          slideY: 0,
          slideT: 0,
          passThrough: new Set<string>([p.id]),
        });
        events.push({ t: 'balloon_placed', tick: s.tick, a: p.id, tx, ty });
      }
    }
  }

  // 4. Sliding kicked balloons
  for (const b of s.balloons) {
    if (b.slideX === 0 && b.slideY === 0) continue;
    b.slideT--;
    if (b.slideT > 0) continue;
    b.slideT = CONFIG.KICK_SLIDE_TICKS_PER_TILE;
    const nx = b.tx + b.slideX;
    const ny = b.ty + b.slideY;
    const t = tileAt(s, nx, ny);
    if (t !== TILE_EMPTY || balloonAt(s, nx, ny)) {
      b.slideX = 0;
      b.slideY = 0;
      continue;
    }
    // stop on player tile
    const occupied = s.players.some((p) => p.alive && Math.floor(p.x) === nx && Math.floor(p.y) === ny);
    if (occupied) {
      b.slideX = 0;
      b.slideY = 0;
      continue;
    }
    b.tx = nx;
    b.ty = ny;
  }

  // 5. Fuse countdown
  for (const b of s.balloons) b.fuse--;

  // 6. Burst with chain BFS — whole cascade resolves in ONE tick
  const toBurst = s.balloons.filter((b) => b.fuse <= 0);
  if (toBurst.length > 0) {
    const queue: BalloonState[] = [...toBurst].sort((a, b2) => a.id - b2.id);
    const bursted = new Set<number>();
    const splashSet = new Map<string, { tx: number; ty: number }>();
    const burstOrder: BalloonState[] = [];
    // BFS: each popped balloon computes tiles; any balloon on those tiles joins queue
    const byTile = new Map<string, BalloonState[]>();
    for (const b of s.balloons) {
      const k = `${b.tx},${b.ty}`;
      if (!byTile.has(k)) byTile.set(k, []);
      byTile.get(k)!.push(b);
    }
    while (queue.length > 0) {
      const b = queue.shift()!;
      if (bursted.has(b.id)) continue;
      bursted.add(b.id);
      burstOrder.push(b);
      const tiles = computeSplashTiles(s, b);
      for (const c of tiles) {
        splashSet.set(`${c.tx},${c.ty}`, c);
        const others = byTile.get(`${c.tx},${c.ty}`) || [];
        for (const o of others) {
          if (!bursted.has(o.id) && !queue.includes(o)) {
            o.fuse = 0;
            queue.push(o);
          }
        }
      }
    }
    // Remove bursted balloons
    s.balloons = s.balloons.filter((b) => !bursted.has(b.id));
    // Apply castle wash + powerup reveal/destroy on splash tiles
    const washed: { tx: number; ty: number }[] = [];
    for (const c of splashSet.values()) {
      const t = tileAt(s, c.tx, c.ty);
      if (t === TILE_CASTLE) {
        s.tiles[c.ty][c.tx] = TILE_EMPTY;
        washed.push(c);
        const owner = burstOrder[0] ? s.players.find((p) => p.id === burstOrder[0].ownerId) : undefined;
        if (owner && owner.alive) owner.castlesWashed++;
        events.push({ t: 'castle_washed', tick: s.tick, a: burstOrder[0]?.ownerId, tx: c.tx, ty: c.ty });
        const hidden = s.contents[c.ty]?.[c.tx] ?? null;
        s.contents[c.ty][c.tx] = null;
        if (hidden) {
          s.powerups.push({ tx: c.tx, ty: c.ty, kind: hidden });
          events.push({ t: 'powerup_revealed', tick: s.tick, tx: c.tx, ty: c.ty, kind: hidden });
        }
      }
      // destroy exposed power-ups caught in splash
      const pi = s.powerups.findIndex((pu) => pu.tx === c.tx && pu.ty === c.ty);
      if (pi >= 0 && tileAt(s, c.tx, c.ty) !== TILE_CASTLE) {
        // only destroy if not just revealed on same tick at same tile
        const justRevealed = washed.some((w) => w.tx === c.tx && w.ty === c.ty && s.powerups[pi]?.tx === c.tx);
        if (!justRevealed) s.powerups.splice(pi, 1);
      }
    }
    // Add splash cells
    for (const c of splashSet.values()) {
      s.splashes.push({ tx: c.tx, ty: c.ty, ttl: CONFIG.SPLASH_TICKS });
    }
    // Events
    for (const b of burstOrder) {
      events.push({ t: 'balloon_burst', tick: s.tick, a: b.ownerId, tx: b.tx, ty: b.ty });
    }
    if (burstOrder.length >= 2) {
      events.push({ t: 'chain_burst', tick: s.tick, a: burstOrder[0].ownerId, count: burstOrder.length, text: burstOrder.length === 2 ? 'DOUBLE SPLASH!' : burstOrder.length === 3 ? 'TRIPLE SPLASH!' : `${burstOrder.length}x SPLASH!` });
    }
    // 7. Soak players standing on splash
    const soakedThisTick: PlayerState[] = [];
    for (const p of s.players) {
      if (!p.alive || p.isDuck) continue;
      const ptx = Math.floor(p.x);
      const pty = Math.floor(p.y);
      if (splashSet.has(`${ptx},${pty}`)) soakedThisTick.push(p);
    }
    // determine killer per soak: owner of burst that covers tile (use first covering burst)
    for (const p of soakedThisTick) {
      // find killer: last burst covering? use burstOrder owner that reaches — approximate with first
      let killer = burstOrder[0]?.ownerId;
      // prefer a burst whose splash actually includes player tile from its own range
      for (const b of burstOrder) {
        const tiles = computeSplashTiles({ ...s, tiles: s.tiles } as GameState, b);
        // recompute against post-wash tiles may differ; acceptable approximation
        if (tiles.some((c) => c.tx === Math.floor(p.x) && c.ty === Math.floor(p.y))) {
          killer = b.ownerId;
          break;
        }
      }
      soakPlayer(s, p, killer, events);
    }
  }

  // 8. Splash TTL decay
  for (const sp of s.splashes) sp.ttl--;
  s.splashes = s.splashes.filter((sp) => sp.ttl > 0);

  // 9. Powerup collection
  for (const p of s.players) {
    if (!p.alive || p.isDuck) continue;
    const ptx = Math.floor(p.x);
    const pty = Math.floor(p.y);
    const idx = s.powerups.findIndex((pu) => pu.tx === ptx && pu.ty === pty);
    if (idx >= 0) {
      const pu = s.powerups[idx];
      s.powerups.splice(idx, 1);
      applyPowerup(p, pu.kind);
      events.push({ t: 'powerup_collected', tick: s.tick, a: p.id, tx: ptx, ty: pty, kind: pu.kind });
    }
  }

  // 10. Tide advance
  if (s.tick >= CONFIG.TIDE_START_TICKS) {
    const elapsed = s.tick - CONFIG.TIDE_START_TICKS;
    const wantRing = Math.min(Math.floor(elapsed / CONFIG.TIDE_RING_INTERVAL_TICKS) + 1, Math.floor(Math.min(s.width, s.height) / 2));
    if (wantRing > s.tideRing) {
      s.tideRing = wantRing;
      events.push({ t: 'tide_advance', tick: s.tick, count: s.tideRing });
      // dissolve castles in new ring
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          if (!isFlooded(s, x, y)) continue;
          if (s.tiles[y][x] === TILE_CASTLE) {
            s.tiles[y][x] = TILE_EMPTY;
            s.contents[y][x] = null;
          }
          // destroy exposed powerups in flood
          const pi = s.powerups.findIndex((pu) => pu.tx === x && pu.ty === y);
          if (pi >= 0) s.powerups.splice(pi, 1);
        }
      }
    }
    // soak anyone standing in flood
    for (const p of s.players) {
      if (!p.alive || p.isDuck) continue;
      if (isFlooded(s, Math.floor(p.x), Math.floor(p.y))) {
        soakPlayer(s, p, undefined, events);
      }
    }
  }

  // 11. Update active counts
  for (const p of s.players) {
    p.activeBalloons = s.balloons.filter((b) => b.ownerId === p.id).length;
  }

  // 12. Round end check
  const alive = s.players.filter((p) => p.alive);
  if (alive.length <= 1 && !s.roundOver) {
    s.roundOver = true;
    if (alive.length === 1) s.roundWinner = alive[0].id;
    else {
      // draw: everyone soaked — collect last soaked ids from events
      const soakedIds = events.filter((e) => e.t === 'player_soaked').map((e) => e.a as string);
      s.roundWinner = soakedIds.length > 0 ? soakedIds : [];
    }
  }

  return events;
}

function soakPlayer(s: GameState, p: PlayerState, killerId: string | undefined, events: GameEvent[]): void {
  if (!p.alive) return;
  p.alive = false;
  if (s.revengeDucks) {
    p.isDuck = true;
    p.duckCooldown = 0;
  }
  if (killerId && killerId !== p.id) {
    const k = s.players.find((pl) => pl.id === killerId);
    if (k) k.soaks++;
  }
  events.push({ t: 'player_soaked', tick: s.tick, a: p.id, b: killerId, tx: Math.floor(p.x), ty: Math.floor(p.y) });
}

function applyPowerup(p: PlayerState, kind: string): void {
  if (kind === 'extra_balloon') p.balloonCount = Math.min(CONFIG.MAX_BALLOONS, p.balloonCount + 1);
  else if (kind === 'big_splash') p.splashRange = Math.min(CONFIG.MAX_RANGE, p.splashRange + 1);
  else if (kind === 'flippers') p.speed = Math.min(CONFIG.MAX_SPEED, +(p.speed + CONFIG.SPEED_PER_FLIPPERS).toFixed(2));
  else if (kind === 'boots') p.hasBoots = true;
}

export function aliveCount(s: GameState): number {
  return s.players.filter((p) => p.alive).length;
}
