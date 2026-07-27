/**
 * Headless soak: bots playing full matches with nothing else attached.
 *
 * No socket, no HTTP, no database - a MatchRunner, a no-op sink and a room full
 * of bots, run flat out. It is the cheapest way to find a round that never
 * ends, a balloon that bursts twice or a bot that walks into an exception.
 *
 * Run it with `npm run soak`. Non-zero exit means something is wrong.
 */

import {
  CONFIG,
  type BotDifficulty,
  type CreateRoomOpts,
  type GameMode,
  type RatingInfo,
  type ServerMessage,
} from '@splash/shared';
import { MatchRunner, type MatchSink, type MatchSlotResult } from './match.js';
import { Room, type PlayerLookup } from './room.js';

interface Scenario {
  label: string;
  mode: GameMode;
  difficulties: BotDifficulty[];
}

const SCENARIOS: Scenario[] = [
  { label: 'ffa-mixed', mode: 'ffa', difficulties: ['easy', 'medium', 'hard', 'medium'] },
  { label: 'ffa-hard', mode: 'ffa', difficulties: ['hard', 'hard', 'hard', 'hard'] },
  { label: 'duel-even', mode: 'duel', difficulties: ['medium', 'medium'] },
  { label: 'duel-tilted', mode: 'duel', difficulties: ['easy', 'hard'] },
];

/** Generous upper bound: every round running to its hard stop, every round played. */
const TICK_BUDGET =
  CONFIG.MAX_ROUNDS * (CONFIG.ROUND_MAX_TICKS + CONFIG.ROUND_END_TICKS + CONFIG.COUNTDOWN_TICKS) +
  CONFIG.TICK_RATE;

/**
 * Wall-clock backstop per scenario, checked between ticks. TICK_BUDGET only
 * catches a match that refuses to end; this also catches ticks that keep
 * returning but get slower and slower, which would otherwise wedge CI for hours
 * with no output. A whole scenario runs in well under a second today, so 60s
 * means something is genuinely stuck rather than merely slow on a loaded box.
 */
const WALL_CLOCK_BUDGET_MS = 60_000;

/** Bots need no account, but the roster still asks the lookup for one. */
const BOT_ONLY_LOOKUP: PlayerLookup = {
  getById: () => null,
  getRating: (_id: string, mode: GameMode): RatingInfo => ({
    mode,
    rating: CONFIG.ELO_START,
    games: 0,
    wins: 0,
    peak: CONFIG.ELO_START,
  }),
};

interface RunReport {
  label: string;
  rounds: number;
  ticks: number;
  soaks: number;
  castles: number;
  bestChain: number;
  mapSeeds: number[];
  elapsedMs: number;
  failures: string[];
}

/**
 * Watches the broadcast stream instead of the private GameState, which is
 * exactly what a client sees - so anything wrong here is wrong on the wire too.
 */
class Watcher {
  readonly failures: string[] = [];
  roundStarts = 0;
  roundEnds = 0;
  matchOver = false;
  readonly mapSeeds: number[] = [];

  /** Balloon id -> owner slot, for the round currently in progress. */
  private live = new Map<number, number>();
  private outstanding = new Map<number, number>();

  observe(msg: ServerMessage): void {
    switch (msg.t) {
      case 'round_start':
        this.roundStarts++;
        // Balloons do not survive a round boundary, so neither does the ledger.
        this.live = new Map();
        this.outstanding = new Map();
        return;
      case 'round_end':
        this.roundEnds++;
        this.matchOver = msg.matchOver;
        return;
      case 'event':
        this.observeEvent(msg.event);
        return;
      default:
        return;
    }
  }

  private observeEvent(event: Extract<ServerMessage, { t: 'event' }>['event']): void {
    if (event.kind === 'balloon_placed') {
      if (this.live.has(event.id)) this.failures.push(`balloon ${event.id} placed twice`);
      this.live.set(event.id, event.playerId);
      this.bump(event.playerId, 1);
      return;
    }
    if (event.kind !== 'balloon_burst') return;

    const owner = this.live.get(event.id);
    if (owner === undefined) {
      this.failures.push(`balloon ${event.id} burst without ever being placed`);
      return;
    }
    this.live.delete(event.id);
    this.bump(owner, -1);
  }

  private bump(owner: number, delta: number): void {
    const next = (this.outstanding.get(owner) ?? 0) + delta;
    if (next < 0) this.failures.push(`slot ${owner} balloon count went negative`);
    this.outstanding.set(owner, next);
  }
}

function buildRoom(scenario: Scenario, index: number): Room {
  const opts: CreateRoomOpts = {
    name: `Soak ${scenario.label}`,
    size: scenario.mode === 'duel' ? 2 : 4,
    isPublic: false,
    theme: 'random',
    roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
    botFill: false,
  };
  const room = new Room(`SOAK${String(index).padStart(2, '0')}`, opts, false, null);
  scenario.difficulties.forEach((difficulty, slot) => {
    room.setSlot(slot, 'bot', difficulty);
  });
  return room;
}

