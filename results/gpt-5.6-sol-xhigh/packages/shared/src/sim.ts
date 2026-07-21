import { CONFIG } from "./config.js";
import { generateMap, tileKey } from "./map.js";
import type {
  Balloon,
  Direction,
  GameState,
  Mode,
  PlayerInput,
  Point,
  PowerupKind,
  SimEvent,
  SimPlayer,
  SimResult
} from "./types.js";

const DIRECTIONS: Record<Exclude<Direction, "none">, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};

export function createPlayer(id: string, name: string, x: number, y: number, animal: SimPlayer["animal"] = "frog", hat: SimPlayer["hat"] = "none"): SimPlayer {
  return {
    id, name, animal, hat, x: x + 0.5, y: y + 0.5, alive: true,
    stats: { speed: CONFIG.BASE_SPEED, balloonCount: CONFIG.BASE_BALLOONS, splashRange: CONFIG.BASE_SPLASH_RANGE, canKick: false },
    activeBalloons: 0, roundsWon: 0, soaks: 0, castlesWashed: 0, lastSeq: -1, facing: "down", moving: false,
    revengeReadyAt: 0
  };
}

export function createGameState(seed: number, mode: Mode, players: Array<Pick<SimPlayer, "id" | "name"> & Partial<Pick<SimPlayer, "animal" | "hat">>>, ranked = false): GameState {
  const map = generateMap(seed, mode);
  return {
    tick: 0, roundStartedAt: 0, mode, ranked, map,
    players: players.map((player, index) => {
      const spawn = map.spawns[index] ?? map.spawns[0]!;
      return createPlayer(player.id, player.name, spawn.x, spawn.y, player.animal, player.hat);
    }),
    balloons: [], splashes: [], powerups: [], tideRing: 0, nextEntityId: 1, roundOver: false, winnerIds: []
  };
}

function tileAt(state: GameState, x: number, y: number): number {
  return state.map.tiles[y]?.[x] ?? 1;
}

export function isFlooded(state: GameState, x: number, y: number): boolean {
  if (state.tideRing <= 0) return false;
  return x < state.tideRing || y < state.tideRing || x >= state.map.width - state.tideRing || y >= state.map.height - state.tideRing;
}

function balloonAt(state: GameState, x: number, y: number, ignore?: number): Balloon | undefined {
  return state.balloons.find((balloon) => balloon.id !== ignore && balloon.x === x && balloon.y === y);
}

function playerAt(state: GameState, x: number, y: number, ignore?: string): SimPlayer | undefined {
  return state.players.find((player) => player.id !== ignore && player.alive && Math.floor(player.x) === x && Math.floor(player.y) === y);
}

function canOccupy(state: GameState, player: SimPlayer, x: number, y: number, dir: Direction, events: SimEvent[]): boolean {
  if (tileAt(state, x, y) !== 0 || isFlooded(state, x, y)) return false;
  const balloon = balloonAt(state, x, y);
  if (!balloon) return true;
  const ownPass = balloon.ownerId === player.id && balloon.ownerMayPass && Math.floor(player.x) === x && Math.floor(player.y) === y;
  if (ownPass) return true;
  if (!CONFIG.ENABLE_KICK || !player.stats.canKick || dir === "none" || balloon.sliding !== "none") return false;
  const vector = DIRECTIONS[dir];
  const targetX = x + vector.x;
  const targetY = y + vector.y;
  if (tileAt(state, targetX, targetY) !== 0 || balloonAt(state, targetX, targetY) || playerAt(state, targetX, targetY)) return false;
  balloon.sliding = dir;
  balloon.nextSlideAt = state.tick + CONFIG.KICK_STEP_TICKS;
  player.stats.canKick = false;
  events.push({ type: "balloon_kicked", playerId: player.id, balloonId: balloon.id, dir });
  return false;
}

function movePlayer(state: GameState, player: SimPlayer, dir: Direction, events: SimEvent[]): void {
  player.moving = dir !== "none";
  if (dir === "none") return;
  player.facing = dir;
  const vector = DIRECTIONS[dir];
  const distance = player.stats.speed / CONFIG.TICK_RATE;
  const nextX = player.x + vector.x * distance;
  const nextY = player.y + vector.y * distance;
  const radius = CONFIG.PLAYER_RADIUS;
  const probeX = Math.floor(nextX + vector.x * radius);
  const probeY = Math.floor(nextY + vector.y * radius);
  if (canOccupy(state, player, probeX, probeY, dir, events)) {
    player.x = Math.max(1 + radius, Math.min(state.map.width - 1 - radius, nextX));
    player.y = Math.max(1 + radius, Math.min(state.map.height - 1 - radius, nextY));
  }
  for (const balloon of state.balloons) {
    if (balloon.ownerId === player.id && balloon.ownerMayPass && (Math.floor(player.x) !== balloon.x || Math.floor(player.y) !== balloon.y)) balloon.ownerMayPass = false;
  }
}

