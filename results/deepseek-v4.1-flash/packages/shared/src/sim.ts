import { CONFIG } from "./config.js";
import type {
  Arena,
  BalloonState,
  Dir,
  Difficulty,
  ExposedPowerup,
  GameMode,
  PlayerInput,
  PlayerSnapshot,
  PlayerState,
  PowerupKind,
  RoundSnapshot,
  RoundState,
  SimEvent,
  SplashState,
  TideState,
  Vec,
} from "./types.js";

export interface RoundParticipant {
  id: string;
  slot: number;
  name: string;
  animal: PlayerState["animal"];
  hat: PlayerState["hat"];
  isBot: boolean;
  difficulty?: Difficulty | null;
}

export interface CreateRoundOptions {
  roundNo?: number;
  enableKick?: boolean;
  enableRevengeDucks?: boolean;
}

const DIRECTIONS: Array<{ dir: Dir; dx: number; dy: number }> = [
  { dir: "up", dx: 0, dy: -1 },
  { dir: "down", dx: 0, dy: 1 },
  { dir: "left", dx: -1, dy: 0 },
  { dir: "right", dx: 1, dy: 0 },
];

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

export function playerTile(player: Pick<PlayerState, "x" | "y">): Vec {
  return { x: Math.floor(player.x), y: Math.floor(player.y) };
}

export function inArena(arena: Pick<Arena, "w" | "h">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < arena.w && y < arena.h;
}

export function isTileFlooded(
  arena: Pick<Arena, "w" | "h">,
  tide: TideState,
  x: number,
  y: number,
): boolean {
  if (!tide.active) return false;
  return (
    x < tide.ring ||
    y < tide.ring ||
    x >= arena.w - tide.ring ||
    y >= arena.h - tide.ring
  );
}

function tileSolid(arena: Arena, x: number, y: number): boolean {
  if (!inArena(arena, x, y)) return true;
  return Boolean(arena.boulders[y]?.[x]) || arena.castles[y]?.[x] === 1;
}

function circleHitsSolid(
  arena: Arena,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const minX = Math.floor(cx - radius);
  const maxX = Math.floor(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.floor(cy + radius);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!tileSolid(arena, x, y)) continue;
      const closestX = Math.max(x, Math.min(cx, x + 1));
      const closestY = Math.max(y, Math.min(cy, y + 1));
      const dx = cx - closestX;
      const dy = cy - closestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }
  return false;
}

