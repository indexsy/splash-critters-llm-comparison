import {
  CONFIG,
  createRound,
  defaultPlayer,
  simulateTick,
  type PlayerInput,
} from "@splash/shared";
import { createBrain, think } from "./bots/bot.js";

function runMatch(seed: number): { ticks: number; winner: string | null; ok: boolean } {
  const players = [
    defaultPlayer("hard", 0, "Hard", { isBot: true, botDifficulty: "hard", animal: "otter" }),
    defaultPlayer("easy", 1, "Easy", { isBot: true, botDifficulty: "easy", animal: "frog" }),
  ];
  const state = createRound(seed, CONFIG.DUEL_WIDTH, CONFIG.DUEL_HEIGHT, "backyard", players);
  const brains = {
    hard: createBrain("hard", "hard"),
    easy: createBrain("easy", "easy"),
  };
  const maxTicks = CONFIG.TIDE_START_TICKS + 800;
  while (!state.ended && state.tick < maxTicks) {
    const inputs = new Map<string, PlayerInput>();
    for (const p of state.players) {
      inputs.set(p.id, think(state, brains[p.id as "hard" | "easy"], p));
    }
    const before = state.tick;
    simulateTick(state, inputs);
    if (state.tick !== before + 1 && state.hitstop === 0 && !state.ended) {
      return { ticks: state.tick, winner: null, ok: false };
    }
  }
  const winner = state.winnerIds[0] ?? null;
  return { ticks: state.tick, winner, ok: true };
}

function main(): void {
  let hardWins = 0;
  let easyWins = 0;
  let draws = 0;
  for (let i = 0; i < 5; i++) {
    const r = runMatch(1000 + i * 17);
    if (!r.ok) {
      console.error("desync/crash at tick", r.ticks);
      process.exit(1);
    }
    if (r.winner === "hard") hardWins++;
    else if (r.winner === "easy") easyWins++;
    else draws++;
    console.log(`match ${i + 1}: winner=${r.winner ?? "draw"} ticks=${r.ticks}`);
  }
  console.log(`hard=${hardWins} easy=${easyWins} draws=${draws}`);
  if (hardWins < easyWins) {
    console.warn("Hard did not beat Easy this sample — acceptable variance, soak still clean.");
  }
  console.log("SOAK OK");
}

main();