function dropBalloon(state: GameState, player: SimPlayer, events: SimEvent[], revenge = false): void {
  const x = Math.floor(player.x);
  const y = Math.floor(player.y);
  if (balloonAt(state, x, y)) return;
  if (!revenge && (!player.alive || player.activeBalloons >= player.stats.balloonCount)) return;
  if (revenge && (player.alive || state.ranked || !CONFIG.ENABLE_REVENGE_DUCKS || state.tick < player.revengeReadyAt)) return;
  const balloon: Balloon = {
    id: state.nextEntityId++, ownerId: player.id, x, y, placedAt: state.tick,
    burstAt: state.tick + (revenge ? 30 : CONFIG.BALLOON_FUSE_TICKS), range: revenge ? 3 : player.stats.splashRange,
    sliding: revenge ? player.facing : "none", nextSlideAt: state.tick + CONFIG.KICK_STEP_TICKS,
    ownerMayPass: !revenge, ...(revenge ? { revenge: true } : {})
  };
  state.balloons.push(balloon);
  if (revenge) {
    player.revengeReadyAt = state.tick + CONFIG.REVENGE_COOLDOWN_TICKS;
    events.push({ type: "revenge_lob", playerId: player.id, balloonId: balloon.id });
  } else {
    player.activeBalloons++;
    events.push({ type: "balloon_dropped", balloon: { ...balloon } });
  }
}

function moveSlidingBalloons(state: GameState): void {
  for (const balloon of [...state.balloons].sort((a, b) => a.id - b.id)) {
    if (balloon.sliding === "none" || state.tick < balloon.nextSlideAt) continue;
    const vector = DIRECTIONS[balloon.sliding];
    const x = balloon.x + vector.x;
    const y = balloon.y + vector.y;
    if (tileAt(state, x, y) !== 0 || balloonAt(state, x, y, balloon.id) || playerAt(state, x, y)) {
      balloon.sliding = "none";
      continue;
    }
    balloon.x = x;
    balloon.y = y;
    balloon.ownerMayPass = false;
    balloon.nextSlideAt += CONFIG.KICK_STEP_TICKS;
  }
}

function applyPowerup(player: SimPlayer, kind: PowerupKind): void {
  if (kind === "balloon") player.stats.balloonCount = Math.min(CONFIG.MAX_BALLOONS, player.stats.balloonCount + 1);
  if (kind === "range") player.stats.splashRange = Math.min(CONFIG.MAX_SPLASH_RANGE, player.stats.splashRange + 1);
  if (kind === "flippers") player.stats.speed = Math.min(CONFIG.MAX_SPEED, player.stats.speed + CONFIG.SPEED_STEP);
  if (kind === "boots") player.stats.canKick = true;
}

function collectPowerups(state: GameState, events: SimEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const index = state.powerups.findIndex((powerup) => powerup.x === Math.floor(player.x) && powerup.y === Math.floor(player.y));
    if (index < 0) continue;
    const [powerup] = state.powerups.splice(index, 1);
    if (!powerup) continue;
    applyPowerup(player, powerup.kind);
    events.push({ type: "powerup_collected", playerId: player.id, kind: powerup.kind });
  }
}

function splashTiles(state: GameState, balloon: Balloon, events: SimEvent[]): Point[] {
  const result: Point[] = [{ x: balloon.x, y: balloon.y }];
  for (const vector of Object.values(DIRECTIONS)) {
    for (let distance = 1; distance <= balloon.range; distance++) {
      const x = balloon.x + vector.x * distance;
      const y = balloon.y + vector.y * distance;
      const tile = tileAt(state, x, y);
      if (tile === 1) break;
      result.push({ x, y });
      if (tile === 2) {
        state.map.tiles[y]![x] = 0;
        const owner = state.players.find((player) => player.id === balloon.ownerId);
        if (owner) owner.castlesWashed++;
        events.push({ type: "castle_washed", x, y, ownerId: balloon.ownerId });
        const hidden = state.map.hiddenPowerups[tileKey(x, y)];
        if (hidden) {
          const powerup = { id: state.nextEntityId++, x, y, kind: hidden };
          state.powerups.push(powerup);
          events.push({ type: "powerup_revealed", powerup: { ...powerup } });
          delete state.map.hiddenPowerups[tileKey(x, y)];
        }
        break;
      }
    }
  }
  return result;
}

