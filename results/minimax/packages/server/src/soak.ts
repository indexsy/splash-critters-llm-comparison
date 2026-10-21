/**
 * Headless soak test: plays complete bot versus bot matches on the real
 * server simulation and verifies that nothing explodes and that the world
 * stays consistent.
 *
 *   npm run soak            # three free-for-all matches
 *   npm run soak -- 10      # ten matches
 */
import { CONFIG } from '@splash-critters/shared';
import type { Placement } from '@splash-critters/shared';
import { GameLoop } from './gameLoop.js';
import { Room } from './rooms.js';

const MATCH_COUNT = Number(process.argv[2] ?? 3);
const MODE = (process.argv[3] ?? 'ffa') as 'duel' | 'ffa';
const DIFFICULTIES = (process.argv[4] ?? 'hard,easy').split(',') as ('easy' | 'medium' | 'hard')[];

const keepAlive = setInterval(() => {}, 1000);
const winners = new Map<string, number>();

function checkInvariants(room: Room, label: string): void {
  const state = room.state;
  if (!state) return;
  for (const p of state.players) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error(`${label}: player ${p.id} has a broken position`);
    }
    if (p.x < 0 || p.y < 0 || p.x >= state.arena.width || p.y >= state.arena.height) {
      throw new Error(`${label}: player ${p.id} left the arena`);
    }
    if (p.balloonCount < 1 || p.balloonCount > CONFIG.BALLOON_COUNT_CAP) {
      throw new Error(`${label}: player ${p.id} has an invalid balloon count`);
    }
    if (p.splashRange < CONFIG.SPLASH_RANGE_BASE || p.splashRange > CONFIG.SPLASH_RANGE_CAP) {
      throw new Error(`${label}: player ${p.id} has an invalid splash range`);
    }
  }
  for (const b of state.balloons) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      throw new Error(`${label}: balloon has a broken position`);
    }
    if (b.fuse < 0) throw new Error(`${label}: balloon fuse went negative`);
  }
  const seen = new Set<string>();
  for (const b of state.balloons) {
    const key = `${b.x},${b.y}`;
    if (seen.has(key)) throw new Error(`${label}: two balloons share a tile`);
    seen.add(key);
  }
}

async function runMatch(index: number): Promise<Placement[]> {
  const maxPlayers = MODE === 'duel' ? 2 : 4;
  let finished: Placement[] = [];
  const room = new Room(
    {
      name: `soak-${index}`,
      maxPlayers,
      isPublic: false,
      theme: 'random',
      roundsToWin: 3,
      botFill: true,
      ranked: false,
      mode: MODE,
    },
    `SOAK${index}`,
    {
      onMatchEnd: (_room, standings) => {
        finished = standings.map((s, i) => ({
          slot: s.slotIndex,
          playerId: s.playerId,
          nickname: s.nickname,
          tag: s.tag,
          placement: i + 1,
          roundWins: s.roundWins,
          soaks: s.soaks,
          castlesWashed: s.castlesWashed,
          biggestChain: s.biggestChain,
          survivedTicks: s.survivedTicks,
        }));
        return { placements: finished, ratingDeltas: [], xp: [], stats: {} };
      },
    },
  );
  // fill the slots with the requested difficulties
  room.slots.forEach((slot, index) => {
    const difficulty = DIFFICULTIES[index % DIFFICULTIES.length];
    room.setSlot(index, 'bot', difficulty);
  });
  if (!room.startMatch()) throw new Error('could not start the soak match');

  const loop = new GameLoop();
  loop.add(room);
  loop.start();

  const started = Date.now();
  const limit = 900000;
  let ticks = 0;
  while (room.phase !== 'matchEnd' && Date.now() - started < limit) {
    await new Promise((resolve) => setTimeout(resolve, 16));
    ticks += 1;
    if (ticks % 10 === 0) checkInvariants(room, `match ${index}`);
    if (ticks % 300 === 0) {
      const st = room.state;
      console.log(
        `  [soak] phase=${room.phase} round=${st?.roundNo} tick=${st?.tick} alive=${st?.players.map((p) => (p.alive ? 1 : 0)).join('')}`,
      );
    }
  }
  loop.stop();
  if (room.phase !== 'matchEnd') {
    throw new Error(`match ${index} did not finish within ${limit}ms`);
  }
  return finished;
}

async function main(): Promise<void> {
  console.log(`[soak] running ${MATCH_COUNT} ${MODE} matches (${DIFFICULTIES.join(' vs ')})`);
  for (let i = 0; i < MATCH_COUNT; i++) {
    const started = Date.now();
    const results = await runMatch(i);
    const summary = results
      .map((r) => `#${r.placement} ${r.nickname} wins=${r.roundWins} soaks=${r.soaks} castles=${r.castlesWashed} chain=${r.biggestChain}`)
      .join(' | ');
    console.log(`[soak] match ${i + 1} finished in ${Date.now() - started}ms -> ${summary}`);
    const winner = results.find((r) => r.placement === 1);
    if (winner) winners.set(winner.nickname, (winners.get(winner.nickname) ?? 0) + 1);
  }
  if (winners.size > 0) {
    const summary = [...winners.entries()].map(([name, wins]) => `${name}: ${wins}`).join(', ');
    console.log(`[soak] wins per player -> ${summary}`);
  }
  console.log('[soak] all matches completed without a crash or desync');
  clearInterval(keepAlive);
  process.exit(0);
}

main().catch((err) => {
  console.error('[soak] FAILED', err);
  clearInterval(keepAlive);
  process.exit(1);
});
