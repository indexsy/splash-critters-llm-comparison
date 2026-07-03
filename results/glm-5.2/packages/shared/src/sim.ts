// sim.ts — deterministic shared simulation. Runs identically on server (authority)
// and client (prediction). Pure: simulateTick(state, inputs) -> mutates state.
//
// Handles: movement & collision, balloon drop + fuse, cross-shaped splash, single-
// tick chain-burst cascade (BFS), power-up reveal/collect/destroy, balloon kick
// (sliding), and the Rising Tide sudden death.

import {
  BALLOON_FUSE_TICKS,
  PLAYER_STATS,
  SPLASH_LINGER_TICKS,
  TICK_HZ,
  TIDE_INTERVAL_TICKS,
  TIDE_START_TICKS,
} from "./config.js";
import { DIR_DX, DIR_DY, type Dir, type GameEvent, type Input, type MatchState, type Player, type PowerUpKind } from "./types.js";

// ---------- factory ----------

export function newPlayer(id: number, x: number, y: number): Player {
  return {
    id,
    entityId: 0,
    x,
    y,
    dir: 1,
    moving: false,
    alive: true,
    soaks: 0,
    roundsWon: 0,
    speed: PLAYER_STATS.speedBase,
    balloonCount: PLAYER_STATS.balloonCountBase,
    splashRange: PLAYER_STATS.splashRangeBase,
    hasKick: false,
    liveBalloons: 0,
    animTime: 0,
    revenge: false,
    revengeX: 0,
    revengeY: 0,
    revengeCooldown: 0,
    lastAppliedSeq: 0,
  };
}

// ---------- helpers ----------

function tileBlocked(state: MatchState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return true;
  const t = state.tiles[y * state.width + x];
  if (t === 1 || t === 2) return true; // boulder or sandcastle
  // any balloon on that tile blocks movement
  for (const b of state.balloons.values()) {
    if (b.x === x && b.y === y && b.sliding !== 0 && b.sliding !== 1 && b.sliding !== 2 && b.sliding !== 3) return true;
  }
  return false;
}

function balloonAt(state: MatchState, x: number, y: number) {
  for (const b of state.balloons.values()) if (b.x === x && b.y === y) return b;
  return undefined;
}

function playerAt(state: MatchState, x: number, y: number) {
  for (const p of state.players) {
    if (p.alive && !p.revenge && Math.round(p.x) === x && Math.round(p.y) === y) return p;
  }
  return undefined;
}

function pushEvent(state: MatchState, e: GameEvent) {
  state.events.push(e);
}

// ---------- input application ----------

function applyMovement(state: MatchState, p: Player, dir: Dir) {
  p.dir = dir;
  const dx = DIR_DX[dir];
  const dy = DIR_DY[dir];
  const targetX = p.x + dx;
  const targetY = p.y + dy;
  // Movement is tile-grid aligned: only move if currently centered and target free.
  const centered = Math.abs(p.x - Math.round(p.x)) < 1e-6 && Math.abs(p.y - Math.round(p.y)) < 1e-6;
  if (!centered) {
    // continue toward current rounding target (already mid-move); allow drift
    const speed = p.speed / TICK_HZ;
    const nx = p.x + dx * speed;
    const ny = p.y + dy * speed;
    p.x = clampCoord(nx, state.width);
    p.y = clampCoord(ny, state.height);
    p.moving = true;
    return;
  }
  if (!tileBlocked(state, targetX, targetY)) {
    const speed = p.speed / TICK_HZ;
    p.x = clampCoord(p.x + dx * speed, state.width);
    p.y = clampCoord(p.y + dy * speed, state.height);
    p.moving = true;
  } else {
    p.moving = false;
  }
}

function clampCoord(v: number, max: number) {
  return Math.max(1, Math.min(max - 2, v));
}

function tryKick(state: MatchState, p: Player, dir: Dir) {
  if (!p.hasKick) return;
  const tx = Math.round(p.x) + DIR_DX[dir];
  const ty = Math.round(p.y) + DIR_DY[dir];
  const b = balloonAt(state, tx, ty);
  if (b && b.sliding === undefined) {
    b.sliding = dir;
    pushEvent(state, { type: "balloon_kicked", id: b.id, dir });
  }
}

// ---------- balloon drop ----------

function dropBalloon(state: MatchState, p: Player) {
  if (p.liveBalloons >= p.balloonCount) return;
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  if (balloonAt(state, tx, ty)) return; // one per tile
  const id = state.nextEntityId++;
  state.balloons.set(id, {
    id,
    x: tx,
    y: ty,
    ownerId: p.id,
    fuse: BALLOON_FUSE_TICKS,
    range: p.splashRange,
    sliding: undefined,
    spawnedTick: state.tick,
  });
  p.liveBalloons++;
}

