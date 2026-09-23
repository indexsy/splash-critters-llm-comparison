// Prints the soak report: per-suite outcomes next to the pre-rework baseline, self-soak judgement,
// the practice-target hunts, bot CPU and the gates.
import { CONFIG } from '@splash/shared';
import { quantileUs } from './cpu';
import {
  EASY_SELF_SOAK_RATE,
  FORCED_SELF_SOAK_RATE,
  FORCING,
  HVE_MIN_WIN_RATE,
  LEVELS,
  TARGET_MIN_RATE,
  forcedTotal,
  type SoakTotals,
  type Verdict,
} from './report';
import { SUITES } from './suites';

/** Share of tide-decided rounds, drawn rounds and the average round length per suite in the soak of commit 0a78e6c (seed 20260922). */
const BASELINE: Record<string, { tide: number; draws: number; secs: number }> = {
  [SUITES.hve]: { tide: 80 / 156, draws: 66 / 156, secs: 97.2 },
  [SUITES.mvm]: { tide: 98 / 127, draws: 91 / 127, secs: 116.2 },
  [SUITES.hard4]: { tide: 73 / 109, draws: 67 / 109, secs: 113.8 },
  [SUITES.mixed4]: { tide: 63 / 89, draws: 56 / 89, secs: 115.9 },
  [SUITES.wanderer]: { tide: 3 / 30, draws: 0, secs: 79.1 },
};

const secs = (ticks: number): string => (ticks / CONFIG.TICK_RATE).toFixed(1);
const pct = (a: number, b: number): string => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const share = (x: number): string => `${(100 * x).toFixed(1)}%`;

function list(title: string, items: string[], max = 10): void {
  if (items.length === 0) return;
  console.log(`  ${title}:`);
  for (const item of items.slice(0, max)) console.log(`    - ${item}`);
  if (items.length > max) console.log(`    ... and ${items.length - max} more`);
}

function printSuites(t: SoakTotals): void {
  console.log('  suite              matches rounds  avg round (was)    tide-decided (was)       draws (was)  kills/round');
  for (const [name, s] of t.suites) {
    const base = BASELINE[name];
    const was = (x: string): string => (base ? `(${x})` : '');
    const avg = s.rounds > 0 ? `${secs(s.ticks / s.rounds)} s ${was(`${base?.secs.toFixed(1)} s`)}` : '-';
    const tide = `${String(s.tideRounds).padStart(4)} ${pct(s.tideRounds, s.rounds).padStart(6)} ${was(share(base?.tide ?? 0))}`;
    const draws = `${String(s.draws).padStart(4)} ${pct(s.draws, s.rounds).padStart(6)} ${was(share(base?.draws ?? 0))}`;
    const kills = s.rounds > 0 ? (s.kills / s.rounds).toFixed(2) : '-';
    const cells = [String(s.matches).padStart(7), String(s.rounds).padStart(6), avg.padStart(17), tide.padStart(21), draws.padStart(20), kills.padStart(12)];
    console.log(`  ${name.padEnd(18)} ${cells.join(' ')}`);
  }
}

function printSelfSoaks(t: SoakTotals): void {
  for (const d of LEVELS) {
    const forced = forcedTotal(t, d);
    const how = FORCING.map((k) => `${t.forced[d][k]} by ${k}s`).join(', ');
    const rounds = String(t.botRounds[d]).padStart(4);
    console.log(`  ${d.padEnd(6)} bot-rounds ${rounds}  soaked ${String(t.soaked[d]).padStart(4)}  self-soaks ${t.selfSoaks[d]}: ${t.selfSoaks[d] - forced} unforced, ${forced} forced (${how})`);
  }
}

function printHunts(t: SoakTotals): void {
  if (t.hve.matches > 0) {
    console.log(`  hard vs easy: match wins ${t.hve.hardWins}/${t.hve.matches} (${pct(t.hve.hardWins, t.hve.matches)}), round wins ${t.hve.hardRounds}-${t.hve.easyRounds}`);
  }
  for (const [kind, target] of t.targets) {
    console.log(`  hard vs ${kind}: soaked it before the tide in ${target.soakedEarly}/${target.rounds} rounds (${pct(target.soakedEarly, target.rounds)})`);
  }
  if (t.cpu.calls > 0) {
    const avg = t.cpu.totalUs / t.cpu.calls;
    const q = (x: number): string => `${quantileUs(t.cpu, x)} us`;
    console.log(`  bot CPU per decision call (all-Hard FFA, ${t.cpu.calls} calls): avg ${avg.toFixed(0)} us, p50 <= ${q(0.5)}, p99 <= ${q(0.99)}, max ${(t.cpu.maxUs / 1000).toFixed(1)} ms`);
    const slow = t.cpu.slowest;
    if (slow) console.log(`  slowest decision call: ${slow.match} round ${slow.round} tick ${slow.tick} slot ${slow.slot}`);
    if (t.cpu.suspended > 0) console.log(`  ${t.cpu.suspended} call(s) spanned a system sleep and were left out of the CPU numbers`);
  }
}

export function printReport(t: SoakTotals, verdict: Verdict, elapsedMs: number, workers: number): void {
  console.log('');
  console.log(`Splash Critters bot soak: ${t.matches} matches, ${t.rounds} rounds, ${secs(t.ticks)} s of sim time in ${(elapsedMs / 1000).toFixed(1)} s on ${workers} worker(s)`);
  printSuites(t);
  console.log(`  average round length: ${t.rounds > 0 ? secs(t.ticks / t.rounds) : '-'} s`);
  console.log(`  crashes: ${t.crashes.length}   desyncs: ${t.desyncs.length}   stalls: ${t.stalls.length}   freezes: ${t.freezes.length}`);
  printSelfSoaks(t);
  printHunts(t);
  console.log(
    `  gates: 0 crashes/desyncs/stalls/freezes; Medium/Hard 0 unforced self-soaks and forced <= ${FORCED_SELF_SOAK_RATE * 100}% of bot-rounds;` +
      ` Easy unforced <= max(2, ${EASY_SELF_SOAK_RATE * 100}%); Hard beats Easy in >= ${HVE_MIN_WIN_RATE * 100}% of matches;` +
      ` Hard soaks each practice target before the tide in >= ${TARGET_MIN_RATE * 100}% of rounds`,
  );
  list('crashes', t.crashes, 3);
  list('desyncs', t.desyncs);
  list('stalls', t.stalls);
  list('freezes', t.freezes);
  list('UNFORCED self-soaks', t.unforcedNotes, 40);
  list('self-soaks forced by opponents', t.forcedNotes, 5);
  if (verdict.passed) {
    console.log('SOAK PASSED');
  } else {
    for (const f of verdict.failures) console.log(`  FAIL: ${f}`);
    console.log('SOAK FAILED');
  }
}
