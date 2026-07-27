/**
 * The netcode heart: one authoritative world plus the two tricks that hide the
 * round trip.
 *
 * The critter you control is PREDICTED. Every sampled input is applied locally
 * through the same `advancePlayer` the server runs, and kept in a ring buffer.
 * When a snapshot lands it overwrites the local critter with the server's truth
 * and replays every input the server has not acknowledged yet, so a correction
 * moves the sprite only by however much the client actually got wrong.
 *
 * Everybody else is INTERPOLATED, between the two most recent snapshots, by
 * interpolate.ts. This file decides what goes into that mix; that one does the
 * mixing.
 *
 * The tile grid is the client's own copy: round_start seeds it and the
 * castle_washed / tide_advance events edit it. Snapshots carry only the things
 * that move.
 */

import {
  CONFIG,
  Tile,
  advancePlayer,
  createPlayer,
  idx,
  overlapsTile,
  perimeterLength,
  spawnPoints,
  tryPlaceBalloon,
  type Balloon,
  type GameState,
  type MatchConfig,
  type PlayerInput,
  type PlayerSnap,
  type PlayerState,
  type RoundPhase,
  type RoundStartMsg,
  type SimEvent,
  type SnapshotMsg,
} from '@splash/shared';
import {
  blendAt,
  interpolateBalloons,
  interpolateLobs,
  interpolatePlayers,
  spawnPlayers,
} from './interpolate';
import type { HudPlayer } from './render/hud';
import type { RenderState } from './render/world';

/**
 * An optimistically placed balloon, held until the server rules on the input
 * that asked for it. Ghost ids start high so they can never collide with a
 * server entity id.
 */
interface Ghost {
  balloon: Balloon;
  /** Input sequence that asked for it. */
  seq: number;
}

const GHOST_ID_BASE = 1_000_000;

/** The client never runs the tide itself, so it carries no flood schedule. */
const NO_SCHEDULE = new Int32Array(0);

function applySnap(player: PlayerState, snap: PlayerSnap): void {
  player.x = snap.x;
  player.y = snap.y;
  player.facing = snap.facing;
  player.alive = snap.alive;
  player.moving = snap.moving;
  player.speed = snap.speed;
  player.balloonCount = snap.balloons;
  player.splashRange = snap.range;
  player.hasKick = snap.kick;
  player.activeBalloons = snap.active;
  player.emoteId = snap.emote;
  player.emoteTicks = snap.emoteTicks;
  player.ghost = snap.ghost;
  player.ghostPos = snap.ghostPos;
  player.soaks = snap.soaks;
  player.castlesWashed = snap.castles;
}

function blankState(config: MatchConfig, cells: Uint8Array, tick: number): GameState {
  const spawns = spawnPoints(config.mode);
  return {
    tick,
    width: config.width,
    height: config.height,
    cells,
    // Castle contents and the flood schedule are server secrets that arrive as
    // events, so the client keeps empties rather than pretending to know them.
    castleContents: new Uint8Array(cells.length),
    players: config.players.map((info) => {
      const spawn = spawns[info.slot % spawns.length];
      return createPlayer(info.slot, spawn.x, spawn.y);
    }),
    balloons: [],
    splashes: [],
    powerups: [],
    lobs: [],
    tideCursor: 0,
    tideOrder: NO_SCHEDULE,
    tideTicks: NO_SCHEDULE,
    phase: 'countdown',
    phaseEndTick: tick + CONFIG.COUNTDOWN_TICKS,
    winners: [],
    revengeDucks: config.revengeDucks,
    kickEnabled: config.kickEnabled,
    nextEntityId: GHOST_ID_BASE,
    events: [],
  };
}

export class PredictedWorld {
  private readonly config: MatchConfig;
  private readonly localSlot: number;
  private world: GameState;
  private previous: SnapshotMsg | null = null;
  private latest: SnapshotMsg | null = null;
  private pending: PlayerInput[] = [];
  private ghosts: Ghost[] = [];
  /** Slot to the tick it was first seen soaked, which clocks the soak animation. */
  private readonly soakedAt = new Map<number, number>();

  constructor(config: MatchConfig) {
    this.config = config;
    this.localSlot = config.yourSlot;
    this.world = blankState(config, new Uint8Array(config.width * config.height), 0);
  }

