import {
  CARDINALS,
  CONFIG,
  DIRECTIONS,
  Tile,
  cloneState,
  mulberry32,
  simulateTick,
  splashTiles,
  tileAt,
  type Difficulty,
  type Direction,
  type GameState,
  type PlayerInput,
} from "@splash/shared";
import { buildDangerMap, escapePath, safeAt } from "./dangerMap.js";

export class BotController {
  private rng: () => number;
  private target: number | null = null;
  private nextDecision = 0;
  private seq = 0;
  constructor(
    public readonly id: string,
    public readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.rng = mulberry32(seed);
  }
  nextInput(state: GameState): PlayerInput {
    const input: PlayerInput = {
      seq: ++this.seq,
      tick: state.tick,
      dir: "none",
      balloonPressed: false,
    };
    const p = state.players.find((p) => p.id === this.id);
    if (!p?.alive || state.roundOver) return input;
    const danger = buildDangerMap(state);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const index = y * state.width + x;
    const step = p.speed / CONFIG.TICK_RATE;
    const nearCenter =
      Math.abs(p.x - x - 0.5) <= step + 0.02 &&
      Math.abs(p.y - y - 0.5) <= step + 0.02;
    if (this.target !== null) {
      const tx = (this.target % state.width) + 0.5;
      const ty = Math.floor(this.target / state.width) + 0.5;
      const distance = Math.abs(p.x - tx) + Math.abs(p.y - ty);
      const entry = Math.max(0, Math.ceil((distance - 0.5) / step));
      const exit = Math.ceil(distance / step) + Math.ceil(0.5 / step) + 2;
      if (
        Math.abs(p.x - tx) <= step + 0.01 &&
        Math.abs(p.y - ty) <= step + 0.01
      )
        this.target = null;
      else if (
        safeAt(danger, this.target, entry, exit - entry) &&
        tileAt(state, Math.floor(tx), Math.floor(ty)) === Tile.Floor &&
        ((p.kick && this.difficulty === "hard") ||
          !state.balloons.some(
            (b) => b.x === Math.floor(tx) && b.y === Math.floor(ty),
          ))
      ) {
        input.dir =
          Math.abs(p.x - tx) > step + 0.01
            ? p.x < tx
              ? "right"
              : "left"
            : p.y < ty
              ? "down"
              : "up";
        return input;
      } else this.target = null;
    }
    if (!nearCenter) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      input.dir =
        Math.abs(p.x - cx) > step + 0.02
          ? p.x < cx
            ? "right"
            : "left"
          : p.y < cy
            ? "down"
            : "up";
      return input;
    }
    const threatened = !safeAt(
      danger,
      index,
      0,
      CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS,
    );
    if (threatened) {
      const path = escapePath(state, this.id, danger);
      if (path?.length) this.target = path[0];
      if (this.target === null && p.kick && this.difficulty === "hard") {
        for (const dir of CARDINALS) {
          const d = DIRECTIONS[dir];
          if (!state.balloons.some((b) => b.x === x + d.x && b.y === y + d.y))
            continue;
          const trial = cloneState(state);
          let kicked = false;
          for (let i = 0; i < 6 && !trial.roundOver; i++) {
            simulateTick(trial, { [this.id]: { ...input, dir } });
            if (trial.events.some((e) => e.type === "balloon_kicked"))
              kicked = true;
          }
          if (
            kicked &&
            trial.players.find((o) => o.id === p.id)?.alive &&
            escapePath(trial, p.id, buildDangerMap(trial))
          ) {
            this.target = (y + d.y) * state.width + x + d.x;
            break;
          }
        }
      }
      if (this.target === null) {
        // If already trapped, choose the neighbor with the longest remaining dry window.
        let longest = -Infinity;
        for (const dir of CARDINALS) {
          const d = DIRECTIONS[dir];
          const nx = x + d.x;
          const ny = y + d.y;
          const ni = ny * state.width + nx;
          if (
            tileAt(state, nx, ny) !== Tile.Floor ||
            state.balloons.some((b) => b.x === nx && b.y === ny)
          )
            continue;
          const time = Math.min(...danger[ni].map((w) => w.start));
          if (time > longest && safeAt(danger, ni, 0, 22)) {
            longest = time;
            this.target = ni;
          }
        }
      }
    } else if (state.tick >= this.nextDecision) {
      this.nextDecision =
        state.tick + CONFIG.BOT_INTERVAL_TICKS[this.difficulty];
      const footprint = splashTiles(state, x, y, p.splashRange);
      const castles = footprint.filter(
        (t) => tileAt(state, t.x, t.y) === Tile.Castle,
      ).length;
      const opponents = state.players.filter((o) => o.alive && o.id !== p.id);
      const attack =
        opponents.some((o) => {
          const movement = DIRECTIONS[o.dir];
          const px = Math.floor(
            o.x + (this.difficulty === "hard" ? movement.x * o.speed * 0.4 : 0),
          );
          const py = Math.floor(
            o.y + (this.difficulty === "hard" ? movement.y * o.speed * 0.4 : 0),
          );
          return (
            footprint.some(
              (t) =>
                (t.x === Math.floor(o.x) && t.y === Math.floor(o.y)) ||
                (t.x === px && t.y === py),
            ) ||
            (this.difficulty === "hard" &&
              state.balloons.some(
                (b) =>
                  footprint.some((t) => t.x === b.x && t.y === b.y) &&
                  splashTiles(state, b.x, b.y, b.range).some(
                    (t) => t.x === Math.floor(o.x) && t.y === Math.floor(o.y),
                  ),
              ))
          );
        }) &&
        this.rng() <
          (this.difficulty === "easy"
            ? 0.15
            : this.difficulty === "medium"
              ? 0.65
              : 1);
      if (
        (castles > 0 || attack) &&
        state.balloons.filter((b) => b.ownerId === p.id).length <
          p.balloonCount &&
        !state.balloons.some((b) => b.x === x && b.y === y)
      ) {
        const hypothetical = cloneState(state);
        hypothetical.balloons.push({
          id: -1,
          ownerId: p.id,
          x,
          y,
          placedTick: state.tick,
          burstTick: state.tick + CONFIG.FUSE_TICKS,
          range: p.splashRange,
          passThrough: [p.id],
          slideDir: "none",
          nextSlideTick: 0,
          revenge: false,
        });
        // Never make our only escape depend on a rival not placing a balloon.
        opponents.forEach((o, i) => {
          const ox = Math.floor(o.x);
          const oy = Math.floor(o.y);
          if (
            (ox !== x || oy !== y) &&
            !hypothetical.balloons.some((b) => b.x === ox && b.y === oy)
          )
            hypothetical.balloons.push({
              id: -2 - i,
              ownerId: o.id,
              x: ox,
              y: oy,
              placedTick: state.tick,
              burstTick: state.tick + CONFIG.FUSE_TICKS,
              range: o.splashRange,
              passThrough: [],
              slideDir: "none",
              nextSlideTick: 0,
              revenge: false,
            });
        });
        const path = escapePath(
          hypothetical,
          this.id,
          buildDangerMap(hypothetical),
        );
        if (
          path?.length &&
          this.rng() > (this.difficulty === "easy" ? 0.5 : 0)
        ) {
          input.balloonPressed = true;
          this.target = path[0];
        }
      }
      if (this.target === null) {
        const queue: { index: number; first: number; depth: number }[] = [
          { index, first: index, depth: 0 },
        ];
        const seen = new Set([index]);
        let best = -Infinity;
        const aggression =
          this.difficulty === "hard"
            ? state.tick > 900
              ? 2.8
              : 1.2
            : this.difficulty === "medium"
              ? 0.8
              : 0.1;
        for (let q = 0; q < queue.length; q++) {
          const node = queue[q];
          const nx = node.index % state.width;
          const ny = Math.floor(node.index / state.width);
          if (node.depth > 0) {
            const nearCastle = CARDINALS.some(
              (d) =>
                tileAt(state, nx + DIRECTIONS[d].x, ny + DIRECTIONS[d].y) ===
                Tile.Castle,
            );
            const pickup = state.powerups.some((u) => u.x === nx && u.y === ny);
            const proximity = Math.min(
              ...opponents.map(
                (o) => Math.abs(o.x - nx - 0.5) + Math.abs(o.y - ny - 0.5),
              ),
            );
            const score =
              (pickup ? 14 : 0) +
              (nearCastle ? 5 : 0) -
              node.depth * 0.65 -
              proximity * aggression +
              this.rng() * (this.difficulty === "easy" ? 8 : 0.4);
            if (score > best) {
              best = score;
              this.target = node.first;
            }
          }
          if (node.depth >= 12) continue;
          for (const dir of CARDINALS) {
            const d = DIRECTIONS[dir];
            const tx = nx + d.x;
            const ty = ny + d.y;
            const ni = ty * state.width + tx;
            if (
              seen.has(ni) ||
              tileAt(state, tx, ty) !== Tile.Floor ||
              state.balloons.some((b) => b.x === tx && b.y === ty) ||
              !safeAt(
                danger,
                ni,
                node.depth * 8,
                CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS,
              )
            )
              continue;
            seen.add(ni);
            queue.push({
              index: ni,
              first: node.depth === 0 ? ni : node.first,
              depth: node.depth + 1,
            });
          }
        }
      }
    }
    if (this.target !== null) {
      const tx = this.target % state.width;
      const ty = Math.floor(this.target / state.width);
      input.dir = (
        tx !== x ? (tx > x ? "right" : "left") : ty > y ? "down" : "up"
      ) as Direction;
    }
    return input;
  }
}
