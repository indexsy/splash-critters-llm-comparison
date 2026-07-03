import type { GameMode, PowerupType } from "./config.js";

// --- Tiles ---
export const TILE = { EMPTY: 0, BOULDER: 1, CASTLE: 2 } as const;
export type Tile = (typeof TILE)[keyof typeof TILE];

// --- Directions: 0 none, 1 up, 2 right, 3 down, 4 left ---
export type Dir = 0 | 1 | 2 | 3 | 4;
export const DIR_VECS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface PlayerInput {
  seq: number;
  tick: number;
  dir: Dir;
  balloon: boolean; // drop button held this tick
}

export interface SimPlayer {
  id: string; // account id or bot id — stable within a match
  slot: number; // 0..3
  x: number; // tile-space coords; tile (tx,ty) spans [tx,tx+1)
  y: number;
  dir: Dir; // facing, for rendering
  moving: boolean;
  alive: boolean;
  soakedTick: number; // -1 while dry
  speed: number; // tiles/sec
  balloonCount: number;
  splashRange: number;
  hasKick: boolean;
  bootsCollected: boolean; // Rubber Boots is once per player per round
  balloonsActive: number;
  dropHeld: boolean; // edge-detect the drop button
  // Revenge duck state (casual only) — null while dry/absent
  duck: { pos: number; cooldownEndTick: number; lobHeld: boolean } | null;
  // Per-round stats, rolled up into match stats by the server
  soaks: number;
  revengeSoaks: number;
  castles: number;
}

export interface SimBalloon {
  id: number;
  ownerSlot: number; // -1 for revenge lobs
  x: number; // tile coords
  y: number;
  burstTick: number;
  range: number;
  placedTick: number;
  ownerCanPass: boolean; // owner may walk off the tile they dropped on
  slide: { dir: Dir; progress: number } | null; // kicked balloon in motion
  revenge: boolean;
}

export interface SimSplash {
  x: number;
  y: number;
  endTick: number;
  ownerSlot: number; // credited with soaks on this tile
  revenge: boolean;
}

export interface SimPowerup {
  x: number;
  y: number;
  type: PowerupType;
}

export interface SimState {
  mode: GameMode;
  w: number;
  h: number;
  tick: number;
  grid: number[]; // Tile values, index = y*w + x
  /**
   * Hidden castle contents, pre-rolled at map generation with the round's
   * seeded PRNG. SERVER-SECRET: never serialized to clients until a castle
   * is washed away. Client-side mirrors carry null everywhere.
   */
  contents: (PowerupType | null)[];
  players: SimPlayer[];
  balloons: SimBalloon[];
  splashes: SimSplash[];
  powerups: SimPowerup[];
  tideRing: number; // 0 = no flooding yet
  tideNextTick: number;
  nextBalloonId: number;
  rules: SimRules;
  roundOver: boolean;
  winnerSlot: number | null; // null while running, -1 for a draw round
}

export interface SimRules {
  enableKick: boolean;
  revengeDucks: boolean;
}

// --- Events emitted by simulateTick, broadcast by the server ---
export type SimEvent =
  | { t: "balloon_placed"; slot: number; x: number; y: number }
  | { t: "balloon_burst"; x: number; y: number }
  | { t: "castle_washed"; x: number; y: number; bySlot: number }
  | { t: "powerup_revealed"; x: number; y: number; type: PowerupType }
  | { t: "powerup_collected"; slot: number; type: PowerupType; x: number; y: number }
  | { t: "powerup_destroyed"; x: number; y: number }
  | { t: "player_soaked"; slot: number; bySlot: number; revenge: boolean }
  | { t: "chain_burst"; size: number; slot: number }
  | { t: "balloon_kicked"; id: number; dir: Dir; slot: number }
  | { t: "tide_advance"; ring: number }
  | { t: "revenge_lob"; slot: number; x: number; y: number }
  | { t: "round_over"; winnerSlot: number };

// --- Helpers shared by sim, bots, and client prediction ---
export function idx(state: { w: number }, x: number, y: number): number {
  return y * state.w + x;
}

export function tileAt(state: SimState, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return TILE.BOULDER;
  return state.grid[y * state.w + x];
}

/** Distance from the arena border (0 on the border ring). */
export function ringDistance(state: { w: number; h: number }, x: number, y: number): number {
  return Math.min(x, y, state.w - 1 - x, state.h - 1 - y);
}

export function isFlooded(state: SimState, x: number, y: number): boolean {
  return state.tideRing > 0 && ringDistance(state, x, y) < state.tideRing;
}

export function balloonAt(state: SimState, x: number, y: number): SimBalloon | undefined {
  return state.balloons.find((b) => b.x === x && b.y === y);
}

/** Tile the player's center is in. */
export function playerTile(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/** Perimeter path length for revenge ducks (the border ring). */
export function perimeterLength(state: { w: number; h: number }): number {
  return 2 * (state.w + state.h) - 4;
}

/** Map a perimeter path position (0..len) to a border tile. */
export function perimeterTile(
  state: { w: number; h: number },
  pos: number
): { x: number; y: number; inwardDir: Dir } {
  const len = perimeterLength(state);
  let p = ((Math.floor(pos) % len) + len) % len;
  const { w, h } = state;
  if (p < w) return { x: p, y: 0, inwardDir: 3 }; // top edge, faces down
  p -= w;
  if (p < h - 1) return { x: w - 1, y: p + 1, inwardDir: 4 }; // right edge, faces left
  p -= h - 1;
  if (p < w - 1) return { x: w - 2 - p, y: h - 1, inwardDir: 1 }; // bottom edge, faces up
  p -= w - 1;
  return { x: 0, y: h - 2 - p, inwardDir: 2 }; // left edge, faces right
}

/** Nearest perimeter path position to a tile (for placing a fresh duck rider). */
export function nearestPerimeterPos(state: { w: number; h: number }, x: number, y: number): number {
  const len = perimeterLength(state);
  let best = 0;
  let bestDist = Infinity;
  for (let p = 0; p < len; p++) {
    const t = perimeterTile(state, p);
    const d = Math.abs(t.x - x) + Math.abs(t.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
