// Headless bot-vs-bot soak test: full matches with no timers, asserting no
// crash, no stuck rounds, and sane results. Run: npm run soak
// SPLASH_DB=:memory: keeps it off the real database.

process.env.SPLASH_DB = process.env.SPLASH_DB || ":memory:";

const { migrate } = await import("./db/index.js");
const { Match } = await import("./gameLoop.js");
const { CONFIG } = await import("../../shared/src/index.js");
import type { BotDifficulty, GameMode } from "../../shared/src/index.js";

migrate();

const MAX_TICKS_PER_MATCH = 150_000; // covers a full MAX_ROUNDS match of tide-length rounds

function runMatch(mode: GameMode, difficulties: BotDifficulty[], label: string): { winner: string; ticks: number } {
  let ended = false;
  const match = new Match({
    mode,
    ranked: false,
    roundsToWin: 3,
    theme: "beach",
    seats: difficulties.map((d, i) => ({
      playerId: `bot:soak:${i}`,
      nickname: `${d}-${i}`,
      animal: "duck",
      hat: "none",
      isBot: true,
      difficulty: d,
      conn: null,
    })),
    onEnd: () => {
      ended = true;
    },
  });
  match.start();
  let ticks = 0;
  while (!ended && ticks < MAX_TICKS_PER_MATCH) {
    match.tick();
    ticks++;
  }
  if (!ended) throw new Error(`${label}: match did not finish within ${MAX_TICKS_PER_MATCH} ticks`);
  const winner = match.seats.reduce((a, b) => (b.roundsWon > a.roundsWon ? b : a));
  return { winner: winner.nickname, ticks };
}

console.log("[soak] starting bot-vs-bot soak...");
const started = Date.now();

// 1) Full 4p FFA with mixed difficulties, several matches.
for (let i = 0; i < 3; i++) {
  const r = runMatch("ffa", ["hard", "medium", "easy", "medium"], `ffa#${i}`);
  console.log(`[soak] ffa#${i}: winner=${r.winner} ticks=${r.ticks}`);
}

// 2) Duels.
for (let i = 0; i < 3; i++) {
  const r = runMatch("duel", ["hard", "medium"], `duel#${i}`);
  console.log(`[soak] duel#${i}: winner=${r.winner} ticks=${r.ticks}`);
}

// 3) Hard should reliably beat Easy in duels.
let hardWins = 0;
const HARD_VS_EASY = 10;
for (let i = 0; i < HARD_VS_EASY; i++) {
  const r = runMatch("duel", ["hard", "easy"], `hve#${i}`);
  if (r.winner.startsWith("hard")) hardWins++;
}
console.log(`[soak] hard beat easy ${hardWins}/${HARD_VS_EASY}`);
if (hardWins < HARD_VS_EASY * 0.7) {
  console.error("[soak] FAIL: hard bots are not reliably beating easy bots");
  process.exit(1);
}

console.log(`[soak] PASS in ${((Date.now() - started) / 1000).toFixed(1)}s (tick rate cfg ${CONFIG.TICK_RATE}Hz)`);
process.exit(0);