function balloonBlocksPlayer(
  state: RoundState,
  player: PlayerState,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  for (const balloon of state.balloons) {
    if (balloon.ownerId === player.id) continue;
    const bx = balloon.x + 0.5;
    const by = balloon.y + 0.5;
    const dx = cx - bx;
    const dy = cy - by;
    const reach = radius + 0.31;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}

function canStand(
  state: RoundState,
  player: PlayerState,
  x: number,
  y: number,
): boolean {
  const radius = CONFIG.PLAYER_RADIUS;
  if (circleHitsSolid(state.arena, x, y, radius)) return false;
  return !balloonBlocksPlayer(state, player, x, y, radius);
}

function axisStep(
  state: RoundState,
  player: PlayerState,
  axis: "x" | "y",
  delta: number,
): void {
  if (delta === 0) return;
  const nx = axis === "x" ? player.x + delta : player.x;
  const ny = axis === "y" ? player.y + delta : player.y;
  if (canStand(state, player, nx, ny)) {
    player.x = nx;
    player.y = ny;
  }
}

function movePlayer(
  state: RoundState,
  player: PlayerState,
  dir: Dir,
  dt: number,
): void {
  if (dir === "none") return;
  const step = player.speed * dt;
  if (dir === "left") axisStep(state, player, "x", -step);
  else if (dir === "right") axisStep(state, player, "x", step);
  else if (dir === "up") axisStep(state, player, "y", -step);
  else axisStep(state, player, "y", step);
}

function findBalloonAt(state: RoundState, x: number, y: number): BalloonState | undefined {
  return state.balloons.find((balloon) => balloon.x === x && balloon.y === y);
}

function tryKick(
  state: RoundState,
  player: PlayerState,
  dir: Dir,
  events: SimEvent[],
): boolean {
  if (!state.enableKick || player.kickCharges <= 0 || dir === "none") return false;
  const vector = DIRECTIONS.find((entry) => entry.dir === dir);
  if (!vector) return false;
  const tile = playerTile(player);
  const target = findBalloonAt(state, tile.x + vector.dx, tile.y + vector.dy);
  if (!target) return false;
  if (target.kickedDir !== "none") return false;
  const originX = target.x;
  const originY = target.y;
  target.kickedDir = dir;
  target.slideCooldown = CONFIG.KICK_SLIDE_TICKS;
  player.kickCharges -= 1;
  events.push({
    type: "balloon_kicked",
    balloonId: target.id,
    ownerId: target.ownerId,
    byId: player.id,
    dir,
    x: originX,
    y: originY,
  });
  return true;
}

function slideBalloons(state: RoundState): void {
  for (const balloon of state.balloons) {
    if (balloon.kickedDir === "none") continue;
    if (balloon.slideCooldown > 0) {
      balloon.slideCooldown -= 1;
      continue;
    }
    const vector = DIRECTIONS.find((entry) => entry.dir === balloon.kickedDir);
    if (!vector) {
      balloon.kickedDir = "none";
      continue;
    }
    const nx = balloon.x + vector.dx;
    const ny = balloon.y + vector.dy;
    let blocked = tileSolid(state.arena, nx, ny);
    if (!blocked && findBalloonAt(state, nx, ny)) blocked = true;
    if (!blocked) {
      const occupier = state.players.find((player) => {
        if (!player.alive) return false;
        const tile = playerTile(player);
        return tile.x === nx && tile.y === ny;
      });
      if (occupier) blocked = true;
    }
    if (blocked) {
      balloon.kickedDir = "none";
      continue;
    }
    balloon.x = nx;
    balloon.y = ny;
    balloon.slideCooldown = CONFIG.KICK_SLIDE_TICKS;
  }
}

function canPlaceBalloon(
  state: RoundState,
  player: PlayerState,
  x: number,
  y: number,
): boolean {
  if (!inArena(state.arena, x, y)) return false;
  if (tileSolid(state.arena, x, y)) return false;
  if (findBalloonAt(state, x, y)) return false;
  const active = state.balloons.filter((balloon) => balloon.ownerId === player.id).length;
  return active < player.balloonCount;
}

function placeBalloon(
  state: RoundState,
  player: PlayerState,
  x: number,
  y: number,
  source: BalloonState["source"] = "balloon",
  range = player.splashRange,
  fuse: number = CONFIG.FUSE_TICKS,
): BalloonState {
  const balloon: BalloonState = {
    id: state.nextIds++,
    ownerId: player.id,
    x,
    y,
    range,
    placedTick: state.tick,
    burstTick: state.tick + fuse,
    kickedDir: "none",
    slideCooldown: 0,
    source,
  };
  state.balloons.push(balloon);
  return balloon;
}

function revengeTarget(state: RoundState, player: PlayerState): Vec | null {
  const sx = Math.max(1, Math.min(state.arena.w - 2, Math.floor(player.soakedAtX)));
  const sy = Math.max(1, Math.min(state.arena.h - 2, Math.floor(player.soakedAtY)));
  const left = sx;
  const right = state.arena.w - 1 - sx;
  const top = sy;
  const bottom = state.arena.h - 1 - sy;
  const smallest = Math.min(left, right, top, bottom);
  let candidates: Vec[];
  if (smallest === left) candidates = [{ x: 1, y: sy }];
  else if (smallest === right) candidates = [{ x: state.arena.w - 2, y: sy }];
  else if (smallest === top) candidates = [{ x: sx, y: 1 }];
  else candidates = [{ x: sx, y: state.arena.h - 2 }];
  for (let offset = 0; offset < Math.max(state.arena.w, state.arena.h); offset += 1) {
    for (const candidate of candidates) {
      const variants = [
        { x: candidate.x + offset, y: candidate.y },
        { x: candidate.x - offset, y: candidate.y },
        { x: candidate.x, y: candidate.y + offset },
        { x: candidate.x, y: candidate.y - offset },
      ];
      for (const variant of variants) {
        if (!inArena(state.arena, variant.x, variant.y)) continue;
        if (tileSolid(state.arena, variant.x, variant.y)) continue;
        if (findBalloonAt(state, variant.x, variant.y)) continue;
        return variant;
      }
    }
  }
  return null;
}

function soakPlayer(
  state: RoundState,
  player: PlayerState,
  byId: string | null,
  cause: "splash" | "tide" | "revenge",
  events: SimEvent[],
): void {
  if (!player.alive) return;
  player.alive = false;
  player.eliminatedTick = state.tick;
  player.soakedAtX = player.x;
  player.soakedAtY = player.y;
  player.revengeReadyTick = state.tick + CONFIG.REVENGE_COOLDOWN_TICKS;
  events.push({
    type: "player_soaked",
    playerId: player.id,
    byId: byId === player.id ? null : byId,
    cause,
    x: Math.floor(player.x),
    y: Math.floor(player.y),
  });
}

interface WetTile {
  ownerId: string | null;
  kind: "splash" | "revenge";
}

function advanceTide(state: RoundState, events: SimEvent[]): void {
  let advanced = false;
  if (!state.tide.active) {
    if (state.tick >= CONFIG.TIDE_START_TICKS) {
      state.tide.active = true;
      state.tide.ring = 1;
      state.tide.startTick = state.tick;
      state.tide.nextAdvanceTick = state.tick + CONFIG.TIDE_INTERVAL_TICKS;
      advanced = true;
    }
  } else if (state.tick >= state.tide.nextAdvanceTick) {
    state.tide.ring += 1;
    state.tide.nextAdvanceTick = state.tick + CONFIG.TIDE_INTERVAL_TICKS;
    advanced = true;
  }
  if (!advanced) return;

  events.push({ type: "tide_advance", ring: state.tide.ring });
  const tide = state.tide;
  for (let y = 0; y < state.arena.h; y += 1) {
    for (let x = 0; x < state.arena.w; x += 1) {
      if (!isTileFlooded(state.arena, tide, x, y)) continue;
      if (state.arena.castles[y]?.[x] === 1) {
        state.arena.castles[y]![x] = 0;
        state.arena.hidden[y]![x] = null;
        events.push({ type: "castle_washed", x, y, ownerId: null });
      }
    }
  }
  const leftover: ExposedPowerup[] = [];
  for (const powerup of state.powerups) {
    if (isTileFlooded(state.arena, tide, powerup.x, powerup.y)) {
      events.push({
        type: "powerup_destroyed",
        x: powerup.x,
        y: powerup.y,
        kind: powerup.kind,
      });
    } else {
      leftover.push(powerup);
    }
  }
  state.powerups = leftover;
  for (const player of state.players) {
    if (!player.alive) continue;
    const tile = playerTile(player);
    if (isTileFlooded(state.arena, tide, tile.x, tile.y)) {
      soakPlayer(state, player, null, "tide", events);
    }
  }
}

function resolveBursts(state: RoundState, events: SimEvent[]): void {
  const activeSplashes = new Map<string, SplashState>();
  for (const splash of state.splashes) {
    if (splash.endTick > state.tick) activeSplashes.set(keyOf(splash.x, splash.y), splash);
  }
  const preexistingPowerups = new Set(
    state.powerups.map((powerup) => keyOf(powerup.x, powerup.y)),
  );
  const burstIds = new Set<number>();
  const queue: BalloonState[] = [];
  const balloonAt = new Map<string, BalloonState>();
  for (const balloon of state.balloons) {
    balloonAt.set(keyOf(balloon.x, balloon.y), balloon);
    if (balloon.burstTick <= state.tick) {
      queue.push(balloon);
      burstIds.add(balloon.id);
    } else if (activeSplashes.has(keyOf(balloon.x, balloon.y))) {
      queue.push(balloon);
      burstIds.add(balloon.id);
    }
  }

  if (queue.length === 0) return;

  const ownerIds = new Set<string>();
  let firstX = 0;
  let firstY = 0;
  let burstCount = 0;
  const revealedThisTick = new Set<string>();
  const soaked = new Map<string, { byId: string | null; cause: "splash" | "revenge" }>();

  for (let index = 0; index < queue.length; index += 1) {
    const balloon = queue[index];
    if (!balloon) continue;
    balloonAt.delete(keyOf(balloon.x, balloon.y));
    const remaining = state.balloons.filter((entry) => entry.id !== balloon.id);
    state.balloons = remaining;
    if (burstCount === 0) {
      firstX = balloon.x;
      firstY = balloon.y;
    }
    burstCount += 1;
    ownerIds.add(balloon.ownerId);
    const cause = balloon.source === "revenge" ? "revenge" : "splash";

    const wet = (x: number, y: number): void => {
      const key = keyOf(x, y);
      let splash = activeSplashes.get(key);
      if (splash) {
        splash.endTick = Math.max(splash.endTick, state.tick + CONFIG.SPLASH_TICKS);
      } else {
        splash = {
          id: state.nextIds++,
          ownerId: balloon.ownerId,
          x,
          y,
          createdTick: state.tick,
          endTick: state.tick + CONFIG.SPLASH_TICKS,
          kind: cause,
        };
        activeSplashes.set(key, splash);
        state.splashes.push(splash);
      }
      if (!preexistingPowerups.has(key)) {
        const exposed = state.powerups.find(
          (powerup) => powerup.x === x && powerup.y === y,
        );
        if (exposed) {
          state.powerups = state.powerups.filter((powerup) => powerup.id !== exposed.id);
          events.push({
            type: "powerup_destroyed",
            x,
            y,
            kind: exposed.kind,
          });
        }
      }
      const chained = balloonAt.get(key);
      if (chained && !burstIds.has(chained.id)) {
        burstIds.add(chained.id);
        queue.push(chained);
      }
    };

    wet(balloon.x, balloon.y);

    for (const vector of DIRECTIONS) {
      for (let step = 1; step <= balloon.range; step += 1) {
        const x = balloon.x + vector.dx * step;
        const y = balloon.y + vector.dy * step;
        if (!inArena(state.arena, x, y)) break;
        if (state.arena.boulders[y]?.[x]) break;
        wet(x, y);
        if (state.arena.castles[y]?.[x] === 1) {
          state.arena.castles[y]![x] = 0;
          events.push({
            type: "castle_washed",
            x,
            y,
            ownerId: balloon.ownerId,
          });
          const hiddenKind = state.arena.hidden[y]?.[x] ?? null;
          state.arena.hidden[y]![x] = null;
          if (hiddenKind) {
            const powerup: ExposedPowerup = {
              id: state.nextIds++,
              x,
              y,
              kind: hiddenKind,
              revealedTick: state.tick,
            };
            state.powerups.push(powerup);
            revealedThisTick.add(keyOf(x, y));
            events.push({ type: "powerup_revealed", powerup });
          }
          break;
        }
      }
    }
  }

  for (const [key, splash] of activeSplashes) {
    if (!state.splashes.some((entry) => entry.id === splash.id)) state.splashes.push(splash);
    const tile = key.split(",");
    const x = Number(tile[0]);
    const y = Number(tile[1]);
    for (const player of state.players) {
      if (!player.alive) continue;
      const pTile = playerTile(player);
      if (pTile.x !== x || pTile.y !== y) continue;
      if (!soaked.has(player.id)) {
        soaked.set(player.id, {
          byId: splash.ownerId,
          cause: splash.kind === "revenge" ? "revenge" : "splash",
        });
      }
    }
  }

  if (burstCount >= 2) {
    events.push({
      type: "chain_burst",
      count: burstCount,
      ownerIds: [...ownerIds],
      x: firstX,
      y: firstY,
    });
  }

  for (const [playerId, source] of soaked) {
    const player = state.players.find((entry) => entry.id === playerId);
    if (player) soakPlayer(state, player, source.byId, source.cause, events);
  }

  void revealedThisTick;
  state.splashes = [...activeSplashes.values()];
}

function collectPowerups(state: RoundState, events: SimEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const tile = playerTile(player);
    const powerup = state.powerups.find(
      (entry) => entry.x === tile.x && entry.y === tile.y,
    );
    if (!powerup) continue;
    if (powerup.kind === "balloon") {
      player.balloonCount = Math.min(CONFIG.BALLOON_MAX, player.balloonCount + 1);
    } else if (powerup.kind === "splash") {
      player.splashRange = Math.min(CONFIG.SPLASH_RANGE_MAX, player.splashRange + 1);
    } else if (powerup.kind === "flippers") {
      player.speed = Math.min(CONFIG.SPEED_MAX, player.speed + CONFIG.SPEED_STEP);
    } else if (powerup.kind === "boots") {
      player.kickCharges = 1;
      player.balloonCount = Math.min(CONFIG.BALLOON_MAX, Math.max(1, player.balloonCount));
    }
    state.powerups = state.powerups.filter((entry) => entry.id !== powerup.id);
    events.push({
      type: "powerup_collected",
      playerId: player.id,
      kind: powerup.kind,
      x: powerup.x,
      y: powerup.y,
    });
  }
}