  /** Rebuild the grid and forget everything from the previous round. */
  beginRound(msg: RoundStartMsg): void {
    this.world = blankState(this.config, Uint8Array.from(msg.castleGrid), msg.startTick);
    this.world.phaseEndTick = msg.startTick + msg.countdownTicks;
    this.previous = null;
    this.latest = null;
    this.pending = [];
    this.ghosts = [];
    this.soakedAt.clear();
  }

  /** Authoritative state: reconcile the local critter, store the rest to blend. */
  applySnapshot(msg: SnapshotMsg): void {
    if (this.latest !== null && msg.tick < this.latest.tick) return;
    this.previous = this.latest;
    this.latest = msg;

    this.world.tick = msg.tick;
    this.world.phase = msg.phase;
    this.world.phaseEndTick = msg.phaseEndTick;
    this.world.tideCursor = msg.tideCursor;

    for (const snap of msg.players) {
      const player = this.world.players.find((p) => p.id === snap.id);
      if (player === undefined) continue;
      applySnap(player, snap);
      if (snap.alive) this.soakedAt.delete(snap.id);
      else if (!this.soakedAt.has(snap.id)) this.soakedAt.set(snap.id, msg.tick);
    }

    // Anything the server has already ruled on stops being a guess.
    this.ghosts = this.ghosts.filter((ghost) => ghost.seq > msg.ack);
    this.pending = this.pending.filter((input) => input.seq > msg.ack);
    this.rebuildBalloons(msg);

    const local = this.localPlayer();
    if (local === null) return;
    local.activeBalloons += this.ghosts.length;
    for (const input of this.pending) this.applyInput(local, input, false);
  }

  /** Grid edits the server has already made. Everything else is cosmetic. */
  applyEvent(tick: number, ev: SimEvent): void {
    switch (ev.kind) {
      case 'castle_washed':
        this.setCell(ev.x, ev.y, Tile.EMPTY);
        break;
      case 'tide_advance':
        for (const i of ev.tiles) {
          if (i >= 0 && i < this.world.cells.length) this.world.cells[i] = Tile.WATER;
        }
        break;
      case 'player_soaked':
        // Events arrive up to a snapshot earlier than the state they describe,
        // so they are the tighter clock for starting the soak animation.
        if (!this.soakedAt.has(ev.playerId)) this.soakedAt.set(ev.playerId, tick);
        break;
      default:
        break;
    }
  }

  /** Record one sampled input and simulate it locally. */
  pushInput(input: PlayerInput): void {
    this.pending.push(input);
    if (this.pending.length > CONFIG.INPUT_BUFFER_TICKS) this.pending.shift();
    const local = this.localPlayer();
    if (local !== null) this.applyInput(local, input, true);
  }

  /** Everything the renderer needs, blended for the given fractional tick. */
  view(renderTick: number): RenderState {
    const blend = blendAt(this.previous, this.latest, renderTick);
    const local = this.localPlayer();
    return {
      width: this.world.width,
      height: this.world.height,
      cells: this.world.cells,
      theme: this.config.theme,
      players:
        blend === null
          ? spawnPlayers(this.config.players, this.world.players)
          : interpolatePlayers({
              blend,
              roster: this.config.players,
              // Only a living local critter is predicted: a soaked one is frozen
              // where the server left it, and blending would drag its body about.
              predicted: local !== null && local.alive ? local : null,
              localSlot: this.localSlot,
              soakedAt: this.soakedAt,
              renderTick,
              perimeter: perimeterLength(this.world.width, this.world.height),
            }),
      balloons: interpolateBalloons(blend, this.ghosts.map((ghost) => ghost.balloon)),
      splashes: this.latest?.splashes ?? [],
      powerups: this.latest?.powerups ?? [],
      lobs: interpolateLobs(blend),
      tick: renderTick,
    };
  }

