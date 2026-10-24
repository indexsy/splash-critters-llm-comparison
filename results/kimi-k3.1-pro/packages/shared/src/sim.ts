import { CONFIG, DIRECTIONS } from "./config.js";
import { hashSeed } from "./rng.js";
import { generateMap, mapIndex, spawnsFor, syncTide, tileAt } from "./map.js";
import { TILE } from "./types.js";
import type {
  BalloonState,
  CardinalDirection,
  Direction,
  GameEvent,
  GameState,
  MapData,
  MatchConfig,
  PlayerDescriptor,
  PlayerInput,
  PlayerState,
  PowerUpType,
  Snapshot,
  TileValue
} from "./types.js";

const DELTAS: Record<CardinalDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

export function directionDelta(direction: CardinalDirection) {
  return DELTAS[direction];
}

export function dimensionsFor(config: MatchConfig) {
  return config.tutorial ? CONFIG.ARENA.tutorial : CONFIG.ARENA[config.mode];
}

function makePlayer(descriptor: PlayerDescriptor): PlayerState {
  return {
    ...descriptor,
    x: 0,
    y: 0,
    dir: "none",
    speed: CONFIG.BASE_SPEED,
    balloonCount: CONFIG.BASE_BALLOONS,
    splashRange: CONFIG.BASE_SPLASH_RANGE,
    kick: false,
    alive: true,
    roundsWon: 0,
    soaks: 0,
    castlesWashed: 0,
    biggestChain: 0,
    survivalTicks: 0,
    totalSurvivalTicks: 0,
    lastInputSeq: 0,
    emote: 0,
    emoteTick: -1000,
    revengePosition: 0,
    revengeCooldown: 0,
    ping: 0
  };
}

function emptyMap(width: number, height: number, mode: MatchConfig["mode"], tutorial: boolean): MapData {
  return {
    width,
    height,
    tiles: new Array<TileValue>(width * height).fill(TILE.FLOOR),
    hiddenPowerups: new Array<PowerUpType | null>(width * height).fill(null),
    flooded: new Array<boolean>(width * height).fill(false),
    spawns: spawnsFor(width, height, mode, tutorial)
  };
}

export function createGameState(matchSeed: number, config: MatchConfig, descriptors: PlayerDescriptor[]): GameState {
  const dimensions = dimensionsFor(config);
  const state: GameState = {
    tick: 0,
    roundStartedTick: 0,
    round: 0,
    phase: "countdown",
    phaseTicks: CONFIG.ROUND_COUNTDOWN_TICKS,
    matchSeed,
    mapSeed: 0,
    config,
    map: emptyMap(dimensions.width, dimensions.height, config.mode, config.tutorial),
    players: descriptors.map(makePlayer),
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    nextEntityId: 1,
    roundWinnerId: null,
    lastSoakedTick: -1
  };
  startNextRound(state);
  return state;
}

export function createClientGameState(
  config: MatchConfig,
  descriptors: PlayerDescriptor[],
  round: number,
  mapSeed: number,
  width: number,
  height: number,
  castleGrid: TileValue[]
): GameState {
  return {
    tick: 0,
    roundStartedTick: 0,
    round,
    phase: "countdown",
    phaseTicks: CONFIG.ROUND_COUNTDOWN_TICKS,
    matchSeed: 0,
    mapSeed,
    config,
    map: {
      width,
      height,
      tiles: [...castleGrid],
      hiddenPowerups: new Array<PowerUpType | null>(width * height).fill(null),
      flooded: new Array<boolean>(width * height).fill(false),
      spawns: spawnsFor(width, height, config.mode, config.tutorial)
    },
    players: descriptors.map(makePlayer),
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    nextEntityId: 1,
    roundWinnerId: null,
    lastSoakedTick: -1
  };
}

