import { CONFIG, type AnimalId, type BotDifficulty, type HatId, type MapTheme, type PowerupType } from './config.js';
import { generateMap, TILE_BOULDER, TILE_CASTLE, TILE_EMPTY } from './map.js';
import {
  DIR_DELTA,
  DIRS,
  idx,
  inBounds,
  type Balloon,
  type Dir,
  type GameEvent,
  type GameState,
  type InputMap,
  type PlayerInput,
  type PlayerState,
  type Splash,
} from './types.js';

export type CreateRoundOpts = {
  width: number;
  height: number;
  mapSeed: number;
  theme: MapTheme;
  ranked: boolean;
  enableRevengeDucks?: boolean;
  enableKick?: boolean;
  players: Array<{
    id: string;
    slot: number;
    nickname: string;
    animal: AnimalId;
    hat: HatId;
    isBot: boolean;
    botDifficulty?: BotDifficulty;
  }>;
};

export function createRoundState(opts: CreateRoundOpts): GameState {
  const map = generateMap(opts.width, opts.height, opts.mapSeed, opts.players.length, opts.theme);
  const players: PlayerState[] = opts.players.map((p, i) => {
    const spawn = map.spawns[i] ?? map.spawns[0]!;
    return {
      id: p.id,
      slot: p.slot,
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
      dir: 'down' as Dir,
      moving: false,
      speed: CONFIG.BASE_SPEED,
      balloonCount: CONFIG.BASE_BALLOON_COUNT,
      splashRange: CONFIG.BASE_SPLASH_RANGE,
      balloonsOut: 0,
      hasBoots: false,
      soaked: false,
      soakTick: -1,
      alive: true,
      isBot: p.isBot,
      botDifficulty: p.botDifficulty,
      animal: p.animal,
      hat: p.hat,
      nickname: p.nickname,
      revenge: false,
      revengeCooldown: 0,
      borderPos: 0,
      soaks: 0,
      castlesWashed: 0,
      inputSeq: 0,
      lastInputTick: 0,
    };
  });

  return {
    tick: 0,
    width: map.width,
    height: map.height,
    theme: map.theme,
    mapSeed: opts.mapSeed,
    grid: map.grid.slice(),
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    hiddenPowerups: map.hiddenPowerups.map((h) => ({ ...h })),
    nextBalloonId: 1,
    tideRing: 0,
    events: [],
    roundOver: false,
    winnerIds: [],
    livingCount: players.length,
    ranked: opts.ranked,
    enableRevengeDucks:
      opts.enableRevengeDucks ??
      (opts.ranked ? CONFIG.ENABLE_REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS),
    enableKick: opts.enableKick ?? CONFIG.ENABLE_KICK,
  };
}

function tileAt(state: GameState, x: number, y: number): number {
  if (!inBounds(x, y, state.width, state.height)) return TILE_BOULDER;
  return state.grid[idx(x, y, state.width)]!;
}

function setTile(state: GameState, x: number, y: number, v: number): void {
  if (inBounds(x, y, state.width, state.height)) {
    state.grid[idx(x, y, state.width)] = v;
  }
}

function isSolid(state: GameState, tx: number, ty: number, ignoreBalloonId?: number): boolean {
  const t = tileAt(state, tx, ty);
  if (t === TILE_BOULDER || t === TILE_CASTLE) return true;
  for (const b of state.balloons) {
    if (ignoreBalloonId !== undefined && b.id === ignoreBalloonId) continue;
    if (b.x === tx && b.y === ty) return true;
  }
  return false;
}

function isFlooded(state: GameState, tx: number, ty: number): boolean {
  if (state.tideRing <= 0) return false;
  const r = state.tideRing;
  return tx < r || ty < r || tx >= state.width - r || ty >= state.height - r;
}

function balloonAt(state: GameState, tx: number, ty: number): Balloon | undefined {
  return state.balloons.find((b) => b.x === tx && b.y === ty);
}

function playerOnTile(state: GameState, tx: number, ty: number, excludeId?: string): PlayerState | undefined {
  return state.players.find(
    (p) =>
      p.alive &&
      !p.soaked &&
      !p.revenge &&
      p.id !== excludeId &&
      Math.floor(p.x) === tx &&
      Math.floor(p.y) === ty,
  );
}

