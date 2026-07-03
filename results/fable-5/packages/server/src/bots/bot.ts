import {
  CONFIG,
  TILE,
  balloonAt,
  isFlooded,
  mulberry32,
  tileAt,
  type BotDifficulty,
  type Dir,
  type PlayerInput,
  type Rng,
  type SimPlayer,
  type SimState,
} from "../../../shared/src/index.js";
import { campable, computeDanger, transitable, type DangerMap } from "./dangerMap.js";

interface PathNode {
  x: number;
  y: number;
}

const DIRS: { dir: Dir; dx: number; dy: number }[] = [
  { dir: 1, dx: 0, dy: -1 },
  { dir: 2, dx: 1, dy: 0 },
  { dir: 3, dx: 0, dy: 1 },
  { dir: 4, dx: -1, dy: 0 },
];

/**
 * Server-side bot. Danger map recomputed every tick (flee reflex + never
 * stepping into a live splash); full decisions every `decisionMs`. Never
 * places a balloon without a verified escape route.
 */
export class BotController {
  private nextDecisionTick = 0;
  private path: PathNode[] = [];
  private dropNow = false;
  private rng: Rng;
  private cfg: (typeof CONFIG.BOTS)[BotDifficulty];
  private seq = 0;
  private lastPos = { x: -1, y: -1 };
  private stuckTicks = 0;
  /** Debug/telemetry: what the bot last chose to do. */
  lastPlan = "";

  constructor(
    public readonly slot: number,
    public readonly difficulty: BotDifficulty,
    seed = 1
  ) {
    this.cfg = CONFIG.BOTS[difficulty];
    this.rng = mulberry32(seed * 7919 + slot * 104729 + 17);
  }

  update(state: SimState): PlayerInput {
    const p = state.players[this.slot];
    this.seq++;
    if (!p) return this.input(0, false);
    if (!p.alive) return this.duckInput(state, p);

    const danger = computeDanger(state);
    const me = { x: Math.floor(p.x), y: Math.floor(p.y) };
    const gi = me.y * state.w + me.x;
    const tpt = Math.ceil(CONFIG.TICK_RATE / p.speed);

    // Reflex: current tile turning dangerous forces an immediate re-plan.
    const misjudge = this.cfg.errorRate > 0 && this.rng() < this.cfg.errorRate;
    const standingInDanger =
      danger.start[gi] <= state.tick + tpt * 6 && danger.end[gi] >= state.tick;
    if ((standingInDanger && !misjudge) || state.tick >= this.nextDecisionTick) {
      this.nextDecisionTick =
        state.tick + Math.max(2, Math.round((this.cfg.decisionMs / 1000) * CONFIG.TICK_RATE));
      this.decide(state, p, danger, tpt, standingInDanger);
    }

    const drop = this.dropNow;
    this.dropNow = false;
    let dir = this.followPath(state, p, danger, tpt);

    // Anti-freeze: wanting to move but not moving → wiggle + re-plan.
    if (dir !== 0 && Math.abs(p.x - this.lastPos.x) < 1e-4 && Math.abs(p.y - this.lastPos.y) < 1e-4) {
      this.stuckTicks++;
      if (this.stuckTicks > 10) {
        this.path = [];
        this.nextDecisionTick = state.tick;
        const open = DIRS.filter(
          ({ dx, dy }) =>
            tileAt(state, me.x + dx, me.y + dy) === TILE.EMPTY &&
            !balloonAt(state, me.x + dx, me.y + dy)
        );
        if (open.length > 0) dir = open[Math.floor(this.rng() * open.length)].dir;
        if (this.stuckTicks > 20) this.stuckTicks = 0;
      }
    } else {
      this.stuckTicks = 0;
    }
    this.lastPos = { x: p.x, y: p.y };
    return this.input(dir, drop);
  }

  private input(dir: Dir, balloon: boolean): PlayerInput {
    return { seq: this.seq, tick: 0, dir, balloon };
  }

  // ---------- planning ----------

