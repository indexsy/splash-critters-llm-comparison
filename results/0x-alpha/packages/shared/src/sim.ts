import { CONFIG, TICK_RATE } from "./config";
import { generateMap, TILE_BOULDER, TILE_CASTLE, TILE_FLOOR, TILE_FLOODED } from "./map";
import type {
  BalloonState,
  HiddenPowerup,
  MatchConfig,
  PlayerState,
  PowerupType,
  SimEvent,
  SimPlayerInput,
  SimState,
  SnapshotPayload,
} from "./types";

const PLAYER_HALF = 0.35;

export interface SpawnSpec {
  id: string;
  x: number;
  y: number;
}

/** Create a fresh round state. Deterministic given config + entity ids. */
export function createSimState(config: MatchConfig, playerIds: string[]): SimState {
  const map = generateMap(config);
  const players: PlayerState[] = playerIds.map((id, i) => {
    const s = map.spawns[i % map.spawns.length]!;
    return {
      id,
      x: s.x,
      y: s.y,
      dirX: s.dirX,
      dirY: s.dirY,
      speed: CONFIG.speedBase,
      balloonCount: CONFIG.balloonCountBase,
      splashRange: CONFIG.splashRangeBase,
      hasBoots: false,
      alive: true,
      soakedTick: null,
      moving: false,
      revengeReady: false,
      revengeCooldown: 0,
      castlesWashed: 0,
      soaks: 0,
      revengeSoaks: 0,
      prevBalloonPressed: false,
      onBalloonTile: null,
      autoKick: true,
      spawnX: s.x,
      spawnY: s.y,
    };
  });
  return {
    tick: 0,
    config,
    grid: map.grid,
    hidden: map.hidden,
    players,
    balloons: [],
    splashes: [],
    exposed: [],
    tideRing: -1,
    events: [],
    roundOver: false,
    winnerIds: [],
    nextId: 1,
    rngState: config.mapSeed,
  };
}

function tileAt(state: SimState, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= state.config.w || y >= state.config.h) return TILE_BOULDER;
  return state.grid[y * state.config.w + x]!;
}

function balloonAtTile(state: SimState, tx: number, ty: number): BalloonState | undefined {
  return state.balloons.find((b) => !b.sliding && b.x === tx && b.y === ty);
}

function hiddenFor(state: SimState, tile: number): HiddenPowerup | undefined {
  return state.hidden.find((h) => h.tile === tile);
}

function overlapsSolid(state: SimState, x: number, y: number, p: PlayerState): boolean {
  const minX = Math.round(x - PLAYER_HALF);
  const maxX = Math.round(x + PLAYER_HALF);
  const minY = Math.round(y - PLAYER_HALF);
  const maxY = Math.round(y + PLAYER_HALF);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const t = tileAt(state, tx, ty);
      if (t === TILE_BOULDER || t === TILE_CASTLE) return true;
      const b = balloonAtTile(state, tx, ty);
      if (!b) continue;
      // own balloon is walkable while we're still leaving its tile
      if (b.owner === p.id && p.onBalloonTile === ty * state.config.w + tx) continue;
      return true;
    }
  }
  return false;
}

function clearOnBalloonIfLeft(state: SimState, p: PlayerState): void {
  if (p.onBalloonTile === null) return;
  const tx = p.onBalloonTile % state.config.w;
  const ty = Math.floor(p.onBalloonTile / state.config.w);
  const minX = Math.round(p.x - PLAYER_HALF);
  const maxX = Math.round(p.x + PLAYER_HALF);
  const minY = Math.round(p.y - PLAYER_HALF);
  const maxY = Math.round(p.y + PLAYER_HALF);
  if (tx < minX || tx > maxX || ty < minY || ty > maxY) p.onBalloonTile = null;
}

