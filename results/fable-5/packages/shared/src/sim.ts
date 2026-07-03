import { CONFIG, type GameMode, type PowerupType } from "./config.js";
import type { GeneratedMap } from "./map.js";
import { movePlayer, overlapsTile } from "./movement.js";
import {
  DIR_VECS,
  TILE,
  balloonAt,
  isFlooded,
  nearestPerimeterPos,
  perimeterLength,
  perimeterTile,
  tileAt,
  type Dir,
  type PlayerInput,
  type SimBalloon,
  type SimEvent,
  type SimPlayer,
  type SimRules,
  type SimState,
} from "./types.js";

export function createSimState(
  mode: GameMode,
  map: GeneratedMap,
  playerIds: string[],
  rules: SimRules
): SimState {
  const players: SimPlayer[] = playerIds.map((id, slot) => {
    const s = map.spawns[slot];
    return {
      id,
      slot,
      x: s.x + 0.5,
      y: s.y + 0.5,
      dir: 3 as Dir,
      moving: false,
      alive: true,
      soakedTick: -1,
      speed: CONFIG.SPEED_BASE,
      balloonCount: CONFIG.BALLOON_BASE,
      splashRange: CONFIG.RANGE_BASE,
      hasKick: false,
      bootsCollected: false,
      balloonsActive: 0,
      dropHeld: false,
      duck: null,
      soaks: 0,
      revengeSoaks: 0,
      castles: 0,
    };
  });
  return {
    mode,
    w: map.w,
    h: map.h,
    tick: 0,
    grid: map.grid.slice(),
    contents: map.contents.slice(),
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    tideRing: 0,
    tideNextTick: CONFIG.TIDE_START_TICKS,
    nextBalloonId: 1,
    rules,
    roundOver: false,
    winnerSlot: null,
  };
}

/**
 * Advance the world one tick. Deterministic: same state + same inputs =
 * same result, on server and client alike. Returns the events of this tick.
 */
export function simulateTick(state: SimState, inputs: (PlayerInput | null)[]): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.roundOver) return events;
  state.tick++;

  // 1. Player intents: movement, balloon drops, kicks; duck riders steer/lob.
  for (const p of state.players) {
    const input = inputs[p.slot] ?? null;
    if (p.alive) {
      const dir = (input?.dir ?? 0) as Dir;
      const canKick = state.rules.enableKick && p.hasKick;
      const kicked = movePlayer(state, p, dir, canKick);
      if (kicked && dir !== 0) {
        kicked.slide = { dir, progress: 0 };
        events.push({ t: "balloon_kicked", id: kicked.id, dir, slot: p.slot });
      }
      const pressed = !!input?.balloon;
      if (pressed && !p.dropHeld) tryPlaceBalloon(state, p, events);
      p.dropHeld = pressed;
    } else if (p.duck) {
      updateDuck(state, p, input, events);
    }
  }

  // 2. A dropped balloon stays walkable for its owner only until they leave it.
  for (const b of state.balloons) {
    if (b.ownerCanPass && b.ownerSlot >= 0) {
      const owner = state.players[b.ownerSlot];
      if (!owner || !owner.alive || !overlapsTile(owner, b.x, b.y)) b.ownerCanPass = false;
    }
  }

  // 3. Kicked balloons slide tile-by-tile until something stops them.
  advanceSlides(state);

  // 4. Rising Tide sudden death.
  advanceTide(state, events);

  // 5. Bursts, including whole chain cascades resolved within this tick.
  resolveBursts(state, events);

  // 6. Expire lingering splashes.
  state.splashes = state.splashes.filter((s) => s.endTick > state.tick);

  // 7. Soak players standing in splash or flood water.
  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const splash = state.splashes.find((s) => s.x === tx && s.y === ty);
    if (splash) {
      soakPlayer(state, p, splash.ownerSlot, splash.revenge, events);
    } else if (isFlooded(state, tx, ty)) {
      soakPlayer(state, p, -1, false, events);
    }
  }

  // 8. Collect exposed power-ups on contact.
  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const i = state.powerups.findIndex((u) => u.x === tx && u.y === ty);
    if (i >= 0) {
      const pu = state.powerups[i];
      state.powerups.splice(i, 1);
      applyPowerup(p, pu.type);
      events.push({ t: "powerup_collected", slot: p.slot, type: pu.type, x: tx, y: ty });
    }
  }

  // 9. Round over?
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.roundOver = true;
    state.winnerSlot = alive.length === 1 ? alive[0].slot : -1; // -1 = draw
    events.push({ t: "round_over", winnerSlot: state.winnerSlot });
  }
  return events;
}