export function startNextRound(state: GameState): void {
  state.round += 1;
  state.roundStartedTick = state.tick;
  state.mapSeed = hashSeed(state.matchSeed, state.round);
  const dimensions = dimensionsFor(state.config);
  state.map = generateMap(dimensions.width, dimensions.height, state.mapSeed, state.config.mode, state.config.tutorial);
  if (state.config.tutorial) {
    for (let y = 1; y < state.map.height - 1; y += 1) {
      for (let x = 1; x < state.map.width - 1; x += 1) {
        const index = mapIndex(state.map, x, y);
        if (state.map.tiles[index] !== TILE.BOULDER) {
          state.map.tiles[index] = TILE.FLOOR;
          state.map.hiddenPowerups[index] = null;
        }
      }
    }
    const scripted: [number, number, PowerUpType][] = [[3, 1, "balloon"], [1, 3, "speed"], [3, 3, "range"], [5, 3, "balloon"], [5, 5, "speed"], [3, 5, "kick"]];
    for (const [x, y, kind] of scripted) {
      const index = mapIndex(state.map, x, y);
      state.map.tiles[index] = TILE.CASTLE;
      state.map.hiddenPowerups[index] = kind;
    }
  }
  state.balloons = [];
  state.splashes = [];
  state.powerups = [];
  state.tideRing = 0;
  state.roundWinnerId = null;
  state.phase = "countdown";
  state.phaseTicks = CONFIG.ROUND_COUNTDOWN_TICKS;
  state.players.forEach((player, index) => {
    const spawn = state.map.spawns[index] ?? state.map.spawns[0];
    player.x = spawn.x;
    player.y = spawn.y;
    player.dir = "none";
    player.speed = CONFIG.BASE_SPEED;
    player.balloonCount = state.config.tutorial && !player.bot ? 2 : CONFIG.BASE_BALLOONS;
    player.splashRange = state.config.tutorial && !player.bot ? 3 : CONFIG.BASE_SPLASH_RANGE;
    player.kick = false;
    player.alive = true;
    player.survivalTicks = 0;
    player.lastInputSeq = 0;
    player.emote = 0;
    player.emoteTick = -1000;
    player.revengePosition = 0;
    player.revengeCooldown = 0;
  });
}

export function cloneGameState(state: GameState): GameState {
  return structuredClone(state);
}

export function snapshotState(state: GameState): Snapshot {
  return {
    tick: state.tick,
    roundStartedTick: state.roundStartedTick,
    round: state.round,
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    mapSeed: state.mapSeed,
    players: state.players.map((player) => ({ ...player })),
    balloons: state.balloons.map((balloon) => ({ ...balloon, passThrough: [...balloon.passThrough] })),
    splashes: state.splashes.map((splash) => ({ ...splash })),
    powerups: state.powerups.map((powerup) => ({ ...powerup })),
    tideRing: state.tideRing,
    nextEntityId: state.nextEntityId,
    roundWinnerId: state.roundWinnerId
  };
}

export function applySnapshot(state: GameState, snapshot: Snapshot): void {
  state.tick = snapshot.tick;
  state.roundStartedTick = snapshot.roundStartedTick;
  state.round = snapshot.round;
  state.phase = snapshot.phase;
  state.phaseTicks = snapshot.phaseTicks;
  state.mapSeed = snapshot.mapSeed;
  state.players = snapshot.players.map((player) => ({ ...player }));
  state.balloons = snapshot.balloons.map((balloon) => ({ ...balloon, passThrough: [...balloon.passThrough] }));
  state.splashes = snapshot.splashes.map((splash) => ({ ...splash }));
  state.powerups = snapshot.powerups.map((powerup) => ({ ...powerup }));
  state.tideRing = snapshot.tideRing;
  state.nextEntityId = snapshot.nextEntityId;
  state.roundWinnerId = snapshot.roundWinnerId;
  syncTide(state.map, state.tideRing);
}

export function findBalloonAt(state: GameState, x: number, y: number, exceptId = -1): BalloonState | undefined {
  return state.balloons.find((balloon) => balloon.id !== exceptId && Math.round(balloon.x) === x && Math.round(balloon.y) === y);
}

function overlapsTile(x: number, y: number, tileX: number, tileY: number, radius = 0.28): boolean {
  return x + radius > tileX - 0.5 && x - radius < tileX + 0.5 && y + radius > tileY - 0.5 && y - radius < tileY + 0.5;
}

export function canOccupy(state: GameState, player: PlayerState, x: number, y: number): boolean {
  const radius = 0.28;
  const minX = Math.floor(x - radius + 0.5);
  const maxX = Math.floor(x + radius + 0.5);
  const minY = Math.floor(y - radius + 0.5);
  const maxY = Math.floor(y + radius + 0.5);
  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      const tile = tileAt(state.map, tileX, tileY);
      if (tile === TILE.BOULDER || tile === TILE.CASTLE) return false;
    }
  }
  for (const balloon of state.balloons) {
    if (balloon.passThrough.includes(player.id)) continue;
    if (overlapsTile(x, y, balloon.x, balloon.y, radius)) return false;
  }
  return true;
}

