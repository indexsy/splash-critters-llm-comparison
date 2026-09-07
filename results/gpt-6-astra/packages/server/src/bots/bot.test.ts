import { it, expect } from "vitest";
import { createGame, simulateTick, Tile, type Balloon } from "@splash/shared";
import { BotController } from "./bot.js";
import { buildDangerMap } from "./dangerMap.js";
const balloon = (
  id: number,
  x: number,
  y: number,
  burstTick: number,
  range: number,
): Balloon => ({
  id,
  x,
  y,
  burstTick,
  range,
  ownerId: "a",
  placedTick: 0,
  passThrough: [],
  slideDir: "none",
  nextSlideTick: 0,
  revenge: false,
});
it("forecasts a later splash through a castle washed by an earlier burst", () => {
  const s = createGame({
    mode: "duel",
    seed: 4,
    players: [
      { id: "a", nickname: "A" },
      { id: "b", nickname: "B" },
    ],
  });
  s.tiles = s.tiles.map((t) => (t === Tile.Castle ? Tile.Floor : t));
  s.hiddenPowerups = {};
  s.tiles[3 * s.width + 5] = Tile.Castle;
  s.balloons = [balloon(1, 3, 3, 10, 2), balloon(2, 7, 3, 30, 3)];
  const danger = buildDangerMap(s);
  expect(danger[3 * s.width + 4].some((w) => w.start === 30)).toBe(true);
  expect(s.tiles[3 * s.width + 5]).toBe(Tile.Castle);
});
it("does not reverse a valid escape halfway across a tile as a fuse gets shorter", () => {
  const s = createGame({
    mode: "ffa",
    seed: 4,
    players: [
      { id: "a", nickname: "A" },
      { id: "b", nickname: "B" },
    ],
  });
  s.tiles = s.tiles.map((t) => (t === Tile.Castle ? Tile.Floor : t));
  s.hiddenPowerups = {};
  Object.assign(s.players[0], { x: 10.42, y: 11.5, speed: 4.4 });
  Object.assign(s.players[1], { x: 1.5, y: 1.5 });
  s.balloons = [balloon(1, 13, 11, 22, 3), balloon(2, 9, 11, 84, 3)];
  const bot = new BotController("a", "hard", 5);
  for (let i = 0; i < 40; i++) simulateTick(s, { a: bot.nextInput(s) });
  expect(s.players[0].alive).toBe(true);
});