function tryPlaceBalloon(state: GameState, player: PlayerState): void {
  if (!player.alive || player.soaked || player.revenge) return;
  if (player.balloonsOut >= player.balloonCount) return;
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  if (tileAt(state, tx, ty) !== TILE_EMPTY) return;
  if (balloonAt(state, tx, ty)) return;
  if (isFlooded(state, tx, ty)) return;

  const balloon: Balloon = {
    id: state.nextBalloonId++,
    ownerId: player.id,
    x: tx,
    y: ty,
    placeTick: state.tick,
    fuseTicks: CONFIG.FUSE_TICKS,
    splashRange: player.splashRange,
    sliding: false,
    slideDir: 'none',
  };
  state.balloons.push(balloon);
  player.balloonsOut++;
  state.events.push({ type: 'balloon_placed', balloonId: balloon.id, x: tx, y: ty, ownerId: player.id });
}

function collectPowerup(state: GameState, player: PlayerState, type: PowerupType, x: number, y: number): void {
  switch (type) {
    case 'extraBalloon':
      player.balloonCount = Math.min(CONFIG.MAX_BALLOON_COUNT, player.balloonCount + 1);
      break;
    case 'bigSplash':
      player.splashRange = Math.min(CONFIG.MAX_SPLASH_RANGE, player.splashRange + 1);
      break;
    case 'flippers':
      player.speed = Math.min(CONFIG.MAX_SPEED, player.speed + CONFIG.SPEED_PER_FLIPPERS);
      break;
    case 'rubberBoots':
      if (!player.hasBoots) player.hasBoots = true;
      break;
  }
  state.events.push({ type: 'powerup_collected', playerId: player.id, x, y, powerup: type });
}

function washCastle(state: GameState, x: number, y: number): void {
  setTile(state, x, y, TILE_EMPTY);
  state.events.push({ type: 'castle_washed', x, y });
  const hi = state.hiddenPowerups.findIndex((h) => h.x === x && h.y === y);
  if (hi >= 0) {
    const hp = state.hiddenPowerups[hi]!;
    state.hiddenPowerups.splice(hi, 1);
    if (hp.type) {
      state.powerups.push({ x, y, type: hp.type });
      state.events.push({ type: 'powerup_revealed', x, y, powerup: hp.type });
    }
  }
}

function soakPlayer(state: GameState, player: PlayerState, byPlayerId: string | null): void {
  if (player.soaked || !player.alive) return;
  player.soaked = true;
  player.soakTick = state.tick;
  player.alive = false;
  player.moving = false;
  state.events.push({ type: 'player_soaked', playerId: player.id, byPlayerId, tick: state.tick });

  if (byPlayerId) {
    const killer = state.players.find((p) => p.id === byPlayerId);
    if (killer) killer.soaks++;
  }

  // Credit castles washed already tracked on player

  if (state.enableRevengeDucks && !state.ranked) {
    player.revenge = true;
    player.revengeCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
    // Place on border
    player.borderPos = player.slot * 10;
    const border = borderPosition(state, player.borderPos);
    player.x = border.x + 0.5;
    player.y = border.y + 0.5;
  }

  updateLiving(state);
}

function updateLiving(state: GameState): void {
  const living = state.players.filter((p) => p.alive && !p.soaked);
  state.livingCount = living.length;
  if (living.length <= 1 && !state.roundOver) {
    state.roundOver = true;
    if (living.length === 1) {
      state.winnerIds = [living[0]!.id];
    } else {
      // Check same-tick multi-soak draw: last living all soaked this tick
      const justSoaked = state.players.filter((p) => p.soakTick === state.tick);
      if (justSoaked.length >= 2 && living.length === 0) {
        state.winnerIds = []; // draw
      } else {
        state.winnerIds = [];
      }
    }
  }
}

function borderPosition(state: GameState, pos: number): { x: number; y: number } {
  const w = state.width;
  const h = state.height;
  const perim = 2 * (w + h - 2);
  const p = ((pos % perim) + perim) % perim;
  if (p < w) return { x: p, y: 0 };
  if (p < w + h - 1) return { x: w - 1, y: p - w + 1 };
  if (p < 2 * w + h - 2) return { x: w - 1 - (p - (w + h - 1)), y: h - 1 };
  return { x: 0, y: h - 1 - (p - (2 * w + h - 2)) };
}

