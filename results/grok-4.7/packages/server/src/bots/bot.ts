import {
  CARDINALS,
  CONFIG,
  DIRS,
  TILE_CASTLE,
  TILE_EMPTY,
  balloonAt,
  canStand,
  cloneState,
  inBounds,
  isFlooded,
  splashCells,
  type BotDiff,
  type Dir,
  type SimPlayer,
  type SimState,
  type TickInput,
} from '@splash/shared';
import { computeDanger, perceive, type DangerMap } from './dangerMap.js';

export class Bot {
  nextDecide = 0;
  goal: { x: number; y: number; place: boolean } | null = null;
  rng: () => number;

  constructor(
    readonly id: string,
    readonly difficulty: BotDiff,
    rng?: () => number,
  ) {
    this.rng = rng ?? Math.random;
  }

  input(state: SimState, tick: number): TickInput {
    const me = state.players.find((p) => p.id === this.id);
    if (!me || !me.alive) return { id: this.id, dir: 'none', balloon: false };
    const real = computeDanger(state);
    if (this.inOwnSplash(state, me) || this.mustFlee(state, me, real)) {
      return { id: this.id, dir: this.escapeDir(state, me, real), balloon: false };
    }
    const seen = perceive(real, this.difficulty, this.rng);
    if (tick >= this.nextDecide) {
      this.plan(state, me, seen);
      this.nextDecide = tick + CONFIG.BOT_INTERVALS[this.difficulty];
    }
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    if (this.goal?.place && this.goal.x === tx && this.goal.y === ty && this.canPlace(state, me)) {
      this.goal = null;
      return { id: this.id, dir: 'none', balloon: true };
    }
    let dir = this.goal ? this.stepDir(state, me, this.goal) : this.wander(state, me, seen);
    if (dir !== 'none' && this.nextHazard(state, me, dir, real) >= 0) dir = 'none';
    return { id: this.id, dir, balloon: false };
  }

  private inOwnSplash(state: SimState, me: SimPlayer): boolean {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    for (const b of state.balloons) {
      if (b.ownerId !== me.id || b.revenge) continue;
      const origin = { x: b.tx, y: b.ty };
      if (splashCells(state, origin.x, origin.y, b.range, b.id).some((c) => c.x === tx && c.y === ty)) return true;
    }
    return false;
  }

  private mustFlee(state: SimState, me: SimPlayer, danger: DangerMap): boolean {
    const t = this.hazard(danger, Math.floor(me.x), Math.floor(me.y), state);
    if (t < 0) return false;
    const exit = this.ticksToSafety(state, me, danger);
    if (exit === null) return true;
    return t <= exit * 1.7 + 12;
  }

