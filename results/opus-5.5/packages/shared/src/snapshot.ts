// Snapshot DTOs: the server serializes the dynamic part of a round (players, balloons,
// splashes, exposed items, tide); the client overwrites its local RoundState with them so
// prediction (movePlayer) runs against the authoritative world. Tiles travel separately
// (round_start grid + castle_washed events) and `hidden` never leaves the server.
import { splashTiles } from './burst';
import { idx } from './grid';
import type { SnapshotMsg } from './protocol';
import { activeBalloonCount } from './state';
import { PowerUp, type ItemSnap, type PlayerSnap, type PlayerState, type PowerUpKind, type RoundState } from './types';

export type SnapshotBody = Omit<SnapshotMsg, 'type' | 'serverTime' | 'ack' | 'pings'>;

export function toPlayerSnap(s: RoundState, p: PlayerState): PlayerSnap {
  return {
    slot: p.slot,
    x: p.x,
    y: p.y,
    facing: p.facing,
    moving: p.moving,
    alive: p.alive,
    speedUps: p.speedUps,
    maxBalloons: p.maxBalloons,
    range: p.range,
    canKick: p.canKick,
    soakedTick: p.soakedTick,
    duckPos: p.duckPos,
    duckCooldownUntil: p.duckCooldownUntil,
    activeBalloons: activeBalloonCount(s, p.slot),
  };
}

/** Exposed power-ups, row-major. */
function itemList(s: RoundState): ItemSnap[] {
  const items: ItemSnap[] = [];
  for (let i = 0; i < s.items.length; i++) {
    if (s.items[i] !== PowerUp.None) items.push({ x: i % s.w, y: Math.floor(i / s.w), kind: s.items[i] as PowerUpKind });
  }
  return items;
}

/** Dynamic state of a round, minus the per-recipient envelope (type, serverTime, ack, pings). */
export function snapshotBody(s: RoundState): SnapshotBody {
  return {
    tick: s.tick,
    players: s.players.filter((p) => p.present).map((p) => toPlayerSnap(s, p)),
    balloons: s.balloons.map((b) => ({ ...b })),
    splashes: s.splashes.map((sp) => ({ ...sp, arms: [sp.arms[0], sp.arms[1], sp.arms[2], sp.arms[3]] })),
    items: itemList(s),
    tideLevel: s.tideLevel,
    nextTideTick: s.nextTideTick,
  };
}

function applyPlayerSnap(p: PlayerState, snap: PlayerSnap): void {
  p.x = snap.x;
  p.y = snap.y;
  p.facing = snap.facing;
  p.moving = snap.moving;
  p.alive = snap.alive;
  p.speedUps = snap.speedUps;
  p.maxBalloons = snap.maxBalloons;
  p.range = snap.range;
  p.canKick = snap.canKick;
  p.soakedTick = snap.soakedTick;
  p.duckPos = snap.duckPos;
  p.duckCooldownUntil = snap.duckCooldownUntil;
}

/**
 * Client side: overwrites the dynamic state of `s` with a snapshot (players by slot, balloons,
 * splashes, exposed items, tide) and rebuilds the per-tile splash layers from the live splash
 * list (in list order, so the latest splash owns overlapping tiles, as on the server).
 */
export function applySnapshotToState(s: RoundState, snap: SnapshotBody): void {
  s.tick = snap.tick;
  // Snapshots list exactly the present players; anyone missing has left the round (e.g. a
  // ranked FFA forfeit mid-round) and must stop counting as present or alive.
  const listed = new Set<number>();
  for (const ps of snap.players) {
    const p = s.players[ps.slot];
    if (!p) continue;
    listed.add(ps.slot);
    p.present = true;
    applyPlayerSnap(p, ps);
  }
  for (const p of s.players) {
    if (listed.has(p.slot)) continue;
    p.present = false;
    p.alive = false;
    p.moving = false;
    p.duckPos = -1;
  }
  s.balloons = snap.balloons.map((b) => ({ ...b }));
  s.splashes = snap.splashes.map((sp) => ({ ...sp, arms: [sp.arms[0], sp.arms[1], sp.arms[2], sp.arms[3]] }));
  s.items.fill(PowerUp.None);
  for (const it of snap.items) s.items[idx(s.w, it.x, it.y)] = it.kind;
  s.tideLevel = snap.tideLevel;
  s.nextTideTick = snap.nextTideTick;
  rebuildSplashLayers(s);
}

function rebuildSplashLayers(s: RoundState): void {
  s.splashUntil.fill(0);
  s.splashOwner.fill(-1);
  s.splashDuck.fill(0);
  for (const sp of s.splashes) {
    if (sp.endTick <= s.tick) continue;
    for (const t of splashTiles(sp.cx, sp.cy, sp.arms)) {
      const i = idx(s.w, t.x, t.y);
      s.splashUntil[i] = sp.endTick;
      s.splashOwner[i] = sp.owner;
      s.splashDuck[i] = sp.fromDuck ? 1 : 0;
    }
  }
}
