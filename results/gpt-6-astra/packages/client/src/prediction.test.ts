import { it, expect } from "vitest";
import {
  createGame,
  simulateTick,
  type GameState,
  type Snapshot,
  type PlayerInput,
} from "@splash/shared";
import { Prediction } from "./prediction.js";
const snapshot = (s: GameState, serverTime: number): Snapshot => ({
  tick: s.tick,
  serverTime,
  roundNo: 1,
  players: s.players.map((p) => ({ ...p })),
  balloons: [...s.balloons],
  splashes: [...s.splashes],
  powerups: [...s.powerups],
  tideRing: s.tideRing,
  roundOver: s.roundOver,
  countdown: 0,
});
it("rewinds to acknowledged inputs and replays only the unacknowledged local tail", () => {
  const s = createGame({
    mode: "duel",
    seed: 5,
    players: [
      { id: "a", nickname: "A" },
      { id: "b", nickname: "B" },
    ],
  });
  const p = new Prediction();
  p.localId = "a";
  p.reset(s.width, s.height, s.tiles, 5);
  p.reconcile(snapshot(s, 1000));
  const first: PlayerInput = {
    seq: 1,
    tick: 0,
    dir: "right",
    balloonPressed: false,
  };
  const second: PlayerInput = { ...first, seq: 2, tick: 1 };
  p.predict(first);
  p.predict(second);
  simulateTick(s, { a: first });
  p.reconcile(snapshot(s, 1033));
  simulateTick(s, { a: second });
  expect(p.state!.players[0].x).toBeCloseTo(s.players[0].x);
  p.reconcile(snapshot(s, 1066));
  expect(p.state!.players[0].x).toBeCloseTo(s.players[0].x);
  expect(p.state!.hiddenPowerups).toEqual({});
});
it("interpolates remote players at server time minus 100ms", () => {
  const s = createGame({
    mode: "duel",
    seed: 5,
    players: [
      { id: "a", nickname: "A" },
      { id: "b", nickname: "B" },
    ],
  });
  const p = new Prediction();
  p.localId = "a";
  p.reset(s.width, s.height, s.tiles, 5);
  s.players[1].x = 8;
  p.reconcile(snapshot(s, 1000));
  s.players[1].x = 10;
  p.reconcile(snapshot(s, 1100));
  expect(p.renderState(1150)!.players[1].x).toBe(9);
});
