import type { Balloon, Player, PowerUp, RoundState, SimInput, Snapshot, Splash, Vec2 } from "./types.js";
import { CONFIG, type Mode, type Theme } from "./config.js";
import { generateMap, isBoulder } from "./map.js";

let nextId = 1;
export function resetIdCounter() {
  nextId = 1;
}
function uid(prefix = "id"): string {
  return `${prefix}_${nextId++}`;
}

export function createRoundState(
  mode: Mode,
  roundNo: number,
  mapSeed: number,
  theme: Theme,
  playerDefs: { id: string; nickname: string; animal: string; hat: string; slot: number; botDifficulty?: string }[]
): RoundState {
  const map = generateMap(mode, mapSeed, theme);
  const players: Player[] = playerDefs.map((def, i) => {
    const spawn = map.spawns[i % map.spawns.length];
    return {
      id: def.id,
      nickname: def.nickname,
      animal: def.animal as any,
      hat: def.hat as any,
      slot: def.slot,
      alive: true,
      pos: { x: spawn.x + 0.5, y: spawn.y + 0.5 },
      dir: { x: 0, y: 0 },
      stats: {
        speed: CONFIG.BASE_SPEED,
        balloonCount: CONFIG.BASE_BALLOON_COUNT,
        splashRange: CONFIG.BASE_SPLASH_RANGE,
        hasBoots: false,
      },
      activeBalloons: 0,
      emoteUntilTick: 0,
      emoteId: 0,
      revengeDuck: false,
      revengeCooldownTick: 0,
      botDifficulty: def.botDifficulty as any,
      input: undefined,
    };
  });

  return {
    roundNo,
    tick: 0,
    mapSeed,
    theme,
    width: map.width,
    height: map.height,
    castles: map.castles,
    tideRing: -1,
    players,
    balloons: [],
    splashes: [],
    powerUps: [],
    events: [],
    ended: false,
    winnerId: null,
    draw: false,
  };
}

export function simulateTick(state: RoundState, inputs: SimInput[]): RoundState {
  if (state.ended) return state;
  state.events = [];
  state.tick++;

  const inputMap = new Map(inputs.map((i) => [i.playerId, i]));

  // Process inputs and movement
  for (const p of state.players) {
    const input = inputMap.get(p.id);
    if (input) {
      p.dir = normalize(input.dir);
      const prev = p.input;
      p.input = {
        seq: (input as any).seq ?? 0,
        tick: input.tick,
        dir: input.dir,
        balloonPressed: input.balloonPressed,
        kickPressed: input.kickPressed,
      };
      if (input.balloonPressed && (!prev || !prev.balloonPressed)) {
        tryPlaceBalloon(state, p);
      }
    } else {
      p.dir = { x: 0, y: 0 };
    }
  }

  movePlayers(state);
  moveKickedBalloons(state);
  processBalloons(state);
  collectPowerUps(state);
  advanceTide(state);
  checkRoundEnd(state);

  return state;
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function tileAt(v: Vec2): { tx: number; ty: number } {
  return { tx: Math.floor(v.x), ty: Math.floor(v.y) };
}

function onTile(pos: Vec2, tx: number, ty: number): boolean {
  return Math.floor(pos.x) === tx && Math.floor(pos.y) === ty;
}

function isTileSolidForPlayer(state: RoundState, tx: number, ty: number, playerId: string): boolean {
  if (isBoulder(state.width, state.height, tx, ty)) return true;
  const castle = state.castles[tx]?.[ty];
  if (castle?.hasCastle) return true;
  const balloon = findBalloonAt(state, tx, ty);
  if (balloon) {
    const ownerCanPass = balloon.ownerId === playerId && state.tick - (balloon as any).placedTick < CONFIG.BALLOON_SOLID_TICKS;
    return !ownerCanPass;
  }
  return false;
}

function findBalloonAt(state: RoundState, tx: number, ty: number): Balloon | undefined {
  return state.balloons.find((b) => Math.floor(b.tx) === tx && Math.floor(b.ty) === ty);
}

function movePlayers(state: RoundState) {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.revengeDuck) {
      moveRevengeDuck(state, p);
      continue;
    }
    const speed = p.stats.speed / CONFIG.TICK_RATE;
    if (speed === 0) continue;

    // Try X
    let nx = p.pos.x + p.dir.x * speed;
    const newTx = Math.floor(nx);
    const curTy = Math.floor(p.pos.y);
    if (newTx !== Math.floor(p.pos.x)) {
      // crossing x boundary
      if (isTileSolidForPlayer(state, newTx, curTy, p.id)) {
        nx = p.dir.x > 0 ? Math.floor(p.pos.x) + 1 - 0.001 : Math.floor(p.pos.x);
      }
    }
    p.pos.x = nx;

    // Try Y
    let ny = p.pos.y + p.dir.y * speed;
    const newTy = Math.floor(ny);
    const curTx = Math.floor(p.pos.x);
    if (newTy !== Math.floor(p.pos.y)) {
      if (isTileSolidForPlayer(state, curTx, newTy, p.id)) {
        ny = p.dir.y > 0 ? Math.floor(p.pos.y) + 1 - 0.001 : Math.floor(p.pos.y);
      }
    }
    p.pos.y = ny;

    // Boots kick: if we walked into a balloon, kick it
    const { tx, ty } = tileAt(p.pos);
    const balloon = findBalloonAt(state, tx, ty);
    if (balloon && p.stats.hasBoots && !balloon.sliding) {
      kickBalloon(state, balloon, p.dir);
    }
  }
}

