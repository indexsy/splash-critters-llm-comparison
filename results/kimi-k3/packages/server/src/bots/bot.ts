import {
  BotDifficulty,
  CONFIG,
  DIR_VECTORS,
  Dir,
  GameState,
  InputFrame,
  TILE_FLOOR,
  balloonAt,
  tileIndex,
} from '@splash/shared';
import { DangerMap, computeDangerMap, tileSafeAt } from './dangerMap.js';

const THINK_TICKS: Record<BotDifficulty, number> = {
  easy: Math.max(1, Math.round((CONFIG.BOTS.EASY.thinkMs / 1000) * CONFIG.TICK_RATE)),
  medium: Math.max(1, Math.round((CONFIG.BOTS.MEDIUM.thinkMs / 1000) * CONFIG.TICK_RATE)),
  hard: Math.max(1, Math.round((CONFIG.BOTS.HARD.thinkMs / 1000) * CONFIG.TICK_RATE)),
};

const ERROR_RATE: Record<BotDifficulty, number> = {
  easy: CONFIG.BOTS.EASY.errorRate,
  medium: 0,
  hard: 0,
};

const ATTACK_RANGE: Record<BotDifficulty, number> = {
  easy: CONFIG.BOTS.EASY.attackRange,
  medium: CONFIG.BOTS.MEDIUM.attackRange,
  hard: CONFIG.BOTS.HARD.attackRange,
};

interface PathNode {
  tx: number;
  ty: number;
}

export class BotController {
  difficulty: BotDifficulty;
  slot: number;
  private path: PathNode[] = [];
  private wantBalloon = false;
  private lastThinkTick = -999;
  private seq = 0;
  private escapeMode = false;
  public debugFlee: 'ok' | 'none' | null = null;
  public debugNowDanger = false;
  private lastX = 0;
  private lastY = 0;
  private stuckTicks = 0;

  constructor(difficulty: BotDifficulty, slot: number) {
    this.difficulty = difficulty;
    this.slot = slot;
  }

  nextInput(state: GameState): InputFrame {
    const me = state.players[this.slot];
    if (!me || !me.alive || me.isDuck || state.phase !== 'playing') {
      this.path = [];
      return { seq: ++this.seq, dir: 0, balloon: false };
    }
    const moved = Math.abs(me.x - this.lastX) + Math.abs(me.y - this.lastY);
    if (moved < 0.02 && this.path.length > 0) {
      this.stuckTicks++;
      if (this.stuckTicks > 20) {
        this.path = [];
        this.lastThinkTick = -999;
        this.stuckTicks = 0;
      }
    } else {
      this.stuckTicks = 0;
    }
    this.lastX = me.x;
    this.lastY = me.y;
    if (state.tick - this.lastThinkTick >= THINK_TICKS[this.difficulty]) {
      this.lastThinkTick = state.tick;
      this.think(state);
    }
    const dir = this.stepDir(state);
    const balloon = this.wantBalloon;
    this.wantBalloon = false;
    return { seq: ++this.seq, dir, balloon };
  }

  private passable(state: GameState, tx: number, ty: number, ignoreOwnBalloons: Set<number>): boolean {
    const idx = tileIndex(state.w, tx, ty);
    if (state.tiles[idx] !== TILE_FLOOR) return false;
    for (const b of state.balloons) {
      if (b.flying) continue;
      if (b.tx === tx && b.ty === ty && !ignoreOwnBalloons.has(b.id)) return false;
    }
    return true;
  }

  private bfs(
    state: GameState,
    danger: DangerMap,
    startTx: number,
    startTy: number,
    opts: { stopMargin: number; passMargin: number; ignoreOwnBalloons?: Set<number>; maxDepth?: number; stepTicks: number },
  ): { arrival: Map<number, number>; prev: Map<number, number> } {
    const arrival = new Map<number, number>();
    const prev = new Map<number, number>();
    const ignore = opts.ignoreOwnBalloons ?? new Set<number>();
    const stepTicks = Math.max(1, opts.stepTicks);
    const q: { tx: number; ty: number; d: number }[] = [{ tx: startTx, ty: startTy, d: 0 }];
    arrival.set(tileIndex(state.w, startTx, startTy), state.tick);
    const maxDepth = opts.maxDepth ?? state.w * state.h;
    while (q.length > 0) {
      const cur = q.shift()!;
      if (cur.d >= maxDepth) continue;
      for (const dd of [1, 2, 3, 4] as const) {
        const v = DIR_VECTORS[dd];
        const nx = cur.tx + v.x;
        const ny = cur.ty + v.y;
        const nIdx = tileIndex(state.w, nx, ny);
        if (arrival.has(nIdx)) continue;
        if (!this.passable(state, nx, ny, ignore)) continue;
        const arriveTick = state.tick + (cur.d + 1) * stepTicks;
        if (!tileSafeAt(danger, nIdx, arriveTick, opts.passMargin)) continue;
        arrival.set(nIdx, arriveTick);
        prev.set(nIdx, tileIndex(state.w, cur.tx, cur.ty));
        q.push({ tx: nx, ty: ny, d: cur.d + 1 });
      }
    }
    return { arrival, prev };
  }