function cleanupSplashes(state: RoundState): void {
  state.splashes = state.splashes.filter((splash) => splash.endTick > state.tick);
}

function finalizeRound(state: RoundState, events: SimEvent[]): void {
  if (state.ended) return;
  const alive = state.players.filter((player) => player.alive);
  if (alive.length > 1) return;
  state.ended = true;
  state.endedTick = state.tick;
  state.winnerId = alive[0]?.id ?? null;
  state.draw = alive.length === 0;
  events.push({ type: "round_ended", draw: state.draw, winnerId: state.winnerId });
}

export function simulateTick(
  state: RoundState,
  inputs: Record<string, PlayerInput | undefined>,
): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.ended) return events;
  state.tick += 1;
  cleanupSplashes(state);
  advanceTide(state, events);
  slideBalloons(state);

  for (const player of state.players) {
    const input = inputs[player.id];
    const pressed = Boolean(input?.balloonPressed);
    const pressedEdge = pressed && !player.prevBalloonPressed;
    player.prevBalloonPressed = pressed;

    if (!player.alive) {
      if (
        state.enableRevengeDucks &&
        pressedEdge &&
        state.tick >= player.revengeReadyTick
      ) {
        const target = revengeTarget(state, player);
        if (target) {
          placeBalloon(
            state,
            player,
            target.x,
            target.y,
            "revenge",
            3,
            CONFIG.REVENGE_FUSE_TICKS,
          );
          player.revengeReadyTick = state.tick + CONFIG.REVENGE_COOLDOWN_TICKS;
          events.push({
            type: "revenge_lob",
            playerId: player.id,
            x: target.x,
            y: target.y,
          });
        }
      }
      continue;
    }

    if (input?.dir && input.dir !== "none") {
      player.dir = input.dir;
      const kicked = tryKick(state, player, input.dir, events);
      if (!kicked) {
        movePlayer(state, player, input.dir, 1 / CONFIG.TICK_RATE);
      }
    }

    if (pressedEdge) {
      const tile = playerTile(player);
      if (canPlaceBalloon(state, player, tile.x, tile.y)) {
        placeBalloon(state, player, tile.x, tile.y);
      }
    }
  }

  resolveBursts(state, events);
  collectPowerups(state, events);
  finalizeRound(state, events);
  cleanupSplashes(state);
  return events;
}

