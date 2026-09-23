// Command-line options for the headless bot soak (npm run soak -- --hve 40 --seed 7 ...).
import { defaultWorkers } from './pool';

export interface SoakOptions {
  /** Hard vs Easy duels. */
  hve: number;
  /** Medium vs Medium duels. */
  mvm: number;
  /** All-Hard 4-player free-for-alls (their bot decisions are timed for the CPU report). */
  hard4: number;
  /** Mixed-difficulty 4-player free-for-alls. */
  mixed4: number;
  /** Hard vs the wandering practice target (the passive tutorial bot). */
  wanderer: number;
  /** Hard vs the practice target that never moves. */
  statue: number;
  seed: number;
  roundsToWin: number;
  /** Worker threads (1 = run in-process). */
  workers: number;
  verbose: boolean;
}

const DEFAULTS: SoakOptions = {
  hve: 40,
  mvm: 10,
  hard4: 6,
  mixed4: 6,
  wanderer: 10,
  statue: 10,
  seed: 20260922,
  roundsToWin: 3,
  workers: defaultWorkers(),
  verbose: false,
};

const USAGE = `Usage: npm run soak -- [--hve N] [--mvm N] [--hard4 N] [--mixed4 N] [--wanderer N] [--statue N] [--seed N] [--rounds-to-win N] [--workers N] [--verbose]
  --hve            Hard vs Easy duels                  (default ${DEFAULTS.hve})
  --mvm            Medium vs Medium duels              (default ${DEFAULTS.mvm})
  --hard4          all-Hard 4-player FFA matches       (default ${DEFAULTS.hard4})
  --mixed4         mixed-difficulty FFA matches        (default ${DEFAULTS.mixed4})
  --wanderer       Hard vs the wandering dummy duels   (default ${DEFAULTS.wanderer})
  --statue         Hard vs the standing dummy duels    (default ${DEFAULTS.statue})
  --seed           base seed                           (default ${DEFAULTS.seed})
  --rounds-to-win  round wins that end a match         (default ${DEFAULTS.roundsToWin})
  --workers        parallel worker threads             (default ${DEFAULTS.workers}; 1 = in-process)
  --verbose        print one line per match`;

const NUMERIC: Record<string, keyof SoakOptions> = {
  '--hve': 'hve',
  '--mvm': 'mvm',
  '--hard4': 'hard4',
  '--mixed4': 'mixed4',
  '--wanderer': 'wanderer',
  '--statue': 'statue',
  '--seed': 'seed',
  '--rounds-to-win': 'roundsToWin',
  '--workers': 'workers',
};

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

/** Parses `--flag value` and `--flag=value` forms; exits with usage on anything unknown. */
export function parseSoakArgs(argv: string[]): SoakOptions {
  const opts: SoakOptions = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=', 2);
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (flag === '--verbose') {
      opts.verbose = true;
      continue;
    }
    const key = NUMERIC[flag];
    if (!key) fail(`Unknown option ${argv[i]}`);
    const raw = inline ?? argv[++i];
    const value = Number(raw);
    if (raw === undefined || !Number.isInteger(value) || value < 0) fail(`${flag} needs a non-negative integer`);
    (opts[key] as number) = value;
  }
  if (opts.roundsToWin < 1) fail('--rounds-to-win must be at least 1');
  if (opts.workers < 1) fail('--workers must be at least 1');
  return opts;
}
