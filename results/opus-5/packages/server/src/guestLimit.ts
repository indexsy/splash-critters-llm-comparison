/**
 * How many brand new guest accounts one address may mint.
 *
 * `hello` with no token creates a permanent account row, and a socket needs
 * nothing else to send it. Without a brake, one process can mint thousands of
 * accounts a second: the database grows forever, and because the guest
 * namespace is finite (adjective x noun x 4-digit tag) it eventually runs out
 * of names altogether. The window is deliberately generous, because a whole
 * office or campus behind one NAT address shares it, while an attacker is
 * reduced from millions an hour to dozens.
 */

/** New guests one address may mint inside a window. */
export const GUEST_MINTS_PER_ADDRESS = 60;

/** The window itself. */
export const GUEST_MINT_WINDOW_MS = 60 * 60 * 1000;

/** Above this many tracked addresses, expired ones are swept before answering. */
const SWEEP_THRESHOLD = 4096;

/** Sliding-window counter, one bucket per address. */
export class GuestMintLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  /** Address -> mint timestamps still inside the window, oldest first. */
  private readonly hits = new Map<string, number[]>();

  constructor(limit = GUEST_MINTS_PER_ADDRESS, windowMs = GUEST_MINT_WINDOW_MS) {
    this.limit = Math.max(1, limit);
    this.windowMs = Math.max(1, windowMs);
  }

  /**
   * True when `address` may mint one more guest, and records it. False refuses
   * the mint and records nothing, so a refused caller cannot extend their own
   * penalty by hammering.
   */
  allow(address: string, nowMs: number = Date.now()): boolean {
    if (this.hits.size > SWEEP_THRESHOLD) this.sweep(nowMs);

    const fresh = this.recent(address, nowMs);
    if (fresh.length >= this.limit) {
      // Keep the pruned list: it is strictly smaller than what was there.
      this.hits.set(address, fresh);
      return false;
    }
    fresh.push(nowMs);
    this.hits.set(address, fresh);
    return true;
  }

  /** Mints already recorded for an address inside the current window. */
  countFor(address: string, nowMs: number = Date.now()): number {
    return this.recent(address, nowMs).length;
  }

  /** Addresses that have minted inside the window. Diagnostics and tests only. */
  addresses(): string[] {
    return [...this.hits.keys()];
  }

  private recent(address: string, nowMs: number): number[] {
    const cutoff = nowMs - this.windowMs;
    const existing = this.hits.get(address);
    if (existing === undefined) return [];
    return existing.filter((at) => at > cutoff);
  }

  private sweep(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    for (const [address, times] of this.hits) {
      const fresh = times.filter((at) => at > cutoff);
      if (fresh.length === 0) this.hits.delete(address);
      else this.hits.set(address, fresh);
    }
  }
}
