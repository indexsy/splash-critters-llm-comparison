import { CONFIG } from './config.js';
import type {
  PlayerId,
  Balloon,
  Splash,
  SimEvent,
  PlayerState,
  RoundStats,
  InputFrame,
  GameConfig,
  Direction,
  PowerUpType,
} from './types.js';
import {
  type GeneratedMap,
  generateMap,
  getTile,
  setTile,
  inBounds,
  isSolid,
  revealPowerUp,
} from './map.js';

export interface RoundState {
  tick: number;
  map: GeneratedMap;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  exposedPowerUps: Map<string, PowerUpType>;
  tideRing: number;
  events: SimEvent[];
  matchConfig: GameConfig;
  roundNo: number;
  winner: PlayerId | null;
  ended: boolean;
}

export interface SimInput {
  tick: number;
  playerInputs: Map<PlayerId, InputFrame>;
}

export function simulateTick(
  state: RoundState,
  inputs: SimInput,
  config: typeof CONFIG
): RoundState {
  if (state.ended) return state;

  const newState = cloneState(state);
  newState.tick = state.tick + 1;
  newState.events = [];

  // 1. Apply inputs and place balloons
  for (const player of newState.players) {
    if (!player.alive) continue;
    const input = inputs.playerInputs.get(player.playerId);
    if (input) {
      player.inputDir = input.dir;
      if (input.balloonPressed) {
        placeBalloon(player, newState, config);
      }
    }
  }

  // 2. Process movement
  for (const player of newState.players) {
    if (!player.alive) continue;
    if (player.inputDir) {
      player.direction = player.inputDir;
      movePlayer(player, newState, config);
    }
  }

  // 3. Collect power-ups from pre-exposed items
  for (const player of newState.players) {
    if (!player.alive) continue;
    collectPowerUp(player, newState, config);
  }

  // 4. Update kicked balloons (slide)
  for (const balloon of newState.balloons) {
    if (balloon.isKicked) {
      updateKickedBalloon(balloon, newState, config);
    }
  }

  // 5. Decrement fuses
  for (const balloon of newState.balloons) {
    if (balloon.fuseTicks > 0) {
      balloon.fuseTicks--;
    }
  }

  // 6. Process bursts (chains)
  processBursts(newState, config);

  // 7. Collect newly-revealed power-ups
  for (const player of newState.players) {
    if (!player.alive) continue;
    collectPowerUp(player, newState, config);
  }

  // 8. Update splashes (soak lingering + decrement timers)
  updateSplashes(newState);

  // 9. Rising tide
  processTide(newState, config);

  // 10. Revenge ducks
  processRevengeDucks(newState, config);

  // 11. Check round end
  checkRoundEnd(newState);

  return newState;
}

export function createRoundState(
  matchConfig: GameConfig,
  mapSeed: number,
  roundNo: number,
  players: PlayerState[]
): RoundState {
  const map = generateMap(mapSeed, matchConfig.mode);
  const clonedPlayers = players.map((p, i) => ({
    ...p,
    x: map.spawnPoints[i % map.spawnPoints.length].x,
    y: map.spawnPoints[i % map.spawnPoints.length].y,
  }));

  return {
    tick: 0,
    map,
    players: clonedPlayers,
    balloons: [],
    splashes: [],
    exposedPowerUps: new Map(),
    tideRing: 0,
    events: [],
    matchConfig,
    roundNo,
    winner: null,
    ended: false,
  };
}

export function getInitialPlayerState(
  playerId: PlayerId,
  nickname: string,
  animal: PlayerState['animal'],
  spawn: { x: number; y: number }
): PlayerState {
  return {
    playerId,
    nickname,
    animal,
    x: spawn.x,
    y: spawn.y,
    alive: true,
    direction: null,
    speed: CONFIG.BASE_SPEED,
    balloonCount: CONFIG.BASE_BALLOON_COUNT,
    splashRange: CONFIG.BASE_SPLASH_RANGE,
    hasBoots: false,
    balloonsAlive: 0,
    emoteCooldown: 0,
    soakedAt: null,
    soaks: 0,
    castlesWashed: 0,
    chainBursts: 0,
    revengeDuckCooldown: 0,
    revengeDuckReady: false,
    score: 0,
    inputDir: null,
  };
}

