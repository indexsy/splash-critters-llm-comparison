export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_SEND_RATE: 30,
  INTERPOLATION_MS: 100,
  INPUT_BUFFER_SIZE: 30,
  PING_INTERVAL_MS: 2000,
  ARENA: {
    duel: { width: 13, height: 11, players: 2 },
    ffa: { width: 15, height: 13, players: 4 },
    tutorial: { width: 9, height: 7, players: 2 }
  },
  BASE_SPEED: 4,
  SPEED_PER_FLIPPERS: 0.4,
  MAX_SPEED: 7,
  BASE_BALLOONS: 1,
  MAX_BALLOONS: 8,
  BASE_SPLASH_RANGE: 2,
  MAX_SPLASH_RANGE: 10,
  BALLOON_FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  KICK_SPEED: 6,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    balloon: 0.38,
    range: 0.38,
    speed: 0.19,
    kick: 0.05
  },
  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_COOLDOWN_TICKS: 150,
  REVENGE_RANGE: 3,
  REVENGE_FUSE_TICKS: 45,
  TIDE_START_TICKS: 3600,
  TIDE_INTERVAL_TICKS: 45,
  ROUND_COUNTDOWN_TICKS: 90,
  ROUND_END_TICKS: 90,
  BOTS: {
    EASY_INTERVAL_TICKS: 14,
    MEDIUM_INTERVAL_TICKS: 8,
    HARD_INTERVAL_TICKS: 4,
    HARD_AGGRESSION_TICKS: 300,
    EASY_ERROR_RATE: 0.15,
    MEDIUM_ERROR_RATE: 0,
    HARD_ERROR_RATE: 0
  },
  MATCHMAKING: {
    TICK_MS: 2000,
    INITIAL_RANGE: 100,
    WIDEN_MS: 10000,
    WIDEN_STEP: 50,
    MAX_RANGE: 400,
    ETA_SECONDS: 20
  },
  ELO: {
    START: 1000,
    K_NEW: 64,
    K_ESTABLISHED: 32,
    NEW_GAMES: 10
  },
  TIERS: [
    { name: "Puddle", min: 0 },
    { name: "Pond", min: 1000 },
    { name: "River", min: 1150 },
    { name: "Lake", min: 1300 },
    { name: "Ocean", min: 1500 },
    { name: "Tsunami", min: 1750 }
  ],
  XP: {
    PARTICIPATION: 50,
    PLACEMENT: [100, 60, 40, 25],
    SOAK: 20,
    CASTLE: 2,
    TUTORIAL: 100
  },
  LEVEL_XP_BASE: 100,
  LEVEL_XP_STEP: 25,
  UNLOCKS: {
    animals: { frog: 1, duck: 1, otter: 3, penguin: 5, cat: 8, raccoon: 11, turtle: 15, capybara: 20 },
    hats: { none: 1, bucket: 2, snorkel: 4, crown: 7, bandana: 10, propeller: 14 }
  },
  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 600000,
  RATE_LIMIT_MESSAGES_PER_SECOND: 60,
  EMOTE_COOLDOWN_MS: 1200,
  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,
  ARTIFICIAL_LATENCY_MS: 0
} as const;

export type SplashConfig = typeof CONFIG;
export const DIRECTIONS = ["up", "down", "left", "right"] as const;
