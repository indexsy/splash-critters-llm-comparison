/**
 * Single source of truth for every tunable in Splash Critters.
 * Everything here is plain data so it can be imported by server, client and tests.
 */

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotConfig {
  /** Milliseconds between decisions. */
  intervalMs: number;
  /** Probability (0..1) that the bot misjudges danger. */
  errorRate: number;
  /** How far the bot will try to attack from, in tiles. */
  attackRange: number;
  /** 0..1 chance of preferring to attack over farming. */
  aggression: number;
  /** Whether the bot uses Rubber Boots to kick balloons. */
  usesKick: boolean;
  /** Chance the bot random-walks instead of executing its plan. */
  wanderRate: number;
}

export interface TierBand {
  name: string;
  min: number;
}

export interface GameConfig {
  // ---- netcode -----------------------------------------------------------
  TICK_RATE: number;
  SNAPSHOT_RATE: number;
  INPUT_SEND_RATE: number;
  CLIENT_INPUT_BUFFER_MS: number;
  INTERP_DELAY_MS: number;
  PING_INTERVAL_MS: number;

  // ---- arena -------------------------------------------------------------
  GRID: Record<'duel' | 'ffa', { width: number; height: number }>;
  /** Fraction of free tiles that hold a destructible sandcastle. */
  CASTLE_DENSITY: number;
  /** Tiles kept clear of sandcastles around each spawn (spawn + 2 per direction). */
  SPAWN_CLEARANCE: number;
  THEMES: readonly string[];

  // ---- player stats ------------------------------------------------------
  SPEED_BASE: number;
  SPEED_PER_FLIPPER: number;
  SPEED_CAP: number;
  BALLOON_COUNT_BASE: number;
  BALLOON_COUNT_CAP: number;
  SPLASH_RANGE_BASE: number;
  SPLASH_RANGE_CAP: number;

  // ---- balloons / splash -------------------------------------------------
  BALLOON_FUSE_TICKS: number;
  SPLASH_LINGER_TICKS: number;
  CHAIN_MAX_DEPTH: number;
  /** Ticks between the discrete tile-steps of a kicked balloon. */
  KICK_STEP_TICKS: number;
  ENABLE_KICK: boolean;

  // ---- power-ups ---------------------------------------------------------
  /** Probability that a sandcastle contains nothing at all. */
  POWERUP_BLOCK_CHANCE: number;
  POWERUP_WEIGHTS: {
    extra_balloon: number;
    big_splash: number;
    flippers: number;
    boots: number;
  };

  // ---- revenge ducks -----------------------------------------------------
  ENABLE_REVENGE_DUCKS: boolean;
  ENABLE_REVENGE_DUCKS_RANKED: boolean;
  REVENGE_INTERVAL_TICKS: number;
  REVENGE_RANGE: number;
  REVENGE_DUCK_SPEED: number;

  // ---- tide / round ------------------------------------------------------
  TIDE_START_TICK: number;
  TIDE_INTERVAL_TICKS: number;
  ROUND_HARD_LIMIT_TICKS: number;
  DEFAULT_ROUNDS_TO_WIN: number;

  // ---- bots --------------------------------------------------------------
  BOTS: Record<BotDifficulty, BotConfig>;

  // ---- matchmaking -------------------------------------------------------
  MATCHMAKING: {
    baseRange: number;
    widenStep: number;
    widenEveryMs: number;
    maxRange: number;
    tickMs: number;
  };

  // ---- elo ---------------------------------------------------------------
  ELO: {
    start: number;
    kProvisional: number;
    kStable: number;
    provisionalGames: number;
    /** FFA pairwise k' = K / divisor. */
    ffaPairDivisor: number;
  };

  TIERS: readonly TierBand[];

  // ---- progression -------------------------------------------------------
  XP: {
    participation: number;
    duelWin: number;
    duelLoss: number;
    ffaPlacement: readonly number[];
    perSoak: number;
    perCastle: number;
  };
  LEVEL_CURVE_BASE: number;
  LEVEL_CURVE_STEP: number;
  UNLOCK_LEVELS: Record<string, number>;

