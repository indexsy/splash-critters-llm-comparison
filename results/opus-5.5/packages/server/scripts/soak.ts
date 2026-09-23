// Headless bot-vs-bot soak (npm run soak): many full matches with the shared sim and server bots
// only, no network. Every match is replayed from its seeds and recorded inputs to prove there is
// no desync; then bot quality is checked (self-soaks, freezes, Hard beating Easy and hunting down
// targets that never fight back, how many rounds only the tide decides, bot CPU). Exits 1 and
// prints SOAK FAILED if any gate fails.
import { parseSoakArgs } from './soak/args';
import { bundleEngine } from './soak/engine';
import type { MatchOutcome } from './soak/match';
import { runAll } from './soak/pool';
import { printReport } from './soak/print';
import { aggregate, evaluate } from './soak/report';
import { buildSpecs } from './soak/suites';

function describe({ result: r, desyncs, ms }: MatchOutcome): string {
  const lineup = r.spec.bots.map((d, slot) => r.spec.dummies[slot] ?? d ?? '-').join(' ');
  const rounds = r.rounds.map((x) => (x.winner < 0 ? 'D' : String(x.winner))).join('');
  const status = r.crash ? 'CRASH' : desyncs > 0 ? 'DESYNC' : 'ok';
  return `${r.spec.suite}#${r.spec.index} [${lineup}] rounds ${rounds} wins ${r.roundsWon.join('-')} winner ${r.winner} ${status} ${ms.toFixed(0)} ms`;
}

async function main(): Promise<void> {
  const opts = parseSoakArgs(process.argv.slice(2));
  const specs = buildSpecs(opts);
  const started = performance.now();
  console.log(`Soaking ${specs.length} matches on ${opts.workers} worker(s)...`);
  const engine = await bundleEngine();
  const outcomes = await runAll(specs, opts.workers, engine.path, (o) => {
    if (opts.verbose) console.log(describe(o));
  }).finally(() => engine.dispose());
  const totals = aggregate(
    outcomes.map((o) => o.result),
    outcomes.map((o) => o.desyncs),
  );
  const verdict = evaluate(totals);
  printReport(totals, verdict, performance.now() - started, opts.workers);
  process.exitCode = verdict.passed ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  console.log('SOAK FAILED');
  process.exitCode = 1;
});
