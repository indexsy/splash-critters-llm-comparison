// Ranked matchmaking: separate Duel and FFA queues of humans, evaluated every MM_TICK_MS. Each
// player's search range widens with waiting time (MM_BASE_RANGE + MM_WIDEN_STEP per
// MM_WIDEN_EVERY_MS, capped at MM_MAX_RANGE); a duel pairs two players whose rating gap fits BOTH
// ranges, an FFA group of 4 needs its rating spread to fit every member's range. Longest waiters
// are served first, each with the closest valid opponents. Operators can keep players queued
// from the same public client address apart (RANKED_SEPARATE_ADDRESSES=1): one person could
// otherwise queue a second account and forfeit it for free rating. It is off by default because
// players behind one address (two tabs on one machine, households, LAN cafes) legitimately meet;
// local and LAN clients have no address and are never kept apart.
import { CONFIG } from '@splash/shared';
import type { Mode } from '@splash/shared';
import type { MemberInfo } from './match/types';
import { ClientError } from './net/errors';
import type { Outbox } from './net/outbox';

export interface QueueEntry {
  member: MemberInfo;
  rating: number;
  joinedAt: number;
  /** Client address key (net/address.ts clientAddress); null for local / LAN clients. */
  address: string | null;
}

export interface MatchmakerDeps {
  outbox: Outbox;
  /** A group was formed (removed from the queue already): create the ranked room and start it. */
  onMatched: (mode: Mode, members: MemberInfo[], now: number) => void;
  /** Keep entries that share a public client address out of the same match. */
  separateAddresses?: boolean;
}

const FFA_GROUP_SIZE = 4;
/** Nearest-rated candidates considered per FFA anchor (bounds the combination search). */
const FFA_CANDIDATES = 12;
/** Weight of the newest sample in the average-wait estimate behind `eta`. */
const WAIT_EMA_ALPHA = 0.3;

/** Rating range a player accepts after waiting `waitMs`. */
export function searchRange(waitMs: number): number {
  const steps = Math.floor(Math.max(0, waitMs) / CONFIG.MM_WIDEN_EVERY_MS);
  return Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_BASE_RANGE + CONFIG.MM_WIDEN_STEP * steps);
}

function rangeOf(e: QueueEntry, now: number): number {
  return searchRange(now - e.joinedAt);
}

function byLongestWait(a: QueueEntry, b: QueueEntry): number {
  return a.joinedAt - b.joinedAt;
}

/** True when no two entries share a client address (entries without an address never clash). */
function distinctAddresses(group: readonly QueueEntry[]): boolean {
  const seen = new Set<string>();
  for (const e of group) {
    if (e.address === null) continue;
    if (seen.has(e.address)) return false;
    seen.add(e.address);
  }
  return true;
}

/**
 * Duel pairs: each unmatched player (longest waiter first) takes the closest valid opponent.
 * `separateAddresses` keeps two entries from one client address apart.
 */
export function pairDuel(
  entries: readonly QueueEntry[],
  now: number,
  separateAddresses = false,
): QueueEntry[][] {
  const open = [...entries].sort(byLongestWait);
  const pairs: QueueEntry[][] = [];
  while (open.length > 1) {
    const a = open.shift()!;
    let best = -1;
    for (let i = 0; i < open.length; i++) {
      const b = open[i];
      const gap = Math.abs(a.rating - b.rating);
      if (gap > Math.min(rangeOf(a, now), rangeOf(b, now))) continue;
      if (separateAddresses && !distinctAddresses([a, b])) continue;
      if (best < 0 || gap < Math.abs(a.rating - open[best].rating)) best = i;
    }
    if (best >= 0) pairs.push([a, ...open.splice(best, 1)]);
  }
  return pairs;
}

function spread(group: readonly QueueEntry[]): number {
  const ratings = group.map((e) => e.rating);
  return Math.max(...ratings) - Math.min(...ratings);
}

/** Tightest valid group of 4 around an anchor, or null. */
function bestGroupFor(anchor: QueueEntry, pool: readonly QueueEntry[], now: number, separateAddresses: boolean): QueueEntry[] | null {
  const near = pool
    .filter((e) => e !== anchor && Math.abs(e.rating - anchor.rating) <= rangeOf(anchor, now))
    .filter((e) => !separateAddresses || distinctAddresses([anchor, e]))
    .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating) || byLongestWait(a, b))
    .slice(0, FFA_CANDIDATES);
  let best: QueueEntry[] | null = null;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (let k = j + 1; k < near.length; k++) {
        const group = [anchor, near[i], near[j], near[k]];
        const s = spread(group);
        if (s > Math.min(...group.map((e) => rangeOf(e, now)))) continue;
        if (separateAddresses && !distinctAddresses(group)) continue;
        if (!best || s < spread(best)) best = group;
      }
    }
  }
  return best;
}

