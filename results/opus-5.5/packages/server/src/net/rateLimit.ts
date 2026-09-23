// Token-bucket rate limiter, one per socket. Messages within the rate (plus a burst allowance)
// pass; over-limit messages are dropped ('limited'); a client that keeps flooding accumulates a
// slowly-decaying penalty and is reported as 'abuse' (the caller closes the socket with 1008).
import { CONFIG } from '@splash/shared';

export type RateVerdict = 'ok' | 'limited' | 'abuse';

export interface RateLimiterOptions {
  /** Sustained messages per second. */
  ratePerSec: number;
  /** Bucket size: how many messages may arrive back-to-back after a quiet period. */
  burst: number;
  /** Penalty points forgiven per second (one point per dropped message). */
  penaltyDecayPerSec: number;
  /** Penalty at which the client counts as abusive. */
  abuseThreshold: number;
}

const RATE = CONFIG.RATE_LIMIT_PER_SEC;

const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  ratePerSec: RATE,
  burst: RATE * 2,
  penaltyDecayPerSec: RATE / 6,
  abuseThreshold: RATE * 2,
};

export class RateLimiter {
  private tokens: number;
  private penalty = 0;
  private last: number;

  constructor(
    now: number,
    private readonly opts: RateLimiterOptions = DEFAULT_RATE_LIMIT,
  ) {
    this.tokens = opts.burst;
    this.last = now;
  }

  /** Accounts for one incoming message at time `now` (ms). */
  take(now: number): RateVerdict {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 'ok';
    }
    this.penalty += 1;
    return this.penalty >= this.opts.abuseThreshold ? 'abuse' : 'limited';
  }

  private refill(now: number): void {
    const elapsedSec = Math.max(0, now - this.last) / 1000;
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.opts.burst, this.tokens + elapsedSec * this.opts.ratePerSec);
    this.penalty = Math.max(0, this.penalty - elapsedSec * this.opts.penaltyDecayPerSec);
  }
}
