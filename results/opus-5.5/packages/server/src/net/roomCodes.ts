// Wrong-room-code budget. A private room is protected only by its code, so naming a code with no
// joinable room behind it must not be free: every miss spends one token from the player's budget
// and one from their client address's budget (the guest accounts one address can create share
// it). While either budget is spent, joins by code are refused before the code is looked up, so
// a guesser learns nothing more (not even "in a match"); a player who keeps trying while refused
// has their socket closed. Legitimate players mistype a code now and then, far below the budget.

export interface RoomCodeLimits {
  /** Wrong codes a player or an address may name back to back. */
  missBurst: number;
  /** Wrong codes earned back per minute: the sustained guessing rate. */
  missesPerMinute: number;
  /** Joins refused in a row (budget spent) at which the player's socket is closed (1008). */
  refusalsBeforeClose: number;
}

export const DEFAULT_ROOM_CODE_LIMITS: RoomCodeLimits = {
  missBurst: 10,
  missesPerMinute: 10,
  refusalsBeforeClose: 10,
};

/** 'ok': look the code up; 'limited': refuse; 'abuse': refuse and close the socket. */
export type RoomCodeVerdict = 'ok' | 'limited' | 'abuse';

const MINUTE_MS = 60_000;
/** A refusal this long after the previous one starts a new run of refusals. */
const REFUSAL_RUN_MS = MINUTE_MS;
/** How often refilled budgets and stale refusal runs are forgotten. */
const PRUNE_EVERY_MS = MINUTE_MS;

interface Bucket {
  tokens: number;
  at: number;
}

interface RefusalRun {
  count: number;
  at: number;
}

/** Budget keys of one request: the player always, the address when it can be told apart. */
function budgetKeys(playerId: string, address: string | null): string[] {
  return address === null ? [`player:${playerId}`] : [`player:${playerId}`, `address:${address}`];
}

export class RoomCodeGuard {
  private readonly budgets = new Map<string, Bucket>();
  private readonly refusals = new Map<string, RefusalRun>();
  private lastPrune = -Infinity;

  constructor(private readonly limits: RoomCodeLimits = DEFAULT_ROOM_CODE_LIMITS) {}

  /** Before a join by code: may this player look a code up now? */
  admit(playerId: string, address: string | null, now: number): RoomCodeVerdict {
    this.pruneIfDue(now);
    if (budgetKeys(playerId, address).every((key) => this.refilled(key, now).tokens >= 1)) {
      this.refusals.delete(playerId);
      return 'ok';
    }
    const run = this.refusals.get(playerId);
    const count = run && now - run.at <= REFUSAL_RUN_MS ? run.count + 1 : 1;
    this.refusals.set(playerId, { count, at: now });
    return count >= this.limits.refusalsBeforeClose ? 'abuse' : 'limited';
  }

  /** The code named no joinable room: one miss off the player's and the address's budget. */
  miss(playerId: string, address: string | null, now: number): void {
    for (const key of budgetKeys(playerId, address)) {
      this.budgets.set(key, { tokens: Math.max(0, this.refilled(key, now).tokens - 1), at: now });
    }
  }

  private refilled(key: string, now: number): Bucket {
    const bucket = this.budgets.get(key);
    if (!bucket) return { tokens: this.limits.missBurst, at: now };
    const earned = (Math.max(0, now - bucket.at) / MINUTE_MS) * this.limits.missesPerMinute;
    return { tokens: Math.min(this.limits.missBurst, bucket.tokens + earned), at: now };
  }

  /** Full budgets and finished refusal runs carry no information: drop them. */
  private pruneIfDue(now: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    for (const key of this.budgets.keys()) {
      if (this.refilled(key, now).tokens >= this.limits.missBurst) this.budgets.delete(key);
    }
    for (const [playerId, run] of this.refusals) {
      if (now - run.at > REFUSAL_RUN_MS) this.refusals.delete(playerId);
    }
  }
}