  private ticksToSafety(state: SimState, me: SimPlayer, danger: DangerMap): number | null {
    const kick = me.hasKick && state.enableKick && this.difficulty === 'hard';
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    const speed = me.speed / CONFIG.TICK_RATE;
    const q: { x: number; y: number; ticks: number }[] = [{ x: sx, y: sy, ticks: 0 }];
    const seen = new Set([`${sx},${sy}`]);
    while (q.length) {
      const cur = q.shift()!;
      const haz = this.hazard(danger, cur.x, cur.y, state);
      if (cur.ticks > 0 && (haz < 0 || cur.ticks + 6 < haz)) return cur.ticks;
      for (const dir of CARDINALS) {
        const nx = cur.x + DIRS[dir].x;
        const ny = cur.y + DIRS[dir].y;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !this.walkable(state, nx, ny, kick)) continue;
        const arrive = cur.ticks + 1 / speed;
        const nh = this.hazard(danger, nx, ny, state);
        if (nh >= 0 && arrive + 2 >= nh) continue;
        seen.add(key);
        q.push({ x: nx, y: ny, ticks: arrive });
      }
    }
    return null;
  }

  private escapeDir(state: SimState, me: SimPlayer, danger: DangerMap): Dir {
  const found = this.searchEscape(state, me, danger);
  return found?.dir ?? 'none';
}

  private searchEscape(state: SimState, me: SimPlayer, danger: DangerMap): { dir: Dir; ticks: number } | null {
    const step = me.speed / CONFIG.TICK_RATE;
    let x = me.x;
    let y = me.y;
    const ghost: SimPlayer = { ...me };
    let first: Dir | null = null;
    for (let i = 1; i <= 140; i++) {
      let pick: Dir | null = null;
      let nx = x;
      let ny = y;
      let bestScore = -1;
      for (const cand of CARDINALS) {
        const d = DIRS[cand];
        const tx = x + d.x * step;
        const ty = y + d.y * step;
        ghost.x = tx;
        ghost.y = ty;
        if (!canStand(state, ghost, tx, ty)) continue;
        const h = this.hazard(danger, Math.floor(tx), Math.floor(ty), state);
        const left = Math.floor(tx) !== Math.floor(x) || Math.floor(ty) !== Math.floor(y) ? 2 : 0;
        const score = (h < 0 ? 2000 : h) + left;
        if (score > bestScore) {
          bestScore = score;
          pick = cand;
          nx = tx;
          ny = ty;
        }
      }
      if (!pick) return first ? { dir: first, ticks: 999 } : null;
      if (!first) first = pick;
      x = nx;
      y = ny;
      ghost.x = x;
      ghost.y = y;
      const h = this.hazard(danger, Math.floor(x), Math.floor(y), state);
      if (h < 0 || i + 8 < h) return { dir: first, ticks: i };
    }
    return null;
  }

  private nearestSafeTile(state: SimState, me: SimPlayer, danger: DangerMap): { x: number; y: number } | null {
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    const kick = me.hasKick && state.enableKick && this.difficulty === 'hard';
    const q: { x: number; y: number; ticks: number }[] = [{ x: sx, y: sy, ticks: 0 }];
    const seen = new Set([`${sx},${sy}`]);
    const speed = me.speed / CONFIG.TICK_RATE;
    while (q.length) {
      const cur = q.shift()!;
      const haz = this.hazard(danger, cur.x, cur.y, state);
      if (cur.ticks > 0 && (haz < 0 || cur.ticks + 8 < haz)) return cur;
      for (const dir of CARDINALS) {
        const nx = cur.x + DIRS[dir].x;
        const ny = cur.y + DIRS[dir].y;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !this.walkable(state, nx, ny, kick)) continue;
        seen.add(key);
        q.push({ x: nx, y: ny, ticks: cur.ticks + 1 / speed });
      }
    }
    return null;
  }

  private align(state: SimState, me: SimPlayer, dir: Dir): Dir {
    if (dir === 'none') return dir;
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    let want: Dir = dir;
    if ((dir === 'left' || dir === 'right') && Math.abs(me.y - (ty + 0.5)) > 0.08) want = me.y < ty + 0.5 ? 'down' : 'up';
    else if ((dir === 'up' || dir === 'down') && Math.abs(me.x - (tx + 0.5)) > 0.08) want = me.x < tx + 0.5 ? 'right' : 'left';
    if (want === dir) return dir;
    const d = DIRS[want];
    const nx = Math.floor(me.x + d.x * 0.25);
    const ny = Math.floor(me.y + d.y * 0.25);
    if ((nx !== tx || ny !== ty) && !this.walkable(state, nx, ny, false)) return dir;
    return want;
  }

  private nextHazard(state: SimState, me: SimPlayer, dir: Dir, danger: DangerMap): number {
    const d = DIRS[dir];
    return this.hazard(danger, Math.floor(me.x + d.x * 0.55), Math.floor(me.y + d.y * 0.55), state);
  }

  private hazard(danger: DangerMap, x: number, y: number, state: SimState): number {
    if (!inBounds(state, x, y)) return 0;
    return danger.time[y * state.width + x] ?? -1;
  }

  private walkable(state: SimState, x: number, y: number, kick: boolean): boolean {
    if (!inBounds(state, x, y)) return false;
    const tile = state.tiles[y * state.width + x]!;
    if (tile !== TILE_EMPTY) return false;
    if (isFlooded(state, x, y)) return false;
    if (balloonAt(state, x, y) && !kick) return false;
    return true;
  }

  private flee(state: SimState, me: SimPlayer, danger: DangerMap): Dir | null {
    const kick = me.hasKick && state.enableKick && this.difficulty === 'hard';
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    const speed = me.speed / CONFIG.TICK_RATE;
    const q: { x: number; y: number; ticks: number; first: Dir | null }[] = [
      { x: sx, y: sy, ticks: 0, first: null },
    ];
    const seen = new Set([`${sx},${sy}`]);
    let best: { dir: Dir; time: number } | null = null;
    while (q.length) {
      const cur = q.shift()!;
      const haz = this.hazard(danger, cur.x, cur.y, state);
      if (cur.first && cur.ticks > 0 && (haz < 0 || cur.ticks + 4 < haz)) return cur.first;
      if (cur.first && haz > (best?.time ?? -1)) best = { dir: cur.first, time: haz };
      for (const dir of CARDINALS) {
        const nx = cur.x + DIRS[dir].x;
        const ny = cur.y + DIRS[dir].y;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !this.walkable(state, nx, ny, kick)) continue;
        const arrive = cur.ticks + 1 / speed;
        const nh = this.hazard(danger, nx, ny, state);
        if (nh >= 0 && arrive + 1 >= nh) continue;
        seen.add(key);
        q.push({ x: nx, y: ny, ticks: arrive, first: cur.first ?? dir });
      }
    }
    return best?.dir ?? null;
  }

  private canPlace(state: SimState, me: SimPlayer): boolean {
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    if (balloonAt(state, tx, ty)) return false;
    const owned = state.balloons.filter((b) => b.ownerId === me.id && !b.revenge).length;
    if (owned >= me.balloonMax) return false;
    const tile = state.tiles[ty * state.width + tx];
    if (tile !== TILE_EMPTY) return false;
    const clone = cloneState(state);
    clone.balloons.push({
      id: 900000 + tx + ty * 100,
      ownerId: me.id,
      tx,
      ty,
      fuse: CONFIG.FUSE_TICKS,
      range: me.splashRange,
      slideDir: null,
      slideProg: 0,
      slideTiles: 0,
      maxSlide: 0,
      revenge: false,
      bornTick: clone.tick,
    });
    const danger = computeDanger(clone);
    const exit = this.searchEscape(clone, me, danger);
    const t = this.hazard(danger, tx, ty, clone);
    return exit !== null && t > exit.ticks + 12;
  }

  private plan(state: SimState, me: SimPlayer, danger: DangerMap): void {
    const opponents = state.players.filter((p) => p.alive && p.id !== me.id);
    if (this.difficulty === 'hard' && opponents.length) {
      const prey = opponents.reduce((a, b) =>
        Math.abs(a.x - me.x) + Math.abs(a.y - me.y) < Math.abs(b.x - me.x) + Math.abs(b.y - me.y) ? a : b,
      );
      const px = Math.floor(me.x);
      const py = Math.floor(me.y);
      const ox = Math.floor(prey.x);
      const oy = Math.floor(prey.y);
      const cells = splashCells(state, px, py, me.splashRange);
      const hits = cells.some((c) => Math.abs(c.x - ox) + Math.abs(c.y - oy) <= 1);
      if (hits && this.canPlace(state, me)) {
        this.goal = { x: px, y: py, place: true };
        return;
      }
      this.goal = { x: ox, y: oy, place: false };
      return;
    }
    const farm = this.wantsFarm(state, me, opponents);
    const attack = this.wantsAttack(me, opponents);
    if (attack) {
      const spot = this.bestSpot(state, me, opponents, farm);
      if (spot) {
        this.goal = { x: spot.x, y: spot.y, place: true };
        return;
      }
    }
    const pu = this.nearestPower(state, me);
    if (pu && this.difficulty !== 'easy') {
      this.goal = { x: pu.x, y: pu.y, place: false };
      return;
    }
    if (farm) {
      const castle = this.nearestCastle(state, me);
      if (castle) {
        const adj = this.adjacentEmpty(state, castle.x, castle.y, me);
        if (adj) {
          this.goal = { x: adj.x, y: adj.y, place: true };
          return;
        }
      }
    }
    if (this.difficulty === 'easy' && this.rng() < 0.5) {
      this.goal = this.randomSafe(state, me, danger);
      return;
    }
    if (opponents[0] && this.difficulty === 'hard') {
      this.goal = { x: Math.floor(opponents[0].x), y: Math.floor(opponents[0].y), place: false };
      return;
    }
    this.goal = this.randomSafe(state, me, danger);
  }

  private wantsFarm(state: SimState, me: SimPlayer, opponents: SimPlayer[]): boolean {
    const castles = state.tiles.some((t) => t === TILE_CASTLE);
    if (!castles) return false;
    if (this.difficulty === 'hard' && me.balloonMax >= 3) return opponents.length === 0;
    if (this.difficulty === 'hard' && state.tick > 800) return false;
    return true;
  }

  private wantsAttack(me: SimPlayer, opponents: SimPlayer[]): boolean {
    if (opponents.length === 0) return false;
    if (this.difficulty === 'easy') return this.rng() < 0.08;
    if (this.difficulty === 'medium') {
      return opponents.some((o) => Math.abs(o.x - me.x) + Math.abs(o.y - me.y) < CONFIG.BOT_ATTACK_RANGE.medium + 0.5);
    }
    return true;
  }

  private bestSpot(
    state: SimState,
    me: SimPlayer,
    opponents: SimPlayer[],
    farm: boolean,
  ): { x: number; y: number; score: number } | null {
    const px = Math.floor(me.x);
    const py = Math.floor(me.y);
    let best: { x: number; y: number; score: number } | null = null;
    const reach = this.difficulty === 'hard' ? 8 : 5;
    for (let y = 1; y < state.height - 1; y++) {
      for (let x = 1; x < state.width - 1; x++) {
        const dist = Math.abs(x - px) + Math.abs(y - py);
        if (dist > reach) continue;
        if (state.tiles[y * state.width + x] !== TILE_EMPTY) continue;
        if (balloonAt(state, x, y)) continue;
        let score = 0;
        const cells = splashCells(state, x, y, me.splashRange);
        for (const o of opponents) {
          const ox = Math.floor(o.x);
          const oy = Math.floor(o.y);
          if (cells.some((c) => c.x === ox && c.y === oy)) score += 60;
          let cuts = 0;
          for (const dir of CARDINALS) {
            const nx = ox + DIRS[dir].x;
            const ny = oy + DIRS[dir].y;
            if (!this.walkable(state, nx, ny, false) || cells.some((c) => c.x === nx && c.y === ny)) cuts += 1;
          }
          if (cuts >= 3) score += 25;
          for (const c of cells) {
            const b = balloonAt(state, c.x, c.y);
            if (!b) continue;
            const more = splashCells(state, b.tx, b.ty, b.range, b.id);
            if (more.some((c2) => c2.x === ox && c2.y === oy)) score += 45;
          }
        }
        if (farm) {
          for (const c of cells) {
            if (state.tiles[c.y * state.width + c.x] === TILE_CASTLE) score += 6;
          }
        }
        score -= dist * 0.8;
        if (score > 4 && (!best || score > best.score)) best = { x, y, score };
      }
    }
    return best;
  }

  private nearestCastle(state: SimState, me: SimPlayer): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.tiles[y * state.width + x] !== TILE_CASTLE) continue;
        const d = Math.abs(x + 0.5 - me.x) + Math.abs(y + 0.5 - me.y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best;
  }

  private adjacentEmpty(state: SimState, x: number, y: number, me: SimPlayer): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (const dir of CARDINALS) {
      const nx = x + DIRS[dir].x;
      const ny = y + DIRS[dir].y;
      if (!this.walkable(state, nx, ny, false)) continue;
      const d = Math.abs(nx + 0.5 - me.x) + Math.abs(ny + 0.5 - me.y);
      if (!best || d < best.d) best = { x: nx, y: ny, d };
    }
    return best;
  }

  private nearestPower(state: SimState, me: SimPlayer): { x: number; y: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    for (const p of state.powerups) {
      if (p.hidden) continue;
      const d = Math.abs(p.x + 0.5 - me.x) + Math.abs(p.y + 0.5 - me.y);
      if (!best || d < best.d) best = { x: p.x, y: p.y, d };
    }
    return best;
  }

  private randomSafe(state: SimState, me: SimPlayer, danger: DangerMap): { x: number; y: number; place: boolean } | null {
    const opts: { x: number; y: number }[] = [];
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    for (const dir of CARDINALS) {
      const x = sx + DIRS[dir].x;
      const y = sy + DIRS[dir].y;
      if (!this.walkable(state, x, y, false)) continue;
      const t = this.hazard(danger, x, y, state);
      if (t >= 0 && t < 30) continue;
      opts.push({ x, y });
    }
    if (!opts.length) return null;
    const pick = opts[Math.floor(this.rng() * opts.length)]!;
    return { ...pick, place: false };
  }

  private stepDir(state: SimState, me: SimPlayer, goal: { x: number; y: number }): Dir {
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    if (sx === goal.x && sy === goal.y) return 'none';
    const kick = me.hasKick && state.enableKick && this.difficulty === 'hard';
    const q: { x: number; y: number; first: Dir | null }[] = [{ x: sx, y: sy, first: null }];
    const seen = new Set([`${sx},${sy}`]);
    let first: Dir | null = null;
    while (q.length) {
      const cur = q.shift()!;
      if (cur.x === goal.x && cur.y === goal.y && cur.first) {
        first = cur.first;
        break;
      }
      for (const dir of CARDINALS) {
        const nx = cur.x + DIRS[dir].x;
        const ny = cur.y + DIRS[dir].y;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        const goalTile = nx === goal.x && ny === goal.y;
        if (!goalTile && !this.walkable(state, nx, ny, kick)) continue;
        if (goalTile && state.tiles[ny * state.width + nx] !== TILE_EMPTY && !this.walkable(state, nx, ny, kick)) {
          continue;
        }
        seen.add(key);
        q.push({ x: nx, y: ny, first: cur.first ?? dir });
      }
    }
    if (!first) {
      if (goal.x < sx) return 'left';
      if (goal.x > sx) return 'right';
      if (goal.y < sy) return 'up';
      if (goal.y > sy) return 'down';
      return 'none';
    }
    if (first === 'left' || first === 'right') {
      if (Math.abs(me.y - (sy + 0.5)) > 0.12) return me.y < sy + 0.5 ? 'down' : 'up';
    } else if (Math.abs(me.x - (sx + 0.5)) > 0.12) {
      return me.x < sx + 0.5 ? 'right' : 'left';
    }
    return first;
  }

  private wander(state: SimState, me: SimPlayer, danger: DangerMap): Dir {
    const spot = this.randomSafe(state, me, danger);
    if (!spot) return 'none';
    return this.stepDir(state, me, spot);
  }

  private dirSafe(state: SimState, me: SimPlayer, dir: Dir, danger: DangerMap): boolean {
    const d = DIRS[dir];
    const nx = Math.floor(me.x + d.x * 0.51);
    const ny = Math.floor(me.y + d.y * 0.51);
    const t = this.hazard(danger, nx, ny, state);
    if (t < 0) return true;
    if (this.difficulty === 'easy' && t > 22 && this.rng() < CONFIG.BOT_ERROR.easy) return true;
    const travel = 0.5 / (me.speed / CONFIG.TICK_RATE);
    return t > travel + 8;
  }

  private anyMove(state: SimState, me: SimPlayer): Dir {
    const sx = Math.floor(me.x);
    const sy = Math.floor(me.y);
    for (const dir of CARDINALS) {
      const nx = sx + DIRS[dir].x;
      const ny = sy + DIRS[dir].y;
      if (this.walkable(state, nx, ny, me.hasKick)) return dir;
    }
    return 'none';
  }
}