function tryMove(state: SimState, p: PlayerState, dx: number, dy: number): boolean {
  let moved = false;
  if (dx !== 0) {
    const nx = p.x + dx;
    if (!overlapsSolid(state, nx, p.y, p)) {
      p.x = nx;
      moved = true;
    } else if (state.config.enableKick && p.hasBoots && p.autoKick) {
      tryKick(state, p, Math.sign(dx), 0);
    }
  }
  if (dy !== 0) {
    const ny = p.y + dy;
    if (!overlapsSolid(state, p.x, ny, p)) {
      p.y = ny;
      moved = true;
    } else if (state.config.enableKick && p.hasBoots && p.autoKick) {
      tryKick(state, p, 0, Math.sign(dy));
    }
  }
  p.x = Math.max(0.55, Math.min(state.config.w - 1.45, p.x));
  p.y = Math.max(0.55, Math.min(state.config.h - 1.45, p.y));
  clearOnBalloonIfLeft(state, p);
  return moved;
}

/** Walk into a balloon with boots → kick it sliding. Only when the blocker is a balloon. */
function tryKick(state: SimState, p: PlayerState, dx: number, dy: number): void {
  const tx = Math.round(p.x) + dx;
  const ty = Math.round(p.y) + dy;
  const b = state.balloons.find((o) => !o.sliding && o.x === tx && o.y === ty);
  if (!b) return;
  b.sliding = true;
  b.slideDirX = dx;
  b.slideDirY = dy;
  b.x = tx;
  b.y = ty;
  b.slideProgress = 0;
  state.events.push({
    type: "balloon_kicked",
    tick: state.tick,
    by: p.id,
    tile: b.y * state.config.w + b.x,
    dirX: dx,
    dirY: dy,
  });
}

const KICK_PER_TICK = CONFIG.kickSpeedTilesPerSec / TICK_RATE;

function stepSlidingBalloons(state: SimState): void {
  for (const b of state.balloons) {
    if (!b.sliding) continue;
    b.slideProgress += KICK_PER_TICK;
    while (b.slideProgress >= 1) {
      const nx = b.x + b.slideDirX;
      const ny = b.y + b.slideDirY;
      const t = tileAt(state, nx, ny);
      const blockedByTile = t === TILE_BOULDER || t === TILE_CASTLE;
      const blockedByBalloon = !!balloonAtTile(state, nx, ny);
      const blockedByPlayer = state.players.some((p) => p.alive && Math.round(p.x) === nx && Math.round(p.y) === ny);
      const offGrid = nx <= 0 || ny <= 0 || nx >= state.config.w - 1 || ny >= state.config.h - 1;
      if (blockedByTile || blockedByBalloon || blockedByPlayer || offGrid) {
        b.sliding = false;
        b.slideProgress = 0;
        break;
      }
      b.x = nx;
      b.y = ny;
      b.slideProgress -= 1;
    }
  }
}

function dropBalloon(state: SimState, p: PlayerState): void {
  const owned = state.balloons.filter((b) => b.owner === p.id).length;
  if (owned >= p.balloonCount) return;
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  if (balloonAtTile(state, tx, ty)) return;
  const t = tileAt(state, tx, ty);
  if (t === TILE_BOULDER || t === TILE_FLOODED) return;
  p.onBalloonTile = ty * state.config.w + tx;
  state.balloons.push({
    id: state.nextId++,
    owner: p.id,
    x: tx,
    y: ty,
    fuse: CONFIG.fuseTicks,
    range: p.splashRange,
    sliding: false,
    slideDirX: 0,
    slideDirY: 0,
    slideProgress: 0,
    chainDepth: 0,
  });
}

/** Splash cells (tile indices) for a burst, washing the first castle per direction. */
function splashCells(state: SimState, b: BalloonState): number[] {
  const { w } = state.config;
  const cells: number[] = [b.y * w + b.x];
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    for (let i = 1; i <= b.range; i++) {
      const tx = b.x + dx * i;
      const ty = b.y + dy * i;
      const t = tileAt(state, tx, ty);
      if (t === TILE_BOULDER) break;
      cells.push(ty * w + tx);
      if (t === TILE_CASTLE) break; // washes first castle per direction and stops
      if (balloonAtTile(state, tx, ty)) break; // chain triggers there
    }
  }
  return cells;
}