export function isPlayerInSplash(
  state: RoundState,
  playerId: PlayerId
): boolean {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player || !player.alive) return false;
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  return state.splashes.some((s) => s.x === tx && s.y === ty);
}

export function canPlaceBalloon(
  state: RoundState,
  playerId: PlayerId
): boolean {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player || !player.alive) return false;
  if (player.balloonsAlive >= player.balloonCount) return false;

  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  if (isSolid(state.map, { x: tx, y: ty })) return false;
  if (findBalloonAt(state, tx, ty)) return false;

  return true;
}

export function resolveRoundEnd(
  state: RoundState
): { winner: PlayerId | null; placements: PlayerId[]; stats: RoundStats } | null {
  if (!state.ended) return null;

  const alivePlayers = state.players.filter((p) => p.alive);
  const winner = alivePlayers.length === 1 ? alivePlayers[0].playerId : null;

  const sorted = [...state.players].sort((a, b) => {
    if (a.alive && !b.alive) return -1;
    if (!a.alive && b.alive) return 1;
    if (a.soakedAt !== null && b.soakedAt !== null) {
      return b.soakedAt - a.soakedAt;
    }
    if (a.soakedAt === null && b.soakedAt !== null) return -1;
    if (a.soakedAt !== null && b.soakedAt === null) return 1;
    return 0;
  });

  const placements = sorted.map((p) => p.playerId);

  const stats: RoundStats = {
    soaks: {},
    chainBursts: {},
    castlesWashed: {},
  };
  for (const player of state.players) {
    stats.soaks[player.playerId] = player.soaks;
    stats.chainBursts[player.playerId] = player.chainBursts;
    stats.castlesWashed[player.playerId] = player.castlesWashed;
  }

  return { winner, placements, stats };
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

function cloneState(state: RoundState): RoundState {
  return {
    ...state,
    map: {
      ...state.map,
      grid: state.map.grid.map((row) => [...row]),
      hiddenPowerUps: new Map(state.map.hiddenPowerUps),
    },
    players: state.players.map((p) => ({ ...p })),
    balloons: state.balloons.map((b) => ({ ...b })),
    splashes: state.splashes.map((s) => ({ ...s })),
    exposedPowerUps: new Map(state.exposedPowerUps),
    events: [],
  };
}

function findBalloonAt(
  state: RoundState,
  x: number,
  y: number,
  excludeId?: string
): Balloon | undefined {
  return state.balloons.find(
    (b) => b.x === x && b.y === y && b.id !== excludeId
  );
}

function findPlayerAt(
  state: RoundState,
  x: number,
  y: number,
  excludeId?: PlayerId
): PlayerState | undefined {
  return state.players.find(
    (p) =>
      p.alive &&
      Math.floor(p.x) === x &&
      Math.floor(p.y) === y &&
      p.playerId !== excludeId
  );
}

function placeBalloon(
  player: PlayerState,
  state: RoundState,
  config: typeof CONFIG
): void {
  if (!canPlaceBalloon(state, player.playerId)) return;

  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);

  const balloon: Balloon = {
    id: `${player.playerId}-${state.tick}-${state.balloons.length}`,
    x: tx,
    y: ty,
    fuseTicks: config.BALLOON_FUSE_TICKS,
    ownerId: player.playerId,
    solid: true,
    isKicked: false,
    kickDir: null,
    splashRange: player.splashRange,
  };

  state.balloons.push(balloon);
  player.balloonsAlive++;
}

