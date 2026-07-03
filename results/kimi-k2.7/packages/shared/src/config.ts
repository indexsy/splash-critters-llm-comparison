export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_SEND_RATE: 30,
  CLIENT_INPUT_BUFFER_MS: 1000,
  INTERP_DELAY_MS: 100,
  PING_INTERVAL_MS: 2000,
  ROUND_WIN_FIRST_TO: 3,

  // Arena sizes (tiles)
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

  // Balloon
  BALLOON_FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  BALLOON_SOLID_TICKS: 5,

  // Map
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.30,
  POWERUP_WEIGHTS: {
    extraBalloon: 0.38,
    bigSplash: 0.38,
    flippers: 0.19,
    rubberBoots: 0.05,
  },

  // Kick
  ENABLE_KICK: true,

  // Tide
  TIDE_START_TICKS: 30 * 60 * 2, // 2 minutes at 30Hz
  TIDE_INTERVAL_TICKS: 45, // ~1.5s

  // Revenge ducks
  ENABLE_REVENGE_DUCKS: true,
  ENABLE_REVENGE_DUCKS_RANKED: false,
  REVENGE_LOB_COOLDOWN_TICKS: 30 * 5,
  REVENGE_LOB_RANGE: 3,

  // Emotes
  EMOTE_COOLDOWN_TICKS: 60,

  // Bots
  BOT_DECISION_EASY_MS: 450,
  BOT_DECISION_MEDIUM_MS: 250,
  BOT_DECISION_HARD_MS: 120,
  BOT_ERROR_EASY: 0.15,
  BOT_ERROR_MEDIUM: 0.0,
  BOT_ERROR_HARD: 0.0,
  BOT_REACTION_EASY_TICKS: 20,
  BOT_REACTION_MEDIUM_TICKS: 8,
  BOT_REACTION_HARD_TICKS: 2,

  // Matchmaking
  MM_TICK_MS: 2000,
  MM_INITIAL_RANGE: 100,
  MM_WIDEN_BY: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_MAX_RANGE: 400,

  // Elo
  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K_ESTABLISHED: 32,
  ELO_PROVISIONAL_GAMES: 10,

  // Tiers
  TIERS: [
    { name: "Puddle", min: 0 },
    { name: "Pond", min: 1000 },
    { name: "River", min: 1150 },
    { name: "Lake", min: 1300 },
    { name: "Ocean", min: 1500 },
    { name: "Tsunami", min: 1750 },
  ],

  // XP
  XP_PARTICIPATION: 25,
  XP_WIN: 50,
  XP_PER_SOAK: 15,
  XP_PER_CASTLE: 2,
  XP_TOP_PLACEMENT: [40, 25, 15, 10],
  XP_LEVEL_BASE: 100,
  XP_LEVEL_INCREMENT: 25,

  // Reconnect / rooms
  RECONNECT_GRACE_MS: 15000,
  ROOM_IDLE_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_MSG_PER_SEC: 60,

  // Protocol
  MSG_MAX_SIZE: 4096,

  // Cosmetics unlock levels
  ANIMAL_UNLOCK_LEVEL: {
    frog: 1,
    duck: 1,
    otter: 3,
    penguin: 5,
    cat: 8,
    raccoon: 12,
    turtle: 16,
    capybara: 20,
  },
  HAT_UNLOCK_LEVEL: {
    none: 1,
    bucket: 2,
    snorkel: 4,
    crown: 7,
    pirate: 10,
    propeller: 15,
  },
} as const;

export type Config = typeof CONFIG;
export type Mode = "duel" | "ffa";
export type Theme = "backyard" | "beach" | "pool";
export type Difficulty = "easy" | "medium" | "hard";
export type SlotKind = "human" | "bot" | "closed";
export type Animal = keyof typeof CONFIG.ANIMAL_UNLOCK_LEVEL;
export type Hat = keyof typeof CONFIG.HAT_UNLOCK_LEVEL;

export const ANIMALS = Object.keys(CONFIG.ANIMAL_UNLOCK_LEVEL) as Animal[];
export const HATS = Object.keys(CONFIG.HAT_UNLOCK_LEVEL) as Hat[];
export const MODES: Mode[] = ["duel", "ffa"];
export const THEMES: Theme[] = ["backyard", "beach", "pool"];

export function tierForRating(rating: number): string {
  for (let i = CONFIG.TIERS.length - 1; i >= 0; i--) {
    if (rating >= CONFIG.TIERS[i].min) return CONFIG.TIERS[i].name;
  }
  return CONFIG.TIERS[0].name;
}

export function xpForLevel(n: number): number {
  return CONFIG.XP_LEVEL_BASE + CONFIG.XP_LEVEL_INCREMENT * n;
}

export function levelForXp(xp: number): number {
  let level = 1;
  let needed = xpForLevel(level);
  while (xp >= needed) {
    xp -= needed;
    level++;
    needed = xpForLevel(level);
  }
  return level;
}

export function xpProgress(xp: number): { level: number; current: number; needed: number } {
  let level = 1;
  let current = xp;
  let needed = xpForLevel(level);
  while (current >= needed) {
    current -= needed;
    level++;
    needed = xpForLevel(level);
  }
  return { level, current, needed };
}
