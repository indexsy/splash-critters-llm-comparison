import {
  CONFIG,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  isBoulderTile,
  mulberry32,
  playerTile,
} from '@splash-critters/shared';
import type {
  Balloon,
  BotDifficulty,
  GameState,
  PlayerInput,
  PlayerState,
} from '@splash-critters/shared';
import { addBalloonThreat, cloneDangerMap, computeDangerMap, DANGER_MARGIN_TICKS } from './dangerMap.js';
import type { DangerMap } from './dangerMap.js';

/** Ticks of slack the bot wants before a splash reaches the tile it stands on. */
const ESCAPE_MARGIN: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 16,
  medium: 24,
  hard: 34,
};

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Server side bot brain. Every difficulty shares the same foundation (a danger
 * map that understands chain reactions and the rising tide) and only differs in
 * how often it thinks and how well it judges the danger.
 */
export interface BotDebugInfo {
  balloons: string;
  tick: number;
  x: number;
  y: number;
  dir: number;
  deadline: number;
  escape: number;
  drop: boolean;
}

export class BotBrain {
  /** Optional hook used by the soak script and the local debug harness. */
  debug: ((info: BotDebugInfo) => void) | null = null;
  private readonly difficulty: BotDifficulty;
  private readonly rng: () => number;
  private seq = 0;
  private lastDecisionTick = -999;
  private dir = 0;
  private wantDrop = false;
  private wanderTarget: { x: number; y: number } | null = null;

  constructor(difficulty: BotDifficulty, seed = Math.floor(Math.random() * 1e9)) {
    this.difficulty = difficulty;
    this.rng = mulberry32(seed);
  }

  get difficultyLevel(): BotDifficulty {
    return this.difficulty;
  }

  /** Called on every simulation tick. Returns an input only on decision ticks. */
  update(state: GameState, playerId: number): PlayerInput | null {
    const p = state.players[playerId];
    if (!p || !p.alive) {
      this.dir = 0;
      this.wantDrop = false;
      return null;
    }
    const cfg = CONFIG.BOTS[this.difficulty];
    const intervalTicks = Math.max(1, Math.round((cfg.intervalMs / 1000) * CONFIG.TICK_RATE));
    if (state.tick - this.lastDecisionTick < intervalTicks) return null;
    this.lastDecisionTick = state.tick;

    const danger = computeDangerMap(state);
    const w = state.arena.width;
    const tile = playerTile(p);
    const tileIdx = tile.y * w + tile.x;

    // Easy bots occasionally fail to notice the danger under their feet.
    let view = danger;
    if (cfg.errorRate > 0 && this.rng() < cfg.errorRate) {
      // The bot overlooks a distant threat - but it always knows where its own
      // balloon lies and it still reacts to imminent splashes.
      view = cloneDangerMap(danger);
      const source = view.source[tileIdx];
      const owner = source >= 0 ? state.balloons.find((b) => b.id === source) : undefined;
      const ownBalloon = owner?.owner === p.id;
      if (!ownBalloon && view.burstAt[tileIdx] > 30) view.burstAt[tileIdx] = Infinity;
    }

    const deadline = view.burstAt[tileIdx];
    if (deadline < Infinity) {
      const escape = this.findEscape(state, view, p, deadline);
      this.debug?.({
        balloons: state.balloons.map((b) => `${b.owner}:(${b.x},${b.y})f${b.fuse}`).join(','),
        tick: state.tick,
        x: p.x,
        y: p.y,
        dir: escape,
        deadline,
        escape,
        drop: false,
      });
      if (escape !== 0) {
        this.dir = escape;
        this.wantDrop = false;
        return this.emit(playerId);
      }
      // no way out - at least run towards the tile that stays dry longest
      const panic = this.safestNeighbour(state, view, p);
      if (panic !== 0) {
        this.dir = panic;
        this.wantDrop = false;
        return this.emit(playerId);
      }
    }

    const decision = this.chooseAction(state, view, p);
    this.dir = decision.dir;
    this.wantDrop = decision.drop;
    this.debug?.({
      balloons: state.balloons.map((b) => `${b.owner}:(${b.x},${b.y})f${b.fuse}`).join(','),
      tick: state.tick,
      x: p.x,
      y: p.y,
      dir: decision.dir,
      deadline,
      escape: decision.drop ? -1 : 0,
      drop: decision.drop,
    });
    return this.emit(playerId);
  }

  private emit(playerId: number): PlayerInput {
    this.seq += 1;
    const input: PlayerInput = {
      playerId,
      seq: this.seq,
      dir: this.dir,
      balloon: this.wantDrop,
    };
    this.wantDrop = false;
    return input;
  }

