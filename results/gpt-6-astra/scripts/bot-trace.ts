import {
  createGame,
  simulateTick,
  type Mode,
} from "../packages/shared/src/index.js";
import { BotController } from "../packages/server/src/bots/bot.js";
import {
  buildDangerMap,
  escapePath,
} from "../packages/server/src/bots/dangerMap.js";
const mode = (process.argv[2] ?? "ffa") as Mode;
const round = Number(process.argv[3] ?? 2);
const target = Number(process.argv[4] ?? 2);
const players = Array.from({ length: mode === "duel" ? 2 : 4 }, (_, i) => ({
  id: `bot-${i}`,
  nickname: `Bot ${i}`,
}));
const state = createGame({
  mode,
  seed: 754 + round * 73,
  lootSeed: 859 + round,
  players,
  revengeEnabled: false,
});
const bots = players.map(
  (p, i) => new BotController(p.id, i % 2 ? "easy" : "hard", 31 + i + round),
);
const history: {
  tick: number;
  xy: string;
  input: string;
  path: string;
  balloons: string;
  others: string;
}[] = [];
while (!state.roundOver && state.tick < 4000) {
  const inputs = Object.fromEntries(
    bots.map((b) => [b.id, b.nextInput(state)]),
  );
  const p = state.players[target];
  const input = inputs[p.id];
  if (state.tick % 5 === 0 || input.balloonPressed) {
    history.push({
      tick: state.tick,
      xy: `${p.x.toFixed(2)},${p.y.toFixed(2)}`,
      input: `${input.dir}${input.balloonPressed ? " DROP" : ""}`,
      path: String(escapePath(state, p.id, buildDangerMap(state))),
      balloons: state.balloons
        .map((b) => `${b.ownerId}:(${b.x},${b.y})@${b.burstTick}`)
        .join(" "),
      others: state.players
        .filter((o) => o.id !== p.id)
        .map((o) => `${o.slot}:(${o.x.toFixed(1)},${o.y.toFixed(1)})`)
        .join(" "),
    });
    if (history.length > 35) history.shift();
  }
  simulateTick(state, inputs);
  if (
    state.events.some((e) => e.type === "player_soaked" && e.playerId === p.id)
  ) {
    console.table(history);
    console.log(state.events);
  }
}