/** Resolve splash cascade via BFS queue in one tick */
function burstBalloon(state: GameState, startBalloon: Balloon, chainDepth: number): void {
  const queue: Array<{ balloon: Balloon; depth: number }> = [{ balloon: startBalloon, depth: chainDepth }];
  const burstIds = new Set<number>();
  let maxDepth = chainDepth;
  let burstCount = 0;

  while (queue.length > 0) {
    const { balloon, depth } = queue.shift()!;
    if (burstIds.has(balloon.id)) continue;
    burstIds.add(balloon.id);
    burstCount++;
    maxDepth = Math.max(maxDepth, depth);

    // Remove balloon
    const bi = state.balloons.findIndex((b) => b.id === balloon.id);
    if (bi >= 0) state.balloons.splice(bi, 1);
    const owner = state.players.find((p) => p.id === balloon.ownerId);
    if (owner) owner.balloonsOut = Math.max(0, owner.balloonsOut - 1);

    state.events.push({ type: 'balloon_burst', balloonId: balloon.id, x: balloon.x, y: balloon.y });

    const splashTiles: Array<{ x: number; y: number }> = [{ x: balloon.x, y: balloon.y }];
    const range = balloon.splashRange;

    for (const dir of DIRS) {
      const { dx, dy } = DIR_DELTA[dir];
      for (let r = 1; r <= range; r++) {
        const nx = balloon.x + dx * r;
        const ny = balloon.y + dy * r;
        if (!inBounds(nx, ny, state.width, state.height)) break;
        const tile = tileAt(state, nx, ny);
        if (tile === TILE_BOULDER) break;

        splashTiles.push({ x: nx, y: ny });

        if (tile === TILE_CASTLE) {
          washCastle(state, nx, ny);
          if (owner) owner.castlesWashed++;
          break; // stop after first castle
        }

        // Chain: balloon on this tile
        const other = balloonAt(state, nx, ny);
        if (other && !burstIds.has(other.id)) {
          queue.push({ balloon: other, depth: depth + 1 });
        }

        // Destroy exposed powerups
        const pi = state.powerups.findIndex((pu) => pu.x === nx && pu.y === ny);
        if (pi >= 0) state.powerups.splice(pi, 1);
      }
    }

    // Center tile also destroys powerups
    const cpi = state.powerups.findIndex((pu) => pu.x === balloon.x && pu.y === balloon.y);
    if (cpi >= 0) state.powerups.splice(cpi, 1);

    const splash: Splash = {
      tiles: splashTiles,
      startTick: state.tick,
      lingerTicks: CONFIG.SPLASH_LINGER_TICKS,
      chainDepth: depth,
    };
    state.splashes.push(splash);

    // Soak players on splash tiles
    for (const tile of splashTiles) {
      for (const p of state.players) {
        if (!p.alive || p.soaked || p.revenge) continue;
        if (Math.floor(p.x) === tile.x && Math.floor(p.y) === tile.y) {
          soakPlayer(state, p, balloon.ownerId === p.id ? null : balloon.ownerId);
        }
      }
    }
  }

  if (burstCount > 1) {
    state.events.push({ type: 'chain_burst', depth: maxDepth, count: burstCount });
  }
}

