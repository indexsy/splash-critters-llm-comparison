export type GameMode = "duel" | "ffa";
export type ArenaTheme = "backyard" | "beach" | "pool";
export type Difficulty = "easy" | "medium" | "hard";
export type AnimalId =
  | "frog"
  | "duck"
  | "otter"
  | "penguin"
  | "cat"
  | "raccoon"
  | "turtle"
  | "capybara";
export type HatId = "none" | "bucket" | "snorkel" | "crown" | "bandana" | "propeller";
export type PowerupKind = "balloon" | "splash" | "flippers" | "boots";
export type Dir = "up" | "down" | "left" | "right" | "none";
export type RoundPhase = "intro" | "countdown" | "playing" | "round_end" | "match_end";
export type SoakCause = "splash" | "tide" | "revenge";

export interface Vec {
  x: number;
  y: number;
}

export interface PowerupContents {
  kind: PowerupKind;
}

export interface Arena {
  w: number;
  h: number;
  theme: ArenaTheme;
  seed: number;
  boulders: boolean[][];
  castles: number[][];
  hidden: (PowerupKind | null)[][];
  spawnTiles: Vec[];
}

export interface PlayerState {
  id: string;
  slot: number;
  name: string;
  animal: AnimalId;
  hat: HatId;
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  eliminatedTick: number | null;
  speed: number;
  balloonCount: number;
  splashRange: number;
  kickCharges: number;
  isBot: boolean;
  difficulty: Difficulty | null;
  prevBalloonPressed: boolean;
  revengeReadyTick: number;
  soakedAtX: number;
  soakedAtY: number;
}

export interface BalloonState {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  range: number;
  placedTick: number;
  burstTick: number;
  kickedDir: Dir;
  slideCooldown: number;
  source: "balloon" | "revenge";
}

export interface SplashState {
  id: number;
  ownerId: string | null;
  x: number;
  y: number;
  createdTick: number;
  endTick: number;
  kind: SoakCause;
}

export interface ExposedPowerup {
  id: number;
  x: number;
  y: number;
  kind: PowerupKind;
  revealedTick: number;
}

export interface TideState {
  active: boolean;
  ring: number;
  startTick: number;
  nextAdvanceTick: number;
}

export interface RoundState {
  tick: number;
  mode: GameMode;
  theme: ArenaTheme;
  roundNo: number;
  arena: Arena;
  players: PlayerState[];
  balloons: BalloonState[];
  splashes: SplashState[];
  powerups: ExposedPowerup[];
  tide: TideState;
  ended: boolean;
  endedTick: number | null;
  winnerId: string | null;
  draw: boolean;
  enableKick: boolean;
  enableRevengeDucks: boolean;
  nextIds: number;
}

export interface PlayerInput {
  seq: number;
  tick: number;
  dir: Dir;
  balloonPressed: boolean;
}

export interface PlayerSnapshot {
  id: string;
  slot: number;
  name: string;
  animal: AnimalId;
  hat: HatId;
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  eliminatedTick: number | null;
  speed: number;
  balloonCount: number;
  splashRange: number;
  kickCharges: number;
  isBot: boolean;
  difficulty: Difficulty | null;
  revengeReadyTick: number;
  soakedAtX: number;
  soakedAtY: number;
}

export interface RoundSnapshot {
  tick: number;
  players: PlayerSnapshot[];
  balloons: BalloonState[];
  splashes: SplashState[];
  powerups: ExposedPowerup[];
  tide: TideState;
  ended: boolean;
  winnerId: string | null;
  draw: boolean;
  acks: Record<string, number>;
}

export interface ArenaRoundStart {
  roundNo: number;
  mapSeed: number;
  castleGrid: number[][];
  boulderGrid: boolean[][];
  w: number;
  h: number;
  theme: ArenaTheme;
  spawnTiles: Vec[];
  countdownMs: number;
}

export type SimEvent =
  | { type: "castle_washed"; x: number; y: number; ownerId: string | null }
  | { type: "powerup_revealed"; powerup: ExposedPowerup }
  | { type: "powerup_collected"; playerId: string; kind: PowerupKind; x: number; y: number }
  | { type: "powerup_destroyed"; x: number; y: number; kind: PowerupKind }
  | {
      type: "player_soaked";
      playerId: string;
      byId: string | null;
      cause: SoakCause;
      x: number;
      y: number;
    }
  | { type: "chain_burst"; count: number; ownerIds: string[]; x: number; y: number }
  | {
      type: "balloon_kicked";
      balloonId: number;
      ownerId: string;
      byId: string;
      dir: Dir;
      x: number;
      y: number;
    }
  | { type: "tide_advance"; ring: number }
  | {
      type: "revenge_lob";
      playerId: string;
      x: number;
      y: number;
    }
  | { type: "round_ended"; draw: boolean; winnerId: string | null };

export interface RatingSummary {
  rating: number;
  games: number;
  wins: number;
  peak: number;
}

export interface PlayerProfile {
  id: string;
  nickname: string;
  tag: string;
  displayName: string;
  xp: number;
  level: number;
  selectedAnimal: AnimalId;
  selectedHat: HatId;
  needsNickname: boolean;
  tutorialDone: boolean;
  unlocks: string[];
  ratings: Partial<Record<GameMode, RatingSummary>>;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

export interface MatchPlayerInfo {
  id: string;
  name: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  difficulty: Difficulty | null;
  rating?: number;
  tier?: string;
  level?: number;
}

export interface MatchConfig {
  roomCode: string;
  mode: GameMode;
  ranked: boolean;
  theme: ArenaTheme;
  roundsToWin: number;
  players: MatchPlayerInfo[];
  introMs: number;
}

export interface MatchPlacement {
  playerId: string;
  name: string;
  animal: AnimalId;
  hat: HatId;
  placement: number;
  roundsWon: number;
  soaks: number;
  castles: number;
  biggestChain: number;
  survivedTicks: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  level: number | null;
}

export interface MatchAwards {
  mostSoaks: string | null;
  castleCrusher: string | null;
  longestSurvivor: string | null;
  biggestChain: string | null;
}

export interface MatchEndPayload {
  roomCode: string;
  mode: GameMode;
  ranked: boolean;
  placements: MatchPlacement[];
  ratingDeltas: Record<string, number>;
  xp: Record<string, { earned: number; total: number; level: number; levelBefore: number }>;
  awards: MatchAwards;
  rematchAllowed: boolean;
}

export interface RoundEndPayload {
  roundNo: number;
  draw: boolean;
  winnerId: string | null;
  winnerName: string | null;
  scores: Record<string, number>;
  nextRoundInMs: number;
}

export interface LobbySlotView {
  slot: number;
  kind: "empty" | "human" | "bot";
  playerId: string | null;
  name: string;
  animal: AnimalId;
  hat: HatId;
  difficulty: Difficulty | null;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbyView {
  code: string;
  name: string;
  mode: GameMode;
  size: 2 | 4;
  theme: ArenaTheme;
  roundsToWin: number;
  isPrivate: boolean;
  hostId: string | null;
  slots: LobbySlotView[];
  youAreHost: boolean;
  rematchVotes: number;
  rematchNeeded: number;
  status: "lobby" | "playing" | "match_end";
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameMode;
  size: 2 | 4;
  players: number;
  theme: ArenaTheme;
  host: string;
  status: "lobby" | "playing";
}