  // ---- identity / rooms --------------------------------------------------
  NICKNAME_MIN: number;
  NICKNAME_MAX: number;
  RECONNECT_GRACE_MS: number;
  ROOM_IDLE_TTL_MS: number;
  ROOM_MAX_PLAYERS: number;
  ROOM_CODE_LENGTH: number;
  RATE_LIMIT_MSGS_PER_SEC: number;
  RATE_LIMIT_BURST: number;
}

export const CONFIG: GameConfig = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_SEND_RATE: 30,
  CLIENT_INPUT_BUFFER_MS: 1000,
  INTERP_DELAY_MS: 100,
  PING_INTERVAL_MS: 2000,

  GRID: {
    duel: { width: 13, height: 11 },
    ffa: { width: 15, height: 13 },
  },
  CASTLE_DENSITY: 0.75,
  SPAWN_CLEARANCE: 2,
  THEMES: ['backyard', 'beach', 'pool', 'random'],

  SPEED_BASE: 4.0,
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7.0,
  BALLOON_COUNT_BASE: 1,
  BALLOON_COUNT_CAP: 8,
  SPLASH_RANGE_BASE: 2,
  SPLASH_RANGE_CAP: 10,

  BALLOON_FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  CHAIN_MAX_DEPTH: 16,
  KICK_STEP_TICKS: 3,
  ENABLE_KICK: true,

  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    extra_balloon: 0.38,
    big_splash: 0.38,
    flippers: 0.19,
    boots: 0.05,
  },

  ENABLE_REVENGE_DUCKS: true,
  ENABLE_REVENGE_DUCKS_RANKED: false,
  REVENGE_INTERVAL_TICKS: 150,
  REVENGE_RANGE: 3,
  REVENGE_DUCK_SPEED: 3.0,

  TIDE_START_TICK: 30 * 120,
  TIDE_INTERVAL_TICKS: 45,
  ROUND_HARD_LIMIT_TICKS: 30 * 120 + 45 * 9,
  DEFAULT_ROUNDS_TO_WIN: 3,

  BOTS: {
    easy: {
      intervalMs: 450,
      errorRate: 0.125,
      attackRange: 2,
      aggression: 0.15,
      usesKick: false,
      wanderRate: 0.45,
    },
    medium: {
      intervalMs: 250,
      errorRate: 0,
      attackRange: 4,
      aggression: 0.5,
      usesKick: false,
      wanderRate: 0.12,
    },
    hard: {
      intervalMs: 120,
      errorRate: 0,
      attackRange: 99,
      aggression: 0.9,
      usesKick: true,
      wanderRate: 0,
    },
  },

  MATCHMAKING: {
    baseRange: 100,
    widenStep: 50,
    widenEveryMs: 10000,
    maxRange: 400,
    tickMs: 2000,
  },

  ELO: {
    start: 1000,
    kProvisional: 64,
    kStable: 32,
    provisionalGames: 10,
    ffaPairDivisor: 3,
  },

  TIERS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 },
  ],

  XP: {
    participation: 20,
    duelWin: 60,
    duelLoss: 15,
    ffaPlacement: [70, 45, 25, 10],
    perSoak: 12,
    perCastle: 3,
  },
  LEVEL_CURVE_BASE: 100,
  LEVEL_CURVE_STEP: 25,
  UNLOCK_LEVELS: {
    frog: 1,
    duck: 1,
    bucket_hat: 2,
    otter: 3,
    snorkel: 4,
    penguin: 5,
    crown: 7,
    raccoon: 8,
    bandana: 10,
    cat: 11,
    turtle: 14,
    propeller: 15,
    capybara: 20,
  },

  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,
  RECONNECT_GRACE_MS: 15000,
  ROOM_IDLE_TTL_MS: 10 * 60 * 1000,
  ROOM_MAX_PLAYERS: 4,
  ROOM_CODE_LENGTH: 6,
  RATE_LIMIT_MSGS_PER_SEC: 60,
  RATE_LIMIT_BURST: 120,
};
