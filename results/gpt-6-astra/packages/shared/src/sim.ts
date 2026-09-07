import { CONFIG } from "./config.js";
import { generateMap } from "./map.js";
import {
  Tile,
  type Balloon,
  type Direction,
  type GameState,
  type Mode,
  type PlayerInput,
  type PlayerSetup,
  type PlayerState,
  type Point,
} from "./types.js";

export const DIRECTIONS: Record<Direction, Point> = {
  none: { x: 0, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const CARDINALS: Direction[] = ["up", "right", "down", "left"];
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
export function createGame(options: {
  mode: Mode;
  seed: number;
  lootSeed?: number | readonly number[];
  players: PlayerSetup[];
  ranked?: boolean;
  revengeEnabled?: boolean;
}): GameState {
  const map = generateMap(options.mode, options.seed, options.lootSeed);
  const players: PlayerState[] = options.players.map((p, slot) => ({
    id: p.id,
    nickname: p.nickname,
    animal: p.animal ?? "frog",
    hat: p.hat ?? "none",
    slot,
    x: map.spawns[slot].x + 0.5,
    y: map.spawns[slot].y + 0.5,
    alive: true,
    dir: "down",
    speed: CONFIG.BASE_SPEED,
    balloonCount: CONFIG.BASE_BALLOONS,
    splashRange: CONFIG.BASE_RANGE,
    kick: false,
    soaks: 0,
    castlesWashed: 0,
    roundsWon: p.roundsWon ?? 0,
    lastInputSeq: -1,
    soakedAt: null,
    lastRevengeTick: -CONFIG.REVENGE_COOLDOWN_TICKS,
    biggestChain: 0,
    survivalTicks: 0,
    duckPos: slot * 10,
  }));
  return {
    tick: 0,
    width: map.width,
    height: map.height,
    tiles: map.tiles,
    hiddenPowerups: map.hiddenPowerups,
    mapSeed: options.seed,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    nextBalloonId: 1,
    events: [],
    roundOver: false,
    winnerId: null,
    ranked: options.ranked ?? false,
    revengeEnabled: options.ranked
      ? CONFIG.RANKED_REVENGE_DUCKS
      : (options.revengeEnabled ?? CONFIG.ENABLE_REVENGE_DUCKS),
  };
}
export function tileAt(state: GameState, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height)
    return Tile.Boulder;
  return state.tiles[y * state.width + x];
}
export function splashTiles(
  state: GameState,
  x: number,
  y: number,
  range: number,
  blockers = state.tiles,
): Point[] {
  const points: Point[] = [{ x, y }];
  for (const dir of CARDINALS) {
    const d = DIRECTIONS[dir];
    for (let i = 1; i <= range; i++) {
      const tx = x + d.x * i;
      const ty = y + d.y * i;
      const tile = blockers[ty * state.width + tx];
      if (
        tx < 0 ||
        ty < 0 ||
        tx >= state.width ||
        ty >= state.height ||
        tile === Tile.Boulder ||
        tile === Tile.Flood
      )
        break;
      points.push({ x: tx, y: ty });
      if (tile === Tile.Castle) break;
    }
  }
  return points;
}
function overlaps(x: number, y: number, tileX: number, tileY: number): boolean {
  const r = CONFIG.PLAYER_RADIUS;
  return (
    x + r > tileX && x - r < tileX + 1 && y + r > tileY && y - r < tileY + 1
  );
}
function slideClear(
  state: GameState,
  balloon: Balloon,
  x: number,
  y: number,
): boolean {
  return (
    tileAt(state, x, y) === Tile.Floor &&
    !state.balloons.some(
      (b) => b.id !== balloon.id && b.x === x && b.y === y,
    ) &&
    !state.players.some((p) => p.alive && overlaps(p.x, p.y, x, y))
  );
}
function canStand(
  state: GameState,
  player: PlayerState,
  x: number,
  y: number,
  dir: Direction,
): boolean {
  const r = CONFIG.PLAYER_RADIUS;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r - 0.00001); ty++)
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r - 0.00001); tx++) {
      const tile = tileAt(state, tx, ty);
      if (tile === Tile.Boulder || tile === Tile.Castle) return false;
      const balloon = state.balloons.find(
        (b) => b.x === tx && b.y === ty && !b.passThrough.includes(player.id),
      );
      if (balloon) {
        if (!CONFIG.ENABLE_KICK || !player.kick || dir === "none") return false;
        const d = DIRECTIONS[dir];
        if (!slideClear(state, balloon, tx + d.x, ty + d.y)) return false;
        balloon.x += d.x;
        balloon.y += d.y;
        balloon.slideDir = dir;
        balloon.nextSlideTick = state.tick + CONFIG.KICK_STEP_TICKS;
        balloon.passThrough = [];
        state.events.push({
          type: "balloon_kicked",
          balloonId: balloon.id,
          playerId: player.id,
          dir,
          x: balloon.x,
          y: balloon.y,
        });
      }
    }
  return true;
}
function movePlayer(
  state: GameState,
  player: PlayerState,
  dir: Direction,
): void {
  if (dir === "none") return;
  const delta = player.speed / CONFIG.TICK_RATE;
  const d = DIRECTIONS[dir];
  player.dir = dir;
  // Soft lane alignment makes right-angle turns forgiving without crossing walls.
  const centerX = Math.floor(player.x) + 0.5;
  const centerY = Math.floor(player.y) + 0.5;
  if (d.x && Math.abs(player.y - centerY) < 0.26) player.y = centerY;
  if (d.y && Math.abs(player.x - centerX) < 0.26) player.x = centerX;
  const x = player.x + d.x * delta;
  const y = player.y + d.y * delta;
  if (canStand(state, player, x, y, dir)) {
    player.x = x;
    player.y = y;
  }
  for (const balloon of state.balloons)
    if (!overlaps(player.x, player.y, balloon.x, balloon.y))
      balloon.passThrough = balloon.passThrough.filter(
        (id) => id !== player.id,
      );
}
function placeBalloon(
  state: GameState,
  player: PlayerState,
  x = Math.floor(player.x),
  y = Math.floor(player.y),
  revenge = false,
): void {
  if (
    tileAt(state, x, y) !== Tile.Floor ||
    state.balloons.some((b) => b.x === x && b.y === y)
  )
    return;
  if (
    !revenge &&
    state.balloons.filter((b) => b.ownerId === player.id && !b.revenge)
      .length >= player.balloonCount
  )
    return;
  const balloon: Balloon = {
    id: state.nextBalloonId++,
    ownerId: player.id,
    x,
    y,
    placedTick: state.tick,
    burstTick: state.tick + CONFIG.FUSE_TICKS,
    range: revenge ? CONFIG.REVENGE_RANGE : player.splashRange,
    passThrough: revenge ? [] : [player.id],
    slideDir: "none",
    nextSlideTick: 0,
    revenge,
  };
  state.balloons.push(balloon);
  state.events.push({
    type: revenge ? "revenge_lob" : "balloon_dropped",
    playerId: player.id,
    balloonId: balloon.id,
    x,
    y,
  } as GameState["events"][number]);
}
export function duckPosition(
  state: GameState,
  position: number,
): Point & { inward: Direction } {
  const w = state.width - 1;
  const h = state.height - 1;
  const length = 2 * (w + h);
  const t = ((position % length) + length) % length;
  if (t < w) return { x: t + 0.5, y: 0.5, inward: "down" };
  if (t < w + h) return { x: w + 0.5, y: t - w + 0.5, inward: "left" };
  if (t < 2 * w + h)
    return { x: 2 * w + h - t + 0.5, y: h + 0.5, inward: "up" };
  return { x: 0.5, y: length - t + 0.5, inward: "right" };
}
function moveDuck(
  state: GameState,
  player: PlayerState,
  input: PlayerInput,
): void {
  if (!state.revengeEnabled) return;
  if (input.dir !== "none")
    player.duckPos +=
      ((input.dir === "left" || input.dir === "up" ? -1 : 1) * 5) /
      CONFIG.TICK_RATE;
  const pos = duckPosition(state, player.duckPos);
  player.x = pos.x;
  player.y = pos.y;
  if (
    !input.balloonPressed ||
    state.tick - player.lastRevengeTick < CONFIG.REVENGE_COOLDOWN_TICKS
  )
    return;
  const d = DIRECTIONS[pos.inward];
  for (let n = 3; n >= 1; n--) {
    const x = Math.floor(pos.x) + d.x * n;
    const y = Math.floor(pos.y) + d.y * n;
    if (
      tileAt(state, x, y) === Tile.Floor &&
      !state.balloons.some((b) => b.x === x && b.y === y)
    ) {
      placeBalloon(state, player, x, y, true);
      player.lastRevengeTick = state.tick;
      break;
    }
  }
}
function soak(
  state: GameState,
  player: PlayerState,
  byId: string | null,
  revenge: boolean,
): void {
  if (!player.alive) return;
  player.alive = false;
  player.soakedAt = state.tick;
  const killer = state.players.find((p) => p.id === byId);
  if (killer && killer.id !== player.id) killer.soaks++;
  state.events.push({
    type: "player_soaked",
    playerId: player.id,
    byId,
    revenge,
    x: player.x,
    y: player.y,
  });
}
export function simulateTick(
  state: GameState,
  inputs: Record<string, PlayerInput>,
): GameState {
  state.events = [];
  if (state.roundOver) return state;
  state.tick++;
  state.splashes = state.splashes.filter((s) => s.expiresTick > state.tick);
  for (const balloon of state.balloons)
    if (balloon.slideDir !== "none" && state.tick >= balloon.nextSlideTick) {
      const d = DIRECTIONS[balloon.slideDir];
      if (slideClear(state, balloon, balloon.x + d.x, balloon.y + d.y)) {
        balloon.x += d.x;
        balloon.y += d.y;
        balloon.nextSlideTick = state.tick + CONFIG.KICK_STEP_TICKS;
      } else balloon.slideDir = "none";
    }
  for (const player of state.players) {
    if (player.alive) player.survivalTicks++;
    const input = inputs[player.id];
    if (!input) continue;
    player.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
    if (!player.alive) {
      moveDuck(state, player, input);
      continue;
    }
    if (input.balloonPressed) placeBalloon(state, player);
    movePlayer(state, player, input.dir);
  }
  if (state.tick >= CONFIG.TIDE_START_TICKS) {
    const ring =
      1 +
      Math.floor(
        (state.tick - CONFIG.TIDE_START_TICKS) / CONFIG.TIDE_INTERVAL_TICKS,
      );
    if (ring > state.tideRing) {
      state.tideRing = ring;
      for (let y = 0; y < state.height; y++)
        for (let x = 0; x < state.width; x++)
          if (
            Math.min(x, y, state.width - x - 1, state.height - y - 1) <= ring
          ) {
            const i = y * state.width + x;
            state.tiles[i] = Tile.Flood;
            delete state.hiddenPowerups[i];
          }
      state.powerups = state.powerups.filter(
        (p) => tileAt(state, p.x, p.y) !== Tile.Flood,
      );
      state.balloons = state.balloons.filter(
        (b) => tileAt(state, b.x, b.y) !== Tile.Flood,
      );
      state.events.push({ type: "tide_advance", ring });
    }
  }
  // Freeze obstruction for this cascade: two bursts cannot tunnel through a just-washed castle.
  const blockers = state.tiles.slice();
  const due = state.balloons.filter(
    (b) =>
      b.burstTick <= state.tick ||
      state.splashes.some((s) => s.x === b.x && s.y === b.y),
  );
  const burstIds = new Set<number>();
  for (const root of due) {
    if (burstIds.has(root.id)) continue;
    const queue = [root];
    let count = 0;
    for (let i = 0; i < queue.length; i++) {
      const balloon = queue[i];
      if (burstIds.has(balloon.id)) continue;
      burstIds.add(balloon.id);
      count++;
      state.events.push({
        type: "balloon_burst",
        balloonId: balloon.id,
        playerId: balloon.ownerId,
        x: balloon.x,
        y: balloon.y,
      });
      for (const point of splashTiles(
        state,
        balloon.x,
        balloon.y,
        balloon.range,
        blockers,
      )) {
        const index = point.y * state.width + point.x;
        state.powerups = state.powerups.filter(
          (p) =>
            p.x !== point.x || p.y !== point.y || p.revealedTick === state.tick,
        );
        if (state.tiles[index] === Tile.Castle) {
          state.tiles[index] = Tile.Floor;
          const owner = state.players.find((p) => p.id === balloon.ownerId);
          if (owner) owner.castlesWashed++;
          state.events.push({
            type: "castle_washed",
            ...point,
            playerId: balloon.ownerId,
          });
          const kind = state.hiddenPowerups[index];
          if (kind) {
            state.powerups.push({ ...point, kind, revealedTick: state.tick });
            state.events.push({ type: "powerup_revealed", ...point, kind });
          }
          delete state.hiddenPowerups[index];
        }
        state.splashes.push({
          ...point,
          ownerId: balloon.ownerId,
          expiresTick: state.tick + CONFIG.SPLASH_TICKS,
          revenge: balloon.revenge,
        });
        for (const chained of state.balloons)
          if (
            !burstIds.has(chained.id) &&
            chained.x === point.x &&
            chained.y === point.y
          )
            queue.push(chained);
      }
    }
    if (count > 1) {
      state.events.push({
        type: "chain_burst",
        count,
        playerId: root.ownerId,
        x: root.x,
        y: root.y,
      });
      const owner = state.players.find((p) => p.id === root.ownerId);
      if (owner) owner.biggestChain = Math.max(owner.biggestChain, count);
    }
  }
  state.balloons = state.balloons.filter((b) => !burstIds.has(b.id));
  for (const player of state.players)
    if (player.alive) {
      const x = Math.floor(player.x);
      const y = Math.floor(player.y);
      if (tileAt(state, x, y) === Tile.Flood) {
        soak(state, player, null, false);
        continue;
      }
      const splash = state.splashes.find((s) => s.x === x && s.y === y);
      if (splash) {
        soak(state, player, splash.ownerId, splash.revenge);
        continue;
      }
      const pickup = state.powerups.find((p) => p.x === x && p.y === y);
      if (pickup) {
        if (pickup.kind === "balloon")
          player.balloonCount = Math.min(
            CONFIG.MAX_BALLOONS,
            player.balloonCount + 1,
          );
        if (pickup.kind === "range")
          player.splashRange = Math.min(
            CONFIG.MAX_RANGE,
            player.splashRange + 1,
          );
        if (pickup.kind === "speed")
          player.speed = Math.min(
            CONFIG.MAX_SPEED,
            +(player.speed + CONFIG.SPEED_UPGRADE).toFixed(2),
          );
        if (pickup.kind === "kick") player.kick = CONFIG.ENABLE_KICK;
        state.powerups = state.powerups.filter((p) => p !== pickup);
        state.events.push({
          type: "powerup_collected",
          playerId: player.id,
          kind: pickup.kind,
          x,
          y,
        });
      }
    }
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.roundOver = true;
    state.winnerId = alive[0]?.id ?? null;
  }
  return state;
}