function tryKick(state: GameState, player: PlayerState, direction: CardinalDirection, events: GameEvent[]): void {
  if (!state.config.kick || !player.kick) return;
  const delta = DELTAS[direction];
  const x = Math.round(player.x) + delta.x;
  const y = Math.round(player.y) + delta.y;
  const balloon = findBalloonAt(state, x, y);
  if (!balloon || balloon.kickDir || Math.hypot(balloon.x - player.x, balloon.y - player.y) > 0.9) return;
  balloon.kickDir = direction;
  balloon.direction = direction;
  balloon.kickProgress = 0;
  balloon.passThrough = [];
  events.push({ type: "balloon_kicked", tick: state.tick, balloonId: balloon.id, playerId: player.id, dir: direction });
}

function movePlayer(state: GameState, player: PlayerState, direction: Direction, events: GameEvent[]): void {
  if (direction === "none") {
    player.dir = "none";
    return;
  }
  player.dir = direction;
  tryKick(state, player, direction, events);
  const delta = DELTAS[direction];
  const distance = player.speed / CONFIG.TICK_RATE;
  const primaryX = player.x + delta.x * distance;
  const primaryY = player.y + delta.y * distance;
  let nextX = primaryX;
  let nextY = primaryY;
  if (delta.x === 0) {
    const center = Math.round(player.x);
    nextX = player.x + Math.sign(center - player.x) * Math.min(distance, Math.abs(center - player.x));
  } else {
    const center = Math.round(player.y);
    nextY = player.y + Math.sign(center - player.y) * Math.min(distance, Math.abs(center - player.y));
  }
  if (canOccupy(state, player, nextX, nextY)) {
    player.x = nextX;
    player.y = nextY;
  } else if (canOccupy(state, player, primaryX, primaryY)) {
    player.x = primaryX;
    player.y = primaryY;
  } else if (canOccupy(state, player, nextX, player.y) && delta.x === 0) {
    player.x = nextX;
  } else if (canOccupy(state, player, player.x, nextY) && delta.y === 0) {
    player.y = nextY;
  }
}

function updatePassThrough(state: GameState): void {
  for (const balloon of state.balloons) {
    balloon.passThrough = balloon.passThrough.filter((playerId) => {
      const player = state.players.find((candidate) => candidate.id === playerId);
      return Boolean(player?.alive && overlapsTile(player.x, player.y, balloon.x, balloon.y));
    });
  }
}

function dropBalloon(state: GameState, player: PlayerState, events: GameEvent[]): void {
  const x = Math.round(player.x);
  const y = Math.round(player.y);
  if (tileAt(state.map, x, y) !== TILE.FLOOR || findBalloonAt(state, x, y)) return;
  const active = state.balloons.filter((balloon) => balloon.ownerId === player.id && !balloon.revenge).length;
  if (active >= player.balloonCount) return;
  const balloon: BalloonState = {
    id: state.nextEntityId++,
    ownerId: player.id,
    x,
    y,
    fuse: CONFIG.BALLOON_FUSE_TICKS,
    range: player.splashRange,
    passThrough: [player.id],
    kickDir: null,
    direction: "down",
    kickProgress: 0,
    straight: false,
    revenge: false
  };
  state.balloons.push(balloon);
  events.push({ type: "balloon_dropped", tick: state.tick, balloonId: balloon.id, playerId: player.id, x, y });
}

function kickBlocked(state: GameState, balloon: BalloonState, x: number, y: number): boolean {
  const tile = tileAt(state.map, x, y);
  if (tile === TILE.BOULDER || tile === TILE.CASTLE || findBalloonAt(state, x, y, balloon.id)) return true;
  return state.players.some((player) => player.alive && Math.round(player.x) === x && Math.round(player.y) === y);
}