function tryPlaceBalloon(state: RoundState, p: Player) {
  if (!p.alive || p.revengeDuck) return;
  if (p.activeBalloons >= p.stats.balloonCount) return;
  const { tx, ty } = tileAt(p.pos);
  if (isBoulder(state.width, state.height, tx, ty)) return;
  const castle = state.castles[tx]?.[ty];
  if (castle?.hasCastle) return;
  if (findBalloonAt(state, tx, ty)) return;
  const b: Balloon = {
    id: uid("bal"),
    ownerId: p.id,
    tx,
    ty,
    fuseTick: CONFIG.BALLOON_FUSE_TICKS,
    range: p.stats.splashRange,
    sliding: undefined,
  };
  (b as any).placedTick = state.tick;
  state.balloons.push(b);
  p.activeBalloons++;
}

function kickBalloon(state: RoundState, b: Balloon, dir: Vec2) {
  if (!dir.x && !dir.y) return;
  // Determine primary axis
  let dx = 0, dy = 0;
  if (Math.abs(dir.x) >= Math.abs(dir.y)) dx = Math.sign(dir.x);
  else dy = Math.sign(dir.y);
  if (!dx && !dy) return;
  b.sliding = {
    dir: { x: dx, y: dy },
    distRemaining: Math.max(state.width, state.height),
    nextMoveTick: state.tick + 3,
  };
  state.events.push({ type: "balloon_kicked", balloonId: b.id, tx: b.tx, ty: b.ty });
}

function moveKickedBalloons(state: RoundState) {
  for (const b of state.balloons) {
    if (!b.sliding) continue;
    if (state.tick < b.sliding.nextMoveTick) continue;
    const nx = b.tx + b.sliding.dir.x;
    const ny = b.ty + b.sliding.dir.y;
    // Stop before obstacle
    if (isBoulder(state.width, state.height, nx, ny)) {
      b.sliding = undefined;
      continue;
    }
    const castle = state.castles[nx]?.[ny];
    if (castle?.hasCastle) {
      b.sliding = undefined;
      continue;
    }
    const other = findBalloonAt(state, nx, ny);
    if (other && other.id !== b.id) {
      b.sliding = undefined;
      continue;
    }
    // Stop if player occupies target tile
    const playerThere = state.players.some((p) => p.alive && !p.revengeDuck && onTile(p.pos, nx, ny)
    );
    if (playerThere) {
      b.sliding = undefined;
      continue;
    }
    b.tx = nx;
    b.ty = ny;
    b.sliding.nextMoveTick = state.tick + 3;
    b.sliding.distRemaining--;
    if (b.sliding.distRemaining <= 0) b.sliding = undefined;
  }
}

