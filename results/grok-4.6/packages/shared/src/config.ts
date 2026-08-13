export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_SEND_RATE: 30,
  INTERP_DELAY_MS: 100,
  PING_INTERVAL_MS: 2000,
  INPUT_BUFFER_MS: 1000,

  TILE_SIZE: 16,
  INTERNAL_W: 256,
  INTERNAL_H: 224,

  DUEL_WIDTH: 13,
  DUEL_HEIGHT: 11,
  FFA_WIDTH: 15,
  FFA_HEIGHT: 13,

  SPEED_BASE: 4.0,
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7.0,
  BALLOON_COUNT_BASE: 1,
  BALLOON_COUNT_CAP: 8,
  SPLASH_RANGE_BASE: 2,
  SPLASH_RANGE_CAP: 10,

  FUSE_TICKS: 90,
  SPLASH_LINGER_TICKS: 12,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,

  POWERUP_WEIGHTS: {
    extraBalloon: 0.38,
    bigSplash: 0.38,
    flippers: 0.19,
    rubberBoots: 0.05,
  } as const,

  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_COOLDOWN_TICKS: 150,
  REVENGE_RANGE: 3,

  TIDE_START_TICKS: 3600,
  TIDE_INTERVAL_TICKS: 45,

  ROUNDS_TO_WIN_DEFAULT: 3,
  ROUNDS_TO_WIN_OPTIONS: [2, 3, 5] as const,

  BOT_EASY_INTERVAL_MS: 450,
  BOT_MEDIUM_INTERVAL_MS: 250,
  BOT_HARD_INTERVAL_MS: 120,
  BOT_EASY_ERROR_RATE: 0.125,

  MM_TICK_MS: 2000,
  MM_INITIAL_RANGE: 100,
  MM_WIDEN_EVERY_MS: 10000,
  MM_WIDEN_BY: 50,
  MM_RANGE_CAP: 400,

  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K_STANDARD: 32,
  ELO_PROVISIONAL_GAMES: 10,

  TIERS: [
    { id: "puddle", name: "Puddle", min: 0 },
    { id: "pond", name: "Pond", min: 1000 },
    { id: "river", name: "River", min: 1150 },
    { id: "lake", name: "Lake", min: 1300 },
    { id: "ocean", name: "Ocean", min: 1500 },
    { id: "tsunami", name: "Tsunami", min: 1750 },
  ] as const,

  XP_PARTICIPATION: 20,
  XP_PER_PLACEMENT: [80, 50, 30, 15] as const,
  XP_PER_SOAK: 8,
  XP_PER_CASTLE: 2,
  XP_TUTORIAL: 40,

  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 10 * 60 * 1000,
  RATE_LIMIT_MSGS_PER_SEC: 60,

  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,

  HITSTOP_TICKS: 2,
} as const;

export type Config = typeof CONFIG;

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
    if (level > 99) break;
  }
  return level;
}

export function tierForRating(rating: number): (typeof CONFIG.TIERS)[number] {
  let found: (typeof CONFIG.TIERS)[number] = CONFIG.TIERS[0];
  for (const t of CONFIG.TIERS) {
    if (rating >= t.min) found = t;
  }
  return found;
}

export const ANIMALS = [
  { id: "frog", name: "Frog", unlockLevel: 1 },
  { id: "duck", name: "Duck", unlockLevel: 1 },
  { id: "otter", name: "Otter", unlockLevel: 3 },
  { id: "penguin", name: "Penguin", unlockLevel: 5 },
  { id: "cat", name: "Cat", unlockLevel: 8 },
  { id: "raccoon", name: "Raccoon", unlockLevel: 12 },
  { id: "turtle", name: "Turtle", unlockLevel: 16 },
  { id: "capybara", name: "Capybara", unlockLevel: 20 },
] as const;

export const HATS = [
  { id: "none", name: "None", unlockLevel: 1 },
  { id: "bucket", name: "Bucket Hat", unlockLevel: 2 },
  { id: "snorkel", name: "Snorkel", unlockLevel: 4 },
  { id: "crown", name: "Tiny Crown", unlockLevel: 7 },
  { id: "bandana", name: "Pirate Bandana", unlockLevel: 10 },
  { id: "propeller", name: "Propeller Cap", unlockLevel: 14 },
] as const;

export type AnimalId = (typeof ANIMALS)[number]["id"];
export type HatId = (typeof HATS)[number]["id"];

export const MAP_THEMES = ["backyard", "beach", "pool", "random"] as const;
export type MapTheme = (typeof MAP_THEMES)[number];
export type ResolvedTheme = Exclude<MapTheme, "random">;

export const GUEST_ADJECTIVES = [
  "Soggy",
  "Drippy",
  "Damp",
  "Splashy",
  "Bubbly",
  "Misty",
  "Puddle",
  "Wavy",
  "Foamy",
  "Dewy",
] as const;

export const GUEST_ANIMALS = [
  "Otter",
  "Frog",
  "Duck",
  "Newt",
  "Crab",
  "Seal",
  "Toad",
  "Guppy",
  "Clam",
  "Finch",
] as const;