function movePlayer(
  player: PlayerState,
  state: RoundState,
  config: typeof CONFIG
): void {
  if (!player.direction || !player.alive) return;

  const dx =
    player.direction === 'left' ? -1 : player.direction === 'right' ? 1 : 0;
  const dy =
    player.direction === 'up' ? -1 : player.direction === 'down' ? 1 : 0;

  const step = player.speed / config.TICK_RATE;
  const newX = player.x + dx * step;
  const newY = player.y + dy * step;

  const currentTx = Math.floor(player.x);
  const currentTy = Math.floor(player.y);
  const newTx = Math.floor(newX);
  const newTy = Math.floor(newY);

  // Clamp to bounds
  if (newX < 0) {
    player.x = 0;
    return;
  }
  if (newX >= state.map.width) {
    player.x = state.map.width - 0.001;
    return;
  }
  if (newY < 0) {
    player.y = 0;
    return;
  }
  if (newY >= state.map.height) {
    player.y = state.map.height - 0.001;
    return;
  }

  // Changing tiles — check obstacles
  if (newTx !== currentTx || newTy !== currentTy) {
    const tile = getTile(state.map, { x: newTx, y: newTy });
    if (tile === 'boulder' || tile === 'sandcastle' || tile === 'water') {
      snapToBoundary(player, currentTx, currentTy, dx, dy);
      return;
    }

    const balloon = findBalloonAt(state, newTx, newTy);
    if (balloon) {
      if (balloon.ownerId === player.playerId) {
        snapToBoundary(player, currentTx, currentTy, dx, dy);
        return;
      }
      if (player.hasBoots && state.matchConfig.enableKick) {
        balloon.isKicked = true;
        balloon.kickDir = player.direction;
        state.events.push({
          type: 'balloon_kicked',
          balloonId: balloon.id,
          x: balloon.x,
          y: balloon.y,
          dir: player.direction,
        });
      } else {
        snapToBoundary(player, currentTx, currentTy, dx, dy);
        return;
      }
    }

    const otherPlayer = findPlayerAt(state, newTx, newTy, player.playerId);
    if (otherPlayer) {
      snapToBoundary(player, currentTx, currentTy, dx, dy);
      return;
    }
  }

  player.x = newX;
  player.y = newY;
}

function snapToBoundary(
  player: PlayerState,
  currentTx: number,
  currentTy: number,
  dx: number,
  dy: number
): void {
  if (dx > 0) player.x = currentTx + 1 - 1e-6;
  else if (dx < 0) player.x = currentTx;

  if (dy > 0) player.y = currentTy + 1 - 1e-6;
  else if (dy < 0) player.y = currentTy;
}

function collectPowerUp(
  player: PlayerState,
  state: RoundState,
  config: typeof CONFIG
): void {
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  const key = `${tx},${ty}`;

  const powerUp = state.exposedPowerUps.get(key);
  if (!powerUp) return;

  state.exposedPowerUps.delete(key);
  setTile(state.map, { x: tx, y: ty }, 'empty');

  switch (powerUp) {
    case 'extraBalloon':
      player.balloonCount = Math.min(
        player.balloonCount + 1,
        config.MAX_BALLOON_COUNT
      );
      break;
    case 'bigSplash':
      player.splashRange = Math.min(
        player.splashRange + 1,
        config.MAX_SPLASH_RANGE
      );
      break;
    case 'flippers':
      player.speed = Math.min(
        player.speed + config.SPEED_PER_FLIPPERS,
        config.MAX_SPEED
      );
      break;
    case 'rubberBoots':
      player.hasBoots = true;
      break;
  }

  state.events.push({
    type: 'powerup_collected',
    playerId: player.playerId,
    x: tx,
    y: ty,
    powerUp,
  });
}