function processBalloons(state: RoundState) {
  const toDetonate: Balloon[] = [];
  const detonated = new Set<string>();

  for (const b of state.balloons) {
    if (b.fuseTick <= 0) {
      toDetonate.push(b);
      detonated.add(b.id);
    }
  }

  let chainCount = 0;
  const splashedKeys = new Set<string>();
  const newSplashes: Splash[] = [];
  const soakedThisTick = new Set<string>();
  const washedCastles: { tx: number; ty: number }[] = [];

  while (toDetonate.length > 0) {
    const b = toDetonate.shift()!;
    chainCount++;

    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= b.range; step++) {
        const tx = b.tx + d.x * step;
        const ty = b.ty + d.y * step;
        if (isBoulder(state.width, state.height, tx, ty)) break;
        const key = `${tx},${ty}`;
        if (!splashedKeys.has(key)) {
          splashedKeys.add(key);
          newSplashes.push({
            id: uid("spl"),
            tx,
            ty,
            ownerId: b.ownerId,
            lingerTick: state.tick + CONFIG.SPLASH_LINGER_TICKS,
          });
        }
        const castle = state.castles[tx]?.[ty];
        if (castle?.hasCastle) {
          castle.hasCastle = false;
          washedCastles.push({ tx, ty });
          if (castle.powerUp) {
            state.powerUps.push({ id: uid("pu"), tx, ty, type: castle.powerUp });
            state.events.push({ type: "powerup_revealed", tx, ty, powerUp: castle.powerUp });
          }
          state.events.push({ type: "castle_washed", tx, ty });
          break;
        }
        // Chain detection
        const other = findBalloonAt(state, tx, ty);
        if (other && other.id !== b.id && !detonated.has(other.id)) {
          toDetonate.push(other);
          detonated.add(other.id);
        }
      }
    }

    // remove detonated balloon
    const idx = state.balloons.findIndex((x) => x.id === b.id);
    if (idx >= 0) {
      state.balloons.splice(idx, 1);
      const owner = state.players.find((p) => p.id === b.ownerId);
      if (owner) owner.activeBalloons--;
    }
  }

  if (chainCount > 1) {
    state.events.push({ type: "chain_burst", count: chainCount });
  }

  // Apply splashes to players/powerups
  for (const s of newSplashes) {
    state.splashes.push(s);
    for (const p of state.players) {
      if (!p.alive || p.revengeDuck) continue;
      if (onTile(p.pos, s.tx, s.ty) && !soakedThisTick.has(p.id)) {
        soakPlayer(state, p, s.ownerId);
        soakedThisTick.add(p.id);
      }
    }
    // destroy exposed powerups
    for (let i = state.powerUps.length - 1; i >= 0; i--) {
      const pu = state.powerUps[i];
      if (pu.tx === s.tx && pu.ty === s.ty) {
        state.powerUps.splice(i, 1);
      }
    }
  }

  // Decrement fuses
  for (const b of state.balloons) {
    b.fuseTick--;
  }

  // Remove expired splashes
  for (let i = state.splashes.length - 1; i >= 0; i--) {
    if (state.tick >= state.splashes[i].lingerTick) {
      state.splashes.splice(i, 1);
    }
  }
}

function soakPlayer(state: RoundState, p: Player, byOwnerId?: string) {
  if (!p.alive) return;
  p.alive = false;
  const by = byOwnerId ? state.players.find((x) => x.id === byOwnerId) : undefined;
  state.events.push({
    type: "player_soaked",
    playerId: p.id,
    byPlayerId: by?.id,
  });
}

function collectPowerUps(state: RoundState) {
  for (const p of state.players) {
    if (!p.alive || p.revengeDuck) continue;
    const { tx, ty } = tileAt(p.pos);
    const idx = state.powerUps.findIndex((pu) => pu.tx === tx && pu.ty === ty);
    if (idx >= 0) {
      const pu = state.powerUps.splice(idx, 1)[0];
      applyPowerUp(p, pu);
      state.events.push({ type: "powerup_collected", playerId: p.id, tx, ty, powerUp: pu.type });
    }
  }
}

function applyPowerUp(p: Player, pu: PowerUp) {
  switch (pu.type) {
    case "extraBalloon":
      p.stats.balloonCount = Math.min(CONFIG.MAX_BALLOON_COUNT, p.stats.balloonCount + 1);
      break;
    case "bigSplash":
      p.stats.splashRange = Math.min(CONFIG.MAX_SPLASH_RANGE, p.stats.splashRange + 1);
      break;
    case "flippers":
      p.stats.speed = Math.min(CONFIG.MAX_SPEED, p.stats.speed + CONFIG.SPEED_PER_FLIPPERS);
      break;
    case "rubberBoots":
      p.stats.hasBoots = true;
      break;
  }
}