/**
 * FFA groups of 4 whose rating spread fits every member's range; longest waiters anchor first.
 * `separateAddresses` keeps entries from one client address out of the same group.
 */
export function groupFfa(
  entries: readonly QueueEntry[],
  now: number,
  separateAddresses = false,
): QueueEntry[][] {
  let open = [...entries].sort(byLongestWait);
  const groups: QueueEntry[][] = [];
  for (let i = 0; i < open.length && open.length >= FFA_GROUP_SIZE; ) {
    const group = bestGroupFor(open[i], open, now, separateAddresses);
    if (!group) {
      i++;
      continue;
    }
    groups.push(group.sort(byLongestWait));
    open = open.filter((e) => !group.includes(e));
  }
  return groups;
}

export class Matchmaker {
  private readonly queues: Record<Mode, QueueEntry[]> = { duel: [], ffa: [] };
  private readonly avgWaitMs: Record<Mode, number | null> = { duel: null, ffa: null };
  private nextRunAt = -Infinity;

  constructor(private readonly deps: MatchmakerDeps) {}

  size(mode: Mode): number {
    return this.queues[mode].length;
  }

  modeOf(playerId: string): Mode | null {
    for (const mode of ['duel', 'ffa'] as const) {
      if (this.queues[mode].some((e) => e.member.playerId === playerId)) return mode;
    }
    return null;
  }

  /**
   * Queues a player (same mode again is a no-op that re-sends the status). `address` is the
   * client address of their socket (null for local / LAN clients).
   */
  join(member: MemberInfo, rating: number, mode: Mode, now: number, address: string | null = null): void {
    const current = this.modeOf(member.playerId);
    if (current && current !== mode) throw new ClientError('already_queued', 'You are already searching in another queue.');
    if (!current) this.queues[mode].push({ member, rating, joinedAt: now, address });
    this.sendStatus(mode, this.queues[mode].find((e) => e.member.playerId === member.playerId)!, now);
  }

  /** Removes a player from whichever queue holds them; true if they were queued. */
  leave(playerId: string): boolean {
    for (const mode of ['duel', 'ffa'] as const) {
      const before = this.queues[mode].length;
      this.queues[mode] = this.queues[mode].filter((e) => e.member.playerId !== playerId);
      if (this.queues[mode].length !== before) return true;
    }
    return false;
  }

  /** Called every server tick; runs a pass every MM_TICK_MS on a fixed grid (no drift). */
  tick(now: number): void {
    if (now < this.nextRunAt) return;
    const behind = now - this.nextRunAt >= CONFIG.MM_TICK_MS;
    this.nextRunAt = behind ? now + CONFIG.MM_TICK_MS : this.nextRunAt + CONFIG.MM_TICK_MS;
    this.run(now);
  }

  /** One matchmaking pass: form groups, hand them off, then tell everyone still waiting. */
  run(now: number): void {
    for (const mode of ['duel', 'ffa'] as const) {
      const separate = this.deps.separateAddresses === true;
      const groups = mode === 'duel' ? pairDuel(this.queues[mode], now, separate) : groupFfa(this.queues[mode], now, separate);
      for (const group of groups) this.dispatch(mode, group, now);
      for (const entry of this.queues[mode]) this.sendStatus(mode, entry, now);
    }
  }

  private dispatch(mode: Mode, group: QueueEntry[], now: number): void {
    this.queues[mode] = this.queues[mode].filter((e) => !group.includes(e));
    for (const e of group) this.recordWait(mode, now - e.joinedAt);
    try {
      this.deps.onMatched(mode, group.map((e) => e.member), now);
    } catch (err) {
      console.error(`[matchmaker] could not start a ${mode} match`, err);
    }
  }

  private recordWait(mode: Mode, waitMs: number): void {
    const prev = this.avgWaitMs[mode];
    this.avgWaitMs[mode] = prev === null ? waitMs : prev + WAIT_EMA_ALPHA * (waitMs - prev);
  }

  /** Seconds until a match is likely, from recent waits in this mode; -1 when there is no estimate. */
  private eta(mode: Mode, elapsedMs: number): number {
    const avg = this.avgWaitMs[mode];
    if (avg === null || avg <= elapsedMs) return -1;
    return Math.ceil((avg - elapsedMs) / 1000);
  }

  private sendStatus(mode: Mode, entry: QueueEntry, now: number): void {
    const elapsedMs = Math.max(0, Math.round(now - entry.joinedAt));
    this.deps.outbox.send(entry.member.playerId, {
      type: 'queue_status',
      mode,
      elapsedMs,
      searchRange: rangeOf(entry, now),
      eta: this.eta(mode, elapsedMs),
      inQueue: this.queues[mode].length,
    });
  }
}