// ---------- explosion / splash cascade ----------

function explode(state: MatchState, balloonId: number, queue: number[]) {
  const b = state.balloons.get(balloonId);
  if (!b) return;
  state.balloons.delete(b.id);
  const owner = state.players[b.ownerId];
  if (owner) owner.liveBalloons = Math.max(0, owner.liveBalloons - 1);

  // compute cross-shaped extents. Boulders (and out-of-bounds) block entirely;
  // a sandcastle is the terminal tile of a direction (it gets washed, then stop).
  const extent = (dx: number, dy: number): number => {
    for (let d = 1; d <= b.range; d++) {
      const nx = b.x + dx * d;
      const ny = b.y + dy * d;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) return d - 1;
      const t = state.tiles[ny * state.width + nx];
      if (t === 1) return d - 1; // boulder blocks
      if (t === 2) return d; // sandcastle: wash it then stop
    }
    return b.range;
  };
  const up = extent(0, -1);
  const down = extent(0, 1);
  const left = extent(-1, 0);
  const right = extent(1, 0);

  // Wash away first sandcastle per direction; reveal/destroy power-up; soak players;
  // and queue any chained balloon for BFS expansion in the SAME tick.
  const wash = (x: number, y: number) => {
    const i = y * state.width + x;
    if (state.tiles[i] === 2) {
      state.tiles[i] = 0;
      pushEvent(state, { type: "castle_washed", x, y });
      const hidden = state.hiddenPowerUps[i];
      if (hidden) {
        state.hiddenPowerUps[i] = "";
        const pid = state.nextEntityId++;
        state.exposedPowerUps.set(pid, { id: pid, kind: hidden, x, y });
        pushEvent(state, { type: "powerup_revealed", x, y, kind: hidden });
      }
    }
    // destroy exposed power-up hit by splash
    for (const [eId, pu] of state.exposedPowerUps) {
      if (pu.x === x && pu.y === y) {
        state.exposedPowerUps.delete(eId);
      }
    }
    // soak any player standing here
    for (const p of state.players) {
      if (p.alive && !p.revenge && Math.round(p.x) === x && Math.round(p.y) === y) {
        p.alive = false;
        p.revenge = true;
        pushEvent(state, { type: "player_soaked", playerId: p.id, byPlayerId: b.ownerId });
        const soaker = state.players[b.ownerId];
        if (soaker && soaker.id !== p.id) soaker.soaks++;
      }
    }
    // chain: a balloon on a splashed tile bursts now
    for (const [cId, c] of state.balloons) {
      if (c.x === x && c.y === y && !queue.includes(cId)) {
        queue.push(cId);
      }
    }
  };

  wash(b.x, b.y);
  for (let d = 1; d <= up; d++) wash(b.x, b.y - d);
  for (let d = 1; d <= down; d++) wash(b.x, b.y + d);
  for (let d = 1; d <= left; d++) wash(b.x - d, b.y);
  for (let d = 1; d <= right; d++) wash(b.x + d, b.y);

  // splash entity for rendering (with linger)
  state.splashes.set(state.nextEntityId, {
    id: state.nextEntityId,
    cx: b.x,
    cy: b.y,
    up, down, left, right,
    linger: SPLASH_LINGER_TICKS,
    ownerId: b.ownerId,
  });
  state.nextEntityId++;
}

// ---------- power-up collection ----------

function collectPowerUps(state: MatchState) {
  for (const p of state.players) {
    if (!p.alive || p.revenge) continue;
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    for (const [eId, pu] of state.exposedPowerUps) {
      if (pu.x === tx && pu.y === ty) {
        applyPowerUp(p, pu.kind);
        pushEvent(state, { type: "powerup_collected", playerId: p.id, kind: pu.kind, x: tx, y: ty });
        state.exposedPowerUps.delete(eId);
      }
    }
  }
}

function applyPowerUp(p: Player, kind: PowerUpKind) {
  switch (kind) {
    case "extraBalloon":
      p.balloonCount = Math.min(PLAYER_STATS.balloonCountCap, p.balloonCount + 1);
      break;
    case "bigSplash":
      p.splashRange = Math.min(PLAYER_STATS.splashRangeCap, p.splashRange + 1);
      break;
    case "flippers":
      p.speed = Math.min(PLAYER_STATS.speedCap, p.speed + PLAYER_STATS.speedPerFlippers);
      break;
    case "rubberBoots":
      p.hasKick = true;
      break;
  }
}

