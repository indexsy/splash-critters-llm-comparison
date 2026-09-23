// Runs soak matches in parallel on worker threads (they are independent and deterministic), or
// in-process when only one worker is wanted, both from the bundled engine (see engine.ts).
// A worker that fails or exits while a match is in flight fails the whole run (never a silent
// exit with matches missing), and every other worker is stopped.
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { MatchOutcome, MatchSpec } from './match';
import { matchLabel } from './suites';

/** One worker per core, up to 8 (the main thread only waits while they play). */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(8, availableParallelism()));
}

/**
 * Plays every spec with the bundled engine at `engine`; `onDone` sees each outcome as it finishes.
 * Results come back in spec order.
 */
export async function runAll(
  specs: MatchSpec[],
  workers: number,
  engine: string,
  onDone: (outcome: MatchOutcome) => void,
): Promise<MatchOutcome[]> {
  if (workers <= 1 || specs.length <= 1) {
    const { playAndVerify } = (await import(pathToFileURL(engine).href)) as { playAndVerify: (spec: MatchSpec) => MatchOutcome };
    return specs.map((spec) => {
      const outcome = playAndVerify(spec);
      onDone(outcome);
      return outcome;
    });
  }
  const outcomes: MatchOutcome[] = new Array(specs.length);
  let next = 0;
  const runWorker = (worker: Worker): Promise<void> =>
    new Promise((resolve, reject) => {
      let current = -1;
      let finished = false;
      const feed = (): void => {
        if (next >= specs.length) {
          finished = true;
          void worker.terminate().then(() => resolve());
          return;
        }
        current = next++;
        worker.postMessage(specs[current]);
      };
      worker.on('message', (outcome: MatchOutcome) => {
        outcomes[current] = outcome;
        onDone(outcome);
        feed();
      });
      worker.once('error', (err) => reject(new Error(`soak worker failed while playing ${matchLabel(specs[current])}: ${String(err)}`)));
      worker.once('exit', (code) => {
        if (!finished) reject(new Error(`soak worker exited with code ${code} while playing ${matchLabel(specs[current])}`));
      });
      feed();
    });
  const pool = Array.from({ length: Math.min(workers, specs.length) }, () => new Worker(engine));
  try {
    await Promise.all(pool.map(runWorker));
  } catch (err) {
    await Promise.all(pool.map((w) => w.terminate()));
    throw err;
  }
  return outcomes;
}
