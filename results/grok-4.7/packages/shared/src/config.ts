export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INTERP_DELAY_MS: 100,
  INPUT_BUFFER_MS: 1000,

  DUEL_W: 13,
  DUEL_H: 11,
  FFA_W: 15,
  FFA_H: 13,
  TUTORIAL_W: 11,
  TUTORIAL_H: 9,

  SPEED_BASE: 4.0,
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7.0,
  BALLOON_BASE: 1,
  BALLOON_CAP: 8,
  SPLASH_BASE: 2,
  SPLASH_CAP: 10,

  FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    balloon: 0.38,
    splash: 0.38,
    flippers: 0.19,
    boots: 0.05,
  },
  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_LOB_RANGE: 3,
  REVENGE_LOB_COOLDOWN_TICKS: 150,
  REVENGE_FUSE_TICKS: 60,
  KICK_SPEED: 6,
  DUCK_SPEED: 2.5,

  PLAYER_RADIUS: 0.3,
  HIT_STOP_TICKS: 2,

  ROUND_TIME_SEC: 120,
  ROUND_TIME_TICKS: 120 * 30,
  TIDE_INTERVAL_TICKS: 45,
  ROUNDS_TO_WIN_DEFAULT: 3,
  COUNTDOWN_TICKS: 90,
  INTRO_TICKS: 75,
  INTERMISSION_TICKS: 75,
  MAX_ROUNDS: 11,

  BOT_INTERVALS: { easy: 14, medium: 8, hard: 4 },
  BOT_ERROR: { easy: 0.12, medium: 0, hard: 0 },
  BOT_ATTACK_RANGE: { easy: 0, medium: 4, hard: 99 },

  MM_TICK_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_CAP_RANGE: 400,

  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K: 32,
  ELO_PROVISIONAL_GAMES: 10,

  TIERS: [
    { name: 'Puddle', min: 0 },
    { name: 'Pond', min: 1000 },
    { name: 'River', min: 1150 },
    { name: 'Lake', min: 1300 },
    { name: 'Ocean', min: 1500 },
    { name: 'Tsunami', min: 1750 },
  ],

  XP_PARTICIPATION: 25,
  XP_PLACEMENT: [80, 50, 30, 20],
  XP_PER_SOAK: 10,
  XP_PER_CASTLE: 1,
  XP_TUTORIAL: 40,
  LEVEL_BASE: 100,
  LEVEL_SLOPE: 25,

  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_PER_SEC: 60,
  EMOTE_COOLDOWN_MS: 800,

  NICK_MIN: 3,
  NICK_MAX: 16,
  ROOM_NAME_MAX: 24,
} as const;

export type Mode = 'duel' | 'ffa';
export type Theme = 'backyard' | 'beach' | 'pool';
export type BotDiff = 'easy' | 'medium' | 'hard';
export type Dir = 'none' | 'up' | 'down' | 'left' | 'right';
export type PowerKind = 'balloon' | 'splash' | 'flippers' | 'boots';

export const DIRS: Record<Dir, { x: number; y: number }> = {
  none: { x: 0, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const CARDINALS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export const TILE_EMPTY = 0;
export const TILE_BOULDER = 1;
export const TILE_CASTLE = 2;

export function arenaSize(mode: Mode): { w: number; h: number } {
  return mode === 'duel'
    ? { w: CONFIG.DUEL_W, h: CONFIG.DUEL_H }
    : { w: CONFIG.FFA_W, h: CONFIG.FFA_H };
}

export function xpForLevel(n: number): number {
  return CONFIG.LEVEL_BASE + CONFIG.LEVEL_SLOPE * n;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < 99) {
    const cost = xpForLevel(level);
    if (left < cost) break;
    left -= cost;
    level += 1;
  }
  return level;
}

export function xpIntoLevel(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < 99) {
    const cost = xpForLevel(level);
    if (left < cost) return { level, into: left, need: cost };
    left -= cost;
    level += 1;
  }
  return { level, into: 0, need: xpForLevel(level) };
}

export function tierFor(rating: number): { name: string; min: number; next: number | null } {
  let name: string = CONFIG.TIERS[0].name;
  let min: number = CONFIG.TIERS[0].min;
  let next: number | null = CONFIG.TIERS[1] ? CONFIG.TIERS[1].min : null;
  for (let i = 0; i < CONFIG.TIERS.length; i++) {
    const t = CONFIG.TIERS[i]!;
    if (rating >= t.min) {
      name = t.name;
      min = t.min;
      next = CONFIG.TIERS[i + 1]?.min ?? null;
    }
  }
  return { name, min, next };
}

export function searchRange(waitMs: number): number {
  const steps = Math.floor(waitMs / CONFIG.MM_WIDEN_EVERY_MS);
  return Math.min(CONFIG.MM_CAP_RANGE, CONFIG.MM_BASE_RANGE + steps * CONFIG.MM_WIDEN);
}

export function matchXp(placement: number, soaks: number, castles: number): number {
  const idx = Math.max(0, Math.min(CONFIG.XP_PLACEMENT.length - 1, placement - 1));
  return (
    CONFIG.XP_PARTICIPATION +
    CONFIG.XP_PLACEMENT[idx]! +
    soaks * CONFIG.XP_PER_SOAK +
    castles * CONFIG.XP_PER_CASTLE
  );
}
