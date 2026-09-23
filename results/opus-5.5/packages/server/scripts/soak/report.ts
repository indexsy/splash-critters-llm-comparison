// Aggregates soak results and checks the quality gates (printing lives in print.ts).
import { CONFIG, type Difficulty } from '@splash/shared';
import type { ForcedBy } from './attribution';
import { emptyHistogram, mergeHistogram, quantileUs, type CpuHistogram } from './cpu';
import type { Dummy } from './dummy';
import type { MatchResult } from './match';
import { SUITES } from './suites';

export const LEVELS: readonly Difficulty[] = ['easy', 'medium', 'hard'];
export const FORCING: readonly ForcedBy[] = ['drop', 'lob', 'kick'];

/** Easy may blunder into its own splash now and then, but rarely: at most this share of its rounds (or 2). */
export const EASY_SELF_SOAK_RATE = 0.02;
/**
 * Regression guard for Medium/Hard self-soaks an opponent forced (it took the victim's last way out
 * with a balloon it dropped, lobbed from a revenge duck or kicked): opponents' kills in all but
 * name (the sim credits a cascade the victim's own balloon set off to the victim), yet they must
 * stay rare. All-Hard FFAs, where three opponents and their revenge ducks hunt every bot, put the
 * most pressure on it.
 */
export const FORCED_SELF_SOAK_RATE = 0.06;
export const HVE_MIN_WIN_RATE = 0.9;
/** Hard must soak each practice target (which never fights back) before the tide in this share of rounds. */
export const TARGET_MIN_RATE = 0.9;
/**
 * Bot decision cost in the all-Hard FFA (every bot runs inside the server's single 30 Hz loop, so
 * a slow decision delays every room): 99% of calls within 3 ms and none over 100 ms (a lone
 * garbage-collection pause can land inside one call; anything longer would visibly stall the
 * room). Calls that spanned a system sleep are excluded (see cpu.ts).
 */
export const CPU_P99_LIMIT_US = 3000;
export const CPU_MAX_LIMIT_US = 100_000;

export interface SuiteTotals {
  matches: number;
  rounds: number;
  ticks: number;
  /** Rounds whose last soak(s) came from the rising tide. */
  tideRounds: number;
  draws: number;
  /** Players soaked by an opponent's splash or revenge lob. */
  kills: number;
}

/** Hard hunting a practice target: rounds played, and rounds it soaked the target before the tide rose. */
export interface TargetTotals {
  rounds: number;
  soakedEarly: number;
}

export interface SoakTotals {
  matches: number;
  rounds: number;
  ticks: number;
  crashes: string[];
  desyncs: string[];
  stalls: string[];
  freezes: string[];
  selfSoaks: Record<Difficulty, number>;
  /** Self-soaks an opponent forced, by the kind of balloon action that did it (see attribution.ts). */
  forced: Record<Difficulty, Record<ForcedBy, number>>;
  botRounds: Record<Difficulty, number>;
  soaked: Record<Difficulty, number>;
  /** One line per self-soak: the unforced ones (blunders) and the ones opponents forced. */
  unforcedNotes: string[];
  forcedNotes: string[];
  hve: { matches: number; hardWins: number; hardRounds: number; easyRounds: number };
  targets: Map<Dummy, TargetTotals>;
  suites: Map<string, SuiteTotals>;
  /** Bot CPU per decision call in the timed (all-Hard FFA) matches. */
  cpu: CpuHistogram;
}

function label(r: MatchResult): string {
  return `${r.spec.suite}#${r.spec.index} (seed ${r.spec.seed})`;
}

export function forcedTotal(t: SoakTotals, d: Difficulty): number {
  return FORCING.reduce((sum, how) => sum + t.forced[d][how], 0);
}

function emptyTotals(matches: number): SoakTotals {
  const zero = (): Record<Difficulty, number> => ({ easy: 0, medium: 0, hard: 0 });
  const byKind = (): Record<ForcedBy, number> => ({ drop: 0, lob: 0, kick: 0 });
  return {
    matches,
    rounds: 0,
    ticks: 0,
    crashes: [],
    desyncs: [],
    stalls: [],
    freezes: [],
    selfSoaks: zero(),
    forced: { easy: byKind(), medium: byKind(), hard: byKind() },
    botRounds: zero(),
    soaked: zero(),
    unforcedNotes: [],
    forcedNotes: [],
    hve: { matches: 0, hardWins: 0, hardRounds: 0, easyRounds: 0 },
    targets: new Map(),
    suites: new Map(),
    cpu: emptyHistogram(),
  };
}

/** Per-round bookkeeping of one match into the totals. */
function countRounds(t: SoakTotals, r: MatchResult, suite: SuiteTotals): void {
  // Practice targets are judged by the target gate, not by the per-difficulty stats.
  const judged = (slot: number): Difficulty | null => (r.spec.dummies[slot] ? null : r.spec.bots[slot]);
  for (const round of r.rounds) {
    t.rounds++;
    t.ticks += round.ticks;
    suite.rounds++;
    suite.ticks += round.ticks;
    if (round.tideDecided) suite.tideRounds++;
    if (round.winner < 0) suite.draws++;
    if (round.stalled) t.stalls.push(`${label(r)} round ${round.roundNo}`);
    r.spec.bots.forEach((_, slot) => {
      const d = judged(slot);
      if (d) t.botRounds[d]++;
    });
    for (const k of round.soaks) {
      if (k.cause !== 'tide' && k.by >= 0 && k.by !== k.slot) suite.kills++;
      const d = judged(k.slot);
      if (!d) continue;
      t.soaked[d]++;
      if (k.by !== k.slot) continue;
      t.selfSoaks[d]++;
      if (k.forcedBy) t.forced[d][k.forcedBy]++;
      const seeded = k.seedOwner !== k.slot ? `cascade seeded by slot ${k.seedOwner}` : '';
      const note = `${label(r)} round ${round.roundNo}: ${d} slot ${k.slot} at tick ${k.tick}`;
      if (k.forcedBy) t.forcedNotes.push(`${note} (${[k.forcedBy, seeded].filter(Boolean).join(', ')})`);
      else t.unforcedNotes.push(seeded ? `${note} (${seeded})` : note);
    }
    for (const f of round.freezes) {
      t.freezes.push(`${label(r)} round ${round.roundNo}: ${r.spec.bots[f.slot]} slot ${f.slot} frozen at tick ${f.tick} (${f.reason} reachable)`);
    }
  }
}

