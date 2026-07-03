// types.ts — pure data types shared by server (authority) and client (prediction).

export type Dir = 0 | 1 | 2 | 3; // 0=up 1=right 2=down 3=left
export const DIR_DX = [0, 1, 0, -1];
export const DIR_DY = [-1, 0, 1, 0];

export type TileKind = 0 | 1 | 2; // 0=empty, 1=boulder (indestructible), 2=sandcastle

export type PowerUpKind = "extraBalloon" | "bigSplash" | "flippers" | "rubberBoots";

export interface Input {
  seq: number;
  tick: number;
  dir: Dir | -1; // -1 = no movement
  balloonPressed: boolean;
}

export interface Balloon {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  fuse: number; // ticks remaining
  range: number; // splash range (owner's at drop time)
  sliding?: Dir | -1; // -1 or undefined = not sliding; kicked balloons slide
  spawnedTick: number;
}

export interface Splash {
  id: number;
  cx: number;
  cy: number;
  up: number; // remaining tiles in each direction
  down: number;
  left: number;
  right: number;
  linger: number;
  ownerId: number;
}

export interface Player {
  id: number; // 0..3 slot index in match
  entityId: number;
  x: number; // tile coords (float, for sub-tile movement)
  y: number;
  dir: Dir;
  moving: boolean;
  alive: boolean;
  soaks: number;
  roundsWon: number;

  // upgradeable stats
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasKick: boolean;

  // balloon accounting
  liveBalloons: number;

  // animation
  animTime: number;

  // revenge-duck mode (eliminated)
  revenge: boolean;
  revengeX: number;
  revengeY: number;
  revengeCooldown: number;

  // input queue (server side; client only stores own)
  lastAppliedSeq: number;
}

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface MatchState {
  tick: number;
  width: number;
  height: number;
  tiles: Uint8Array; // TileKind, row-major width*height
  /** power-up hidden inside castle at tile index, or "" if none. Length = width*height. */
  hiddenPowerUps: (PowerUpKind | "")[]; // index by tile = y*width+x
  balloons: Map<number, Balloon>;
  splashes: Map<number, Splash>;
  players: Player[];
  exposedPowerUps: Map<number, PowerUp>;
  tideRing: number; // current flooding ring radius (0 = none)
  tideActive: boolean;
  nextEntityId: number;
  events: GameEvent[];
  roundOver: boolean;
  // transient input buffers per slot
  pendingInputs: Map<number, Input[]>;
}

export type GameEvent =
  | { type: "castle_washed"; x: number; y: number }
  | { type: "powerup_revealed"; x: number; y: number; kind: PowerUpKind }
  | { type: "powerup_collected"; playerId: number; kind: PowerUpKind; x: number; y: number }
  | { type: "player_soaked"; playerId: number; byPlayerId: number }
  | { type: "chain_burst"; chainSize: number; x: number; y: number }
  | { type: "balloon_kicked"; id: number; dir: Dir }
  | { type: "tide_advance"; ring: number }
  | { type: "revenge_lob"; playerId: number; x: number; y: number };

export interface SnapshotPlayer {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  alive: boolean;
  revenge: boolean;
  revengeX: number;
  revengeY: number;
  soaks: number;
  roundsWon: number;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasKick: boolean;
  animTime: number;
}
export interface SnapshotBalloon {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  fuse: number;
  range: number;
  sliding: Dir | -1;
}
export interface SnapshotSplash {
  id: number;
  cx: number;
  cy: number;
  up: number;
  down: number;
  left: number;
  right: number;
  ownerId: number;
}
export interface Snapshot {
  tick: number;
  players: SnapshotPlayer[];
  balloons: SnapshotBalloon[];
  splashes: SnapshotSplash[];
  exposedPowerUps: { id: number; kind: PowerUpKind; x: number; y: number }[];
  tideRing: number;
  tideActive: boolean;
  events: GameEvent[];
}
