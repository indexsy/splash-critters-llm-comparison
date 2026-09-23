// Per-address admission: caps concurrent sockets and the rate of new guest accounts per client
// address, so one script can neither hold thousands of sockets nor grow the players table
// without bound. Addresses come from clientAddress(); null (a client that cannot be told apart
// from others: local development, LAN) is never limited.

export interface AdmissionLimits {
  /** Open WebSockets per address (a household or a LAN party behind one NAT fits easily). */
  maxSocketsPerAddress: number;
  /** New guest accounts an address may create back to back. */
  guestBurst: number;
  /** Sustained new guest accounts per address and hour. */
  guestsPerHour: number;
}

export const DEFAULT_ADMISSION_LIMITS: AdmissionLimits = {
  maxSocketsPerAddress: 24,
  guestBurst: 12,
  guestsPerHour: 30,
};

const HOUR_MS = 3_600_000;
/** How often refilled guest buckets are forgotten. */
const PRUNE_EVERY_MS = 60_000;

interface Bucket {
  tokens: number;
  at: number;
}

export class Admission {
  private readonly sockets = new Map<string, number>();
  private readonly guests = new Map<string, Bucket>();
  private lastPrune = -Infinity;

  constructor(private readonly limits: AdmissionLimits = DEFAULT_ADMISSION_LIMITS) {}

  /** Counts a new socket; false (not counted) when its address already holds the maximum. */
  openSocket(address: string | null): boolean {
    if (address === null) return true;
    const open = this.sockets.get(address) ?? 0;
    if (open >= this.limits.maxSocketsPerAddress) return false;
    this.sockets.set(address, open + 1);
    return true;
  }

  /** A socket counted by openSocket closed. */
  closeSocket(address: string | null): void {
    if (address === null) return;
    const open = (this.sockets.get(address) ?? 0) - 1;
    if (open > 0) this.sockets.set(address, open);
    else this.sockets.delete(address);
  }

  /** Takes one guest-creation token; false when the address created too many accounts lately. */
  allowGuest(address: string | null, now: number): boolean {
    if (address === null) return true;
    this.pruneIfDue(now);
    const bucket = this.refilled(this.guests.get(address), now);
    if (bucket.tokens < 1) {
      this.guests.set(address, bucket);
      return false;
    }
    this.guests.set(address, { tokens: bucket.tokens - 1, at: now });
    return true;
  }

  private refilled(bucket: Bucket | undefined, now: number): Bucket {
    if (!bucket) return { tokens: this.limits.guestBurst, at: now };
    const earned = (Math.max(0, now - bucket.at) / HOUR_MS) * this.limits.guestsPerHour;
    return { tokens: Math.min(this.limits.guestBurst, bucket.tokens + earned), at: now };
  }

  /** Buckets that have refilled completely carry no information: drop them. */
  private pruneIfDue(now: number): void {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    for (const [address, bucket] of this.guests) {
      if (this.refilled(bucket, now).tokens >= this.limits.guestBurst) this.guests.delete(address);
    }
  }
}