  private buildPath(state: GameState, prev: Map<number, number>, from: number, to: number): PathNode[] {
    const out: PathNode[] = [];
    let cur = to;
    let guard = 0;
    while (cur !== from && guard++ < 500) {
      out.unshift({ tx: cur % state.w, ty: Math.floor(cur / state.w) });
      const p = prev.get(cur);
      if (p === undefined) return [];
      cur = p;
    }
    return out;
  }

  private think(state: GameState): void {
    const me = state.players[this.slot]!;
    const danger = computeDangerMap(state);
    const ignoreDanger = Math.random() < ERROR_RATE[this.difficulty];
    if (ignoreDanger) {
      danger.burstAt.fill(Infinity);
      for (let y = 0; y < state.h; y++) {
        for (let x = 0; x < state.w; x++) {
          const idx = tileIndex(state.w, x, y);
          const t = state.tiles[idx]!;
          if (t !== 0) danger.burstAt[idx] = Infinity;
        }
      }
    }
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    const myIdx = tileIndex(state.w, tx, ty);
    const ownBalloons = new Set(me.overlappedBalloonIds);

    const reactTicks = THINK_TICKS[this.difficulty] + 3 * this.stepTicks(state);
    const nowDanger = !tileSafeAt(danger, myIdx, state.tick, 0) || !tileSafeAt(danger, myIdx, state.tick + reactTicks, 0);
    if (nowDanger) {
      const { arrival, prev } = this.bfs(state, danger, tx, ty, { stopMargin: 12, passMargin: 4, ignoreOwnBalloons: ownBalloons, stepTicks: this.stepTicks(state) });
      let best: number | null = null;
      let bestCost = Infinity;
      let fallback: number | null = null;
      let fallbackBurst = -Infinity;
      for (const [idx, arrive] of arrival) {
        const burstAt = danger.burstAt[idx]!;
        const safeToStand = burstAt === Infinity || arrive > burstAt + CONFIG.SPLASH_TICKS;
        if (safeToStand) {
          const cost = arrive - state.tick;
          if (cost < bestCost) {
            bestCost = cost;
            best = idx;
          }
        } else if (burstAt > fallbackBurst) {
          fallbackBurst = burstAt;
          fallback = idx;
        }
      }
      const target = best ?? fallback;
      if (target !== null && target !== myIdx) {
        this.path = this.buildPath(state, prev, myIdx, target);
        this.escapeMode = true;
        this.debugFlee = 'ok';
        return;
      }
      this.debugFlee = 'none';
    } else {
      this.debugFlee = null;
    }
    this.debugNowDanger = nowDanger;
    this.escapeMode = false;

    const { arrival, prev } = this.bfs(state, danger, tx, ty, { stopMargin: 20, passMargin: 4, ignoreOwnBalloons: ownBalloons, stepTicks: this.stepTicks(state) });

    for (const pu of state.exposedPowerUps) {
      const idx = tileIndex(state.w, pu.tx, pu.ty);
      const arrive = arrival.get(idx);
      if (arrive !== undefined && tileSafeAt(danger, idx, arrive, 25)) {
        this.path = this.buildPath(state, prev, myIdx, idx);
        return;
      }
    }

    const enemies = state.players.filter((p) => p.alive && !p.isDuck && p.slot !== this.slot);
    const attackRange = ATTACK_RANGE[this.difficulty];
    let nearestEnemy: { d: number; tx: number; ty: number } | null = null;
    for (const e of enemies) {
      const etx = Math.floor(e.x);
      const ety = Math.floor(e.y);
      const d = Math.abs(etx - tx) + Math.abs(ety - ty);
      if (!nearestEnemy || d < nearestEnemy.d) nearestEnemy = { d, tx: etx, ty: ety };
    }

    const shouldAttack =
      nearestEnemy !== null &&
      nearestEnemy.d <= attackRange &&
      (this.difficulty !== 'easy' || Math.random() < 0.3);

    if (shouldAttack && nearestEnemy) {
      const aligned =
        (nearestEnemy.tx === tx && this.lineClear(state, tx, ty, nearestEnemy.tx, nearestEnemy.ty, me.splashRange)) ||
        (nearestEnemy.ty === ty && this.lineClear(state, tx, ty, nearestEnemy.tx, nearestEnemy.ty, me.splashRange));
      if (aligned && me.activeBalloons < me.balloonCount && this.verifyEscape(state, danger, tx, ty, ownBalloons)) {
        this.wantBalloon = true;
        this.planEscape(state, danger, tx, ty, ownBalloons, true);
        return;
      }
      const eIdx = tileIndex(state.w, nearestEnemy.tx, nearestEnemy.ty);
      let bestAdjacent: number | null = null;
      let bestD = Infinity;
      for (const dd of [1, 2, 3, 4] as const) {
        const v = DIR_VECTORS[dd];
        const ax = nearestEnemy.tx + v.x;
        const ay = nearestEnemy.ty + v.y;
        const aIdx = tileIndex(state.w, ax, ay);
        const arrive = arrival.get(aIdx);
        if (arrive !== undefined && tileSafeAt(danger, aIdx, arrive, 30)) {
          const d = arrive - state.tick;
          if (d < bestD) {
            bestD = d;
            bestAdjacent = aIdx;
          }
        }
      }
      if (bestAdjacent !== null) {
        this.path = this.buildPath(state, prev, myIdx, bestAdjacent);
        return;
      }
      void eIdx;
    }

    if (this.difficulty === 'hard' && me.hasBoots) {
      for (const b of state.balloons) {
        if (b.flying || b.slideDir !== 0) continue;
        const d = Math.abs(b.tx - tx) + Math.abs(b.ty - ty);
        if (d === 1 && nearestEnemy) {
          const bIdx = tileIndex(state.w, b.tx, b.ty);
          const arrive = arrival.get(bIdx);
          if (arrive !== undefined && tileSafeAt(danger, bIdx, arrive, 20)) {
            this.path = this.buildPath(state, prev, myIdx, bIdx);
            return;
          }
        }
      }
    }

    if (this.adjacentCastle(state, tx, ty) && me.activeBalloons < me.balloonCount) {
      if (this.verifyEscape(state, danger, tx, ty, ownBalloons)) {
        this.wantBalloon = true;
        this.planEscape(state, danger, tx, ty, ownBalloons, true);
        return;
      }
    }

    let bestFarm: number | null = null;
    let bestFarmCost = Infinity;
    for (const [idx, arrive] of arrival) {
      const x = idx % state.w;
      const y = Math.floor(idx / state.w);
      if (!this.adjacentCastle(state, x, y)) continue;
      if (!tileSafeAt(danger, idx, arrive, CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS)) continue;
      const cost = arrive - state.tick;
      if (cost < bestFarmCost) {
        bestFarmCost = cost;
        bestFarm = idx;
      }
    }
    if (bestFarm !== null) {
      this.path = this.buildPath(state, prev, myIdx, bestFarm);
      return;
    }

    const safeTiles: number[] = [];
    for (const [idx, arrive] of arrival) {
      if (tileSafeAt(danger, idx, arrive, CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS)) safeTiles.push(idx);
    }
    if (safeTiles.length > 0) {
      const pick = safeTiles[Math.floor(Math.random() * safeTiles.length)]!;
      this.path = this.buildPath(state, prev, myIdx, pick);
      return;
    }
    this.path = [];
  }