function revealAndWashCastle(state: SimState, tile: number, by: string | undefined): void {
  state.grid[tile] = TILE_FLOOR;
  const h = hiddenFor(state, tile);
  const hiddenType = h?.type ?? null;
  if (h) h.type = null;
  const owner = by ? state.players.find((p) => p.id === by) : undefined;
  if (owner?.alive) owner.castlesWashed++;
  state.events.push({ type: "castle_washed", tick: state.tick, by, tile });
  if (hiddenType) {
    state.events.push({ type: "powerup_revealed", tick: state.tick, tile, powerup: hiddenType });
    state.exposed.push({
      id: state.nextId++,
      x: tile % state.config.w,
      y: Math.floor(tile / state.config.w),
      type: hiddenType,
    });
  }
}

interface BurstJob {
  balloon: BalloonState;
}

/** Resolve all bursts this tick as one cascade via BFS queue. Returns max chain depth reached. */
function resolveBursts(state: SimState, initial: BalloonState[]): void {
  const queue: BurstJob[] = [];
  const bursting = new Set<number>();
  for (const b of initial) {
    if (!bursting.has(b.id)) {
      queue.push({ balloon: b });
      bursting.add(b.id);
    }
  }
  let chainDepth = 0;

  while (queue.length > 0) {
    const job = queue.shift()!;
    const b = job.balloon;
    const idx = state.balloons.indexOf(b);
    if (idx === -1) continue;
    state.balloons.splice(idx, 1);

    const isChain = b.chainDepth > 0;
    if (isChain) chainDepth = Math.max(chainDepth, b.chainDepth);

    const cells = splashCells(state, b);
    state.splashes.push({ id: state.nextId++, x: b.x, y: b.y, age: 0, cells, owner: b.owner });

    // wash castles / trigger chains / destroy exposed powerups
    const { w } = state.config;
    for (const cell of cells) {
      const t = state.grid[cell]!;
      if (t === TILE_CASTLE) revealAndWashCastle(state, cell, b.owner);
      const other = state.balloons.find((o) => !bursting.has(o.id) && o.x === cell % w && o.y === Math.floor(cell / w));
      if (other) {
        other.chainDepth = b.chainDepth + 1;
        queue.push({ balloon: other });
        bursting.add(other.id);
      }
      const exIdx = state.exposed.findIndex((e) => e.y * w + e.x === cell);
      if (exIdx !== -1) state.exposed.splice(exIdx, 1);
    }

    state.events.push({
      type: "chain_burst",
      tick: state.tick,
      tile: b.y * w + b.x,
      chain: isChain ? b.chainDepth : 0,
      by: b.owner,
    });
  }

  if (chainDepth >= 2) {
    state.events.push({ type: "chain_burst", tick: state.tick, chain: chainDepth });
  }
}

function soakPlayersOnSplashes(state: SimState): void {
  const { w } = state.config;
  const soaked = new Map<PlayerState, { owner: string; revenge: boolean }>();
  for (const sp of state.splashes) {
    const cellSet = new Set(sp.cells);
    for (const p of state.players) {
      if (!p.alive) continue;
      const pt = Math.round(p.y) * w + Math.round(p.x);
      if (!cellSet.has(pt)) continue;
      if (!soaked.has(p)) {
        const owner = state.players.find((o) => o.id === sp.owner);
        soaked.set(p, { owner: sp.owner, revenge: !owner?.alive });
      }
    }
  }
  for (const [p, info] of soaked) {
    p.alive = false;
    p.soakedTick = state.tick;
    const ownerPlayer = state.players.find((o) => o.id === info.owner);
    if (ownerPlayer && ownerPlayer.id !== p.id) {
      if (info.revenge) ownerPlayer.revengeSoaks++;
      else ownerPlayer.soaks++;
    }
    state.events.push({
      type: "player_soaked",
      tick: state.tick,
      by: info.owner,
      target: p.id,
      revenge: info.revenge,
    });
  }
}

