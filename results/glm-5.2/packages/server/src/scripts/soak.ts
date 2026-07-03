// soak.ts — headless bot-vs-bot full match (spec §1, §13).
// Runs a complete 4-player match with mixed-difficulty bots, no crash/desync.
// Usage: npm run soak  (after build)
import { newMatchState, simulateTick, TICK_MS, type Input, type MatchState } from "@splash/shared";
import { newBot, botInput } from "../bots/bot.js";

function run(): { ok: boolean; ticks: number; winner: number; reason: string } {
  const { state } = newMatchState(42, "ffa", 4);
  const bots = state.players.map((p) => newBot(p.id, (["easy", "medium", "hard", "hard"] as const)[p.id]));
  const roundsToWin = 3;
  let totalTicks = 0;
  const maxTicks = 200 * 30 * 5; // hard cap ~5 full rounds of sudden death

  for (let round = 1; round <= 10; round++) {
    const roundState = newMatchState(42 + round * 1000, "ffa", 4).state;
    // carry round wins
    roundState.players.forEach((p, i) => (p.roundsWon = state.players[i].roundsWon));
    const rBots = state.players.map((p) => bots[p.id]);
    let roundTicks = 0;
    while (!roundState.roundOver && roundTicks < maxTicks) {
      const inputs = new Map<number, Input[]>();
      for (const p of roundState.players) {
        if (!p.alive && !p.revenge) continue;
        const bi = botInput(roundState, rBots[p.id]);
        if (bi) inputs.set(p.id, [bi]);
      }
      simulateTick(roundState, inputs);
      roundTicks++;
      totalTicks++;
    }
    // commit round wins back to outer state
    roundState.players.forEach((p, i) => (state.players[i].roundsWon = p.roundsWon));
    const winner = state.players.findIndex((p) => p.roundsWon >= roundsToWin);
    if (winner >= 0) {
      return { ok: true, ticks: totalTicks, winner, reason: `player ${winner} reached ${roundsToWin} round wins` };
    }
  }
  return { ok: false, ticks: totalTicks, winner: -1, reason: "no winner after 10 rounds (timeout)" };
}

const result = run();
console.log("[soak] result:", result);
if (result.ok) {
  console.log("[soak] PASS — full bot match completed with no crash");
  process.exit(0);
} else {
  console.log("[soak] FAIL —", result.reason);
  process.exit(1);
}