function updateKickedBalloon(
  balloon: Balloon,
  state: RoundState,
  _config: typeof CONFIG
): void {
  if (!balloon.isKicked || !balloon.kickDir) return;

  const dx =
    balloon.kickDir === 'left' ? -1 : balloon.kickDir === 'right' ? 1 : 0;
  const dy =
    balloon.kickDir === 'up' ? -1 : balloon.kickDir === 'down' ? 1 : 0;

  const nx = balloon.x + dx;
  const ny = balloon.y + dy;

  if (!inBounds(state.map, { x: nx, y: ny })) {
    balloon.isKicked = false;
    balloon.kickDir = null;
    return;
  }

  const tile = getTile(state.map, { x: nx, y: ny });
  if (tile === 'boulder' || tile === 'sandcastle' || tile === 'water') {
    balloon.isKicked = false;
    balloon.kickDir = null;
    return;
  }

  if (findBalloonAt(state, nx, ny, balloon.id)) {
    balloon.isKicked = false;
    balloon.kickDir = null;
    return;
  }

  if (findPlayerAt(state, nx, ny)) {
    balloon.isKicked = false;
    balloon.kickDir = null;
    return;
  }

  balloon.x = nx;
  balloon.y = ny;
}

function processBursts(state: RoundState, config: typeof CONFIG): void {
  const toBurst: Balloon[] = [];
  const burstIds = new Set<string>();

  for (const balloon of state.balloons) {
    if (balloon.fuseTicks <= 0 && !burstIds.has(balloon.id)) {
      toBurst.push(balloon);
      burstIds.add(balloon.id);
    }
  }

  const splashTiles: Splash[] = [];
  const burstBalloons: Balloon[] = [];

  while (toBurst.length > 0) {
    const balloon = toBurst.shift()!;
    burstBalloons.push(balloon);

    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    for (const dir of dirs) {
      const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

      for (let i = 1; i <= balloon.splashRange; i++) {
        const tx = balloon.x + dx * i;
        const ty = balloon.y + dy * i;

        if (!inBounds(state.map, { x: tx, y: ty })) break;

        const tile = getTile(state.map, { x: tx, y: ty });
        if (tile === 'boulder') break;

        const otherBalloon = findBalloonAt(state, tx, ty);
        if (otherBalloon && !burstIds.has(otherBalloon.id)) {
          toBurst.push(otherBalloon);
          burstIds.add(otherBalloon.id);
        }

        splashTiles.push({
          x: tx,
          y: ty,
          ticksRemaining: config.SPLASH_LINGER_TICKS,
          ownerId: balloon.ownerId,
        });

        for (const player of state.players) {
          if (
            player.alive &&
            Math.floor(player.x) === tx &&
            Math.floor(player.y) === ty
          ) {
            soakPlayer(player, balloon.ownerId, state, tx, ty);
          }
        }

        const key = `${tx},${ty}`;
        if (state.exposedPowerUps.has(key)) {
          const powerUp = state.exposedPowerUps.get(key)!;
          state.exposedPowerUps.delete(key);
          setTile(state.map, { x: tx, y: ty }, 'empty');
          state.events.push({
            type: 'powerup_destroyed',
            x: tx,
            y: ty,
            powerUp,
          });
        }

        if (tile === 'sandcastle') {
          const powerUp = revealPowerUp(state.map, { x: tx, y: ty });
          setTile(state.map, { x: tx, y: ty }, 'empty');
          if (powerUp) {
            state.exposedPowerUps.set(key, powerUp);
            state.events.push({
              type: 'powerup_revealed',
              x: tx,
              y: ty,
              powerUp,
            });
          }
          state.events.push({ type: 'castle_washed', x: tx, y: ty });
          const owner = state.players.find(
            (p) => p.playerId === balloon.ownerId
          );
          if (owner) owner.castlesWashed++;
          break;
        }

        if (tile === 'water') break;
      }
    }

    // Center tile
    for (const player of state.players) {
      if (
        player.alive &&
        Math.floor(player.x) === balloon.x &&
        Math.floor(player.y) === balloon.y
      ) {
        soakPlayer(player, balloon.ownerId, state, balloon.x, balloon.y);
      }
    }
    splashTiles.push({
      x: balloon.x,
      y: balloon.y,
      ticksRemaining: config.SPLASH_LINGER_TICKS,
      ownerId: balloon.ownerId,
    });
  }

  state.balloons = state.balloons.filter((b) => !burstIds.has(b.id));

  for (const balloon of burstBalloons) {
    const owner = state.players.find((p) => p.playerId === balloon.ownerId);
    if (owner) {
      owner.balloonsAlive--;
      if (owner.balloonsAlive < 0) owner.balloonsAlive = 0;
    }
  }

  state.splashes.push(...splashTiles);

  if (burstBalloons.length >= 2) {
    state.events.push({
      type: 'chain_burst',
      chainCount: burstBalloons.length,
    });
  }
}

