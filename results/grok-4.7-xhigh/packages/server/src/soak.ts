import { botAct, createBotMemory, createGameState, hashState, simulateTick, type Player } from '@splash/shared';

function run(seed: number): { ok: boolean; ticks: number; winner: string | null; rounds: number } {
  const memories = [0, 1, 2, 3].map((i) => createBotMemory(seed + i * 17));
  const ids = ['a', 'b', 'c', 'd'];
  const diffs = ['hard', 'medium', 'easy', 'hard'] as const;
  let carry: Player[] | undefined;
  let ticks = 0;
  for (let round = 0; round < 12; round++) {
    const a = createGameState({
      mode: 'ffa',
      seed: seed + round * 99,
      theme: 'backyard',
      revenge: false,
      roundsToWin: 2,
      players: ids.map((id, i) => ({
        id,
        name: id,
        slot: i,
        animal: 'frog',
        hat: null,
        isBot: true,
        difficulty: diffs[i],
      })),
      carry,
    });
    const b = structuredClone(a);
    let guard = 0;
    while (!a.over && guard++ < 9000) {
      const inputs: Record<string, ReturnType<typeof botAct>> = {};
      ids.forEach((id, i) => {
        const inp = botAct(a, id, memories[i]);
        inp.seq = ticks + 1;
        inputs[id] = inp;
      });
      simulateTick(a, inputs);
      simulateTick(b, inputs);
      if (hashState(a) !== hashState(b)) {
        throw new Error(`desync at tick ${a.tick}`);
      }
      ticks++;
    }
    if (!a.over) return { ok: false, ticks, winner: null, rounds: round };
    if (a.winnerId) {
      const w = a.players.find((p) => p.id === a.winnerId);
      if (w) w.roundWins += 1;
    }
    carry = a.players;
    if (a.players.some((p) => p.roundWins >= 2)) {
      return { ok: true, ticks, winner: a.players.find((p) => p.roundWins >= 2)?.id ?? null, rounds: round + 1 };
    }
  }
  return { ok: true, ticks, winner: carry?.slice().sort((x, y) => y.roundWins - x.roundWins)[0]?.id ?? null, rounds: 12 };
}

const result = run(42);
if (!result.ok) {
  console.error('soak failed', result);
  process.exit(1);
}
console.log(`soak ok winner=${result.winner} rounds=${result.rounds} ticks=${result.ticks}`);