function tryPlaceBalloon(state: SimState, p: SimPlayer, events: SimEvent[]): void {
  if (p.balloonsActive >= p.balloonCount) return;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (tileAt(state, tx, ty) !== TILE.EMPTY) return;
  if (balloonAt(state, tx, ty)) return;
  if (isFlooded(state, tx, ty)) return;
  state.balloons.push({
    id: state.nextBalloonId++,
    ownerSlot: p.slot,
    x: tx,
    y: ty,
    burstTick: state.tick + CONFIG.FUSE_TICKS,
    range: p.splashRange,
    placedTick: state.tick,
    ownerCanPass: true,
    slide: null,
    revenge: false,
  });
  p.balloonsActive++;
  events.push({ t: "balloon_placed", slot: p.slot, x: tx, y: ty });
}

function applyPowerup(p: SimPlayer, type: PowerupType): void {
  switch (type) {
    case "extra_balloon":
      p.balloonCount = Math.min(CONFIG.BALLOON_CAP, p.balloonCount + 1);
      break;
    case "big_splash":
      p.splashRange = Math.min(CONFIG.RANGE_CAP, p.splashRange + 1);
      break;
    case "flippers":
      p.speed = Math.min(CONFIG.SPEED_CAP, p.speed + CONFIG.SPEED_STEP);
      break;
    case "rubber_boots":
      if (!p.bootsCollected) {
        p.hasKick = true;
        p.bootsCollected = true; // once per player per round
      }
      break;
  }
}

function advanceSlides(state: SimState): void {
  for (const b of state.balloons) {
    if (!b.slide) continue;
    b.slide.progress++;
    if (b.slide.progress < CONFIG.KICK_TICKS_PER_TILE) continue;
    const [dx, dy] = DIR_VECS[b.slide.dir];
    const nx = b.x + dx;
    const ny = b.y + dy;
    const playerInWay = state.players.some(
      (p) => p.alive && Math.floor(p.x) === nx && Math.floor(p.y) === ny
    );
    if (
      tileAt(state, nx, ny) !== TILE.EMPTY ||
      balloonAt(state, nx, ny) ||
      playerInWay ||
      isFlooded(state, nx, ny)
    ) {
      b.slide = null; // stopped — keeps its fuse
    } else {
      b.x = nx;
      b.y = ny;
      b.slide.progress = 0;
    }
  }
}

function advanceTide(state: SimState, events: SimEvent[]): void {
  const maxRing = Math.ceil(Math.min(state.w, state.h) / 2);
  if (state.tick < state.tideNextTick || state.tideRing >= maxRing) return;
  state.tideRing++;
  state.tideNextTick = state.tick + CONFIG.TIDE_INTERVAL_TICKS;
  events.push({ t: "tide_advance", ring: state.tideRing });
  // Flood dissolves sandcastles (no reveal), swallows balloons and power-ups.
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      if (!isFlooded(state, x, y)) continue;
      const i = y * state.w + x;
      if (state.grid[i] === TILE.CASTLE) {
        state.grid[i] = TILE.EMPTY;
        state.contents[i] = null;
      }
    }
  }
  state.balloons = state.balloons.filter((b) => {
    if (!isFlooded(state, b.x, b.y)) return true;
    if (!b.revenge && b.ownerSlot >= 0) state.players[b.ownerSlot].balloonsActive--;
    return false;
  });
  state.powerups = state.powerups.filter((u) => !isFlooded(state, u.x, u.y));
}

function addSplash(state: SimState, x: number, y: number, b: SimBalloon): void {
  const existing = state.splashes.find((s) => s.x === x && s.y === y);
  const endTick = state.tick + CONFIG.SPLASH_TICKS;
  if (existing) {
    existing.endTick = Math.max(existing.endTick, endTick);
  } else {
    state.splashes.push({ x, y, endTick, ownerSlot: b.ownerSlot, revenge: b.revenge });
  }
}

/**
 * Burst every due balloon, resolving full chain cascades within this single
 * tick via a BFS queue. Chained balloons splash with their own range.
 */
function resolveBursts(state: SimState, events: SimEvent[]): void {
  const due = state.balloons.filter((b) => b.burstTick <= state.tick);
  if (due.length === 0) return;
  const burst = new Set<number>();
  for (const root of due) {
    if (burst.has(root.id)) continue;
    burst.add(root.id);
    const queue: SimBalloon[] = [root];
    let chainSize = 0;
    while (queue.length > 0) {
      const b = queue.shift()!;
      chainSize++;
      burstBalloon(state, b, events, queue, burst);
    }
    if (chainSize >= 2) {
      events.push({ t: "chain_burst", size: chainSize, slot: root.ownerSlot });
    }
  }
  state.balloons = state.balloons.filter((b) => {
    if (!burst.has(b.id)) return true;
    if (!b.revenge && b.ownerSlot >= 0) state.players[b.ownerSlot].balloonsActive--;
    return false;
  });
}

