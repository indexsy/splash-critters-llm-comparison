/**
 * GameState to wire shapes. Pure conversion, no game logic.
 *
 * Snapshots go out 15 times a second to every human in a match, so positions are
 * rounded to three decimals: a millimetre of arena precision nobody can see, for
 * roughly a third of the bytes.
 */

import {
  CONFIG,
  type BalloonSnap,
  type GameState,
  type LobSnap,
  type MapTheme,
  type PlayerSnap,
  type PowerupSnap,
  type RoundStartMsg,
  type SnapshotMsg,
  type SplashSnap,
} from '@splash/shared';

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function playerSnaps(state: GameState): PlayerSnap[] {
  // Soaked critters stay in the list: the client draws their splash-out
  // animation and, in casual, their revenge duck paddling the border.
  return state.players.map((p) => ({
    id: p.id,
    x: r3(p.x),
    y: r3(p.y),
    facing: p.facing,
    alive: p.alive,
    moving: p.moving,
    speed: r3(p.speed),
    balloons: p.balloonCount,
    range: p.splashRange,
    kick: p.hasKick,
    active: p.activeBalloons,
    emote: p.emoteTicks > 0 ? p.emoteId : -1,
    emoteTicks: p.emoteTicks,
    ghost: p.ghost,
    ghostPos: r3(p.ghostPos),
    soaks: p.soaks,
    castles: p.castlesWashed,
  }));
}

function balloonSnaps(state: GameState): BalloonSnap[] {
  return state.balloons.map((b) => ({
    id: b.id,
    owner: b.ownerId,
    x: r3(b.x),
    y: r3(b.y),
    burstTick: b.burstTick,
    range: b.range,
    slide: b.slideDir,
  }));
}

function splashSnaps(state: GameState): SplashSnap[] {
  return state.splashes.map((s) => ({
    id: s.id,
    owner: s.ownerId,
    x: s.x,
    y: s.y,
    arms: [...s.arms],
    capped: [...s.capped],
    endTick: s.endTick,
  }));
}

function powerupSnaps(state: GameState): PowerupSnap[] {
  return state.powerups.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y }));
}

function lobSnaps(state: GameState): LobSnap[] {
  return state.lobs.map((l) => ({
    id: l.id,
    owner: l.ownerId,
    x: r3(l.x),
    y: r3(l.y),
    dir: l.dir,
  }));
}

/**
 * The shared part of a snapshot. `ack` is per-recipient, so the caller stamps it
 * on a shallow copy for each player rather than rebuilding the whole packet.
 */
export function buildSnapshot(
  state: GameState,
  scores: number[],
  pings: number[],
): Omit<SnapshotMsg, 'ack'> {
  return {
    t: 'snapshot',
    tick: state.tick,
    phase: state.phase,
    phaseEndTick: state.phaseEndTick,
    players: playerSnaps(state),
    balloons: balloonSnaps(state),
    splashes: splashSnaps(state),
    powerups: powerupSnaps(state),
    lobs: lobSnaps(state),
    tideCursor: state.tideCursor,
    scores: [...scores],
    pings: [...pings],
  };
}

/**
 * Only `cells` ever crosses the wire. `castleContents` stays on the server until
 * a castle is actually washed away, otherwise a modified client could read every
 * power-up on the map at round start. The map seed stays behind for the same
 * reason: it regenerates those contents exactly.
 */
export function buildRoundStart(
  state: GameState,
  roundNo: number,
  theme: MapTheme,
  scores: number[],
): RoundStartMsg {
  return {
    t: 'round_start',
    roundNo,
    castleGrid: Array.from(state.cells),
    theme,
    startTick: state.tick,
    countdownTicks: CONFIG.COUNTDOWN_TICKS,
    scores: [...scores],
  };
}