function movePlayer(state: GameState, player: PlayerState, input: PlayerInput): void {
  if (!player.alive || player.soaked) {
    // Revenge duck movement along border
    if (player.revenge) {
      if (input.dir !== 'none') {
        const delta = input.dir === 'left' || input.dir === 'up' ? -1 : 1;
        player.borderPos += delta * 0.15;
        const bp = borderPosition(state, Math.floor(player.borderPos));
        player.x = bp.x + 0.5;
        player.y = bp.y + 0.5;
        player.dir = input.dir;
        player.moving = true;
      } else {
        player.moving = false;
      }
      if (input.balloonPressed && player.revengeCooldown <= 0) {
        // Lob straight 3-tile balloon inward
        const tx = Math.floor(player.x);
        const ty = Math.floor(player.y);
        let lobDir: Dir = 'down';
        if (ty === 0) lobDir = 'down';
        else if (ty === state.height - 1) lobDir = 'up';
        else if (tx === 0) lobDir = 'right';
        else lobDir = 'left';
        const { dx, dy } = DIR_DELTA[lobDir];
        // Place balloon REVENGE_RANGE tiles in
        const bx = tx + dx * CONFIG.REVENGE_RANGE;
        const by = ty + dy * CONFIG.REVENGE_RANGE;
        if (inBounds(bx, by, state.width, state.height) && tileAt(state, bx, by) === TILE_EMPTY && !balloonAt(state, bx, by)) {
          const balloon: Balloon = {
            id: state.nextBalloonId++,
            ownerId: player.id,
            x: bx,
            y: by,
            placeTick: state.tick,
            fuseTicks: CONFIG.FUSE_TICKS,
            splashRange: 1,
            sliding: false,
            slideDir: 'none',
          };
          state.balloons.push(balloon);
          player.revengeCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
          state.events.push({ type: 'revenge_lob', playerId: player.id, x: bx, y: by, dir: lobDir });
        }
      }
    }
    return;
  }

  player.inputSeq = input.seq;
  player.lastInputTick = state.tick;

  if (input.dir !== 'none') {
    player.dir = input.dir;
    player.moving = true;
  } else {
    player.moving = false;
  }

  if (input.balloonPressed) {
    tryPlaceBalloon(state, player);
  }

  if (!player.moving || input.dir === 'none') return;

  const { dx, dy } = DIR_DELTA[input.dir];
  const speed = player.speed / CONFIG.TICK_RATE;
  let nx = player.x + dx * speed;
  let ny = player.y + dy * speed;

  // Tile collision — axis separated
  const tryMove = (px: number, py: number): { x: number; y: number } => {
    const corners = [
      { x: px - 0.35, y: py - 0.35 },
      { x: px + 0.35, y: py - 0.35 },
      { x: px - 0.35, y: py + 0.35 },
      { x: px + 0.35, y: py + 0.35 },
    ];
    for (const c of corners) {
      const tx = Math.floor(c.x);
      const ty = Math.floor(c.y);
      const t = tileAt(state, tx, ty);
      if (t === TILE_BOULDER || t === TILE_CASTLE) return { x: player.x, y: player.y };

      // Balloon collision
      const bal = balloonAt(state, tx, ty);
      if (bal) {
        // Owner can walk off their own balloon if still on it
        const onOwn = bal.ownerId === player.id && Math.floor(player.x) === bal.x && Math.floor(player.y) === bal.y;
        if (onOwn) continue;

        // Kick
        if (state.enableKick && player.hasBoots && !bal.sliding) {
          bal.sliding = true;
          bal.slideDir = input.dir;
          state.events.push({ type: 'balloon_kicked', balloonId: bal.id, dir: input.dir });
          continue;
        }
        return { x: player.x, y: player.y };
      }
    }
    return { x: px, y: py };
  };

  // Separate axes for smoother sliding along walls
  const mx = tryMove(nx, player.y);
  player.x = mx.x;
  const my = tryMove(player.x, ny);
  player.y = my.y;

  // Clamp to playable area
  player.x = Math.max(0.5, Math.min(state.width - 0.5, player.x));
  player.y = Math.max(0.5, Math.min(state.height - 0.5, player.y));

  // Collect powerups
  const ptx = Math.floor(player.x);
  const pty = Math.floor(player.y);
  const pui = state.powerups.findIndex((pu) => pu.x === ptx && pu.y === pty);
  if (pui >= 0) {
    const pu = state.powerups[pui]!;
    state.powerups.splice(pui, 1);
    collectPowerup(state, player, pu.type, ptx, pty);
  }

  // Tide soak
  if (isFlooded(state, ptx, pty)) {
    soakPlayer(state, player, null);
  }
}

function updateSlidingBalloons(state: GameState): void {
  // Slide one tile per few ticks — slide every 3 ticks (~10 tiles/sec feel)
  if (state.tick % 3 !== 0) return;

  for (const bal of state.balloons) {
    if (!bal.sliding || bal.slideDir === 'none') continue;
    const { dx, dy } = DIR_DELTA[bal.slideDir];
    const nx = bal.x + dx;
    const ny = bal.y + dy;

    if (!inBounds(nx, ny, state.width, state.height)) {
      bal.sliding = false;
      bal.slideDir = 'none';
      continue;
    }
    const t = tileAt(state, nx, ny);
    if (t === TILE_BOULDER || t === TILE_CASTLE) {
      bal.sliding = false;
      bal.slideDir = 'none';
      continue;
    }
    if (balloonAt(state, nx, ny)) {
      bal.sliding = false;
      bal.slideDir = 'none';
      continue;
    }
    if (playerOnTile(state, nx, ny)) {
      bal.sliding = false;
      bal.slideDir = 'none';
      continue;
    }
    bal.x = nx;
    bal.y = ny;
  }
}

function updateFuses(state: GameState): void {
  const toBurst: Balloon[] = [];
  for (const bal of state.balloons) {
    const age = state.tick - bal.placeTick;
    if (age >= bal.fuseTicks) {
      toBurst.push(bal);
    }
  }
  for (const bal of toBurst) {
    if (state.balloons.find((b) => b.id === bal.id)) {
      burstBalloon(state, bal, 1);
    }
  }
}

function updateSplashes(state: GameState): void {
  state.splashes = state.splashes.filter((s) => state.tick - s.startTick < s.lingerTicks);
}

