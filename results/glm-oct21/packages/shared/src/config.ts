import type { GameMode, MapTheme, PowerupType, BotDifficulty } from './types'

export const CONFIG = {
  TICK_RATE: 30,
  TICK_MS: 1000 / 30,
  SNAPSHOT_EVERY: 2,
  INTERP_DELAY_MS: 100,
  PING_EVERY_MS: 2000,

  SPEED_BASE: 4.0,
  SPEED_PER_FLIPPERS: 0.4,
  SPEED_CAP: 7.0,

  BALLOONS_BASE: 1,
  BALLOONS_CAP: 8,

  RANGE_BASE: 2,
  RANGE_CAP: 10,

  FUSE_TICKS: 90,
  SPLASH_TICKS: 12,

  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: { extra_balloon: 0.38, big_splash: 0.38, flippers: 0.19, boots: 0.05 },

  ENABLE_KICK: true,
  BALLOON_SLIDE_TPS: 6,

  ROUND_TICKS: 120 * 30,
  TIDE_RING_TICKS: 45,

  ENABLE_REVENGE_DUCKS: true,
  DUCK_LOB_COOLDOWN_TICKS: 150,
  DUCK_LOB_RANGE: 3,
  DUCK_SPEED_TPS: 3,

  BOTS: {
    easy: { decideEveryTicks: 13, mistakeChance: 0.12, attackRange: 2 },
    medium: { decideEveryTicks: 7, mistakeChance: 0.0, attackRange: 4 },
    hard: { decideEveryTicks: 4, mistakeChance: 0.0, attackRange: 8 }
  } as Record<BotDifficulty, { decideEveryTicks: number; mistakeChance: number; attackRange: number }>,

  MM_TICK_MS: 2000,
  MM_START_RANGE: 100,
  MM_WIDEN: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_MAX_RANGE: 400,

  ELO: { START: 1000, K_PROVISIONAL: 64, K: 32, PROVISIONAL_GAMES: 10 },

  TIERS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 }
  ],

  XP: {
    TUTORIAL: 20,
    PARTICIPATION: 10,
    PER_ROUND_WIN: 5,
    PER_SOAK: 3,
    PER_CASTLE: 2,
    WIN_BONUS: 15
  },

  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 600000,
  MSG_RATE_LIMIT: 60,
  EMOTE_COOLDOWN_MS: 2000,

  MAPS: {
    duel: { W: 13, H: 11 },
    ffa: { W: 15, H: 13 }
  },

  THEMES: ['backyard', 'beach', 'pool'] as MapTheme[],

  ANIMALS: [
    { id: 'frog', name: 'Frog', level: 1 },
    { id: 'duck', name: 'Duck', level: 1 },
    { id: 'otter', name: 'Otter', level: 2 },
    { id: 'penguin', name: 'Penguin', level: 3 },
    { id: 'cat', name: 'Cat', level: 4 },
    { id: 'raccoon', name: 'Raccoon', level: 6 },
    { id: 'turtle', name: 'Turtle', level: 8 },
    { id: 'capybara', name: 'Capybara', level: 20 }
  ],

  HATS: [
    { id: 'none', name: 'Bare Head', level: 1 },
    { id: 'bucket', name: 'Bucket Hat', level: 2 },
    { id: 'snorkel', name: 'Snorkel', level: 3 },
    { id: 'bandana', name: 'Pirate Bandana', level: 4 },
    { id: 'crown', name: 'Tiny Crown', level: 5 },
    { id: 'propeller', name: 'Propeller Cap', level: 7 }
  ]
} as const

export function xpForLevel(n: number): number {
  return 100 + 25 * n
}

export function levelFromXp(xp: number): number {
  let level = 1
  let remaining = xp
  while (remaining >= xpForLevel(level) && level < 999) {
    remaining -= xpForLevel(level)
    level++
  }
  return level
}

export function xpProgress(xp: number): { level: number; cur: number; need: number } {
  let level = 1
  let remaining = xp
  while (remaining >= xpForLevel(level) && level < 999) {
    remaining -= xpForLevel(level)
    level++
  }
  return { level, cur: remaining, need: xpForLevel(level) }
}

export const MODE_SIZES: Record<GameMode, number> = { duel: 2, ffa: 4 }