  // -------------------------------------------------------------------------
  // decisions
  // -------------------------------------------------------------------------

  private chooseAction(
    state: GameState,
    danger: DangerMap,
    p: PlayerState,
  ): { dir: number; drop: boolean } {
    const cfg = CONFIG.BOTS[this.difficulty];
    const w = state.arena.width;
    const h = state.arena.height;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);

    // 1. exposed power-ups are always worth a detour
    const powerup = this.findNearbyPowerup(state, p);
    if (powerup) {
      const step = this.pathStep(state, p, powerup.x, powerup.y, danger);
      if (step !== 0) return { dir: step, drop: false };
    }

    // 2. hunt the closest enemy
    const enemy = this.findClosestEnemy(state, p);
    if (enemy && cfg.aggression > 0 && (this.rng() < cfg.aggression || this.difficulty === 'hard')) {
      const aligned = this.alignedTarget(p, enemy);
      if (aligned) {
        const escape = this.tryDrop(state, danger, p);
        if (escape !== null) return { dir: escape, drop: true };
      }
      // walk to a tile from which the enemy can be splashed
      const attackTile = this.findAttackTile(state, p, enemy, danger);
      if (attackTile) {
        const step = this.pathStep(state, p, attackTile.x, attackTile.y, danger);
        if (step !== 0) return { dir: step, drop: false };
      }
      const step = this.pathStep(state, p, Math.floor(enemy.x), Math.floor(enemy.y), danger);
      if (step !== 0) return { dir: step, drop: false };
    }

    // 3. farm sandcastles
    const castle = this.findFarmTarget(state, p);
    if (castle) {
      const escape = this.tryDrop(state, danger, p);
      if (escape !== null) return { dir: escape, drop: true };
    }
    if (castle) {
      const step = this.pathStep(state, p, castle.x, castle.y, danger);
      if (step !== 0) return { dir: step, drop: false };
    }

    // 4. kick an enemy balloon if we have the boots
    if (cfg.usesKick && p.hasBoots && !p.bootsUsed) {
      const kick = this.findKickTarget(state, p);
      if (kick !== 0) return { dir: kick, drop: false };
    }

