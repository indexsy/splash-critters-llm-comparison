export type PlayerId = string;
export type RoomCode = string;
export type MatchId = string;

export type Tile = 'empty' | 'boulder' | 'sandcastle' | 'powerup' | 'water';
export type TilePos = { x: number; y: number };

export type PowerUpType = 'extraBalloon' | 'bigSplash' | 'flippers' | 'rubberBoots';

export type Animal =
  | 'frog'
  | 'duck'
  | 'otter'
  | 'penguin'
  | 'cat'
  | 'raccoon'
  | 'turtle'
  | 'capybara';

export type Hat = 'none' | 'bucket' | 'snorkel' | 'crown' | 'pirate' | 'propeller';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type GameMode = 'duel' | 'ffa';

export type GameConfig = {
  mode: GameMode;
  roundsToWin: number;
  mapTheme?: 'backyard' | 'beach' | 'pool' | 'random';
  enableKick: boolean;
  enableRevengeDucks: boolean;
  botFill: boolean;
};

export type InputFrame = {
  dir: Direction | null;
  balloonPressed: boolean;
  emoteId?: number;
};

export type Balloon = {
  id: string;
  x: number;
  y: number;
  fuseTicks: number;
  ownerId: PlayerId;
  solid: boolean;
  isKicked: boolean;
  kickDir: Direction | null;
  splashRange: number;
};

export type Splash = {
  x: number;
  y: number;
  ticksRemaining: number;
  ownerId: PlayerId;
};

export type SimEvent =
  | { type: 'castle_washed'; x: number; y: number }
  | { type: 'powerup_revealed'; x: number; y: number; powerUp: PowerUpType }
  | {
      type: 'powerup_collected';
      playerId: PlayerId;
      x: number;
      y: number;
      powerUp: PowerUpType;
    }
  | { type: 'powerup_destroyed'; x: number; y: number; powerUp: PowerUpType }
  | {
      type: 'player_soaked';
      playerId: PlayerId;
      soakedBy: PlayerId | null;
      x: number;
      y: number;
    }
  | { type: 'chain_burst'; chainCount: number }
  | {
      type: 'balloon_kicked';
      balloonId: string;
      x: number;
      y: number;
      dir: Direction;
    }
  | { type: 'tide_advance'; ring: number }
  | {
      type: 'revenge_lob';
      playerId: PlayerId;
      x: number;
      y: number;
      dir: Direction;
    };

export type PlayerState = {
  playerId: PlayerId;
  nickname: string;
  animal: Animal;
  x: number;
  y: number;
  alive: boolean;
  direction: Direction | null;
  speed: number;
  balloonCount: number;
  splashRange: number;
  hasBoots: boolean;
  balloonsAlive: number;
  emoteCooldown: number;
  soakedAt: number | null;
  soaks: number;
  castlesWashed: number;
  chainBursts: number;
  revengeDuckCooldown: number;
  revengeDuckReady: boolean;
  score: number;
  inputDir: Direction | null;
};

export type RoundStats = {
  soaks: Record<PlayerId, number>;
  chainBursts: Record<PlayerId, number>;
  castlesWashed: Record<PlayerId, number>;
};

export type RoundResult = {
  winner: PlayerId | null;
  placements: PlayerId[];
  stats: RoundStats;
};

// Server/Client types
export type QueueMode = 'duel' | 'ffa';
export type RoomVisibility = 'public' | 'private';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type SlotKind = 'human' | 'bot';

export type SlotState = {
  kind: SlotKind;
  playerId?: PlayerId;
  difficulty?: BotDifficulty;
  ready?: boolean;
};

export type LobbyState = {
  roomCode: RoomCode;
  name: string;
  hostId: PlayerId;
  mode: GameMode;
  visibility: RoomVisibility;
  theme: 'backyard' | 'beach' | 'pool' | 'random';
  roundsToWin: number;
  botFill: boolean;
  slots: SlotState[];
  humansPresent: number;
  state: 'waiting' | 'playing';
};

export type RoomInfo = {
  code: RoomCode;
  name: string;
  mode: GameMode;
  players: number;
  maxPlayers: number;
  theme: string;
  host: string;
};

export type Profile = {
  playerId: PlayerId;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selectedAnimal: Animal;
  selectedHat: Hat;
};

export type Rating = {
  mode: QueueMode;
  rating: number;
  games: number;
  wins: number;
  peak: number;
};

export type LeaderboardEntry = {
  rank: number;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
};

export type MatchResult = {
  matchId: MatchId;
  mode: GameMode;
  ranked: boolean;
  placements: PlayerId[];
  ratingDeltas: Record<PlayerId, number>;
  xp: Record<PlayerId, number>;
  stats: {
    soaks: Record<PlayerId, number>;
    castlesWashed: Record<PlayerId, number>;
    longestSurvivor: PlayerId;
    biggestChain: number;
  };
};

export type EmoteId = 1 | 2 | 3 | 4;

export type Snapshot = {
  tick: number;
  roundNo: number;
  players: PlayerState[];
  balloons: Balloon[];
  splashes: Splash[];
  powerUps: { x: number; y: number; type: PowerUpType }[];
  tideRing: number;
  events: SimEvent[];
};
