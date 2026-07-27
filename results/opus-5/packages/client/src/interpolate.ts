/**
 * Blending two snapshots into one frame.
 *
 * net.ts hands the renderer a tick that is deliberately in the past, so almost
 * every frame sits between two snapshots the client already holds. These
 * functions do that mixing and nothing else: no state, no side effects, and
 * never a value past the newest snapshot. Running out of data holds the last
 * known position, because a wrong guess about a critter you are about to bomb is
 * far worse than a frozen one.
 */

import { Dir, type Balloon, type MatchPlayerInfo, type PlayerState, type LobSnap, type SnapshotMsg } from '@splash/shared';
import type { RenderBalloon, RenderPlayer } from './render/world';

export interface Blend {
  from: SnapshotMsg;
  to: SnapshotMsg;
  /** 0 at `from`, 1 at `to`. Never outside that range. */
  t: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolation around a closed loop: always take the short way round. */
function lerpRing(a: number, b: number, t: number, total: number): number {
  let delta = b - a;
  if (delta > total / 2) delta -= total;
  else if (delta < -total / 2) delta += total;
  const value = a + delta * t;
  return ((value % total) + total) % total;
}

export function blendAt(
  previous: SnapshotMsg | null,
  latest: SnapshotMsg | null,
  renderTick: number,
): Blend | null {
  if (latest === null) return null;
  if (previous === null || previous.tick >= latest.tick) return { from: latest, to: latest, t: 1 };
  return {
    from: previous,
    to: latest,
    t: clamp01((renderTick - previous.tick) / (latest.tick - previous.tick)),
  };
}

export interface PlayerBlendArgs {
  blend: Blend;
  roster: MatchPlayerInfo[];
  /** The predicted local critter, or null when it is soaked or spectating. */
  predicted: PlayerState | null;
  localSlot: number;
  /** Slot to the tick it was first seen soaked. */
  soakedAt: Map<number, number>;
  renderTick: number;
  /** Border length in tiles, for wrapping the revenge duck's position. */
  perimeter: number;
}

export function interpolatePlayers(args: PlayerBlendArgs): RenderPlayer[] {
  const { blend, predicted, renderTick } = args;
  const single = blend.from === blend.to;
  const out: RenderPlayer[] = [];

  for (const info of args.roster) {
    const to = blend.to.players.find((p) => p.id === info.slot);
    if (to === undefined) continue;
    const from = single ? undefined : blend.from.players.find((p) => p.id === info.slot);
    const own = info.slot === args.localSlot ? predicted : null;
    const soakedAt = args.soakedAt.get(info.slot);

    out.push({
      slot: info.slot,
      x: own?.x ?? (from ? lerp(from.x, to.x, blend.t) : to.x),
      y: own?.y ?? (from ? lerp(from.y, to.y, blend.t) : to.y),
      facing: own?.facing ?? to.facing,
      alive: to.alive,
      moving: own?.moving ?? to.moving,
      animal: info.animal,
      hat: info.hat,
      nickname: info.nickname,
      ghost: to.ghost,
      ghostPos: from ? lerpRing(from.ghostPos, to.ghostPos, blend.t, args.perimeter) : to.ghostPos,
      soakAge: to.alive || soakedAt === undefined ? -1 : Math.max(0, renderTick - soakedAt),
      emote: to.emote,
      emoteTicks: to.emoteTicks,
    });
  }
  return out;
}

/**
 * The first frames of a round land before its first snapshot. Spawn corners are
 * deterministic, so the roster is drawn standing on them rather than the arena
 * flashing up empty.
 */
export function spawnPlayers(roster: MatchPlayerInfo[], states: PlayerState[]): RenderPlayer[] {
  return roster.map((info) => {
    const state = states.find((p) => p.id === info.slot);
    return {
      slot: info.slot,
      x: state?.x ?? 0.5,
      y: state?.y ?? 0.5,
      facing: state?.facing ?? Dir.DOWN,
      alive: true,
      moving: false,
      animal: info.animal,
      hat: info.hat,
      nickname: info.nickname,
      ghost: false,
      ghostPos: 0,
      soakAge: -1,
      emote: -1,
      emoteTicks: 0,
    };
  });
}

/**
 * Server balloons blended by id, then the optimistic local drops that no
 * snapshot has replaced yet.
 */
export function interpolateBalloons(blend: Blend | null, ghosts: Balloon[]): RenderBalloon[] {
  const out: RenderBalloon[] = [];

  if (blend !== null) {
    const single = blend.from === blend.to;
    const older = single ? null : new Map(blend.from.balloons.map((b) => [b.id, b]));
    for (const balloon of blend.to.balloons) {
      const from = older?.get(balloon.id);
      out.push({
        id: balloon.id,
        x: from ? lerp(from.x, balloon.x, blend.t) : balloon.x,
        y: from ? lerp(from.y, balloon.y, blend.t) : balloon.y,
        owner: balloon.owner,
        burstTick: balloon.burstTick,
      });
    }
  }

  for (const ghost of ghosts) {
    const tx = Math.floor(ghost.x);
    const ty = Math.floor(ghost.y);
    if (out.some((b) => Math.floor(b.x) === tx && Math.floor(b.y) === ty)) continue;
    out.push({
      id: ghost.id,
      x: ghost.x,
      y: ghost.y,
      owner: ghost.ownerId,
      burstTick: ghost.burstTick,
    });
  }
  return out;
}

export function interpolateLobs(blend: Blend | null): LobSnap[] {
  if (blend === null) return [];
  if (blend.from === blend.to) return blend.to.lobs;
  const older = new Map(blend.from.lobs.map((l) => [l.id, l]));
  return blend.to.lobs.map((lob) => {
    const from = older.get(lob.id);
    if (from === undefined) return lob;
    return { ...lob, x: lerp(from.x, lob.x, blend.t), y: lerp(from.y, lob.y, blend.t) };
  });
}