    // 5. wander
    const wander = this.wander(state, p, w, h, danger);
    return { dir: wander, drop: false };
  }

  /**
   * Returns an escape direction when dropping a balloon here is safe.
   *
   * The balloon is simulated as a ghost while the escape route is searched:
   * a balloon that blocks the only corridor would trap the bot.
   */
  private tryDrop(state: GameState, danger: DangerMap, p: PlayerState): number | null {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const preview = cloneDangerMap(danger);
    addBalloonThreat(preview, state, x, y, p.splashRange, CONFIG.BALLOON_FUSE_TICKS);

    const ghost: Balloon = {
      id: -1,
      owner: p.id,
      x,
      y,
      fuse: CONFIG.BALLOON_FUSE_TICKS,
      range: p.splashRange,
      revenge: false,
      sliding: false,
      slideDir: 0,
      slideCooldown: 0,
    };
    state.balloons.push(ghost);
    let route: { dir: number; tiles: number[] } | null = null;
    try {
      // The bot only drops when it can be well clear of the blast radius when
      // the balloon goes off - the margin depends on the difficulty.
      route = this.findEscapeRoute(
        state,
        preview,
        p,
        CONFIG.BALLOON_FUSE_TICKS,
        ESCAPE_MARGIN[this.difficulty],
      );
    } finally {
      const index = state.balloons.indexOf(ghost);
      if (index >= 0) state.balloons.splice(index, 1);
    }
    if (!route) return null;
    // The route may lead through the bot's own blast radius, but never through
    // the radius of a balloon somebody else dropped - that one can be blocked
    // at any time.
    if (this.difficulty === 'hard' || this.difficulty === 'medium') {
      const foreign = route.tiles.some(
        (tile, index) => index > 0 && preview.source[tile] >= 0,
      );
      if (foreign) return null;
    }
    return route.dir;
  }

  private findEscape(
    state: GameState,
    danger: DangerMap,
    p: PlayerState,
    deadline: number,
  ): number {
    return this.findEscapeRoute(state, danger, p, deadline)?.dir ?? 0;
  }

  /**
   * Searches a route out of the blast radius. The route is returned including
   * every tile it uses so the caller can insist on a clean escape.
   */
  private findEscapeRoute(
    state: GameState,
    danger: DangerMap,
    p: PlayerState,
    deadline: number,
    margin = DANGER_MARGIN_TICKS,
  ): { dir: number; tiles: number[] } | null {
    const w = state.arena.width;
    const h = state.arena.height;
    const start = playerTile(p);
    const startIdx = start.y * w + start.x;
    const ticksPerTile = CONFIG.TICK_RATE / p.speed;
    if (deadline <= ticksPerTile) return null; // too late, nothing to do

    const dist = new Int32Array(w * h).fill(-1);
    const prev = new Int32Array(w * h).fill(-1);
    dist[startIdx] = 0;
    const queue: number[] = [startIdx];
    let goal = -1;

    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const d = dist[cur];
      const arrival = d * ticksPerTile;
      if (cur !== startIdx && arrival + margin >= danger.burstAt[cur]) continue;
      const safe = danger.burstAt[cur];
      if (cur !== startIdx && (safe === Infinity || safe > arrival + 120)) {
        goal = cur;
        break;
      }
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (dist[ni] !== -1) continue;
        if (!this.tileFree(state, nx, ny)) continue;
        dist[ni] = d + 1;
        prev[ni] = cur;
        queue.push(ni);
      }
    }

    if (goal < 0) return null;
    const tiles: number[] = [];
    let cur = goal;
    while (prev[cur] !== -1 && prev[cur] !== startIdx) {
      tiles.unshift(cur);
      cur = prev[cur];
    }
    if (prev[cur] === -1) return null;
    tiles.unshift(startIdx);
    return {
      dir: this.dirBetween(cur % w, Math.floor(cur / w), start.x, start.y),
      tiles,
    };
  }

  /** Picks the free neighbour that stays dry the longest. */
  private safestNeighbour(state: GameState, danger: DangerMap, p: PlayerState): number {
    const w = state.arena.width;
    const h = state.arena.height;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    let best = 0;
    let bestTime = -Infinity;
    const candidates: [number, number, number][] = [
      [DIR_UP, tx, ty - 1],
      [DIR_RIGHT, tx + 1, ty],
      [DIR_DOWN, tx, ty + 1],
      [DIR_LEFT, tx - 1, ty],
    ];
    for (const [dir, nx, ny] of candidates) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!this.tileFree(state, nx, ny)) continue;
      const time = danger.burstAt[ny * w + nx];
      if (time > bestTime) {
        bestTime = time;
        best = dir;
      }
    }
    return bestTime === -Infinity ? 0 : best;
  }

  /** A tile is free when it holds no boulder, no sandcastle and no balloon. */
  private tileFree(state: GameState, x: number, y: number): boolean {
    if (isBoulderTile(x, y, state.arena.width, state.arena.height)) return false;
    if (state.arena.castles[y * state.arena.width + x]) return false;
    for (const b of state.balloons) if (b.x === x && b.y === y) return false;
    return true;
  }

  private dirBetween(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    if (dx === 1) return DIR_RIGHT;
    if (dx === -1) return DIR_LEFT;
    if (dy === 1) return DIR_DOWN;
    if (dy === -1) return DIR_UP;
    return 0;
  }

  /**
   * Breadth first navigation towards a tile, returns the direction of step one.
   * Tiles that are about to be splashed are avoided unless the bot has to run
   * through them to escape.
   */
  private pathStep(
    state: GameState,
    p: PlayerState,
    gx: number,
    gy: number,
    danger?: DangerMap,
    horizon = 45,
  ): number {
    const w = state.arena.width;
    const h = state.arena.height;
    const start = playerTile(p);
    const startIdx = start.y * w + start.x;
    const goalIdx = gy * w + gx;
    if (startIdx === goalIdx) return 0;

    const prev = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    seen[startIdx] = 1;
    const queue: number[] = [startIdx];
    let goal = -1;

    for (let qi = 0; qi < queue.length && qi < 400; qi++) {
      const cur = queue[qi];
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        if (!this.tileFree(state, nx, ny)) continue;
        if (danger && danger.burstAt[ni] < horizon) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        if (ni === goalIdx) {
          goal = ni;
          break;
        }
        queue.push(ni);
      }
      if (goal >= 0) break;
    }
    if (goal < 0) return 0;
    let cur = goal;
    while (prev[cur] !== -1 && prev[cur] !== startIdx) cur = prev[cur];
    if (prev[cur] === -1) return 0;
    return this.dirBetween(cur % w, Math.floor(cur / w), start.x, start.y);
  }

  private findNearbyPowerup(state: GameState, p: PlayerState): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const e of state.exposed) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (d < bestDist && d <= 8) {
        bestDist = d;
        best = { x: e.x, y: e.y };
      }
    }
    return best;
  }

  private findClosestEnemy(state: GameState, p: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDist = Infinity;
    for (const other of state.players) {
      if (!other.alive || other.id === p.id) continue;
      const d = Math.abs(other.x - p.x) + Math.abs(other.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  /**
   * Finds a reachable tile from which the enemy would be hit by a splash.
   * The bot walks there first and only drops the balloon once it is aligned.
   */
  private findAttackTile(
    state: GameState,
    p: PlayerState,
    enemy: PlayerState,
    danger: DangerMap,
  ): { x: number; y: number } | null {
    const w = state.arena.width;
    const h = state.arena.height;
    const ex = Math.floor(enemy.x);
    const ey = Math.floor(enemy.y);
    const range = p.splashRange;
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let d = -range; d <= range; d++) {
      const candidates = [
        { x: ex + d, y: ey },
        { x: ex, y: ey + d },
      ];
      for (const candidate of candidates) {
        if (candidate.x < 1 || candidate.y < 1 || candidate.x >= w - 1 || candidate.y >= h - 1) {
          continue;
        }
        if (!this.tileFree(state, candidate.x, candidate.y)) continue;
        if (danger && danger.burstAt[candidate.y * w + candidate.x] < 30) continue;
        const distance = Math.abs(candidate.x - p.x) + Math.abs(candidate.y - p.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
    return best;
  }

  /** True when the enemy sits in the same row or column within splash range. */
  private alignedTarget(p: PlayerState, enemy: PlayerState): boolean {
    const sameRow = Math.floor(p.y) === Math.floor(enemy.y);
    const sameCol = Math.floor(p.x) === Math.floor(enemy.x);
    if (!sameRow && !sameCol) return false;
    const distance = sameRow
      ? Math.abs(enemy.x - p.x)
      : Math.abs(enemy.y - p.y);
    return distance <= p.splashRange && distance >= 1;
  }

  /** The nearest sandcastle that the current splash range could wash away. */
  private findFarmTarget(
    state: GameState,
    p: PlayerState,
  ): { x: number; y: number } | null {
    const w = state.arena.width;
    const h = state.arena.height;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    for (const [dx, dy] of DIRS) {
      for (let step = 1; step <= p.splashRange; step++) {
        const nx = tx + dx * step;
        const ny = ty + dy * step;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
        if (isBoulderTile(nx, ny, w, h)) break;
        if (state.arena.castles[ny * w + nx]) return { x: nx, y: ny };
        break;
      }
    }
    return null;
  }

  /** Hard bots try to push enemy balloons towards their owner. */
  private findKickTarget(state: GameState, p: PlayerState): number {
    const w = state.arena.width;
    const h = state.arena.height;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    for (const [dx, dy] of DIRS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const balloon = state.balloons.find((b) => b.x === nx && b.y === ny);
      if (!balloon) continue;
      if (balloon.owner === p.id) continue;
      // the balloon has to travel towards the victim
      const victim = state.players[balloon.owner];
      if (!victim || !victim.alive) continue;
      const vx = Math.floor(victim.x);
      const vy = Math.floor(victim.y);
      if (dx !== 0 && vx !== nx) continue;
      if (dy !== 0 && vy !== ny) continue;
      if (dx > 0) return DIR_RIGHT;
      if (dx < 0) return DIR_LEFT;
      if (dy > 0) return DIR_DOWN;
      if (dy < 0) return DIR_UP;
    }
    return 0;
  }

  private wander(
    state: GameState,
    p: PlayerState,
    w: number,
    h: number,
    danger?: DangerMap,
  ): number {
    const cfg = CONFIG.BOTS[this.difficulty];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.wanderTarget || this.rng() < 0.25) {
        const x = 1 + Math.floor(this.rng() * (w - 2));
        const y = 1 + Math.floor(this.rng() * (h - 2));
        this.wanderTarget = { x, y };
      }
      const step = this.pathStep(state, p, this.wanderTarget.x, this.wanderTarget.y, danger);
      if (step !== 0) return step;
      this.wanderTarget = null;
    }
    // no route at all - shuffle into any free tile instead of standing still
    const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
    for (let i = 0; i < 8; i++) {
      const dir = dirs[Math.floor(this.rng() * dirs.length)];
      const nx = Math.floor(p.x) + (dir === DIR_LEFT ? -1 : dir === DIR_RIGHT ? 1 : 0);
      const ny = Math.floor(p.y) + (dir === DIR_UP ? -1 : dir === DIR_DOWN ? 1 : 0);
      if (!this.tileFree(state, nx, ny)) continue;
      if (danger && danger.burstAt[ny * state.arena.width + nx] < 45) continue;
      return dir;
    }
    void cfg;
    return 0;
  }
}