function updateKickedBalloon(state: GameState, balloon: BalloonState): void {
  if (!balloon.kickDir) return;
  balloon.kickProgress += CONFIG.KICK_SPEED / CONFIG.TICK_RATE;
  if (balloon.kickProgress < 1) return;
  balloon.kickProgress -= 1;
  const delta = DELTAS[balloon.kickDir];
  const nextX = Math.round(balloon.x) + delta.x;
  const nextY = Math.round(balloon.y) + delta.y;
  if (kickBlocked(state, balloon, nextX, nextY)) {
    balloon.kickDir = null;
    balloon.kickProgress = 0;
    balloon.x = Math.round(balloon.x);
    balloon.y = Math.round(balloon.y);
    return;
  }
  balloon.x = nextX;
  balloon.y = nextY;
}

function perimeterPoint(map: MapData, position: number): { x: number; y: number; inward: CardinalDirection } {
  const horizontal = map.width - 1;
  const vertical = map.height - 1;
  const length = 2 * (horizontal + vertical);
  let value = ((position % length) + length) % length;
  if (value < horizontal) return { x: value, y: 0, inward: "down" };
  value -= horizontal;
  if (value < vertical) return { x: horizontal, y: value, inward: "left" };
  value -= vertical;
  if (value < horizontal) return { x: horizontal - value, y: vertical, inward: "up" };
  value -= horizontal;
  return { x: 0, y: vertical - value, inward: "right" };
}

function updateRevenge(state: GameState, player: PlayerState, input: PlayerInput, events: GameEvent[]): void {
  if (!state.config.revengeDucks || state.config.ranked) return;
  const reverse = input.dir === "left" || input.dir === "up";
  player.revengePosition += (reverse ? -1 : 1) * CONFIG.BASE_SPEED / CONFIG.TICK_RATE;
  const point = perimeterPoint(state.map, player.revengePosition);
  player.x = point.x;
  player.y = point.y;
  player.dir = point.inward;
  player.revengeCooldown = Math.max(0, player.revengeCooldown - 1);
  if (!input.balloonPressed || player.revengeCooldown > 0) return;
  const delta = DELTAS[point.inward];
  const x = Math.round(point.x) + delta.x;
  const y = Math.round(point.y) + delta.y;
  if (tileAt(state.map, x, y) !== TILE.FLOOR || findBalloonAt(state, x, y)) return;
  const balloon: BalloonState = {
    id: state.nextEntityId++,
    ownerId: player.id,
    x,
    y,
    fuse: CONFIG.REVENGE_FUSE_TICKS,
    range: CONFIG.REVENGE_RANGE,
    passThrough: [],
    kickDir: null,
    direction: point.inward,
    kickProgress: 0,
    straight: true,
    revenge: true
  };
  state.balloons.push(balloon);
  player.revengeCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
  events.push({ type: "revenge_lob", tick: state.tick, playerId: player.id, balloonId: balloon.id });
}

export function traceSplash(
  map: MapData,
  x: number,
  y: number,
  range: number,
  straight = false,
  direction: CardinalDirection = "down"
): { x: number; y: number }[] {
  const cells = [{ x, y }];
  const directions: CardinalDirection[] = straight ? [direction] : [...DIRECTIONS];
  for (const current of directions) {
    const delta = DELTAS[current];
    for (let distance = 1; distance <= range; distance += 1) {
      const cellX = x + delta.x * distance;
      const cellY = y + delta.y * distance;
      const tile = tileAt(map, cellX, cellY);
      if (tile === TILE.BOULDER) break;
      cells.push({ x: cellX, y: cellY });
      if (tile === TILE.CASTLE) break;
    }
  }
  return cells;
}

function washCastle(state: GameState, x: number, y: number, ownerId: string | null, events: GameEvent[]): void {
  const index = mapIndex(state.map, x, y);
  if (state.map.tiles[index] !== TILE.CASTLE) return;
  state.map.tiles[index] = TILE.FLOOR;
  const owner = state.players.find((player) => player.id === ownerId);
  if (owner) owner.castlesWashed += 1;
  events.push({ type: "castle_washed", tick: state.tick, x, y, by: ownerId });
  const kind = state.map.hiddenPowerups[index];
  state.map.hiddenPowerups[index] = null;
  if (!kind || state.map.flooded[index]) return;
  const powerup = { id: state.nextEntityId++, x, y, kind, revealedTick: state.tick };
  state.powerups.push(powerup);
  events.push({ type: "powerup_revealed", tick: state.tick, id: powerup.id, x, y, kind });
}