function checkResults(results: MatchSlotResult[], room: Room, watcher: Watcher): string[] {
  const failures: string[] = [];

  if (results.length !== room.maxPlayers) {
    failures.push(`expected ${room.maxPlayers} results, got ${results.length}`);
  }
  if (!results.some((r) => r.placement === 1)) failures.push('nobody was placed first');
  if (results.some((r) => r.placement < 1 || r.placement > results.length)) {
    failures.push('a placement fell outside the roster');
  }
  if (results.some((r) => r.soaks < 0 || r.castles < 0 || r.roundsWon < 0)) {
    failures.push('a negative stat reached the results');
  }

  const totalRoundWins = results.reduce((sum, r) => sum + r.roundsWon, 0);
  if (totalRoundWins > watcher.roundEnds) {
    failures.push(`${totalRoundWins} round wins across ${watcher.roundEnds} rounds`);
  }
  const decided = results.some((r) => r.roundsWon >= room.roundsToWin);
  if (!decided && watcher.roundEnds < CONFIG.MAX_ROUNDS) {
    failures.push('match ended without anyone reaching the round target');
  }
  return failures;
}

function runScenario(scenario: Scenario, index: number): RunReport {
  const startedAt = Date.now();
  const watcher = new Watcher();
  const room = buildRoom(scenario, index);
  // The seed is deliberately not on the wire, so a failing scenario asks the
  // runner for it rather than reading it off round_start.
  let seedOfRound: () => number = () => 0;
  const sink: MatchSink = {
    // Nobody is connected: a targeted send has no recipient by construction.
    send: () => {},
    broadcast: (msg) => {
      if (msg.t === 'round_start') watcher.mapSeeds.push(seedOfRound());
      watcher.observe(msg);
    },
    latency: () => 0,
  };

  const failures: string[] = [];
  let ticks = 0;
  let results: MatchSlotResult[] = [];

  try {
    const runner = new MatchRunner(room, BOT_ONLY_LOOKUP, sink);
    seedOfRound = () => runner.currentMapSeed();
    runner.begin();
    // A synthetic clock: bots only read it to pace their decisions, and running
    // it at exactly the tick rate keeps a soak honest at any wall-clock speed.
    let clockMs = Date.now();
    const deadline = startedAt + WALL_CLOCK_BUDGET_MS;
    let timedOut = false;
    while (!runner.finished && ticks < TICK_BUDGET) {
      clockMs += CONFIG.TICK_MS;
      runner.tick(clockMs);
      ticks++;
      // Cheap enough at 1/256 ticks to be free, frequent enough to bail fast.
      if ((ticks & 0xff) === 0 && Date.now() > deadline) {
        timedOut = true;
        break;
      }
    }

    if (timedOut) {
      failures.push(`timed out after ${WALL_CLOCK_BUDGET_MS}ms (${ticks} ticks)`);
    } else if (!runner.finished) {
      failures.push(`match unfinished after ${ticks} ticks`);
    }
    results = runner.results();
    failures.push(...checkResults(results, room, watcher));
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack : String(error)}`);
  }

  if (watcher.roundStarts !== watcher.roundEnds) {
    failures.push(`${watcher.roundStarts} rounds started but ${watcher.roundEnds} ended`);
  }
  if (watcher.roundEnds === 0) failures.push('no round ever ended');
  if (!watcher.matchOver) failures.push('the last round_end did not close the match');
  failures.push(...watcher.failures);

  return {
    label: scenario.label,
    rounds: watcher.roundEnds,
    ticks,
    soaks: results.reduce((sum, r) => sum + r.soaks, 0),
    castles: results.reduce((sum, r) => sum + r.castles, 0),
    bestChain: results.reduce((best, r) => Math.max(best, r.bestChain), 0),
    mapSeeds: watcher.mapSeeds,
    elapsedMs: Date.now() - startedAt,
    failures,
  };
}

function main(): void {
  const startedAt = Date.now();
  const reports = SCENARIOS.map((scenario, index) => runScenario(scenario, index));

  console.log('scenario      rounds   ticks   soaks castles  chain    ms');
  for (const report of reports) {
    console.log(
      [
        report.label.padEnd(13),
        String(report.rounds).padStart(6),
        String(report.ticks).padStart(7),
        String(report.soaks).padStart(7),
        String(report.castles).padStart(7),
        String(report.bestChain).padStart(6),
        String(report.elapsedMs).padStart(5),
      ].join(' '),
    );
  }

  const failed = reports.filter((r) => r.failures.length > 0);
  const totalTicks = reports.reduce((sum, r) => sum + r.ticks, 0);
  const totalRounds = reports.reduce((sum, r) => sum + r.rounds, 0);
  console.log(
    `\n${reports.length} matches, ${totalRounds} rounds, ${totalTicks} ticks in ${Date.now() - startedAt}ms`,
  );

  if (failed.length === 0) {
    console.log('soak passed');
    return;
  }

  for (const report of failed) {
    console.error(`\n${report.label} FAILED (map seeds: ${report.mapSeeds.join(', ')})`);
    for (const failure of report.failures) console.error(`  - ${failure}`);
  }
  console.error(`\nsoak failed: ${failed.length}/${reports.length} scenarios`);
  process.exitCode = 1;
}

main();
