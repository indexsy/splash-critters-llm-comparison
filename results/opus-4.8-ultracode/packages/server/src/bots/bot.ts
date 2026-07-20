/**
 * Server-side bot controller. One per bot slot. Produces a PlayerInput each tick.
 * Bots run ONLY on the server (fed into the sim as inputs like any player), so
 * they may use Math.random without affecting client-prediction determinism.
 *
 * Decision loop: 1) flee if the current tile is dangerous; 2) never place a
 * balloon without a verified reachable escape; 3) otherwise hunt / farm / collect.
 */

import {
  CONFIG,
  Tile,
  idx,
  type Balloon,
  type Difficulty,
  type GameState,
  type Player,
  type PlayerInput,
} from '@splash/shared';
import {
  computeDangerMap,
  tileActiveDanger,
  tileImminentDanger,
  type DangerMap,
} from './dangerMap';
import { bfs, dirBetween, manhattan, walkableForBot, type Tile2 } from './pathing';

const IDLE: PlayerInput = { seq: 0, tick: 0, dir: null, balloon: false };

export class BotController {
  readonly playerId: string;
  readonly difficulty: Difficulty;
  private path: Tile2[] = [];
  private placeOnArrive = false;
  private escape: Tile2[] = [];
  private lastDecisionTick = -9999;
  private lastPlaceTick = -9999;
  private escaping = false; // committed to retreating after dropping a balloon

  constructor(playerId: string, difficulty: Difficulty) {
    this.playerId = playerId;
    this.difficulty = difficulty;
  }

  private me(state: GameState): Player | undefined {
    return state.players.find((p) => p.id === this.playerId);
  }

  private ticksPerTile(me: Player): number {
    return Math.max(1, Math.ceil(CONFIG.TICK_RATE / me.speed));
  }

  private intervalTicks(): number {
    return Math.max(1, Math.round((CONFIG.BOT[this.difficulty].decisionMs / 1000) * CONFIG.TICK_RATE));
  }

  step(state: GameState, now: number): PlayerInput {
    const me = this.me(state);
    if (!me || !me.alive) return IDLE;
    const cur: Tile2 = { x: Math.round(me.x), y: Math.round(me.y) };
    const dm = computeDangerMap(state);
    const cfg = CONFIG.BOT[this.difficulty];
    const lead = this.ticksPerTile(me) * 4;

    const unsafe = tileActiveDanger(dm, cur.x, cur.y) || tileImminentDanger(dm, cur.x, cur.y, lead);
    const misjudge = this.difficulty === 'easy' && Math.random() < cfg.dangerMisjudge;

    // done retreating only once fully clear of our own (and others') blast
    const curSafe = dm.dangerAt[idx(cur.x, cur.y, state.width)] === Infinity;
    if (this.escaping && curSafe) this.escaping = false;

    if (unsafe && !misjudge) {
      const flee = this.findSafeTile(state, dm, cur, me, now);
      this.path = flee ?? this.leastDangerStep(state, dm, cur);
      this.placeOnArrive = false;
    } else if (this.escaping) {
      // fully commit to the retreat before re-engaging — don't re-plan back into our own blast
      if (this.path.length === 0) {
        const flee = this.findSafeTile(state, dm, cur, me, now);
        if (flee) this.path = flee;
        else this.escaping = false;
      }
    } else if (now - this.lastDecisionTick >= this.intervalTicks() || this.path.length === 0) {
      this.decide(state, dm, me, cur);
      this.lastDecisionTick = now;
    }

    // walking INTO a tile is only unsafe if it splashes before we can pass through it;
    // tiles that burst later are fine to traverse (keeps bots from freezing near live balloons).
    const moveLead = Math.ceil(this.ticksPerTile(me) * 1.5);
    return this.follow(state, dm, me, cur, now, moveLead, misjudge);
  }

  // ---- following the current plan ----