function soakPlayer(
  player: PlayerState,
  soakedBy: PlayerId | null,
  state: RoundState,
  x: number,
  y: number
): void {
  if (!player.alive) return;
  player.alive = false;
  player.soakedAt = state.tick;

  if (state.matchConfig.enableRevengeDucks) {
    player.revengeDuckReady = true;
    player.revengeDuckCooldown = 0;
    const borderPos = getNearestBorderTile(state.map, player.x, player.y);
    player.x = borderPos.x;
    player.y = borderPos.y;
  }

  state.events.push({
    type: 'player_soaked',
    playerId: player.playerId,
    soakedBy,
    x,
    y,
  });

  if (soakedBy) {
    const soaker = state.players.find((p) => p.playerId === soakedBy);
    if (soaker && soaker.alive) {
      soaker.soaks++;
    }
  }
}

function getNearestBorderTile(
  map: GeneratedMap,
  x: number,
  y: number
): { x: number; y: number } {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const dTop = ty;
  const dBottom = map.height - 1 - ty;
  const dLeft = tx;
  const dRight = map.width - 1 - tx;
  const minDist = Math.min(dTop, dBottom, dLeft, dRight);

  if (minDist === dTop) return { x: tx, y: 0 };
  if (minDist === dBottom) return { x: tx, y: map.height - 1 };
  if (minDist === dLeft) return { x: 0, y: ty };
  return { x: map.width - 1, y: ty };
}

function updateSplashes(state: RoundState): void {
  // Soak anyone standing in a lingering splash
  for (const splash of state.splashes) {
    if (splash.ticksRemaining <= 0) continue;
    for (const player of state.players) {
      if (
        player.alive &&
        Math.floor(player.x) === splash.x &&
        Math.floor(player.y) === splash.y
      ) {
        soakPlayer(player, splash.ownerId, state, splash.x, splash.y);
      }
    }
  }

  for (const splash of state.splashes) {
    splash.ticksRemaining--;
  }
  state.splashes = state.splashes.filter((s) => s.ticksRemaining > 0);
}

function processTide(state: RoundState, config: typeof CONFIG): void {
  if (state.tick < config.TIDE_START_TICKS) return;
  if ((state.tick - config.TIDE_START_TICKS) % config.TIDE_INTERVAL_TICKS !== 0)
    return;

  state.tideRing++;
  const ring = state.tideRing;
  const map = state.map;

  const minX = ring - 1;
  const maxX = map.width - ring;
  const minY = ring - 1;
  const maxY = map.height - ring;

  if (minX > maxX || minY > maxY) return;

  const floodedTiles: { x: number; y: number }[] = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (x === minX || x === maxX || y === minY || y === maxY) {
        const tile = getTile(map, { x, y });
        if (tile !== 'water') {
          setTile(map, { x, y }, 'water');
          floodedTiles.push({ x, y });

          for (const player of state.players) {
            if (
              player.alive &&
              Math.floor(player.x) === x &&
              Math.floor(player.y) === y
            ) {
              soakPlayer(player, null, state, x, y);
            }
          }

          const key = `${x},${y}`;
          if (state.exposedPowerUps.has(key)) {
            const powerUp = state.exposedPowerUps.get(key)!;
            state.exposedPowerUps.delete(key);
            state.events.push({
              type: 'powerup_destroyed',
              x,
              y,
              powerUp,
            });
          }

          if (tile === 'sandcastle') {
            const powerUp = revealPowerUp(map, { x, y });
            setTile(map, { x, y }, 'water');
            if (powerUp) {
              state.exposedPowerUps.set(key, powerUp);
              state.events.push({
                type: 'powerup_revealed',
                x,
                y,
                powerUp,
              });
            }
            state.events.push({ type: 'castle_washed', x, y });
          }
        }
      }
    }
  }

  if (floodedTiles.length > 0) {
    state.events.push({ type: 'tide_advance', ring });
  }
}

