// Single typed CONFIG object — all tunables live here.
export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INTERP_DELAY_MS: 100,
  INPUT_BUFFER_SIZE: 90,

  // Arena sizes
  DUEL_W: 13,
  DUEL_H: 11,
  FFA_W: 15,
  FFA_H: 13,

  // Player stats
  BASE_SPEED: 4.0, // tiles/sec
  SPEED_PER_FLIPPERS: 0.4,
  MAX_SPEED: 7.0,
  BASE_BALLOONS: 1,
  MAX_BALLOONS: 8,
  BASE_RANGE: 2,
  MAX_RANGE: 10,

  // Balloons
  FUSE_TICKS: 90, // 3.0s @30Hz
  SPLASH_TICKS: 12, // ~0.4s
  KICK_SLIDE_TICKS_PER_TILE: 6,
  ENABLE_KICK: true,

  // Map
  CASTLE_DENSITY: 0.75,

  // Power-ups (pre-rolled at map gen)
  POWERUP_BLOCK_CHANCE: 0.30,
  POWERUP_WEIGHTS: {
    extra_balloon: 0.38,
    big_splash: 0.38,
    flippers: 0.19,
    boots: 0.05,
  } as Record<PowerupKind, number>,

  // Rising tide sudden death
  TIDE_START_TICKS: 3600, // 2:00 @30Hz
  TIDE_RING_INTERVAL_TICKS: 45, // ~1.5s per ring
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_LOB_COOLDOWN_TICKS: 150, // 5s
  REVENGE_LOB_DISTANCE: 3,

  // Bots
  BOT_INTERVAL: { easy: 14, medium: 8, hard: 4 } as Record<BotDifficulty, number>, // ticks between decisions (~450/250/120ms)
  BOT_ERROR_RATE: { easy: 0.13, medium: 0.0, hard: 0.0 } as Record<BotDifficulty, number>,

  // Matchmaking
  MM_TICK_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN_PER_10S: 50,
  MM_MAX_RANGE: 400,

  // Elo
  ELO_START: 1000,
  ELO_K_NEW: 64,
  ELO_K: 32,
  ELO_NEW_GAMES: 10,
  TIERS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 },
  ] as { name: TierName; min: number }[],

  // XP / levels
  XP_PARTICIPATION: 20,
  XP_PER_WIN: 30,
  XP_PER_SOAK: 15,
  XP_PER_CASTLE: 2,
  xpForLevel: (n: number) => 100 + 25 * n,

  // Rounds
  DUEL_ROUNDS_TO_WIN: 3,
  FFA_ROUNDS_TO_WIN: 3,

  // Net / rooms
  RECONNECT_GRACE_S: 15,
  ROOM_TTL_S: 600,
  RATE_LIMIT_PER_SEC: 60,

  // Presentation
  INTERNAL_W: 256,
  INTERNAL_H: 224,
} as const;

export type PowerupKind = 'extra_balloon' | 'big_splash' | 'flippers' | 'boots';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type TierName = 'Puddle' | 'Pond' | 'River' | 'Lake' | 'Ocean' | 'Tsunami';

export function tierFor(rating: number): TierName {
  let t: TierName = 'Puddle';
  for (const band of CONFIG.TIERS) if (rating >= band.min) t = band.name;
  return t;
}