function resolveBursts(state: GameState, events: SimEvent[]): void {
  const queue = state.balloons.filter((balloon) => balloon.burstAt <= state.tick).sort((a, b) => a.id - b.id).map((balloon) => ({ id: balloon.id, chain: 1 }));
  const burst = new Set<number>();
  const exposedBeforeBurst = new Set(state.powerups.map((powerup) => powerup.id));
  const splashByTile = new Map<string, { ownerId: string; chain: number }>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (burst.has(current.id)) continue;
    const balloon = state.balloons.find((item) => item.id === current.id);
    if (!balloon) continue;
    burst.add(balloon.id);
    const owner = state.players.find((player) => player.id === balloon.ownerId);
    if (owner && !balloon.revenge) owner.activeBalloons = Math.max(0, owner.activeBalloons - 1);
    const tiles = splashTiles(state, balloon, events);
    if (current.chain > 1) events.push({ type: "chain_burst", ownerId: balloon.ownerId, chain: current.chain, x: balloon.x, y: balloon.y });
    for (const tile of tiles) {
      const key = tileKey(tile.x, tile.y);
      splashByTile.set(key, { ownerId: balloon.ownerId, chain: current.chain });
      const hit = state.balloons.find((candidate) => !burst.has(candidate.id) && candidate.x === tile.x && candidate.y === tile.y);
      if (hit && !queue.some((queued) => queued.id === hit.id)) queue.push({ id: hit.id, chain: current.chain + 1 });
    }
  }
  state.balloons = state.balloons.filter((balloon) => !burst.has(balloon.id));
  for (const [key, source] of splashByTile) {
    const [xText, yText] = key.split(",");
    const x = Number(xText);
    const y = Number(yText);
    state.splashes.push({ x, y, ownerId: source.ownerId, chain: source.chain, expiresAt: state.tick + CONFIG.SPLASH_TICKS });
    state.powerups = state.powerups.filter((powerup) => !exposedBeforeBurst.has(powerup.id) || powerup.x !== x || powerup.y !== y);
  }
}

function soakPlayers(state: GameState, events: SimEvent[]): void {
  const active = state.splashes.filter((splash) => splash.expiresAt > state.tick);
  for (const player of state.players) {
    if (!player.alive) continue;
    const source = active.find((splash) => splash.x === Math.floor(player.x) && splash.y === Math.floor(player.y));
    if (!source && !isFlooded(state, Math.floor(player.x), Math.floor(player.y))) continue;
    player.alive = false;
    player.revengeReadyAt = state.tick + CONFIG.REVENGE_COOLDOWN_TICKS;
    const ownerId = source?.ownerId ?? "tide";
    const owner = state.players.find((candidate) => candidate.id === ownerId);
    if (owner && owner.id !== player.id) owner.soaks++;
    events.push({ type: "player_soaked", playerId: player.id, ownerId });
  }
}

function advanceTide(state: GameState, events: SimEvent[]): void {
  const elapsed = state.tick - state.roundStartedAt;
  if (elapsed < CONFIG.TIDE_START_TICKS) return;
  const target = 1 + Math.floor((elapsed - CONFIG.TIDE_START_TICKS) / CONFIG.TIDE_INTERVAL_TICKS);
  const maxRing = Math.ceil(Math.min(state.map.width, state.map.height) / 2);
  while (state.tideRing < Math.min(target, maxRing)) {
    state.tideRing++;
    for (let y = 0; y < state.map.height; y++) for (let x = 0; x < state.map.width; x++) {
      if (isFlooded(state, x, y) && state.map.tiles[y]?.[x] === 2) state.map.tiles[y]![x] = 0;
    }
    events.push({ type: "tide_advance", ring: state.tideRing });
  }
}

function finishRound(state: GameState, events: SimEvent[]): void {
  if (state.roundOver || state.players.length < 2) return;
  const alive = state.players.filter((player) => player.alive);
  if (alive.length > 1) return;
  state.roundOver = true;
  state.winnerIds = alive.map((player) => player.id);
  for (const winner of alive) winner.roundsWon++;
  events.push({ type: "round_end", winnerIds: [...state.winnerIds] });
}

export function simulateTick(state: GameState, inputs: readonly PlayerInput[]): SimResult {
  const events: SimEvent[] = [];
  if (state.roundOver) return { state, events };
  state.splashes = state.splashes.filter((splash) => splash.expiresAt > state.tick);
  const latestInputs = new Map<string, PlayerInput>();
  for (const input of inputs) {
    const previous = latestInputs.get(input.playerId);
    if (!previous || input.seq > previous.seq) latestInputs.set(input.playerId, input);
  }
  for (const player of [...state.players].sort((a, b) => a.id.localeCompare(b.id))) {
    const input = latestInputs.get(player.id);
    if (!input || input.seq <= player.lastSeq) {
      player.moving = false;
      continue;
    }
    player.lastSeq = input.seq;
    if (player.alive) {
      movePlayer(state, player, input.dir, events);
      if (input.balloonPressed) dropBalloon(state, player, events);
    } else if (input.revengePressed) {
      dropBalloon(state, player, events, true);
    }
  }
  moveSlidingBalloons(state);
  collectPowerups(state, events);
  resolveBursts(state, events);
  advanceTide(state, events);
  soakPlayers(state, events);
  finishRound(state, events);
  state.tick++;
  return { state, events };
}

export function cloneGameState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

export function directionVector(direction: Direction): Point {
  return direction === "none" ? { x: 0, y: 0 } : DIRECTIONS[direction];
}