  private decide(state: SimState, p: SimPlayer, danger: DangerMap, tpt: number, fleeing: boolean): void {
    const me = { x: Math.floor(p.x), y: Math.floor(p.y) };

    if (fleeing) {
      if (this.cfg.errorRate > 0 && this.rng() < this.cfg.errorRate) return; // easy bots dawdle
      const escape = this.bfs(state, danger, me, tpt, (x, y, arrival) =>
        campable(danger, y * state.w + x, arrival)
      );
      this.path = escape ?? [];
      this.lastPlan = escape ? `flee:${escape.length}` : "flee:NONE";
      if (!escape) {
        // Cornered with boots? Kick the balloon in our way to open a lane.
        if (state.rules.enableKick && p.hasKick) {
          for (const { dx, dy } of DIRS) {
            if (balloonAt(state, me.x + dx, me.y + dy)) {
              this.path = [{ x: me.x + dx, y: me.y + dy }];
              this.lastPlan = "flee:KICK";
              return;
            }
          }
        }
        // No safe route at all: freezing = certain soak, so take the open
        // neighbor whose danger starts latest and keep re-planning.
        let best: PathNode | null = null;
        let bestStart = danger.start[me.y * state.w + me.x];
        for (const { dx, dy } of DIRS) {
          const nx = me.x + dx;
          const ny = me.y + dy;
          if (tileAt(state, nx, ny) !== TILE.EMPTY) continue;
          if (balloonAt(state, nx, ny) || isFlooded(state, nx, ny)) continue;
          const s = danger.start[ny * state.w + nx];
          if (s > bestStart) {
            bestStart = s;
            best = { x: nx, y: ny };
          }
        }
        if (best) {
          this.path = [best];
          this.lastPlan = "flee:FALLBACK";
        }
      }
      return;
    }

    // 1) Attack when a drop from HERE genuinely threatens an enemy.
    const enemies = state.players.filter((o) => o.alive && o.slot !== this.slot);
    const nearest = enemies
      .map((e) => ({ e, d: Math.abs(Math.floor(e.x) - me.x) + Math.abs(Math.floor(e.y) - me.y) }))
      .sort((a, b) => a.d - b.d)[0];
    const threatens =
      nearest &&
      (nearest.d <= (this.difficulty === "hard" ? 3 : 2) ||
        (this.difficulty !== "easy" && this.inMySplashLine(state, p, me, nearest.e)) ||
        // Endgame: the tide is shrinking the arena — force the issue.
        (state.tideRing > 0 && nearest.d <= p.splashRange));
    const attackRoll = nearest && nearest.d <= this.cfg.attackRange && this.rng() < this.cfg.aggression;

    if (threatens && attackRoll && this.tryPlace(state, p, me, tpt)) {
      this.lastPlan = `attack:${this.path.length}`;
      return;
    }

    // 2) Grab exposed power-ups.
    const powerupPath = this.bfs(state, danger, me, tpt, (x, y, arrival) =>
      state.powerups.some((u) => u.x === x && u.y === y) &&
      transitable(danger, y * state.w + x, arrival, tpt)
    );
    if (powerupPath) {
      this.path = powerupPath;
      this.lastPlan = `powerup:${powerupPath.length}`;
      return;
    }

    // 3) Farm: drop next to a sandcastle.
    const adjacentCastles = DIRS.some(
      ({ dx, dy }) => tileAt(state, me.x + dx, me.y + dy) === TILE.CASTLE
    );
    if (adjacentCastles && this.tryPlace(state, p, me, tpt)) {
      this.lastPlan = `farmdrop:${this.path.length}`;
      return;
    }

    // 4) Hunt (difficulty-gated): path next to the (predicted) enemy.
    if (nearest && this.rng() < this.cfg.aggression) {
      const e = nearest.e;
      const lead = this.difficulty === "hard" ? 2 : 0;
      const [ldx, ldy] = e.moving ? [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]][e.dir] : [0, 0];
      const tx = Math.max(1, Math.min(state.w - 2, Math.floor(e.x) + ldx * lead));
      const ty = Math.max(1, Math.min(state.h - 2, Math.floor(e.y) + ldy * lead));
      const hunt = this.bfs(
        state,
        danger,
        me,
        tpt,
        (x, y, arrival) =>
          Math.abs(x - tx) + Math.abs(y - ty) <= 1 && campable(danger, y * state.w + x, arrival)
      );
      if (hunt) {
        this.path = hunt;
        this.lastPlan = `hunt:${hunt.length}`;
        return;
      }
    }

    // 5) Walk toward the nearest castle to farm next.
    const farmPath = this.bfs(state, danger, me, tpt, (x, y, arrival) =>
      DIRS.some(({ dx, dy }) => tileAt(state, x + dx, y + dy) === TILE.CASTLE) &&
      campable(danger, y * state.w + x, arrival)
    );
    if (farmPath) {
      this.path = farmPath;
      this.lastPlan = `farmwalk:${farmPath.length}`;
      return;
    }

