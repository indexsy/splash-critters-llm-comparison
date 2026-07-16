/**
 * Headless bot-vs-bot soak: completes a full match with no crash.
 */
import {
  CONFIG,
  createRoundState,
  simulateTick,
  type InputMap,
  dimensionsForMode,
} from '@splash/shared';
import { createBot, botThink } from './bots/bot.js';

function runMatch(mode: 'duel' | 'ffa', roundsToWin: number): boolean {
  const dims = dimensionsForMode(mode);
  const count = mode === 'duel' ? 2 : 4;
  const diffs = ['hard', 'easy', 'medium', 'hard'] as const;

  const players = Array.from({ length: count }, (_, i) => ({
    id: `bot-${diffs[i]}-${i}`,
    slot: i,
    nickname: `Bot${i}`,
    animal: 'frog' as const,
    hat: 'none' as const,
    isBot: true,
    botDifficulty: diffs[i]!,
  }));

  const bots = players.map((p) => createBot(p.id, p.botDifficulty));
  let roundsWon = players.map(() => 0);
  let roundNo = 0;
  let seq = 0;
  let totalTicks = 0;
  const maxTicks = CONFIG.TICK_RATE * 60 * 10; // 10 min safety

  while (Math.max(...roundsWon) < roundsToWin && totalTicks < maxTicks) {
    roundNo++;
    const seed = (roundNo * 99991 + 42) >>> 0;
    const state = createRoundState({
      width: dims.width,
      height: dims.height,
      mapSeed: seed,
      theme: 'backyard',
      ranked: false,
      enableRevengeDucks: false,
      players,
    });

    // Reset bots
    for (const b of bots) b.lastDecisionTick = -999;

    let guard = 0;
    while (!state.roundOver && guard < CONFIG.TICK_RATE * 180) {
      const inputs: InputMap = {};
      for (const bot of bots) {
        seq++;
        inputs[bot.playerId] = botThink(bot, state, seq);
      }
      simulateTick(state, inputs);
      guard++;
      totalTicks++;
    }

    if (!state.roundOver) {
      console.error(`Round ${roundNo} timed out`);
      return false;
    }

    if (state.winnerIds.length === 1) {
      const wi = players.findIndex((p) => p.id === state.winnerIds[0]);
      if (wi >= 0) roundsWon[wi]!++;
    }

    console.log(
      `  Round ${roundNo}: winner=${state.winnerIds[0] ?? 'draw'} scores=${roundsWon.join('-')} ticks=${state.tick}`,
    );
  }

  console.log(`Match complete: ${mode} scores=${roundsWon.join('-')} totalTicks=${totalTicks}`);
  return Math.max(...roundsWon) >= roundsToWin;
}

console.log('Soak test: bot-vs-bot matches...');
const duelOk = runMatch('duel', 2);
const ffaOk = runMatch('ffa', 2);
if (duelOk && ffaOk) {
  console.log('SOAK PASS');
  process.exit(0);
} else {
  console.error('SOAK FAIL');
  process.exit(1);
}