// ---------- sliding (kicked) balloons ----------

function updateSlidingBalloons(state: MatchState, queue: number[]) {
  for (const [id, b] of [...state.balloons]) {
    if (b.sliding === undefined) continue;
    const nx = b.x + DIR_DX[b.sliding];
    const ny = b.y + DIR_DY[b.sliding];
    if (state.tiles[ny * state.width + nx] === 1 || state.tiles[ny * state.width + nx] === 2) {
      b.sliding = undefined; // stop at boulder/castle
    } else if (balloonAt(state, nx, ny) || playerAt(state, nx, ny)) {
      b.sliding = undefined;
    } else {
      b.x = nx;
      b.y = ny;
    }
  }
}

// ---------- rising tide ----------

function updateTide(state: MatchState) {
  if (!state.tideActive && state.tick >= TIDE_START_TICKS) {
    state.tideActive = true;
    state.tideRing = 0;
  }
  if (!state.tideActive) return;
  if (state.tick % TIDE_INTERVAL_TICKS === 0) {
    state.tideRing++;
    pushEvent(state, { type: "tide_advance", ring: state.tideRing });
  }
  if (state.tideActive && state.tideRing > 0) {
    // Flood tiles whose min(border-distance) <= tideRing
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const distBorder = Math.min(x, y, state.width - 1 - x, state.height - 1 - y);
        if (distBorder < state.tideRing) {
          const i = y * state.width + x;
          if (state.tiles[i] === 2) {
            state.tiles[i] = 0;
            pushEvent(state, { type: "castle_washed", x, y });
          }
          for (const p of state.players) {
            if (p.alive && !p.revenge && Math.round(p.x) === x && Math.round(p.y) === y) {
              p.alive = false;
              p.revenge = true;
              pushEvent(state, { type: "player_soaked", playerId: p.id, byPlayerId: -1 });
            }
          }
        }
      }
    }
  }
}

// ---------- main tick ----------

export function simulateTick(state: MatchState, inputs: Map<number, Input[]>) {
  state.tick++;
  state.events = [];

  // 1. apply inputs to each player
  for (const p of state.players) {
    if (!p.alive && !p.revenge) continue;
    const q = inputs.get(p.id) ?? [];
    // keep only inputs newer than last applied
    let chosen: Input | undefined;
    while (q.length) {
      const n = q.shift()!;
      if (n.seq > p.lastAppliedSeq) {
        chosen = n;
        p.lastAppliedSeq = n.seq;
        break;
      }
    }
    if (p.revenge) {
      // revenge duck movement along the border (cosmetic + lob)
      if (p.revengeCooldown > 0) p.revengeCooldown--;
      continue;
    }
    if (chosen) {
      if (chosen.dir >= 0) {
        applyMovement(state, p, chosen.dir as Dir);
        tryKick(state, p, chosen.dir as Dir);
      } else {
        p.moving = false;
      }
      if (chosen.balloonPressed) dropBalloon(state, p);
    }
    if (p.moving) p.animTime++;
  }

  // 2. update balloon fuses & sliding
  const detonate: number[] = [];
  for (const [id, b] of state.balloons) {
    b.fuse--;
    if (b.fuse <= 0) detonate.push(id);
  }
  updateSlidingBalloons(state, detonate);

  // 3. resolve explosions: fuse-expired + chains, all in one tick (BFS)
  {
    const queue = [...detonate];
    while (queue.length) {
      const id = queue.shift()!;
      if (!state.balloons.has(id)) continue;
      const chainStart = state.balloons.size;
      explode(state, id, queue);
      const burst = chainStart - state.balloons.size;
      if (burst > 0) {
        pushEvent(state, { type: "chain_burst", chainSize: burst, x: 0, y: 0 });
      }
    }
  }

  // 4. lingering splash countdown
  for (const [id, s] of state.splashes) {
    s.linger--;
    if (s.linger <= 0) state.splashes.delete(id);
  }

  // 5. power-up collection
  collectPowerUps(state);

  // 6. rising tide
  updateTide(state);

  // 7. round-over detection
  const alive = state.players.filter((p) => p.alive);
  if (!state.roundOver && state.players.length > 1) {
    if (alive.length <= 1) {
      state.roundOver = true;
      if (alive.length === 1) alive[0].roundsWon++;
    }
  } else if (state.players.length === 1 && alive.length === 0) {
    state.roundOver = true;
  }
}

export { applyPowerUp };
