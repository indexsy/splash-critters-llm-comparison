import { CONFIG, mulberry32, type BotDiff } from '@splash/shared';
import { LiveMatch, type MatchPlayer, type MatchResult } from './gameLoop.js';

function player(id: string, difficulty: BotDiff, animal: string): MatchPlayer {
  return {
    id,
    name: id,
    tag: '0000',
    animal,
    hat: 'none',
    bot: true,
    difficulty,
    rating: 1000,
    games: 20,
    roundWins: 0,
    soaks: 0,
    castles: 0,
    biggestChain: 0,
    survived: 0,
    connected: true,
    disconnectAt: null,
    human: false,
  };
}

function run(label: string, players: MatchPlayer[], rounds: number, width: number, height: number): MatchResult {
  let result: MatchResult | null = null;
  const match = new LiveMatch(
    {
      id: `soak-${label}`,
      mode: players.length > 2 ? 'ffa' : 'duel',
      ranked: false,
      kind: 'practice',
      theme: 'backyard',
      roundsToWin: rounds,
      width,
      height,
      players,
      revenge: false,
    },
    { send: () => {}, onEnd: (r) => { result = r; } },
  );
  match.start();
  const rng = mulberry32(7);
  let guard = 0;
  while (match.phase !== 'ended' && guard++ < 250000) {
    match.tick();
    if (guard % 5000 === 0 && rng() < 0) break;
  }
  if (!result) throw new Error(`${label} did not finish (${guard} ticks, phase ${match.phase})`);
  if (match.selfSoaks > 0) throw new Error(`${label} self-soaked ${match.selfSoaks} times`);
  return result;
}

const ffa = run(
  'ffa',
  [
    player('h1', 'hard', 'otter'),
    player('h2', 'hard', 'frog'),
    player('h3', 'medium', 'duck'),
    player('h4', 'easy', 'penguin'),
  ],
  1,
  CONFIG.FFA_W,
  CONFIG.FFA_H,
);
console.log('ffa placements', ffa.placements.map((p) => `${p.id}:${p.placement}`).join(' '));

const duel = run(
  'duel',
  [player('hard', 'hard', 'capybara'), player('easy', 'easy', 'frog')],
  1,
  CONFIG.DUEL_W,
  CONFIG.DUEL_H,
);
const winner = duel.placements.find((p) => p.placement === 1);
console.log('duel winner', winner?.id, 'wins', winner?.roundWins);
if (winner?.id !== 'hard') {
  console.error('Hard did not beat Easy', duel.placements);
  process.exit(1);
}
console.log('soak ok');