export function createRoundState(
  mode: GameMode,
  arena: Arena,
  participants: RoundParticipant[],
  options: CreateRoundOptions = {},
): RoundState {
  const players: PlayerState[] = participants.map((participant, index) => {
    const spawn = arena.spawnTiles[participant.slot] ?? arena.spawnTiles[index] ?? { x: 1, y: 1 };
    return {
      id: participant.id,
      slot: participant.slot,
      name: participant.name,
      animal: participant.animal,
      hat: participant.hat,
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
      dir: "down",
      alive: true,
      eliminatedTick: null,
      speed: CONFIG.SPEED_BASE,
      balloonCount: CONFIG.BALLOON_BASE,
      splashRange: CONFIG.SPLASH_RANGE_BASE,
      kickCharges: 0,
      isBot: participant.isBot,
      difficulty: participant.difficulty ?? null,
      prevBalloonPressed: false,
      revengeReadyTick: 0,
      soakedAtX: spawn.x + 0.5,
      soakedAtY: spawn.y + 0.5,
    };
  });
  return {
    tick: 0,
    mode,
    theme: arena.theme,
    roundNo: options.roundNo ?? 1,
    arena,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    tide: {
      active: false,
      ring: 0,
      startTick: CONFIG.TIDE_START_TICKS,
      nextAdvanceTick: CONFIG.TIDE_START_TICKS + CONFIG.TIDE_INTERVAL_TICKS,
    },
    ended: false,
    endedTick: null,
    winnerId: null,
    draw: false,
    enableKick: options.enableKick ?? CONFIG.ENABLE_KICK,
    enableRevengeDucks: options.enableRevengeDucks ?? false,
    nextIds: 1,
  };
}