function processRevengeDucks(state: RoundState, config: typeof CONFIG): void {
  if (!state.matchConfig.enableRevengeDucks) return;

  for (const player of state.players) {
    if (player.alive) continue;

    moveDuck(player, state);

    if (player.revengeDuckCooldown > 0) {
      player.revengeDuckCooldown--;
      continue;
    }

    if (player.revengeDuckReady) {
      lobRevengeBalloon(player, state, config);
      player.revengeDuckReady = false;
      player.revengeDuckCooldown = config.REVENGE_DUCK_INTERVAL;
    }
  }
}

function moveDuck(player: PlayerState, state: RoundState): void {
  const map = state.map;
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);

  if (ty === 0 && tx < map.width - 1) {
    player.direction = 'right';
  } else if (tx === map.width - 1 && ty < map.height - 1) {
    player.direction = 'down';
  } else if (ty === map.height - 1 && tx > 0) {
    player.direction = 'left';
  } else if (tx === 0 && ty > 0) {
    player.direction = 'up';
  }

  const dx =
    player.direction === 'left' ? -1 : player.direction === 'right' ? 1 : 0;
  const dy =
    player.direction === 'up' ? -1 : player.direction === 'down' ? 1 : 0;

  const nx = tx + dx;
  const ny = ty + dy;

  if (inBounds(map, { x: nx, y: ny })) {
    player.x = nx;
    player.y = ny;
  }
}

function lobRevengeBalloon(
  player: PlayerState,
  state: RoundState,
  config: typeof CONFIG
): void {
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);

  let dir: Direction;
  if (ty === 0) dir = 'down';
  else if (ty === state.map.height - 1) dir = 'up';
  else if (tx === 0) dir = 'right';
  else dir = 'left';

  const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

  const splashTiles: Splash[] = [];

  for (let i = 1; i <= config.REVENGE_DUCK_RANGE; i++) {
    const sx = tx + dx * i;
    const sy = ty + dy * i;

    if (!inBounds(state.map, { x: sx, y: sy })) break;

    const tile = getTile(state.map, { x: sx, y: sy });
    if (tile === 'boulder' || tile === 'sandcastle' || tile === 'water')
      break;

    splashTiles.push({
      x: sx,
      y: sy,
      ticksRemaining: config.SPLASH_LINGER_TICKS,
      ownerId: player.playerId,
    });

    for (const target of state.players) {
      if (
        target.alive &&
        Math.floor(target.x) === sx &&
        Math.floor(target.y) === sy
      ) {
        soakPlayer(target, player.playerId, state, sx, sy);
      }
    }

    const key = `${sx},${sy}`;
    if (state.exposedPowerUps.has(key)) {
      const powerUp = state.exposedPowerUps.get(key)!;
      state.exposedPowerUps.delete(key);
      setTile(state.map, { x: sx, y: sy }, 'empty');
      state.events.push({
        type: 'powerup_destroyed',
        x: sx,
        y: sy,
        powerUp,
      });
    }
  }

  state.splashes.push(...splashTiles);
  state.events.push({
    type: 'revenge_lob',
    playerId: player.playerId,
    x: tx,
    y: ty,
    dir,
  });
}

function checkRoundEnd(state: RoundState): void {
  if (state.ended) return;
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.ended = true;
    state.winner = alive.length === 1 ? alive[0].playerId : null;
  }
}
