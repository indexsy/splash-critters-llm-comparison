import { CONFIG, TILE_CASTLE, TILE_EMPTY } from './config.js';
import { isStaticBoulder } from './map.js';
import type { Snapshot } from './protocol.js';
import { cloneState, type SimState } from './sim.js';

export function tilesFromCastles(w: number, h: number, castles: number[]): number[] {
  const tiles = new Array<number>(w * h).fill(TILE_EMPTY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isStaticBoulder(x, y, w, h)) tiles[y * w + x] = 1;
    }
  }
  for (const i of castles) {
    if (i >= 0 && i < tiles.length && tiles[i] === TILE_EMPTY) tiles[i] = TILE_CASTLE;
  }
  return tiles;
}

export function snapshotFromState(
  state: SimState,
  ackSeq: number,
  serverTime: number,
  extra: { round: number; roundWins: Record<string, number>; pings: Record<string, number> },
): Snapshot {
  const castles: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) if (state.tiles[i] === TILE_CASTLE) castles.push(i);
  const timeLeft = Math.max(0, state.tideStart - state.tick);
  return {
    tick: state.tick,
    serverTime,
    ackSeq,
    tide: state.tideLevel,
    phase: state.phase,
    winnerId: state.winnerId,
    draw: state.draw,
    width: state.width,
    height: state.height,
    round: extra.round,
    timeLeft,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      hat: p.hat,
      x: p.x,
      y: p.y,
      dir: p.dir,
      alive: p.alive,
      ducking: p.ducking,
      duckPos: p.duckPos,
      speed: p.speed,
      balloonMax: p.balloonMax,
      splashRange: p.splashRange,
      hasKick: p.hasKick,
      flippers: p.flippers,
      soaks: p.soaks,
      castles: p.castles,
      roundWins: extra.roundWins[p.id] ?? 0,
      balloonHeld: p.balloonHeld,
      phasingX: p.phasingX,
      phasingY: p.phasingY,
      ping: extra.pings[p.id] ?? 0,
      soakedBy: p.soakedBy,
    })),
    balloons: state.balloons.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      tx: b.tx,
      ty: b.ty,
      fuse: b.fuse,
      range: b.range,
      slideDir: b.slideDir,
      slideProg: b.slideProg,
      slideTiles: b.slideTiles,
      maxSlide: b.maxSlide,
      revenge: b.revenge,
    })),
    splashes: state.splashes.map((s) => ({ x: s.x, y: s.y, dir: s.dir, ttl: s.ttl, ownerId: s.ownerId })),
    powerups: state.powerups.filter((p) => !p.hidden).map((p) => ({ x: p.x, y: p.y, kind: p.kind })),
    castles,
  };
}

export function applySnapshot(prev: SimState | null, snap: Snapshot): SimState {
  const base: SimState = prev
    ? cloneState(prev)
    : {
        width: snap.width,
        height: snap.height,
        tiles: [],
        players: [],
        balloons: [],
        splashes: [],
        powerups: [],
        tick: 0,
        tideLevel: 0,
        tideStart: CONFIG.ROUND_TIME_TICKS,
        tideInterval: CONFIG.TIDE_INTERVAL_TICKS,
        nextBalloonId: 1,
        events: [],
        phase: 'playing',
        winnerId: null,
        draw: false,
        enableKick: CONFIG.ENABLE_KICK,
        enableRevenge: false,
        aliveAtStart: 0,
      };
  base.width = snap.width;
  base.height = snap.height;
  base.tiles = tilesFromCastles(snap.width, snap.height, snap.castles);
  base.tick = snap.tick;
  base.tideLevel = snap.tide;
  base.phase = snap.phase;
  base.winnerId = snap.winnerId;
  base.draw = snap.draw;
  base.events = [];
  base.splashes = snap.splashes.map((s) => ({ ...s }));
  base.balloons = snap.balloons.map((b) => ({ ...b, bornTick: 0 }));
  base.powerups = snap.powerups.map((p) => ({ ...p, hidden: false, revealedTick: -1 }));
  const maxId = base.balloons.reduce((m, b) => Math.max(m, b.id), 0);
  base.nextBalloonId = Math.max(base.nextBalloonId, maxId + 1);
  base.players = snap.players.map((p) => ({
    id: p.id,
    name: p.name,
    animal: p.animal,
    hat: p.hat,
    x: p.x,
    y: p.y,
    dir: p.dir,
    alive: p.alive,
    ducking: p.ducking,
    duckPos: p.duckPos,
    duckCooldown: 0,
    speed: p.speed,
    balloonMax: p.balloonMax,
    splashRange: p.splashRange,
    hasKick: p.hasKick,
    flippers: p.flippers,
    soaks: p.soaks,
    castles: p.castles,
    biggestChain: 0,
    survived: 0,
    balloonHeld: p.balloonHeld,
    phasingX: p.phasingX,
    phasingY: p.phasingY,
    soakedBy: p.soakedBy,
  }));
  return base;
}