    // 6) Wander somewhere safe.
    const wander = this.bfs(
      state,
      danger,
      me,
      tpt,
      (x, y, arrival) =>
        (x !== me.x || y !== me.y) && campable(danger, y * state.w + x, arrival) && this.rng() < 0.2
    );
    this.path = wander ?? [];
    this.lastPlan = wander ? `wander:${wander.length}` : "idle";
  }

  /** Would a balloon dropped on `me` splash the enemy down a clear lane? */
  private inMySplashLine(state: SimState, p: SimPlayer, me: PathNode, e: SimPlayer): boolean {
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (ex !== me.x && ey !== me.y) return false;
    const dist = Math.abs(ex - me.x) + Math.abs(ey - me.y);
    if (dist > p.splashRange || dist === 0) return false;
    const sx = Math.sign(ex - me.x);
    const sy = Math.sign(ey - me.y);
    for (let i = 1; i < dist; i++) {
      if (tileAt(state, me.x + sx * i, me.y + sy * i) !== TILE.EMPTY) return false;
    }
    return true;
  }

  /**
   * Place a balloon only if, WITH our splash added to the danger map, a
   * campable tile is still reachable. Sets the escape as the current path.
   */
  private tryPlace(state: SimState, p: SimPlayer, me: PathNode, tpt: number): boolean {
    if (p.balloonsActive >= p.balloonCount) return false;
    if (balloonAt(state, me.x, me.y)) return false;
    const hypo = computeDanger(state, {
      x: me.x,
      y: me.y,
      range: p.splashRange,
      burstTick: state.tick + CONFIG.FUSE_TICKS,
    });
    const escape = this.bfs(state, hypo, me, tpt, (x, y, arrival) =>
      campable(hypo, y * state.w + x, arrival)
    );
    if (!escape || escape.length === 0) return false;
    this.dropNow = true;
    this.path = escape;
    return true;
  }

  /** BFS over walkable tiles honoring danger windows. Path EXCLUDES the start tile. */
  private bfs(
    state: SimState,
    danger: DangerMap,
    from: PathNode,
    ticksPerTile: number,
    goal: (x: number, y: number, arrivalTick: number) => boolean
  ): PathNode[] | null {
    const n = state.w * state.h;
    const prev = new Array<number>(n).fill(-2); // -2 unvisited, -1 root
    const queue: { x: number; y: number; dist: number }[] = [{ x: from.x, y: from.y, dist: 0 }];
    prev[from.y * state.w + from.x] = -1;
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      const arrival = state.tick + cur.dist * ticksPerTile;
      if ((cur.x !== from.x || cur.y !== from.y) && goal(cur.x, cur.y, arrival)) {
        const path: PathNode[] = [];
        let gi = cur.y * state.w + cur.x;
        while (prev[gi] !== -1) {
          path.unshift({ x: gi % state.w, y: Math.floor(gi / state.w) });
          gi = prev[gi];
        }
        return path;
      }
      for (const { dx, dy } of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const gi = ny * state.w + nx;
        if (nx < 0 || ny < 0 || nx >= state.w || ny >= state.h || prev[gi] !== -2) continue;
        if (tileAt(state, nx, ny) !== TILE.EMPTY) continue;
        if (balloonAt(state, nx, ny)) continue;
        if (isFlooded(state, nx, ny)) continue;
        const arrivalNext = state.tick + (cur.dist + 1) * ticksPerTile;
        if (!transitable(danger, gi, arrivalNext, ticksPerTile)) continue;
        prev[gi] = cur.y * state.w + cur.x;
        queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
      }
    }
    return null;
  }

  /**
   * Steer toward the next waypoint — but NEVER step into a tile that is (or
   * is about to be) splashed; stale paths get re-planned instead.
   */
  private followPath(state: SimState, p: SimPlayer, danger: DangerMap, tpt: number): Dir {
    while (this.path.length > 0) {
      const wp = this.path[0];
      const cx = wp.x + 0.5;
      const cy = wp.y + 0.5;
      if (Math.abs(p.x - cx) < 0.12 && Math.abs(p.y - cy) < 0.12) {
        this.path.shift();
        continue;
      }
      const enteringNewTile = wp.x !== Math.floor(p.x) || wp.y !== Math.floor(p.y);
      if (enteringNewTile) {
        const gi = wp.y * state.w + wp.x;
        const unsafe = !transitable(danger, gi, state.tick, tpt) && danger.end[gi] >= state.tick;
        const kickIntent = state.rules.enableKick && p.hasKick && balloonAt(state, wp.x, wp.y);
        if (unsafe && !kickIntent) {
          this.nextDecisionTick = state.tick; // re-plan next tick
          this.lastPlan += "|GATESTOP";
          return 0;
        }
      }
      const ddx = cx - p.x;
      const ddy = cy - p.y;
      if (Math.abs(ddx) > Math.abs(ddy)) return ddx > 0 ? 2 : 4;
      return ddy > 0 ? 3 : 1;
    }
    return 0;
  }

  /** Revenge duck: cruise the border, lob at anyone near our lane. */
  private duckInput(state: SimState, p: SimPlayer): PlayerInput {
    if (!p.duck) return this.input(0, false);
    const canLob = state.tick >= p.duck.cooldownEndTick;
    let lob = false;
    if (canLob) {
      const me = { x: Math.floor(p.x), y: Math.floor(p.y) };
      lob = state.players.some(
        (o) =>
          o.alive &&
          o.slot !== this.slot &&
          (Math.abs(Math.floor(o.x) - me.x) <= 1 || Math.abs(Math.floor(o.y) - me.y) <= 1)
      );
    }
    const dir: Dir = this.rng() < 0.7 ? 2 : 0;
    return this.input(dir, lob);
  }
}