export function addBalloonForTest(
  state: RoundState,
  ownerId: string,
  x: number,
  y: number,
  range: number,
  fuse: number = CONFIG.FUSE_TICKS,
): BalloonState {
  const owner = state.players.find((player) => player.id === ownerId);
  if (!owner) throw new Error("Unknown balloon owner");
  const balloon: BalloonState = {
    id: state.nextIds++,
    ownerId,
    x,
    y,
    range,
    placedTick: state.tick,
    burstTick: state.tick + fuse,
    kickedDir: "none",
    slideCooldown: 0,
    source: "balloon",
  };
  state.balloons.push(balloon);
  return balloon;
}

export function snapshotRound(
  state: RoundState,
  acks: Record<string, number>,
): RoundSnapshot {
  const players: PlayerSnapshot[] = state.players.map((player) => ({
    id: player.id,
    slot: player.slot,
    name: player.name,
    animal: player.animal,
    hat: player.hat,
    x: Math.round(player.x * 1000) / 1000,
    y: Math.round(player.y * 1000) / 1000,
    dir: player.dir,
    alive: player.alive,
    eliminatedTick: player.eliminatedTick,
    speed: player.speed,
    balloonCount: player.balloonCount,
    splashRange: player.splashRange,
    kickCharges: player.kickCharges,
    isBot: player.isBot,
    difficulty: player.difficulty,
    revengeReadyTick: player.revengeReadyTick,
    soakedAtX: player.soakedAtX,
    soakedAtY: player.soakedAtY,
  }));
  return {
    tick: state.tick,
    players,
    balloons: state.balloons.map((balloon) => ({ ...balloon })),
    splashes: state.splashes.map((splash) => ({ ...splash })),
    powerups: state.powerups.map((powerup) => ({ ...powerup })),
    tide: { ...state.tide },
    ended: state.ended,
    winnerId: state.winnerId,
    draw: state.draw,
    acks,
  };
}

export function findSpawnTileForSlot(arena: Arena, slot: number): Vec {
  return arena.spawnTiles[slot] ?? arena.spawnTiles[0] ?? { x: 1, y: 1 };
}

export function adjacentTileIsWet(state: RoundState, x: number, y: number): boolean {
  return state.splashes.some((splash) => splash.x === x && splash.y === y);
}

export function powerupLabel(kind: PowerupKind): string {
  switch (kind) {
    case "balloon":
      return "EXTRA BALLOON";
    case "splash":
      return "BIG SPLASH";
    case "flippers":
      return "FLIPPERS";
    case "boots":
      return "RUBBER BOOTS";
  }
}