function collectPowerups(state: SimState): void {
  const { w } = state.config;
  for (const p of state.players) {
    if (!p.alive) continue;
    const pt = Math.round(p.y) * w + Math.round(p.x);
    const idx = state.exposed.findIndex((e) => e.y * w + e.x === pt);
    if (idx === -1) continue;
    const pu = state.exposed[idx]!;
    state.exposed.splice(idx, 1);
    applyPowerup(state, p, pu.type);
    state.events.push({ type: "powerup_collected", tick: state.tick, target: p.id, powerup: pu.type });
  }
}

function applyPowerup(state: SimState, p: PlayerState, type: PowerupType): void {
  switch (type) {
    case "balloon":
      p.balloonCount = Math.min(CONFIG.balloonCountCap, p.balloonCount + 1);
      break;
    case "range":
      p.splashRange = Math.min(CONFIG.splashRangeCap, p.splashRange + 1);
      break;
    case "speed":
      p.speed = Math.min(CONFIG.speedCap, p.speed + CONFIG.speedPerFlipper);
      break;
    case "boots":
      p.hasBoots = true;
      break;
  }
}

function advanceTide(state: SimState): void {
  const { w, h } = state.config;
  state.tideRing++;
  const ring = state.tideRing;
  state.events.push({ type: "tide_advance", tick: state.tick, tile: ring });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (dist !== ring) continue;
      const t = y * w + x;
      if (state.grid[t] === TILE_BOULDER) continue;
      if (state.grid[t] === TILE_CASTLE) {
        state.grid[t] = TILE_FLOOR;
        const hh = state.hidden.find((z) => z.tile === t);
        if (hh) hh.type = null;
        state.events.push({ type: "castle_washed", tick: state.tick, tile: t });
      } else if (state.grid[t] === TILE_FLOOR) {
        state.grid[t] = TILE_FLOODED;
      }
      const exIdx = state.exposed.findIndex((e) => e.y * w + e.x === t);
      if (exIdx !== -1) state.exposed.splice(exIdx, 1);
    }
  }
}

function checkTideSoak(state: SimState): void {
  if (state.tideRing < 0) return;
  const { w, h } = state.config;
  for (const p of state.players) {
    if (!p.alive) continue;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (state.grid[py * w + px] === TILE_FLOODED) {
      p.alive = false;
      p.soakedTick = state.tick;
      state.events.push({ type: "player_soaked", tick: state.tick, target: p.id });
    }
  }
}

function fireRevengeLob(state: SimState, p: PlayerState): void {
  if (!state.config.enableRevengeDucks || p.alive || p.revengeCooldown > 0) return;
  const tx = Math.round(p.x) + p.dirX * CONFIG.revengeRange;
  const ty = Math.round(p.y) + p.dirY * CONFIG.revengeRange;
  if (tx <= 0 || ty <= 0 || tx >= state.config.w - 1 || ty >= state.config.h - 1) return;
  if (tileAt(state, tx, ty) === TILE_BOULDER || balloonAtTile(state, tx, ty)) return;
  p.revengeCooldown = CONFIG.revengeDuckCooldownTicks;
  state.balloons.push({
    id: state.nextId++,
    owner: p.id,
    x: tx,
    y: ty,
    fuse: CONFIG.fuseTicks,
    range: CONFIG.revengeRange,
    sliding: false,
    slideDirX: 0,
    slideDirY: 0,
    slideProgress: 0,
    chainDepth: 0,
  });
  state.events.push({ type: "revenge_lob", tick: state.tick, target: p.id, tile: ty * state.config.w + tx });
}