function updateTide(state: GameState): void {
  if (state.tick < CONFIG.TIDE_START_TICKS) return;
  const elapsed = state.tick - CONFIG.TIDE_START_TICKS;
  const newRing = 1 + Math.floor(elapsed / CONFIG.TIDE_INTERVAL_TICKS);
  const maxRing = Math.floor(Math.min(state.width, state.height) / 2) - 1;
  const ring = Math.min(newRing, maxRing);
  if (ring > state.tideRing) {
    state.tideRing = ring;
    state.events.push({ type: 'tide_advance', ring });

    // Dissolve castles and soak players in new flood zone
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (!isFlooded(state, x, y)) continue;
        if (tileAt(state, x, y) === TILE_CASTLE) {
          washCastle(state, x, y);
        }
        // Remove balloons in flood
        for (let i = state.balloons.length - 1; i >= 0; i--) {
          const b = state.balloons[i]!;
          if (b.x === x && b.y === y) {
            const owner = state.players.find((p) => p.id === b.ownerId);
            if (owner) owner.balloonsOut = Math.max(0, owner.balloonsOut - 1);
            state.balloons.splice(i, 1);
          }
        }
        // Remove powerups
        for (let i = state.powerups.length - 1; i >= 0; i--) {
          if (state.powerups[i]!.x === x && state.powerups[i]!.y === y) {
            state.powerups.splice(i, 1);
          }
        }
      }
    }
    for (const p of state.players) {
      if (!p.alive || p.soaked) continue;
      if (isFlooded(state, Math.floor(p.x), Math.floor(p.y))) {
        soakPlayer(state, p, null);
      }
    }
  }
}

function updateRevengeCooldowns(state: GameState): void {
  for (const p of state.players) {
    if (p.revenge && p.revengeCooldown > 0) p.revengeCooldown--;
  }
}

/**
 * Advance simulation by one tick.
 * Mutates state in place. Clears and fills state.events.
 * Pure given identical state + inputs → identical result.
 */
export function simulateTick(state: GameState, inputs: InputMap): GameState {
  state.events = [];
  if (state.roundOver) {
    state.tick++;
    return state;
  }

  state.tick++;

  // Apply player inputs
  for (const player of state.players) {
    if (player.isBot) continue; // bots inject via inputs map too
    const input = inputs[player.id];
    if (input) {
      movePlayer(state, player, input);
    } else {
      // Hold last dir if moving? stop
      player.moving = false;
    }
  }

  // Bots also come through inputs map
  for (const player of state.players) {
    if (!player.isBot) continue;
    const input = inputs[player.id];
    if (input) movePlayer(state, player, input);
    else player.moving = false;
  }

  updateSlidingBalloons(state);
  updateFuses(state);
  updateSplashes(state);
  updateTide(state);
  updateRevengeCooldowns(state);

  // Re-check living after all soaks
  if (!state.roundOver) updateLiving(state);

  return state;
}

/** Default empty input */
export function emptyInput(seq = 0, tick = 0): PlayerInput {
  return { seq, tick, dir: 'none', balloonPressed: false };
}

/** Clone state shallowly enough for prediction rewind (structured clone of arrays) */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    grid: state.grid.slice(),
    players: state.players.map((p) => ({ ...p })),
    balloons: state.balloons.map((b) => ({ ...b })),
    splashes: state.splashes.map((s) => ({ ...s, tiles: s.tiles.map((t) => ({ ...t })) })),
    powerups: state.powerups.map((p) => ({ ...p })),
    hiddenPowerups: state.hiddenPowerups.map((h) => ({ ...h })),
    events: [],
    winnerIds: state.winnerIds.slice(),
  };
}

/** Public snapshot without hidden powerups */
export function toSnapshot(state: GameState) {
  return {
    tick: state.tick,
    players: state.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      x: p.x,
      y: p.y,
      dir: p.dir,
      moving: p.moving,
      speed: p.speed,
      balloonCount: p.balloonCount,
      splashRange: p.splashRange,
      balloonsOut: p.balloonsOut,
      hasBoots: p.hasBoots,
      soaked: p.soaked,
      alive: p.alive,
      isBot: p.isBot,
      animal: p.animal,
      hat: p.hat,
      nickname: p.nickname,
      revenge: p.revenge,
      soaks: p.soaks,
      inputSeq: p.inputSeq,
    })),
    balloons: state.balloons.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      x: b.x,
      y: b.y,
      placeTick: b.placeTick,
      fuseTicks: b.fuseTicks,
      splashRange: b.splashRange,
      sliding: b.sliding,
      slideDir: b.slideDir,
    })),
    splashes: state.splashes.map((s) => ({
      tiles: s.tiles.map((t) => ({ ...t })),
      startTick: s.startTick,
      lingerTicks: s.lingerTicks,
      chainDepth: s.chainDepth,
    })),
    powerups: state.powerups.map((p) => ({ ...p })),
    tideRing: state.tideRing,
    livingCount: state.livingCount,
  };
}
