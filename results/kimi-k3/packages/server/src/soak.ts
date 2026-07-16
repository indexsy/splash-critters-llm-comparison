import { BotDifficulty, CONFIG, GameState, InputFrame, createGame, simulateTick } from '@splash/shared';
import { BotController } from './bots/bot.js';

function runMatch(mode: 'duel' | 'ffa', difficulties: BotDifficulty[], seed: number): { winner: number; ticks: number; state: GameState } {
  const state = createGame({
    mode,
    mapSeed: seed,
    playerCount: difficulties.length,
    roundsToWin: CONFIG.ROUNDS_TO_WIN_DEFAULT,
    enableRevengeDucks: false,
  });
  const bots = difficulties.map((d, i) => new BotController(d, i));
  const maxTicks = CONFIG.TICK_RATE * 60 * 20;
  let ticks = 0;
  while (state.phase !== 'matchEnd' && ticks < maxTicks) {
    const inputs = new Map<number, InputFrame>();
    for (let i = 0; i < bots.length; i++) {
      inputs.set(i, bots[i]!.nextInput(state));
    }
    simulateTick(state, inputs);
    ticks++;
  }
  if (ticks >= maxTicks) throw new Error(`match did not complete in ${maxTicks} ticks`);
  return { winner: state.matchWinner, ticks, state };
}

function main(): void {
  console.log('[soak] FFA 4x hard bots...');
  const ffa = runMatch('ffa', ['hard', 'hard', 'hard', 'hard'], 0xc0ffee);
  console.log(`[soak] FFA completed in ${ffa.ticks} ticks, winner slot ${ffa.winner}`);
  if (ffa.winner < 0) throw new Error('FFA ended with no winner');

  console.log('[soak] Duel hard vs easy x5...');
  let hardWins = 0;
  for (let i = 0; i < 5; i++) {
    const r = runMatch('duel', ['easy', 'hard'], 1000 + i * 77);
    console.log(`[soak] duel ${i + 1}: winner slot ${r.winner} (${r.ticks} ticks)`);
    if (r.winner === 1) hardWins++;
  }
  console.log(`[soak] hard won ${hardWins}/5 vs easy`);
  if (hardWins < 3) throw new Error('Hard bot does not reliably beat Easy');

  console.log('[soak] mixed casual 2 humans-as-bots + revenge ducks...');
  const ducks = createGame({
    mode: 'ffa',
    mapSeed: 42,
    playerCount: 4,
    roundsToWin: 2,
    enableRevengeDucks: true,
  });
  const duckBots = [0, 1, 2, 3].map((i) => new BotController('medium', i));
  let ticks = 0;
  while (ducks.phase !== 'matchEnd' && ticks < CONFIG.TICK_RATE * 60 * 20) {
    const inputs = new Map<number, InputFrame>();
    for (let i = 0; i < 4; i++) inputs.set(i, duckBots[i]!.nextInput(ducks));
    simulateTick(ducks, inputs);
    ticks++;
  }
  if (ticks >= CONFIG.TICK_RATE * 60 * 20) throw new Error('duck match did not complete');
  console.log(`[soak] revenge-duck match completed in ${ticks} ticks, winner slot ${ducks.matchWinner}`);
  console.log('[soak] ALL OK');
}

main();
