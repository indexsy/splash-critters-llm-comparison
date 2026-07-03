// Headless soak test: bot-vs-bot full match with no crash/desync
import { type Mode } from "@splash/shared";
import { createRoundState, simulateTick, buildSnapshot } from "@splash/shared";
import { createBot, getBotInput } from "./bots/bot.js";

function runSoak(mode: Mode = "ffa"): { ok: boolean; ticks: number; winner: string | null; error?: string } {
  try {
    const playerDefs = [
      { id: "p1", nickname: "Bot1", animal: "frog", hat: "none", slot: 0, botDifficulty: "hard" },
      { id: "p2", nickname: "Bot2", animal: "duck", hat: "none", slot: 1, botDifficulty: "hard" },
      { id: "p3", nickname: "Bot3", animal: "otter", hat: "none", slot: 2, botDifficulty: "medium" },
      { id: "p4", nickname: "Bot4", animal: "penguin", hat: "none", slot: 3, botDifficulty: "easy" },
    ].slice(0, mode === "duel" ? 2 : 4);

    const state = createRoundState(mode, 1, 12345, "beach", playerDefs);
    const bots = playerDefs.map((p) => createBot(p.id, p.botDifficulty as any));

    let ticks = 0;
    const maxTicks = 60 * 60 * 5; // 5 minutes
    while (ticks < maxTicks && !state.ended) {
      const inputs = state.players.map((p, i) => ({
        playerId: p.id,
        ...getBotInput(state, bots[i], state.tick),
      }));
      simulateTick(state, inputs);
      ticks++;
    }

    // Verify determinism by replay
    const state2 = createRoundState(mode, 1, 12345, "beach", playerDefs);
    const bots2 = playerDefs.map((p) => createBot(p.id, p.botDifficulty as any));
    for (let t = 0; t < ticks; t++) {
      const inputs = state2.players.map((p, i) => ({
        playerId: p.id,
        ...getBotInput(state2, bots2[i], state2.tick),
      }));
      simulateTick(state2, inputs);
    }
    const snap1 = buildSnapshot(state);
    const snap2 = buildSnapshot(state2);
    if (JSON.stringify(snap1) !== JSON.stringify(snap2)) {
      return { ok: false, ticks, winner: state.winnerId, error: "desync detected" };
    }

    return { ok: true, ticks, winner: state.winnerId };
  } catch (e) {
    return { ok: false, ticks: 0, winner: null, error: String(e) };
  }
}

const duel = runSoak("duel");
const ffa = runSoak("ffa");
console.log("Duel soak:", duel);
console.log("FFA soak:", ffa);
if (!duel.ok || !ffa.ok) process.exit(1);
console.log("Soak test passed");