  private follow(
    state: GameState,
    dm: DangerMap,
    me: Player,
    cur: Tile2,
    now: number,
    moveLead: number,
    misjudge: boolean,
  ): PlayerInput {
    while (this.path.length && this.path[0].x === cur.x && this.path[0].y === cur.y) this.path.shift();

    if (this.path.length === 0) {
      if (this.placeOnArrive && this.canPlace(state, me, cur, now)) {
        this.placeOnArrive = false;
        this.lastPlaceTick = now;
        this.escaping = this.difficulty !== 'easy'; // Easy doesn't reliably retreat — it pays for it
        this.path = this.escape.slice();
        return { seq: now, tick: now, dir: null, balloon: true };
      }
      this.placeOnArrive = false;
      return { seq: now, tick: now, dir: null, balloon: false };
    }

    const next = this.path[0];
    // never knowingly walk into a tile that is (about to be) splashed
    const nextDangerous = !misjudge && (tileActiveDanger(dm, next.x, next.y) || tileImminentDanger(dm, next.x, next.y, moveLead));
    if (!walkableForBot(state, next.x, next.y) || nextDangerous) {
      const flee = this.findSafeTile(state, dm, cur, me, now);
      this.path = flee ?? this.leastDangerStep(state, dm, cur);
      this.placeOnArrive = false;
      const step = this.path[0];
      if (!step || (step.x === cur.x && step.y === cur.y)) return { seq: now, tick: now, dir: null, balloon: false };
      return { seq: now, tick: now, dir: dirBetween(cur, step), balloon: false };
    }
    const dir = dirBetween(cur, next);
    return { seq: now, tick: now, dir, balloon: false };
  }

  // ---- decisions ----

  private decide(state: GameState, dm: DangerMap, me: Player, cur: Tile2): void {
    const cfg = CONFIG.BOT[this.difficulty];

    // 1) grab a safely reachable power-up
    if (state.powerups.length) {
      const pk = bfs(
        state,
        cur,
        (x, y) => state.powerups.some((pu) => pu.x === x && pu.y === y),
        { maxDist: 10, blocked: (x, y) => tileImminentDanger(dm, x, y, this.ticksPerTile(me) * 4) },
      );
      if (pk) {
        this.path = pk.path;
        this.placeOnArrive = false;
        return;
      }
    }

    // 2) hunt a player (medium/hard)
    if (cfg.attackRange > 0 && Math.random() < cfg.aggression) {
      const enemy = this.nearestEnemy(state, me);
      if (enemy && manhattan(cur, { x: Math.round(enemy.x), y: Math.round(enemy.y) }) <= cfg.attackRange) {
        const spot = this.findFiringSpot(state, cur, me, enemy);
        if (spot) {
          this.path = spot;
          this.placeOnArrive = true;
          return;
        }
      }
    }

    // 3) farm the nearest castle
    const farm = bfs(state, cur, (x, y) => this.hasCastleNeighbor(state, x, y), {
      maxDist: 20,
      blocked: (x, y) => tileImminentDanger(dm, x, y, this.ticksPerTile(me) * 4),
    });
    if (farm) {
      this.path = farm.path;
      this.placeOnArrive = true;
      return;
    }

    // 4) wander toward open safe space
    this.path = this.wander(state, dm, cur);
    this.placeOnArrive = false;
  }

  // ---- placement safety ----

  private canPlace(state: GameState, me: Player, cur: Tile2, now: number): boolean {
    if (me.activeBalloons >= me.maxBalloons) return false;
    if (now - this.lastPlaceTick < 8) return false; // small cooldown, avoids balloon spam / self-clustering
    if (state.grid[idx(cur.x, cur.y, state.width)] !== Tile.Empty) return false;
    if (state.balloons.some((b) => Math.round(b.x) === cur.x && Math.round(b.y) === cur.y)) return false;
    const esc = this.verifyEscape(state, me, cur, now);
    if (!esc) {
      // Easy bots are reckless: they sometimes drop a balloon without a proven
      // escape (and pay for it). Medium/Hard never do — that's the skill gap.
      if (this.difficulty === 'easy' && Math.random() < 0.4) {
        this.escape = this.leastDangerStep(state, computeDangerMap(state), cur);
        return true;
      }
      return false;
    }
    this.escape = esc;
    return true;
  }

