export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INTERPOLATION_DELAY_MS: 100,
  INPUT_BUFFER_TICKS: 30,
  DUEL_SIZE: { width: 13, height: 11 },
  FFA_SIZE: { width: 15, height: 13 },
  PLAYER_RADIUS: 0.29,
  BASE_SPEED: 4,
  SPEED_STEP: 0.4,
  MAX_SPEED: 7,
  BASE_BALLOONS: 1,
  MAX_BALLOONS: 8,
  BASE_SPLASH_RANGE: 2,
  MAX_SPLASH_RANGE: 10,
  BALLOON_FUSE_TICKS: 90,
  SPLASH_TICKS: 12,
  KICK_STEP_TICKS: 4,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    balloon: 0.38,
    range: 0.38,
    flippers: 0.19,
    boots: 0.05
  },
  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  ENABLE_REVENGE_DUCKS_RANKED: false,
  REVENGE_COOLDOWN_TICKS: 150,
  TIDE_START_TICKS: 3_600,
  TIDE_INTERVAL_TICKS: 45,
  BOT_INTERVAL_TICKS: { easy: 14, medium: 8, hard: 4 },
  BOT_ERROR_RATE: { easy: 0.13, medium: 0, hard: 0 },
  MATCHMAKING_TICK_MS: 2_000,
  MATCHMAKING_INITIAL_RANGE: 100,
  MATCHMAKING_WIDEN_AMOUNT: 50,
  MATCHMAKING_WIDEN_MS: 10_000,
  MATCHMAKING_MAX_RANGE: 400,
  START_RATING: 1_000,
  PROVISIONAL_GAMES: 10,
  PROVISIONAL_K: 64,
  STANDARD_K: 32,
  TIERS: [
    { name: "Puddle", min: 0 },
    { name: "Pond", min: 1_000 },
    { name: "River", min: 1_150 },
    { name: "Lake", min: 1_300 },
    { name: "Ocean", min: 1_500 },
    { name: "Tsunami", min: 1_750 }
  ],
  XP: { participation: 40, placement: [60, 40, 25, 15], soak: 10, castle: 2, tutorial: 50 },
  UNLOCK_LEVELS: {
    animals: { frog: 1, duck: 1, otter: 3, penguin: 5, cat: 7, raccoon: 10, turtle: 14, capybara: 20 },
    hats: { none: 1, bucket: 2, snorkel: 4, crown: 8, bandana: 12, propeller: 16 }
  },
  LEVEL_BASE_XP: 100,
  LEVEL_STEP_XP: 25,
  RECONNECT_GRACE_MS: 15_000,
  ROOM_TTL_MS: 600_000,
  MESSAGE_RATE_LIMIT: 60,
  EMOTE_COOLDOWN_MS: 1_000
} as const;

export type Config = typeof CONFIG;

export function xpForLevel(level: number): number {
  return CONFIG.LEVEL_BASE_XP + CONFIG.LEVEL_STEP_XP * level;
}

export function tierForRating(rating: number): string {
  let tier: string = CONFIG.TIERS[0].name;
  for (const band of CONFIG.TIERS) if (rating >= band.min) tier = band.name;
  return tier;
}
