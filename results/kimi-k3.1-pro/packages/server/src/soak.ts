import { CONFIG, createGameState, simulateTick, snapshotState } from "@splash/shared";
import type { BotDifficulty, GameMode, GameState, PlayerDescriptor, PlayerInput } from "@splash/shared";
import { BotBrain } from "./bots/bot.js";
import { buildDangerMap } from "./bots/dangerMap.js";

function runMatch(seed: number, mode: GameMode, difficulties: BotDifficulty[]): GameState {
  const descriptors: PlayerDescriptor[] = difficulties.map((difficulty, index) => ({
    id: `bot-${index}`,
    nickname: `${difficulty}-${index}`,
    animal: "frog",
    hat: "none",
    bot: true,
    difficulty
  }));
  const config = { mode, ranked: false, roundsToWin: 3, theme: "backyard" as const, revengeDucks: true, kick: true, tutorial: false };
  const first = createGameState(seed, config, descriptors);
  const second = createGameState(seed, config, descriptors);
  const firstBrains = descriptors.map((player) => new BotBrain(player.id, player.difficulty ?? "medium", seed));
  const secondBrains = descriptors.map((player) => new BotBrain(player.id, player.difficulty ?? "medium", seed));
  let ticks = 0;
  while (first.phase !== "match_end" && ticks < 100000) {
    const danger = first.phase === "playing" ? buildDangerMap(first) : null;
    const inputs: Record<string, PlayerInput> = {};
    descriptors.forEach((player, index) => {
      inputs[player.id] = danger ? firstBrains[index].input(first, danger) : { seq: ticks + 1, dir: "none", balloonPressed: false };
    });
    const secondDanger = second.phase === "playing" ? buildDangerMap(second) : null;
    const secondInputs: Record<string, PlayerInput> = {};
    descriptors.forEach((player, index) => {
      secondInputs[player.id] = secondDanger ? secondBrains[index].input(second, secondDanger) : { seq: ticks + 1, dir: "none", balloonPressed: false };
    });
    if (JSON.stringify(inputs) !== JSON.stringify(secondInputs)) throw new Error(`Bot input desync at tick ${ticks}`);
    const firstEvents = simulateTick(first, inputs);
    if (process.env.BOT_TRACE && seed === 9101 && first.round === 1) {
      if (first.tick % 30 === 0) console.log(JSON.stringify({ tick: first.tick, players: first.players.map((player) => ({ id: player.id, x: player.x, y: player.y, dir: player.dir, alive: player.alive })), balloons: first.balloons.map((balloon) => ({ x: balloon.x, y: balloon.y, fuse: balloon.fuse })), inputs }));
      for (const event of firstEvents) if (event.type === "balloon_dropped" || event.type === "player_soaked") console.log(JSON.stringify(event));
    }
    if (process.env.BOT_DEBUG) {
      for (const event of firstEvents) {
        if (event.type === "player_soaked") {
          const player = first.players.find((candidate) => candidate.id === event.playerId);
          console.log(JSON.stringify({ seed, tick: first.tick, event, difficulty: player?.difficulty, balloons: first.balloons.length }));
        }
      }
    }
    const secondEvents = simulateTick(second, secondInputs);
    if (JSON.stringify(firstEvents) !== JSON.stringify(secondEvents)) throw new Error(`Event desync at tick ${ticks}`);
    if (ticks % CONFIG.TICK_RATE === 0 && JSON.stringify(snapshotState(first)) !== JSON.stringify(snapshotState(second))) throw new Error(`Snapshot desync at tick ${ticks}`);
    ticks += 1;
  }
  if (first.phase !== "match_end") throw new Error(`Match did not finish: ${JSON.stringify({ seed, ticks, round: first.round, phase: first.phase, scores: first.players.map((player) => player.roundsWon), alive: first.players.filter((player) => player.alive).length })}`);
  if (JSON.stringify(snapshotState(first)) !== JSON.stringify(snapshotState(second))) throw new Error("Final state desync");
  if (first.map.hiddenPowerups.length !== second.map.hiddenPowerups.length) throw new Error("Hidden state desync");
  return first;
}

const arena = runMatch(20260301, "ffa", ["easy", "easy", "medium", "hard"]);
let hardWins = 0;
const duelStats: Record<string, number>[] = [];
const duels = 8;
for (let index = 0; index < duels; index += 1) {
  const result = runMatch(9100 + index, "duel", ["hard", "easy"]);
  if (result.players[0].roundsWon > result.players[1].roundsWon) hardWins += 1;
  duelStats.push({ seed: 9100 + index, ticks: result.tick, hardWins: result.players[0].roundsWon, easyWins: result.players[1].roundsWon, hardSoaks: result.players[0].soaks, easySoaks: result.players[1].soaks, hardCastles: result.players[0].castlesWashed, easyCastles: result.players[1].castlesWashed });
}
if (hardWins < Math.ceil(duels * 0.75)) throw new Error(`Hard bots won only ${hardWins}/${duels} duels`);
console.log(JSON.stringify({
  ok: true,
  arenaTicks: arena.tick,
  arenaScores: Object.fromEntries(arena.players.map((player) => [player.nickname, player.roundsWon])),
  hardDuelWins: hardWins,
  duels,
  ...(process.env.BOT_DEBUG ? { duelStats } : {})
}, null, 2));