function detonateBalloons(state: GameState, initial: BalloonState[], events: GameEvent[]): void {
  const queue = initial.map((balloon) => ({ id: balloon.id, depth: 0, rootOwner: balloon.ownerId }));
  const queued = new Set(queue.map((entry) => entry.id));
  const detonated = new Set<number>();
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry || detonated.has(entry.id)) continue;
    const balloon = state.balloons.find((candidate) => candidate.id === entry.id);
    queued.delete(entry.id);
    if (!balloon) continue;
    detonated.add(balloon.id);
    state.balloons.splice(state.balloons.indexOf(balloon), 1);
    const x = Math.round(balloon.x);
    const y = Math.round(balloon.y);
    events.push({ type: "balloon_burst", tick: state.tick, balloonId: balloon.id, ownerId: balloon.ownerId, x, y, chainDepth: entry.depth });
    const cells = traceSplash(state.map, x, y, balloon.range, balloon.straight, balloon.direction);
    for (const cell of cells) {
      if (tileAt(state.map, cell.x, cell.y) === TILE.CASTLE) washCastle(state, cell.x, cell.y, balloon.ownerId, events);
      state.splashes.push({
        id: state.nextEntityId++,
        x: cell.x,
        y: cell.y,
        expiresAt: state.tick + CONFIG.SPLASH_LINGER_TICKS,
        ownerId: balloon.ownerId,
        chainDepth: entry.depth
      });
    }
    const owner = state.players.find((player) => player.id === entry.rootOwner);
    if (owner) owner.biggestChain = Math.max(owner.biggestChain, entry.depth + 1);
    if (entry.depth > 0) {
      events.push({
        type: "chain_burst",
        tick: state.tick,
        ownerId: entry.rootOwner,
        depth: entry.depth,
        count: entry.depth + 1,
        x,
        y
      });
    }
    for (const cell of cells) {
      for (const chained of state.balloons) {
        if (detonated.has(chained.id) || queued.has(chained.id)) continue;
        if (Math.round(chained.x) !== cell.x || Math.round(chained.y) !== cell.y) continue;
        queued.add(chained.id);
        queue.push({ id: chained.id, depth: entry.depth + 1, rootOwner: entry.rootOwner });
      }
    }
  }
}

function collectPowerups(state: GameState, events: GameEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const x = Math.round(player.x);
    const y = Math.round(player.y);
    const powerup = state.powerups.find((candidate) => candidate.x === x && candidate.y === y);
    if (!powerup || (powerup.kind === "kick" && player.kick)) continue;
    if (powerup.kind === "balloon") player.balloonCount = Math.min(CONFIG.MAX_BALLOONS, player.balloonCount + 1);
    if (powerup.kind === "range") player.splashRange = Math.min(CONFIG.MAX_SPLASH_RANGE, player.splashRange + 1);
    if (powerup.kind === "speed") player.speed = Math.min(CONFIG.MAX_SPEED, player.speed + CONFIG.SPEED_PER_FLIPPERS);
    if (powerup.kind === "kick") player.kick = true;
    state.powerups.splice(state.powerups.indexOf(powerup), 1);
    events.push({ type: "powerup_collected", tick: state.tick, id: powerup.id, playerId: player.id, kind: powerup.kind });
  }
}

function soakPlayer(
  state: GameState,
  player: PlayerState,
  by: string | null,
  tide: boolean,
  chainDepth: number,
  events: GameEvent[]
): void {
  if (!player.alive) return;
  player.alive = false;
  player.dir = "none";
  player.revengePosition = 0;
  player.revengeCooldown = 0;
  state.lastSoakedTick = state.tick;
  const attacker = by ? state.players.find((candidate) => candidate.id === by) : undefined;
  if (attacker && attacker.id !== player.id) attacker.soaks += 1;
  events.push({ type: "player_soaked", tick: state.tick, playerId: player.id, by, tide, chainDepth });
}

export function forceSoak(state: GameState, playerId: string, by: string | null = null): GameEvent[] {
  const events: GameEvent[] = [];
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player) soakPlayer(state, player, by, false, 0, events);
  return events;
}