  hudPlayers(scores: number[], pings: number[]): HudPlayer[] {
    return this.config.players.map((info) => {
      const snap = this.latest?.players.find((p) => p.id === info.slot);
      return {
        slot: info.slot,
        nickname: info.nickname,
        animal: info.animal,
        hat: info.hat,
        alive: snap?.alive ?? true,
        balloons: snap?.balloons ?? CONFIG.BALLOONS_BASE,
        range: snap?.range ?? CONFIG.RANGE_BASE,
        speed: snap?.speed ?? CONFIG.SPEED_BASE,
        kick: snap?.kick ?? false,
        score: scores[info.slot] ?? 0,
        soaks: snap?.soaks ?? 0,
        ping: pings[info.slot] ?? 0,
      };
    });
  }

  get phase(): RoundPhase {
    return this.world.phase;
  }

  get phaseEndTick(): number {
    return this.world.phaseEndTick;
  }

  get aliveCount(): number {
    return this.latest?.players.filter((p) => p.alive).length ?? this.config.players.length;
  }

  /** True once the first tile has flooded, which the HUD shows as "TIDE!". */
  get tideStarted(): boolean {
    return this.world.tideCursor > 0;
  }

  /** Soaked, and riding a revenge duck rather than simply out. */
  get localGhost(): boolean {
    const local = this.localPlayer();
    return local !== null && !local.alive && local.ghost;
  }

  // ------------------------------------------------------------------ internals

  private localPlayer(): PlayerState | null {
    if (this.localSlot < 0) return null;
    return this.world.players.find((p) => p.id === this.localSlot) ?? null;
  }

  private setCell(tx: number, ty: number, value: number): void {
    if (tx < 0 || ty < 0 || tx >= this.world.width || ty >= this.world.height) return;
    this.world.cells[idx(this.world.width, tx, ty)] = value;
  }

  /**
   * `live` is false while replaying: the balloons those inputs asked for already
   * exist as ghosts, so asking for them again would double them up.
   */
  private applyInput(player: PlayerState, input: PlayerInput, live: boolean): void {
    if (this.world.phase !== 'playing' || !player.alive) return;
    if (live && input.balloonPressed) this.dropGhost(player, input.seq);
    this.refreshPassThrough(player);
    advancePlayer(this.world, player, input, { placeBalloons: false });
    // A predicted kick pushes an event nobody downstream consumes.
    this.world.events.length = 0;
  }

  /**
   * The server's own rule, applied to the one critter we simulate: a balloon you
   * were standing on turns solid the instant you are fully clear of its tile.
   */
  private refreshPassThrough(player: PlayerState): void {
    for (const balloon of this.world.balloons) {
      if (!balloon.passThrough.includes(player.id)) continue;
      if (overlapsTile(player, Math.floor(balloon.x), Math.floor(balloon.y))) continue;
      balloon.passThrough = balloon.passThrough.filter((id) => id !== player.id);
    }
  }

  private dropGhost(player: PlayerState, seq: number): void {
    const before = this.world.balloons.length;
    if (!tryPlaceBalloon(this.world, player)) return;
    this.ghosts.push({ balloon: this.world.balloons[before], seq });
    this.world.events.length = 0;
  }

  /**
   * The wire never carries pass-through lists. The server seeds one when a
   * balloon appears and drops a player the instant they step clear, and a player
   * can never re-enter a tile that has turned solid behind them, so "currently
   * overlapping" reproduces it exactly for the only critter we predict.
   */
  private rebuildBalloons(msg: SnapshotMsg): void {
    const local = this.localPlayer();
    const passable = (tx: number, ty: number): number[] =>
      local !== null && local.alive && overlapsTile(local, tx, ty) ? [local.id] : [];

    const balloons: Balloon[] = msg.balloons.map((snap) => ({
      id: snap.id,
      ownerId: snap.owner,
      x: snap.x,
      y: snap.y,
      burstTick: snap.burstTick,
      range: snap.range,
      slideDir: snap.slide,
      passThrough: passable(Math.floor(snap.x), Math.floor(snap.y)),
      counted: true,
    }));

    const taken = new Set(
      balloons.map((b) => idx(this.world.width, Math.floor(b.x), Math.floor(b.y))),
    );
    for (const ghost of this.ghosts) {
      const tx = Math.floor(ghost.balloon.x);
      const ty = Math.floor(ghost.balloon.y);
      if (taken.has(idx(this.world.width, tx, ty))) continue;
      ghost.balloon.passThrough = passable(tx, ty);
      balloons.push(ghost.balloon);
    }
    this.world.balloons = balloons;
  }
}
