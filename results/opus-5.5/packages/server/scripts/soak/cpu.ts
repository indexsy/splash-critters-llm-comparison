// Bot CPU per decision call (nextInput), kept as a fixed-bucket histogram so that the numbers of
// many matches on many worker threads merge exactly into one average and percentiles. The single
// slowest call is kept with where it happened, so that it can be replayed deterministically.
//
// Calls that spanned a system sleep (a laptop's lid closed mid-soak) are counted as `suspended`
// and left out of the statistics: they show minutes of wall time with almost no CPU burnt, while
// a genuinely slow call keeps its thread busy the whole time.

/** Bucket width (microseconds) and the number of buckets; slower calls land in the last one. */
const BUCKET_US = 10;
const BUCKETS = 2000;

/** Where a decision call happened: the match, the round, the state's tick before the call and the bot's slot. */
export interface CallSite {
  match: string;
  round: number;
  tick: number;
  slot: number;
}

export interface CpuHistogram {
  calls: number;
  totalUs: number;
  maxUs: number;
  /** The slowest call (null before the first). */
  slowest: (CallSite & { us: number }) | null;
  /** Calls excluded because the process was suspended (system sleep) while they ran. */
  suspended: number;
  buckets: number[];
}

/** A call at least this long is checked for suspension... */
const SUSPECT_WALL_US = 200_000;
/** ...and counts as suspended when the whole process burnt less than this share of its wall time. */
const SUSPENDED_CPU_SHARE = 0.5;

/** Wall and process CPU time of one call, both in microseconds. */
export interface CallTiming {
  wallUs: number;
  cpuUs: number;
}

/** Times `fn`: wall clock plus process CPU (user + system) spent while it ran. */
export function timeCall<T>(fn: () => T): { value: T; timing: CallTiming } {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const value = fn();
  const wallUs = (performance.now() - t0) * 1000;
  const cpu = process.cpuUsage(cpu0);
  return { value, timing: { wallUs, cpuUs: cpu.user + cpu.system } };
}

export function wasSuspended(t: CallTiming): boolean {
  return t.wallUs >= SUSPECT_WALL_US && t.cpuUs < t.wallUs * SUSPENDED_CPU_SHARE;
}

export function emptyHistogram(): CpuHistogram {
  return { calls: 0, totalUs: 0, maxUs: 0, slowest: null, suspended: 0, buckets: new Array<number>(BUCKETS).fill(0) };
}

/** Records one call; `site` is only asked for when the call is the slowest so far. */
export function recordCall(h: CpuHistogram, timing: CallTiming, site: () => CallSite): void {
  if (wasSuspended(timing)) {
    h.suspended++;
    return;
  }
  const us = timing.wallUs;
  h.calls++;
  h.totalUs += us;
  if (us > h.maxUs) {
    h.maxUs = us;
    h.slowest = { ...site(), us };
  }
  h.buckets[Math.min(BUCKETS - 1, Math.floor(us / BUCKET_US))]++;
}

export function mergeHistogram(into: CpuHistogram, from: CpuHistogram): void {
  into.calls += from.calls;
  into.totalUs += from.totalUs;
  into.suspended += from.suspended;
  if (from.maxUs > into.maxUs) {
    into.maxUs = from.maxUs;
    into.slowest = from.slowest;
  }
  for (let i = 0; i < BUCKETS; i++) into.buckets[i] += from.buckets[i];
}

/** Upper edge (microseconds) of the bucket holding the `q` quantile (0..1). */
export function quantileUs(h: CpuHistogram, q: number): number {
  const rank = Math.ceil(q * h.calls);
  let seen = 0;
  for (let i = 0; i < BUCKETS; i++) {
    seen += h.buckets[i];
    if (seen >= rank) return (i + 1) * BUCKET_US;
  }
  return h.maxUs;
}