function advanceTide(state: RoundState) {
  if (state.tick >= CONFIG.TIDE_START_TICKS) {
    const ticksSince = state.tick - CONFIG.TIDE_START_TICKS;
    const ring = Math.floor(ticksSince / CONFIG.TIDE_INTERVAL_TICKS);
    if (ring !== state.tideRing) {
      state.tideRing = ring;
      state.events.push({ type: "tide_advance", ring });
    }
    const limit = Math.min(state.width, state.height) / 2 - 1;
    if (state.tideRing >= limit) state.tideRing = limit;
  }

  if (state.tideRing >= 0) {
    for (const p of state.players) {
      if (!p.alive || p.revengeDuck) continue;
      const { tx, ty } = tileAt(p.pos);
      if (isFlooded(state, tx, ty)) {
        soakPlayer(state, p);
      }
    }
    // dissolve castles in flooded tiles
    for (let x = 0; x < state.width; x++) {
      for (let y = 0; y < state.height; y++) {
        if (isFlooded(state, x, y) && state.castles[x][y]?.hasCastle) {
          state.castles[x][y]!.hasCastle = false;
          state.events.push({ type: "castle_washed", tx: x, ty: y });
        }
      }
    }
  }
}

function isFlooded(state: RoundState, tx: number, ty: number): boolean {
  if (state.tideRing < 0) return false;
  const d = Math.min(tx, ty, state.width - 1 - tx, state.height - 1 - ty);
  return d <= state.tideRing;
}

function checkRoundEnd(state: RoundState) {
  const alive = state.players.filter((p) => p.alive && !p.revengeDuck);
  if (alive.length <= 1 && !state.ended) {
    state.ended = true;
    if (alive.length === 1) {
      state.winnerId = alive[0].id;
    } else {
      state.draw = true;
    }
  }
}

function moveRevengeDuck(state: RoundState, p: Player) {
  // Move along perimeter clockwise
  const margin = 0.5;
  const speed = CONFIG.BASE_SPEED / CONFIG.TICK_RATE;
  let dx = 0, dy = 0;
  if (p.pos.y <= margin && p.pos.x < state.width - margin) dx = 1;
  else if (p.pos.x >= state.width - margin && p.pos.y < state.height - margin) dy = 1;
  else if (p.pos.y >= state.height - margin && p.pos.x > margin) dx = -1;
  else dy = -1;
  p.pos.x += dx * speed;
  p.pos.y += dy * speed;
  p.pos.x = Math.max(margin, Math.min(state.width - margin, p.pos.x));
  p.pos.y = Math.max(margin, Math.min(state.height - margin, p.pos.y));
}

export function buildSnapshot(state: RoundState): Snapshot {
  return {
    tick: state.tick,
    players: state.players.map((p) => ({
      id: p.id,
      pos: { ...p.pos },
      dir: { ...p.dir },
      alive: p.alive,
      activeBalloons: p.activeBalloons,
      stats: { ...p.stats },
      emoteUntilTick: p.emoteUntilTick,
      emoteId: p.emoteId,
      revengeDuck: p.revengeDuck,
      revengeCooldownTick: p.revengeCooldownTick,
    })),
    balloons: state.balloons.map((b) => ({ ...b, sliding: b.sliding ? { ...b.sliding } : undefined })),
    splashes: state.splashes.map((s) => ({ ...s })),
    powerUps: state.powerUps.map((p) => ({ ...p })),
    tideRing: state.tideRing,
    events: [...state.events],
  };
}

export function applySnapshot(state: RoundState, snap: Snapshot) {
  state.tick = snap.tick;
  state.tideRing = snap.tideRing;
  state.balloons = snap.balloons.map((b) => ({ ...b, sliding: b.sliding ? { ...b.sliding } : undefined }));
  state.splashes = snap.splashes.map((s) => ({ ...s }));
  state.powerUps = snap.powerUps.map((p) => ({ ...p }));
  for (const sp of snap.players) {
    const p = state.players.find((x) => x.id === sp.id);
    if (!p) continue;
    p.pos = { ...sp.pos };
    p.dir = { ...sp.dir };
    p.alive = sp.alive;
    p.activeBalloons = sp.activeBalloons;
    p.stats = { ...sp.stats };
    p.emoteUntilTick = sp.emoteUntilTick;
    p.emoteId = sp.emoteId;
    p.revengeDuck = sp.revengeDuck;
    p.revengeCooldownTick = sp.revengeCooldownTick;
  }
}

export function getTileState(state: RoundState, tx: number, ty: number): { boulder: boolean; castle: boolean; flooded: boolean } {
  return {
    boulder: isBoulder(state.width, state.height, tx, ty),
    castle: !!state.castles[tx]?.[ty]?.hasCastle,
    flooded: isFlooded(state, tx, ty),
  };
}