function applySplashes(state: GameState, events: GameEvent[]): void {
  state.splashes = state.splashes.filter((splash) => splash.expiresAt > state.tick);
  for (const splash of state.splashes) {
    for (const player of state.players) {
      if (player.alive && Math.round(player.x) === splash.x && Math.round(player.y) === splash.y) {
        soakPlayer(state, player, splash.ownerId, false, splash.chainDepth, events);
      }
    }
    for (let index = state.powerups.length - 1; index >= 0; index -= 1) {
      const powerup = state.powerups[index];
      if (powerup.x !== splash.x || powerup.y !== splash.y) continue;
      const splashCreatedTick = splash.expiresAt - CONFIG.SPLASH_LINGER_TICKS;
      if (powerup.revealedTick === splashCreatedTick) continue;
      state.powerups.splice(index, 1);
      events.push({ type: "powerup_destroyed", tick: state.tick, id: powerup.id, x: powerup.x, y: powerup.y });
    }
  }
}

function advanceTide(state: GameState, events: GameEvent[]): void {
  const roundTick = state.tick - state.roundStartedTick;
  if (roundTick < CONFIG.TIDE_START_TICKS || (roundTick - CONFIG.TIDE_START_TICKS) % CONFIG.TIDE_INTERVAL_TICKS !== 0) return;
  state.tideRing += 1;
  const changed = syncTide(state.map, state.tideRing);
  for (const index of changed) {
    if (state.map.tiles[index] === TILE.CASTLE) {
      state.map.tiles[index] = TILE.FLOOR;
      state.map.hiddenPowerups[index] = null;
    }
    const x = index % state.map.width;
    const y = Math.floor(index / state.map.width);
    for (let powerupIndex = state.powerups.length - 1; powerupIndex >= 0; powerupIndex -= 1) {
      const powerup = state.powerups[powerupIndex];
      if (powerup.x !== x || powerup.y !== y) continue;
      state.powerups.splice(powerupIndex, 1);
      events.push({ type: "powerup_destroyed", tick: state.tick, id: powerup.id, x, y });
    }
  }
  events.push({ type: "tide_advance", tick: state.tick, ring: state.tideRing });
  for (const player of state.players) {
    if (!player.alive) continue;
    const index = mapIndex(state.map, Math.round(player.x), Math.round(player.y));
    if (state.map.flooded[index]) soakPlayer(state, player, null, true, 0, events);
  }
}

function checkRoundEnd(state: GameState): void {
  if (state.phase !== "playing") return;
  const alive = state.players.filter((player) => player.alive);
  if (alive.length > 1) return;
  state.phase = "round_end";
  state.phaseTicks = CONFIG.ROUND_END_TICKS;
  state.roundWinnerId = alive[0]?.id ?? null;
  if (state.roundWinnerId) {
    const winner = state.players.find((player) => player.id === state.roundWinnerId);
    if (winner) winner.roundsWon += 1;
  }
}

export function triggerEmote(state: GameState, playerId: string, emote: number): GameEvent | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || emote < 1 || emote > 4) return null;
  player.emote = emote;
  player.emoteTick = state.tick;
  return { type: "emote", tick: state.tick, playerId, emote };
}

export function simulateTick(state: GameState, inputs: Record<string, PlayerInput>): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.phase === "match_end") return events;
  state.tick += 1;
  if (state.phase === "countdown") {
    state.phaseTicks -= 1;
    if (state.phaseTicks <= 0) state.phase = "playing";
    return events;
  }
  if (state.phase === "round_end") {
    state.phaseTicks -= 1;
    if (state.phaseTicks <= 0) {
      if (state.players.some((player) => player.roundsWon >= state.config.roundsToWin)) {
        state.phase = "match_end";
      } else {
        startNextRound(state);
      }
    }
    return events;
  }
  for (const player of state.players) {
    const input = inputs[player.id];
    if (input) player.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
    if (player.alive) {
      player.survivalTicks += 1;
      player.totalSurvivalTicks += 1;
      movePlayer(state, player, input?.dir ?? "none", events);
      if (input?.balloonPressed) dropBalloon(state, player, events);
    } else {
      updateRevenge(state, player, input ?? { seq: 0, dir: "none", balloonPressed: false }, events);
    }
  }
  updatePassThrough(state);
  for (const balloon of state.balloons) updateKickedBalloon(state, balloon);
  collectPowerups(state, events);
  for (const balloon of state.balloons) balloon.fuse -= 1;
  const due = state.balloons.filter((balloon) => balloon.fuse <= 0).sort((a, b) => a.id - b.id);
  if (due.length > 0) detonateBalloons(state, due, events);
  applySplashes(state, events);
  advanceTide(state, events);
  checkRoundEnd(state);
  return events;
}