function countTarget(t: SoakTotals, r: MatchResult): void {
  const slot = r.spec.dummies.findIndex((d) => d !== null);
  const kind = slot >= 0 ? r.spec.dummies[slot] : null;
  if (!kind) return;
  const target = t.targets.get(kind) ?? { rounds: 0, soakedEarly: 0 };
  t.targets.set(kind, target);
  for (const round of r.rounds) {
    target.rounds++;
    const early = round.soaks.some((k) => k.slot === slot && k.cause === 'splash' && k.by !== slot && k.tick < CONFIG.TIDE_START_TICKS);
    if (early) target.soakedEarly++;
  }
}

function countHve(t: SoakTotals, r: MatchResult): void {
  const hard = r.spec.bots.indexOf('hard');
  const easy = r.spec.bots.indexOf('easy');
  t.hve.matches++;
  if (r.winner === hard) t.hve.hardWins++;
  t.hve.hardRounds += r.roundsWon[hard];
  t.hve.easyRounds += r.roundsWon[easy];
}

export function aggregate(results: MatchResult[], desyncsByMatch: number[]): SoakTotals {
  const t = emptyTotals(results.length);
  results.forEach((r, i) => {
    const suite = t.suites.get(r.spec.suite) ?? { matches: 0, rounds: 0, ticks: 0, tideRounds: 0, draws: 0, kills: 0 };
    t.suites.set(r.spec.suite, suite);
    suite.matches++;
    if (r.crash) t.crashes.push(`${label(r)}: ${r.crash}`);
    if (desyncsByMatch[i] > 0) t.desyncs.push(`${label(r)}: ${desyncsByMatch[i]} round(s)`);
    if (r.cpu) mergeHistogram(t.cpu, r.cpu);
    countRounds(t, r, suite);
    if (r.spec.suite === SUITES.hve) countHve(t, r);
    countTarget(t, r);
  });
  return t;
}

export interface Verdict {
  passed: boolean;
  failures: string[];
}

export function evaluate(t: SoakTotals): Verdict {
  const failures: string[] = [];
  if (t.crashes.length > 0) failures.push(`${t.crashes.length} crash(es)`);
  if (t.desyncs.length > 0) failures.push(`${t.desyncs.length} desync(s)`);
  if (t.stalls.length > 0) failures.push(`${t.stalls.length} stalled round(s)`);
  if (t.freezes.length > 0) failures.push(`${t.freezes.length} freeze(s)`);
  for (const d of ['medium', 'hard'] as const) {
    const forced = forcedTotal(t, d);
    const unforced = t.selfSoaks[d] - forced;
    if (unforced > 0) failures.push(`${d} soaked itself (unforced) ${unforced} time(s)`);
    const forcedLimit = Math.max(1, Math.floor(t.botRounds[d] * FORCED_SELF_SOAK_RATE));
    if (forced > forcedLimit) failures.push(`${d} forced self-soaks ${forced} (limit ${forcedLimit})`);
  }
  const easyUnforced = t.selfSoaks.easy - forcedTotal(t, 'easy');
  const easyLimit = Math.max(2, Math.floor(t.botRounds.easy * EASY_SELF_SOAK_RATE));
  if (easyUnforced > easyLimit) failures.push(`easy soaked itself (unforced) ${easyUnforced} time(s) (limit ${easyLimit})`);
  if (t.hve.matches > 0 && t.hve.hardWins / t.hve.matches < HVE_MIN_WIN_RATE) {
    failures.push(`Hard beat Easy in only ${t.hve.hardWins}/${t.hve.matches} matches (need ${HVE_MIN_WIN_RATE * 100}%)`);
  }
  if (t.cpu.calls > 0) {
    const p99 = quantileUs(t.cpu, 0.99);
    if (p99 > CPU_P99_LIMIT_US) failures.push(`bot decision p99 ${p99} us (limit ${CPU_P99_LIMIT_US} us)`);
    if (t.cpu.maxUs > CPU_MAX_LIMIT_US) failures.push(`slowest bot decision ${(t.cpu.maxUs / 1000).toFixed(1)} ms (limit ${CPU_MAX_LIMIT_US / 1000} ms)`);
  }
  for (const [kind, target] of t.targets) {
    if (target.rounds > 0 && target.soakedEarly / target.rounds < TARGET_MIN_RATE) {
      failures.push(`Hard soaked the ${kind} before the tide in only ${target.soakedEarly}/${target.rounds} rounds (need ${TARGET_MIN_RATE * 100}%)`);
    }
  }
  return { passed: failures.length === 0, failures };
}
