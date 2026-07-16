export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_SEND_RATE: 30,
  INTERP_DELAY_MS: 100,
  PING_INTERVAL_MS: 2000,

  // Arena sizes
  DUEL_WIDTH: 13,
  DUEL_HEIGHT: 11,
  FFA_WIDTH: 15,
  FFA_HEIGHT: 13,

  // Player stats
  BASE_SPEED: 4.0,
  SPEED_PER_FLIPPERS: 0.4,
  MAX_SPEED: 7.0,
  BASE_BALLOON_COUNT: 1,
  MAX_BALLOON_COUNT: 8,
  BASE_SPLASH_RANGE: 2,
  MAX_SPLASH_RANGE: 10,

  // Balloons
  FUSE_TICKS: 90, // 3.0s at 30Hz
  SPLASH_LINGER_TICKS: 12, // ~0.4s
  ENABLE_KICK: true,

  // Map
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    extraBalloon: 0.38,
    bigSplash: 0.38,
    flippers: 0.19,
    rubberBoots: 0.05,
  } as const,

  // Tide
  TIDE_START_TICKS: 3600, // 2:00 at 30Hz
  TIDE_INTERVAL_TICKS: 45, // ~1.5s

  // Revenge ducks
  ENABLE_REVENGE_DUCKS: true,
  ENABLE_REVENGE_DUCKS_RANKED: false,
  REVENGE_COOLDOWN_TICKS: 150, // 5s
  REVENGE_RANGE: 3,

  // Match
  ROUNDS_TO_WIN_DEFAULT: 3,
  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_MSGS_PER_SEC: 60,

  // Matchmaking
  MM_TICK_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN_EVERY_MS: 10000,
  MM_WIDEN_AMOUNT: 50,
  MM_MAX_RANGE: 400,

  // Elo
  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K_STANDARD: 32,
  ELO_PROVISIONAL_GAMES: 10,

  // Tiers
  TIER_BANDS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 },
  ] as const,

  // XP
  XP_PARTICIPATION: 20,
  XP_PER_PLACEMENT: [50, 30, 15, 5] as const, // 1st..4th
  XP_PER_SOAK: 8,
  XP_PER_CASTLE: 2,
  XP_TUTORIAL: 30,

  // Bots
  BOT_INTERVALS_MS: { easy: 450, medium: 250, hard: 120 } as const,
  BOT_ERROR_RATES: { easy: 0.12, medium: 0.03, hard: 0 } as const,

  // Nicknames
  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,

  // Animals & hats unlock levels
  ANIMAL_UNLOCKS: {
    frog: 1,
    duck: 1,
    otter: 3,
    penguin: 5,
    cat: 7,
    raccoon: 10,
    turtle: 14,
    capybara: 20,
  } as const,

  HAT_UNLOCKS: {
    none: 1,
    bucket: 2,
    snorkel: 4,
    crown: 8,
    bandana: 12,
    propeller: 16,
  } as const,
} as const;

export type PowerupType = keyof typeof CONFIG.POWERUP_WEIGHTS;
export type AnimalId = keyof typeof CONFIG.ANIMAL_UNLOCKS;
export type HatId = keyof typeof CONFIG.HAT_UNLOCKS;
export type BotDifficulty = keyof typeof CONFIG.BOT_INTERVALS_MS;
export type MapTheme = 'backyard' | 'beach' | 'pool' | 'random';
export type GameMode = 'duel' | 'ffa';
export type MatchKind = 'ranked' | 'casual' | 'practice' | 'tutorial';

export function xpForLevel(n: number): number {
  return 100 + 25 * n;
}

export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevel(i);
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
    if (level > 100) break;
  }
  return level;
}

export function tierFromRating(rating: number): string {
  let tier: string = CONFIG.TIER_BANDS[0].name;
  for (const band of CONFIG.TIER_BANDS) {
    if (rating >= band.min) tier = band.name;
  }
  return tier;
}