function burstBalloon(
  state: SimState,
  b: SimBalloon,
  events: SimEvent[],
  queue: SimBalloon[],
  burst: Set<number>
): void {
  events.push({ t: "balloon_burst", x: b.x, y: b.y });
  addSplash(state, b.x, b.y, b);
  for (let dir = 1 as Dir; dir <= 4; dir++) {
    const [dx, dy] = DIR_VECS[dir];
    for (let i = 1; i <= b.range; i++) {
      const tx = b.x + dx * i;
      const ty = b.y + dy * i;
      const tile = tileAt(state, tx, ty);
      if (tile === TILE.BOULDER) break; // splash blocked by boulders
      if (tile === TILE.CASTLE) {
        // Wash away the FIRST sandcastle and stop. Contents were pre-rolled
        // at map gen; reveal now (the fresh reveal is safe from this splash).
        const gi = ty * state.w + tx;
        state.grid[gi] = TILE.EMPTY;
        if (b.ownerSlot >= 0 && state.players[b.ownerSlot]) state.players[b.ownerSlot].castles++;
        events.push({ t: "castle_washed", x: tx, y: ty, bySlot: b.ownerSlot });
        const hidden = state.contents[gi];
        if (hidden) {
          state.contents[gi] = null;
          state.powerups.push({ x: tx, y: ty, type: hidden });
          events.push({ t: "powerup_revealed", x: tx, y: ty, type: hidden });
        }
        break;
      }
      // Already-exposed power-ups are destroyed by splash, which stops there.
      const pi = state.powerups.findIndex((u) => u.x === tx && u.y === ty);
      if (pi >= 0) {
        state.powerups.splice(pi, 1);
        events.push({ t: "powerup_destroyed", x: tx, y: ty });
        addSplash(state, tx, ty, b);
        break;
      }
      // Any balloon touched by splash joins the cascade (splash passes through).
      const other = balloonAt(state, tx, ty);
      if (other && !burst.has(other.id)) {
        burst.add(other.id);
        queue.push(other);
      }
      addSplash(state, tx, ty, b);
    }
  }
}

function soakPlayer(
  state: SimState,
  p: SimPlayer,
  bySlot: number,
  revenge: boolean,
  events: SimEvent[]
): void {
  p.alive = false;
  p.soakedTick = state.tick;
  p.moving = false;
  if (bySlot >= 0 && bySlot !== p.slot && state.players[bySlot]) {
    if (revenge) state.players[bySlot].revengeSoaks++;
    else state.players[bySlot].soaks++;
  }
  events.push({ t: "player_soaked", slot: p.slot, bySlot, revenge });
  if (state.rules.revengeDucks) {
    p.duck = {
      pos: nearestPerimeterPos(state, Math.floor(p.x), Math.floor(p.y)),
      cooldownEndTick: state.tick + CONFIG.REVENGE_LOB_COOLDOWN_TICKS,
      lobHeld: true,
    };
  }
}

function updateDuck(
  state: SimState,
  p: SimPlayer,
  input: PlayerInput | null,
  events: SimEvent[]
): void {
  const duck = p.duck!;
  const step = CONFIG.DUCK_SPEED / CONFIG.TICK_RATE;
  const dir = (input?.dir ?? 0) as Dir;
  if (dir === 2 || dir === 3) duck.pos += step; // right/down = clockwise
  else if (dir === 1 || dir === 4) duck.pos -= step;
  const len = perimeterLength(state);
  duck.pos = ((duck.pos % len) + len) % len;

  const pressed = !!input?.balloon;
  if (pressed && !duck.lobHeld && state.tick >= duck.cooldownEndTick) {
    const t = perimeterTile(state, duck.pos);
    const [dx, dy] = DIR_VECS[t.inwardDir];
    for (let i = CONFIG.REVENGE_LOB_DISTANCE; i >= 1; i--) {
      const x = t.x + dx * i;
      const y = t.y + dy * i;
      if (tileAt(state, x, y) !== TILE.EMPTY) continue;
      if (balloonAt(state, x, y) || isFlooded(state, x, y)) continue;
      state.balloons.push({
        id: state.nextBalloonId++,
        ownerSlot: p.slot,
        x,
        y,
        burstTick: state.tick + CONFIG.REVENGE_LOB_FUSE_TICKS,
        range: CONFIG.REVENGE_LOB_RANGE,
        placedTick: state.tick,
        ownerCanPass: false,
        slide: null,
        revenge: true,
      });
      duck.cooldownEndTick = state.tick + CONFIG.REVENGE_LOB_COOLDOWN_TICKS;
      events.push({ t: "revenge_lob", slot: p.slot, x, y });
      break;
    }
  }
  duck.lobHeld = pressed;

  // Keep the player entity positioned on the border tile for rendering.
  const t = perimeterTile(state, duck.pos);
  p.x = t.x + 0.5;
  p.y = t.y + 0.5;
  p.dir = t.inwardDir;
  p.moving = dir !== 0;
}
