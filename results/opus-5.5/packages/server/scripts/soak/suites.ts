// The soak's match line-up: Hard vs Easy duels, Medium mirror duels, all-Hard FFAs (timed for the
// bot CPU report), mixed FFAs, and Hard hunting the two practice targets that never fight back.
import { hashSeed, mulberry32, type Difficulty } from '@splash/shared';
import type { SoakOptions } from './args';
import type { Dummy } from './dummy';
import type { MatchSpec } from './match';

export const SUITES = {
  hve: 'hard-vs-easy',
  mvm: 'medium-vs-medium',
  hard4: 'hard-ffa',
  mixed4: 'mixed-ffa',
  wanderer: 'hard-vs-wanderer',
  statue: 'hard-vs-statue',
} as const;

const LEVELS: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** A match's name in the reports: suite#index. */
export function matchLabel(spec: MatchSpec): string {
  return `${spec.suite}#${spec.index}`;
}

/** Four seeded difficulties that are not all the same. */
function mixedLineup(seed: number): Difficulty[] {
  const rng = mulberry32(seed);
  for (;;) {
    const lineup = [0, 1, 2, 3].map(() => LEVELS[Math.floor(rng() * LEVELS.length)]);
    if (new Set(lineup).size > 1) return lineup;
  }
}

/** Hard in alternating corners against an Easy bot (or the practice target playing that slot). */
function hardDuel(i: number): Difficulty[] {
  return i % 2 === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
}

export function buildSpecs(opts: SoakOptions): MatchSpec[] {
  const specs: MatchSpec[] = [];
  const add = (
    suite: string,
    count: number,
    lineup: (i: number, seed: number) => MatchSpec['bots'],
    mode: MatchSpec['mode'],
    dummy: Dummy | null = null,
    timed = false,
  ): void => {
    for (let i = 0; i < count; i++) {
      const seed = hashSeed(opts.seed, specs.length, i);
      const bots = lineup(i, seed);
      const dummies = bots.map((d) => (dummy !== null && d === 'easy' ? dummy : null));
      specs.push({ suite, index: i, mode, bots, dummies, seed, roundsToWin: opts.roundsToWin, timed });
    }
  };
  add(SUITES.hve, opts.hve, hardDuel, 'duel');
  add(SUITES.mvm, opts.mvm, () => ['medium', 'medium'], 'duel');
  add(SUITES.hard4, opts.hard4, () => ['hard', 'hard', 'hard', 'hard'], 'ffa', null, true);
  add(SUITES.mixed4, opts.mixed4, (_, seed) => mixedLineup(seed), 'ffa');
  add(SUITES.wanderer, opts.wanderer, hardDuel, 'duel', 'wanderer');
  add(SUITES.statue, opts.statue, hardDuel, 'duel', 'statue');
  return specs;
}
