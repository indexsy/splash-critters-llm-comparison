// index.ts — barrel for @splash/shared
export * from "./config.js";
export * from "./types.js";
export * from "./rng.js";
export * from "./map.js";
export * from "./sim.js";
export * from "./elo.js";
export * from "./protocol.js";

// state factory (used by server & tests)
import { generateMap, type GeneratedMap } from "./map.js";
import { newPlayer } from "./sim.js";
import type { GameMode } from "./config.js";
import type { MatchState } from "./types.js";

export function newMatchState(seed: number, mode: GameMode, numPlayers: number): { state: MatchState; map: GeneratedMap } {
  const map = generateMap(seed, mode);
  const spawns = map.spawns.slice(0, numPlayers);
  const state: MatchState = {
    tick: 0,
    width: map.width,
    height: map.height,
    tiles: new Uint8Array(map.tiles),
    hiddenPowerUps: [...map.hiddenPowerUps],
    balloons: new Map(),
    splashes: new Map(),
    players: spawns.map((s, i) => newPlayer(i, s.x, s.y)),
    exposedPowerUps: new Map(),
    tideRing: 0,
    tideActive: false,
    nextEntityId: 1,
    events: [],
    roundOver: false,
    pendingInputs: new Map(),
  };
  return { state, map };
}