  private lineClear(state: GameState, x0: number, y0: number, x1: number, y1: number, range: number): boolean {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    const dist = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (dist > range) return false;
    for (let i = 1; i <= dist; i++) {
      const t = state.tiles[tileIndex(state.w, x0 + dx * i, y0 + dy * i)]!;
      if (t !== TILE_FLOOR) return false;
    }
    return true;
  }

  private adjacentCastle(state: GameState, tx: number, ty: number): boolean {
    for (const dd of [1, 2, 3, 4] as const) {
      const v = DIR_VECTORS[dd];
      const t = state.tiles[tileIndex(state.w, tx + v.x, ty + v.y)];
      if (t === 2) return true;
    }
    return false;
  }

  private verifyEscape(state: GameState, danger: DangerMap, tx: number, ty: number, ownBalloons: Set<number>): boolean {
    const me = state.players[this.slot]!;
    const hypot = computeDangerMap(state);
    const burstTick = state.tick + CONFIG.FUSE_TICKS;
    const tiles = this.splashFrom(state, tx, ty, me.splashRange);
    const splashSet = new Set(tiles);
    for (const t of tiles) {
      hypot.burstAt[t] = Math.min(hypot.burstAt[t]!, burstTick);
    }
    const { arrival } = this.bfs(state, hypot, tx, ty, {
      stopMargin: 8,
      passMargin: 0,
      ignoreOwnBalloons: new Set([...ownBalloons, -1]),
      maxDepth: Math.floor((CONFIG.FUSE_TICKS - 10) / this.stepTicks(state)),
      stepTicks: this.stepTicks(state),
    });
    for (const [idx, arrive] of arrival) {
      if (idx === tileIndex(state.w, tx, ty)) continue;
      if (arrive >= burstTick) break;
      if (splashSet.has(idx)) continue;
      if (tileSafeAt(hypot, idx, arrive, 12)) return true;
    }
    return false;
  }

