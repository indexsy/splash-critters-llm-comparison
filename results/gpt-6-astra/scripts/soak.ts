import assert from "node:assert/strict";
import {
  createGame,
  cloneState,
  simulateTick,
  type PlayerInput,
  type Mode,
} from "../packages/shared/src/index.js";
import { BotController } from "../packages/server/src/bots/bot.js";

const started = performance.now();
let totalTicks = 0;
let selfSoaks = 0;
let hardWins = 0;
let easyWins = 0;
for (const mode of ["duel", "ffa"] as Mode[]) {
  const players = Array.from({ length: mode === "duel" ? 2 : 4 }, (_, i) => ({
    id: `bot-${i}`,
    nickname: `Bot ${i}`,
  }));
  const scores = players.map(() => 0);
  let round = 0;
  while (Math.max(...scores) < 3 && round < 30) {
    const state = createGame({
      mode,
      seed: 754 + round * 73,
      lootSeed: 859 + round,
      players,
      revengeEnabled: false,
    });
    const replay = cloneState(state);
    const bots = players.map(
      (p, i) =>
        new BotController(p.id, i % 2 ? "easy" : "hard", 31 + i + round),
    );
    while (!state.roundOver && state.tick < 4000) {
      const inputs: Record<string, PlayerInput> = Object.fromEntries(
        bots.map((b) => [b.id, b.nextInput(state)]),
      );
      simulateTick(state, inputs);
      simulateTick(replay, inputs);
      totalTicks++;
      if (state.tick % 60 === 0 || state.roundOver)
        assert.deepEqual(state, replay, "Deterministic replay diverged");
      for (const e of state.events)
        if (e.type === "player_soaked" && e.playerId === e.byId) {
          selfSoaks++;
          console.log("Self soak diagnostic:", {
            mode,
            round,
            tick: state.tick,
            event: e,
          });
        }
      assert(
        state.players.every(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
      );
    }
    assert(state.roundOver, "Round did not finish");
    if (state.winnerId) {
      const winner = players.findIndex((p) => p.id === state.winnerId);
      scores[winner]++;
      if (winner % 2) easyWins++;
      else hardWins++;
    }
    round++;
  }
  assert(Math.max(...scores) >= 3, "Match did not reach first-to-three");
  console.log(
    `${mode}: complete in ${round} rounds, scores ${scores.join(":")}`,
  );
}
console.log({
  totalTicks,
  selfSoaks,
  hardWins,
  easyWins,
  durationSeconds: ((performance.now() - started) / 1000).toFixed(2),
});
assert.equal(selfSoaks, 0, "Bots soaked themselves");
assert(hardWins > easyWins, "Hard should outperform Easy in seeded fixtures");
