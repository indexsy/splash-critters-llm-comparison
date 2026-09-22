export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_HZ: 15,
  INPUT_SEND_HZ: 30,
  INPUT_SAMPLE_HZ: 60,
  INTERP_DELAY_MS: 100,
  INPUT_BUFFER_MS: 1000,

  DUEL_W: 13,
  DUEL_H: 11,
  FFA_W: 15,
  FFA_H: 13,

  SPEED_BASE: 4,
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7,
  BALLOON_BASE: 1,
  BALLOON_CAP: 8,
  SPLASH_BASE: 2,
  SPLASH_CAP: 10,

  FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  WARMUP_TICKS: 90,
  HITBOX: 0.3,
  PLAYER_SEPARATION: 0.64,

  CASTLE_DENSITY: 0.75,
  SPAWN_CLEAR: 2,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    extra_balloon: 0.38,
    big_splash: 0.38,
    flippers: 0.19,
    rubber_boots: 0.05,
  },

  ENABLE_KICK: true,
  KICK_TILES_PER_SEC: 8,

  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_RANGE: 3,
  REVENGE_COOLDOWN_TICKS: 150,
  REVENGE_FUSE_TICKS: 30,
  REVENGE_SPLASH: 2,
  DUCK_TILES_PER_SEC: 3,

  TIDE_START_SEC: 120,
  TIDE_INTERVAL_SEC: 1.5,

  DEFAULT_ROUNDS: 3,
  ROUND_PAUSE_MS: 2800,
  INTRO_MS: 2800,
  RESULTS_VOTE_MS: 20000,

  BOT_INTERVAL_MS: { easy: 450, medium: 250, hard: 120 },
  BOT_ERROR_RATE: { easy: 0.125, medium: 0, hard: 0 },
  BOT_ATTACK_RANGE: { easy: 0, medium: 4, hard: 14 },

  MM_INTERVAL_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_CAP_RANGE: 400,

  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K: 32,
  ELO_PROVISIONAL_GAMES: 10,

  TIERS: [
    { id: 'puddle', name: 'Puddle', min: 0 },
    { id: 'pond', name: 'Pond', min: 1000 },
    { id: 'river', name: 'River', min: 1150 },
    { id: 'lake', name: 'Lake', min: 1300 },
    { id: 'ocean', name: 'Ocean', min: 1500 },
    { id: 'tsunami', name: 'Tsunami', min: 1750 },
  ],

  XP_PARTICIPATION: 25,
  XP_BY_PLACE: [40, 25, 15, 10],
  XP_PER_SOAK: 8,
  XP_PER_CASTLE: 1,
  XP_TUTORIAL: 50,

  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_PER_SEC: 60,
  MAX_MSG_BYTES: 4096,
  EMOTE_COOLDOWN_MS: 800,

  NICK_MIN: 3,
  NICK_MAX: 16,
} as const;

export type Mode = 'duel' | 'ffa';
export type Theme = 'backyard' | 'beach' | 'pool';
export type ThemePick = Theme | 'random';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type AnimalId =
  | 'frog'
  | 'duck'
  | 'otter'
  | 'penguin'
  | 'cat'
  | 'raccoon'
  | 'turtle'
  | 'capybara';
export type HatId = 'bucket' | 'snorkel' | 'bandana' | 'crown' | 'propeller';
export type PowerupKind = 'extra_balloon' | 'big_splash' | 'flippers' | 'rubber_boots';

export const ANIMALS: { id: AnimalId; name: string; level: number }[] = [
  { id: 'frog', name: 'Frog', level: 1 },
  { id: 'duck', name: 'Duck', level: 1 },
  { id: 'otter', name: 'Otter', level: 3 },
  { id: 'penguin', name: 'Penguin', level: 5 },
  { id: 'cat', name: 'Cat', level: 7 },
  { id: 'raccoon', name: 'Raccoon', level: 10 },
  { id: 'turtle', name: 'Turtle', level: 14 },
  { id: 'capybara', name: 'Capybara', level: 20 },
];

export const HATS: { id: HatId; name: string; level: number }[] = [
  { id: 'bucket', name: 'Bucket Hat', level: 2 },
  { id: 'snorkel', name: 'Snorkel', level: 4 },
  { id: 'bandana', name: 'Pirate Bandana', level: 6 },
  { id: 'crown', name: 'Tiny Crown', level: 8 },
  { id: 'propeller', name: 'Propeller Cap', level: 12 },
];

export const POWERUP_ORDER: PowerupKind[] = [
  'extra_balloon',
  'big_splash',
  'flippers',
  'rubber_boots',
];

export function xpForLevel(n: number): number {
  return 100 + 25 * n;
}

export function xpProgress(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < 99 && left >= xpForLevel(level)) {
    left -= xpForLevel(level);
    level++;
  }
  return { level, into: left, need: xpForLevel(level) };
}

export function levelFromXp(xp: number): number {
  return xpProgress(xp).level;
}

export function arenaSize(mode: Mode): { w: number; h: number } {
  return mode === 'duel'
    ? { w: CONFIG.DUEL_W, h: CONFIG.DUEL_H }
    : { w: CONFIG.FFA_W, h: CONFIG.FFA_H };
}

export function tierFor(rating: number): { id: string; name: string; min: number; next: number | null } {
  let current: { id: string; name: string; min: number } = CONFIG.TIERS[0];
  let next: number | null = CONFIG.TIERS[1]?.min ?? null;
  for (let i = 0; i < CONFIG.TIERS.length; i++) {
    const t = CONFIG.TIERS[i];
    if (rating >= t.min) {
      current = t;
      next = CONFIG.TIERS[i + 1]?.min ?? null;
    }
  }
  return { ...current, next };
}

export function matchXp(placement: number, soaks: number, castles: number): number {
  const place = CONFIG.XP_BY_PLACE[Math.max(0, Math.min(3, placement - 1))] ?? 10;
  return CONFIG.XP_PARTICIPATION + place + soaks * CONFIG.XP_PER_SOAK + castles * CONFIG.XP_PER_CASTLE;
}

export function tideStartTick(): number {
  return CONFIG.TIDE_START_SEC * CONFIG.TICK_RATE + CONFIG.WARMUP_TICKS;
}

export function tideIntervalTicks(): number {
  return Math.round(CONFIG.TIDE_INTERVAL_SEC * CONFIG.TICK_RATE);
}