function finishRoundIfOver(state: SimState, soakedThisTickCount: number): void {
  if (state.roundOver || state.players.length < 2) return;
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.roundOver = true;
    if (alive.length === 1) {
      state.winnerIds = [alive[0]!.id];
    } else if (soakedThisTickCount >= 2) {
      state.winnerIds = []; // draw — last two soaked on same tick
    } else {
      state.winnerIds = [];
    }
  } else if (state.tick >= (CONFIG.tideStartSec + 60) * TICK_RATE + CONFIG.tideRingIntervalTicks * 64) {
    // safety timeout → draw
    state.roundOver = true;
    state.winnerIds = [];
    state.events.push({ type: "round_timeout_draw", tick: state.tick });
  }
}

/**
 * Advance the simulation one fixed tick.
 * `inputs` keyed by player entity id; missing inputs = no movement.
 */
export function simulateTick(state: SimState, inputs: Record<string, SimPlayerInput>): SimEvent[] {
  state.events = [];
  if (state.roundOver) return state.events;
  state.tick++;

  // 1) Movement + actions
  for (const p of state.players) {
    if (p.revengeCooldown > 0) p.revengeCooldown--;
    const input = inputs[p.id];
    if (!input) {
      p.moving = false;
      p.prevBalloonPressed = false;
      continue;
    }
    let dx = input.dirX;
    let dy = input.dirY;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    if (len > 0.01) {
      p.dirX = Math.sign(dx) || p.dirX;
      p.dirY = Math.sign(dy) || p.dirY;
    }

    if (p.alive) {
      const dist = (p.speed / TICK_RATE) * 1;
      p.moving = len > 0.01;
      if (p.moving) tryMove(state, p, dx * dist, dy * dist);
    } else {
      // eliminated: ride duck along border, can still turn to aim lobs
      p.moving = false;
    }

    if (p.alive) {
      if (input.balloonPressed && !p.prevBalloonPressed) dropBalloon(state, p);
    } else if (input.balloonPressed && !p.prevBalloonPressed) {
      fireRevengeLob(state, p);
    }
    p.prevBalloonPressed = input.balloonPressed;
  }

  // 2) Fuses & sliding
  stepSlidingBalloons(state);
  const toBurst: BalloonState[] = [];
  for (const b of state.balloons) {
    b.fuse--;
    if (b.fuse <= 0) toBurst.push(b);
  }

  // 3) Cascade bursts in a single tick
  resolveBursts(state, toBurst);

  // 4) Splash aging
  for (const sp of state.splashes) sp.age++;
  state.splashes = state.splashes.filter((sp) => sp.age <= CONFIG.splashLingerTicks);

  // 5) Soaks from active splashes
  soakPlayersOnSplashes(state);

  // 6) Powerup collection
  collectPowerups(state);

  // 7) Rising tide
  const tideStartTick = CONFIG.tideStartSec * TICK_RATE;
  if (
    state.tick > tideStartTick &&
    (state.tick - tideStartTick) % CONFIG.tideRingIntervalTicks === 0 &&
    state.tideRing < Math.floor(Math.min(state.config.w, state.config.h) / 2)
  ) {
    advanceTide(state);
  }
  checkTideSoak(state);

  // 8) Round end?
  const aliveNow = state.players.filter((p) => p.alive).length;
  finishRoundIfOver(state, state.players.length - aliveNow);

  return state.events;
}

export function makeSnapshot(state: SimState): SnapshotPayload {
  return {
    tick: state.tick,
    players: state.players.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      alive: p.alive,
      stats: { speed: p.speed, balloons: p.balloonCount, range: p.splashRange },
      hasBoots: p.hasBoots,
      moving: p.moving,
      revengeCooldown: p.revengeCooldown,
    })),
    balloons: state.balloons.map((b) => ({
      id: b.id,
      owner: b.owner,
      x: b.x,
      y: b.y,
      fuse: b.fuse,
      sliding: b.sliding,
      dx: b.slideDirX,
      dy: b.slideDirY,
      progress: b.slideProgress,
      range: b.range,
    })),
    splashes: state.splashes.map((s) => ({ id: s.id, x: s.x, y: s.y, age: s.age, cells: s.cells })),
    exposed: state.exposed.map((e) => ({ ...e })),
    tideRing: state.tideRing,
  };
}
