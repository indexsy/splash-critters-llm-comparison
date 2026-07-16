export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INTERP_DELAY_MS: 100,
  PING_INTERVAL_MS: 2000,

  ARENA: {
    DUEL: { w: 13, h: 11 },
    FFA: { w: 15, h: 13 },
  },
  CASTLE_DENSITY: 0.75,

  STATS: {
    SPEED_BASE: 4.0,
    SPEED_PER_FLIPPERS: 0.4,
    SPEED_CAP: 7.0,
    BALLOON_BASE: 1,
    BALLOON_CAP: 8,
    RANGE_BASE: 2,
    RANGE_CAP: 10,
  },

  FUSE_TICKS: 90,
  SPLASH_TICKS: 12,
  PLAYER_RADIUS: 0.35,
  KICK_SPEED: 8.0,
  ENABLE_KICK: true,

  POWERUP_BLOCK_CHANCE: 0.30,
  POWERUP_WEIGHTS: {
    balloon: 0.38,
    range: 0.38,
    speed: 0.19,
    boots: 0.05,
  } as const,

  TIDE_START_TICKS: 30 * 120,
  TIDE_INTERVAL_TICKS: 45,

  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  DUCK_LOB_COOLDOWN_TICKS: 150,
  DUCK_LOB_RANGE: 3,
  DUCK_SPEED: 3.0,

  BOTS: {
    EASY: { thinkMs: 450, errorRate: 0.12, attackRange: 2 },
    MEDIUM: { thinkMs: 250, errorRate: 0.0, attackRange: 4 },
    HARD: { thinkMs: 120, errorRate: 0.0, attackRange: 6 },
  },

  MATCHMAKING: {
    TICK_MS: 2000,
    BASE_RANGE: 100,
    WIDEN_EVERY_MS: 10000,
    WIDEN_STEP: 50,
    MAX_RANGE: 400,
  },

  ELO: {
    START: 1000,
    K_NEW: 64,
    K_NORMAL: 32,
    NEW_GAMES: 10,
  },
  TIERS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 },
  ] as const,

  XP: {
    PARTICIPATION: 20,
    PLACEMENT: [100, 50, 25, 10] as readonly number[],
    PER_SOAK: 15,
    PER_CASTLE: 1,
    TUTORIAL_BONUS: 50,
  },
  xpForLevel(n: number): number {
    return 100 + 25 * n;
  },

  ROUNDS_TO_WIN_DEFAULT: 3,
  RECONNECT_GRACE_MS: 15000,
  ROOM_IDLE_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_MSGS_PER_SEC: 60,
  EMOTE_COOLDOWN_MS: 1500,
  INPUT_BUFFER_TICKS: 30,
  MAX_ROOM_NAME_LEN: 24,

  ANIMALS: ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara'] as const,
  ANIMAL_UNLOCK_LEVEL: { frog: 0, duck: 0, otter: 2, penguin: 4, cat: 6, raccoon: 9, turtle: 12, capybara: 20 } as Record<string, number>,
  HATS: ['none', 'bucket', 'snorkel', 'crown', 'bandana', 'propeller'] as const,
  HAT_UNLOCK_LEVEL: { none: 0, bucket: 1, snorkel: 3, crown: 8, bandana: 5, propeller: 10 } as Record<string, number>,

  EMOTES: ['quack', 'ribbit', 'squeak', 'honk'] as const,
} as const;

export type Config = typeof CONFIG;
