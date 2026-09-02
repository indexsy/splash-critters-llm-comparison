// Headless bot-vs-bot soak: completes a full match with no crash/desync.
import { CONFIG, createInitialState, simulateTick, type PlayerInput } from '@splash/shared';
import { botInput } from './bots/bot.js';

async function main(): Promise<void> {
  const modes = [
    { mode: 'duel' as const, bots: 2 },
    { mode: 'ffa' as const, bots: 4 },
  ];
  for (const { mode, bots } of modes) {
    console.log(`Soak ${mode}...`);
    const metas = Array.from({ length: bots }, (_, i) => ({
      id: `soak${i}`,
      nickname: `Soak${i}`,
      animal: 'frog' as const,
      hat: 'none' as const,
    }));
    const diffs = ['easy', 'medium', 'hard', 'hard'] as const;
    const st = createInitialState(
      { mode, mapSeed: (Math.random() * 0xffffffff) >>> 0, theme: 'backyard', roundsToWin: 3, revengeDucks: true },
      metas,
    );
    // track round wins across rounds
    const scores: Record<string, number> = {};
    for (const m of metas) scores[m.id] = 0;
    let rounds = 0;
    const t0 = Date.now();
    while (rounds < 7) {
      rounds++;
      // fresh round, restore scores
      if (rounds > 1) {
        const fresh = createInitialState(
          { mode, mapSeed: (Math.random() * 0xffffffff) >>> 0, theme: 'beach', roundsToWin: 3, revengeDucks: true },
          metas,
        );
        Object.assign(st, fresh);
        for (const p of st.players) p.roundsWon = scores[p.id] ?? 0;
      }
      let ticks = 0;
      const maxTicks = CONFIG.TIDE_START_TICKS + 40 * 45 + 600;
      while (!st.roundOver && ticks < maxTicks) {
        const inputs: Record<string, PlayerInput> = {};
        for (const p of st.players) {
          if (!p.alive && !p.isDuck) {
            inputs[p.id] = { seq: ticks, tick: st.tick, dx: 0, dy: 0, balloon: false };
            continue;
          }
          const idx = metas.findIndex((m) => m.id === p.id);
          inputs[p.id] = botInput(st, p, diffs[idx % diffs.length], Math.random);
        }
        simulateTick(st, inputs);
        ticks++;
        if (ticks % 900 === 0 && st.players.filter((p) => p.alive).length > 1) {
          // force tide to guarantee termination in soak
        }
      }
      if (!st.roundOver) throw new Error(`Soak ${mode}: round ${rounds} did not finish in ${ticks} ticks`);
      const w = st.roundWinner;
      if (typeof w === 'string') scores[w]++;
      console.log(`  round ${rounds}: winner=${JSON.stringify(w)} ticks=${ticks}`);
      const champ = Object.entries(scores).find(([, v]) => v >= 3);
      if (champ) {
        console.log(`  match over: ${champ[0]} wins ${champ[1]} rounds`);
        break;
      }
    }
    console.log(`Soak ${mode} OK in ${Date.now() - t0}ms`);
  }
  console.log('SOAK PASS');
}

main().catch((e) => {
  console.error('SOAK FAIL', e);
  process.exit(1);
});