  /** BFS to a tile that stays fully safe once a virtual balloon is placed at cur. */
  private verifyEscape(state: GameState, me: Player, cur: Tile2, now: number): Tile2[] | null {
    const virtual: Balloon = {
      id: -1,
      owner: me.id,
      x: cur.x,
      y: cur.y,
      fuseTick: now + CONFIG.FUSE_TICKS,
      range: me.range,
      sliding: null,
      slideFrom: null,
      passableOwners: [],
    };
    const dm2 = computeDangerMap(state, [virtual]);
    const tpt = this.ticksPerTile(me);
    // How long until THIS balloon actually goes off — accounting for early chain
    // detonation by nearby balloons, not just its own 90-tick fuse.
    const burstTick = dm2.dangerAt[idx(cur.x, cur.y, state.width)];
    const budget = Number.isFinite(burstTick) ? burstTick : now + CONFIG.FUSE_TICKS;
    const res = bfs(
      state,
      cur,
      (x, y) => dm2.dangerAt[idx(x, y, state.width)] === Infinity,
      { maxDist: 12 },
    );
    if (!res) return null;
    if (now + res.dist * tpt > budget - tpt) return null; // can't clear the blast in time
    return res.path;
  }

  // ---- fleeing ----

  private findSafeTile(state: GameState, dm: DangerMap, cur: Tile2, me: Player, now: number): Tile2[] | null {
    const tpt = this.ticksPerTile(me);
    // never route THROUGH a tile that is splashing now or about to (kill-zone);
    // far-future dangers are passable since we clear them first.
    const blocked = (x: number, y: number): boolean => {
      const d = dm.dangerAt[idx(x, y, state.width)];
      if (d === Infinity) return false;
      if (d <= now && now <= d + CONFIG.SPLASH_LINGER_TICKS) return true;
      return d - now <= tpt * 2;
    };
    const res = bfs(
      state,
      cur,
      (x, y, dist) => {
        const i = idx(x, y, state.width);
        const d = dm.dangerAt[i];
        if (d === Infinity) return true;
        return now + dist * tpt > d + CONFIG.SPLASH_LINGER_TICKS;
      },
      { maxDist: 18, blocked },
    );
    return res ? res.path : null;
  }

  private leastDangerStep(state: GameState, dm: DangerMap, cur: Tile2): Tile2[] {
    let best: Tile2 | null = null;
    let bestDanger = dm.dangerAt[idx(cur.x, cur.y, state.width)];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!walkableForBot(state, nx, ny)) continue;
      const d = dm.dangerAt[idx(nx, ny, state.width)];
      if (d > bestDanger) {
        bestDanger = d;
        best = { x: nx, y: ny };
      }
    }
    return best ? [best] : [];
  }

  // ---- helpers ----

  private hasCastleNeighbor(state: GameState, x: number, y: number): boolean {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      if (state.grid[idx(nx, ny, state.width)] === Tile.Sandcastle) return true;
    }
    return false;
  }

  private nearestEnemy(state: GameState, me: Player): Player | undefined {
    let best: Player | undefined;
    let bestD = Infinity;
    for (const p of state.players) {
      if (p.id === me.id || !p.alive || p.revenge) continue;
      const d = manhattan({ x: me.x, y: me.y }, { x: p.x, y: p.y });
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Path to the nearest tile from which a balloon would threaten the enemy along a clear line. */
  private findFiringSpot(state: GameState, cur: Tile2, me: Player, enemy: Player): Tile2[] | null {
    const ex = Math.round(enemy.x);
    const ey = Math.round(enemy.y);
    const res = bfs(
      state,
      cur,
      (x, y) => this.threatens(state, x, y, ex, ey, me.range),
      { maxDist: 8 },
    );
    return res ? res.path : null;
  }

  private threatens(state: GameState, x: number, y: number, ex: number, ey: number, range: number): boolean {
    if (x === ex && Math.abs(y - ey) <= range && Math.abs(y - ey) >= 1) return this.clearLine(state, x, y, ex, ey);
    if (y === ey && Math.abs(x - ex) <= range && Math.abs(x - ex) >= 1) return this.clearLine(state, x, y, ex, ey);
    return false;
  }

  private clearLine(state: GameState, x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0 + dx;
    let y = y0 + dy;
    while (x !== x1 || y !== y1) {
      const t = state.grid[idx(x, y, state.width)];
      if (t === Tile.Boulder || t === Tile.Sandcastle) return false;
      x += dx;
      y += dy;
    }
    return true;
  }

  private wander(state: GameState, dm: DangerMap, cur: Tile2): Tile2[] {
    const options: Tile2[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!walkableForBot(state, nx, ny)) continue;
      if (tileImminentDanger(dm, nx, ny, 6)) continue;
      options.push({ x: nx, y: ny });
    }
    if (options.length === 0) return [];
    return [options[Math.floor(Math.random() * options.length)]];
  }
}