  private planEscape(state: GameState, danger: DangerMap, tx: number, ty: number, ownBalloons: Set<number>, withHypothetical: boolean): void {
    const me = state.players[this.slot]!;
    const hypot = computeDangerMap(state);
    const splashSet = new Set<number>();
    if (withHypothetical) {
      const tiles = this.splashFrom(state, tx, ty, me.splashRange);
      for (const t of tiles) {
        splashSet.add(t);
        hypot.burstAt[t] = Math.min(hypot.burstAt[t]!, state.tick + CONFIG.FUSE_TICKS);
      }
    }
    const myIdx = tileIndex(state.w, tx, ty);
    const { arrival, prev } = this.bfs(state, hypot, tx, ty, { stopMargin: 10, passMargin: 4, ignoreOwnBalloons: ownBalloons, stepTicks: this.stepTicks(state) });
    let best: number | null = null;
    let bestCost = Infinity;
    for (const [idx, arrive] of arrival) {
      if (idx === myIdx) continue;
      if (splashSet.has(idx)) continue;
      const burstAt = hypot.burstAt[idx]!;
      const safeToStand = burstAt === Infinity || arrive + 30 < burstAt || arrive > burstAt + CONFIG.SPLASH_TICKS;
      if (!safeToStand) continue;
      const cost = arrive - state.tick;
      if (cost < bestCost) {
        bestCost = cost;
        best = idx;
      }
    }
    if (best !== null) {
      this.path = this.buildPath(state, prev, myIdx, best);
    } else {
      this.path = [];
    }
    void danger;
  }

  private stepTicks(state: GameState): number {
    const me = state.players[this.slot];
    const speed = me ? me.speed : CONFIG.STATS.SPEED_BASE;
    return Math.max(1, Math.round(CONFIG.TICK_RATE / speed));
  }

  private splashFrom(state: GameState, tx: number, ty: number, range: number): number[] {
    const out = [tileIndex(state.w, tx, ty)];
    for (const dd of [1, 2, 3, 4] as const) {
      const v = DIR_VECTORS[dd];
      for (let i = 1; i <= range; i++) {
        const nx = tx + v.x * i;
        const ny = ty + v.y * i;
        const t = state.tiles[tileIndex(state.w, nx, ny)];
        if (t === 1 || t === undefined) break;
        out.push(tileIndex(state.w, nx, ny));
        if (t === 2) break;
      }
    }
    return out;
  }

  private stepDir(state: GameState): Dir {
    const me = state.players[this.slot]!;
    if (this.path.length === 0) {
      const cx = Math.floor(me.x) + 0.5;
      const cy = Math.floor(me.y) + 0.5;
      const ddx = cx - me.x;
      const ddy = cy - me.y;
      if (Math.abs(ddx) > 0.14 && Math.abs(ddx) > Math.abs(ddy)) return ddx > 0 ? 2 : 4;
      if (Math.abs(ddy) > 0.14) return ddy > 0 ? 3 : 1;
      return 0;
    }
    const next = this.path[0]!;
    const cx = next.tx + 0.5;
    const cy = next.ty + 0.5;
    const dx = cx - me.x;
    const dy = cy - me.y;
    if (Math.abs(dx) < 0.08 && Math.abs(dy) < 0.08) {
      this.path.shift();
      return 0;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 2 : 4;
    }
    if (Math.abs(dy) > 0.01) {
      return dy > 0 ? 3 : 1;
    }
    return dx > 0 ? 2 : 4;
  }
}

export function makeBot(difficulty: BotDifficulty, slot: number): BotController {
  return new BotController(difficulty, slot);
}
