import type {
  AnimalId,
  ArenaTheme,
  Difficulty,
  GameMode,
  HatId,
  PowerupKind,
} from "./types.js";

export const ARENA_THEMES: ArenaTheme[] = ["backyard", "beach", "pool"];

export const THEME_LABELS: Record<ArenaTheme, string> = {
  backyard: "BACKYARD",
  beach: "BEACH",
  pool: "POOL PARTY",
};

export interface CosmeticDef<T extends string> {
  id: T;
  name: string;
  level: number;
  blurb: string;
}

export const ANIMALS: CosmeticDef<AnimalId>[] = [
  { id: "frog", name: "FROG", level: 1, blurb: "Bouncy and born for puddles." },
  { id: "duck", name: "DUCK", level: 1, blurb: "Water rolls right off." },
  { id: "otter", name: "OTTER", level: 2, blurb: "A slippery arena veteran." },
  { id: "penguin", name: "PENGUIN", level: 4, blurb: "Cool under pressure." },
  { id: "cat", name: "CAT", level: 6, blurb: "Hates water. Very dramatic." },
  { id: "raccoon", name: "RACCOON", level: 9, blurb: "Always finds the good loot." },
  { id: "turtle", name: "TURTLE", level: 12, blurb: "Slow and unsinkable." },
  { id: "capybara", name: "CAPYBARA", level: 20, blurb: "The final flex. Unbothered." },
];

export const HATS: CosmeticDef<HatId>[] = [
  { id: "none", name: "NO HAT", level: 1, blurb: "Let the ears breathe." },
  { id: "bucket", name: "BUCKET HAT", level: 2, blurb: "Sun protection with style." },
  { id: "snorkel", name: "SNORKEL", level: 4, blurb: "Optimistic about the tide." },
  { id: "crown", name: "TINY CROWN", level: 8, blurb: "Rule the splash zone." },
  { id: "bandana", name: "PIRATE BANDANA", level: 12, blurb: "Arr, that be a wet deck." },
  { id: "propeller", name: "PROPELLER CAP", level: 16, blurb: "Lift-off not included." },
];

export const TIERS = [
  { name: "PUDDLE", min: 0 },
  { name: "POND", min: 1000 },
  { name: "RIVER", min: 1150 },
  { name: "LAKE", min: 1300 },
  { name: "OCEAN", min: 1500 },
  { name: "TSUNAMI", min: 1750 },
] as const;

export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INTERPOLATION_DELAY_MS: 100,
  MATCH_INTRO_MS: 2200,
  ROUND_COUNTDOWN_MS: 3000,
  ROUND_END_MS: 2800,

  SPEED_BASE: 4.0,
  SPEED_STEP: 0.4,
  SPEED_MAX: 7.0,
  BALLOON_BASE: 1,
  BALLOON_MAX: 8,
  SPLASH_RANGE_BASE: 2,
  SPLASH_RANGE_MAX: 10,

  FUSE_TICKS: 90,
  SPLASH_TICKS: 12,
  PLAYER_RADIUS: 0.3,
  KICK_SLIDE_TICKS: 2,

  ARENAS: {
    duel: { w: 13, h: 11 },
    ffa: { w: 15, h: 13 },
  } satisfies Record<GameMode, { w: number; h: number }>,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    balloon: 0.38,
    splash: 0.38,
    flippers: 0.19,
    boots: 0.05,
  } satisfies Record<PowerupKind, number>,
  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_COOLDOWN_TICKS: 150,
  REVENGE_FUSE_TICKS: 60,

  TIDE_START_TICKS: 3600,
  TIDE_INTERVAL_TICKS: 45,

  MATCHMAKING: {
    tickMs: 2000,
    baseRange: 100,
    widenEveryMs: 10000,
    widenStep: 50,
    maxRange: 400,
    ffaSize: 4,
  },
  ROUNDS_TO_WIN: 3,
  ROUNDS_OPTIONS: [2, 3, 5] as const,

  ELO: {
    start: 1000,
    placementGames: 10,
    kPlacement: 64,
    kStandard: 32,
    ffaPairK: 3,
  },

  XP: {
    participation: 10,
    placement: [50, 30, 15, 5],
    soak: 8,
    castle: 2,
    roundWin: 12,
    levelBase: 100,
    levelStep: 25,
  },

  RECONNECT_GRACE_TICKS: 450,
  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 600000,
  RATE_LIMIT: { messagesPerSecond: 60, burst: 30 },
  MAX_NICKNAME_LENGTH: 16,
  MIN_NICKNAME_LENGTH: 3,

  BOTS: {
    easy: {
      decisionTicks: 14,
      dangerMistake: 0.12,
      attackRange: 2,
      label: "EASY",
    },
    medium: {
      decisionTicks: 8,
      dangerMistake: 0,
      attackRange: 4,
      label: "MEDIUM",
    },
    hard: {
      decisionTicks: 4,
      dangerMistake: 0,
      attackRange: 8,
      label: "HARD",
    },
  } satisfies Record<Difficulty, { decisionTicks: number; dangerMistake: number; attackRange: number; label: string }>,

  TUTORIAL_XP: 50,
} as const;

export function xpForLevel(level: number): number {
  return CONFIG.XP.levelBase + CONFIG.XP.levelStep * level;
}

export function levelFromXp(totalXp: number): number {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return level;
}

export function levelProgress(totalXp: number): {
  level: number;
  intoLevel: number;
  needed: number;
  ratio: number;
} {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  const needed = xpForLevel(level);
  return { level, intoLevel: remaining, needed, ratio: remaining / needed };
}

export function tierForRating(rating: number): string {
  if (rating >= 1750) return "TSUNAMI";
  if (rating >= 1500) return "OCEAN";
  if (rating >= 1300) return "LAKE";
  if (rating >= 1150) return "RIVER";
  if (rating >= 1000) return "POND";
  return "PUDDLE";
}

export function tierColor(tier: string): string {
  switch (tier) {
    case "PUDDLE":
      return "#6aa7a0";
    case "POND":
      return "#55c98f";
    case "RIVER":
      return "#45b6e8";
    case "LAKE":
      return "#6f83f5";
    case "OCEAN":
      return "#c86df0";
    case "TSUNAMI":
      return "#ffc94d";
    default:
      return "#9ab1b5";
  }
}

export function ratingSearchRange(waitMs: number): number {
  const steps = Math.floor(waitMs / CONFIG.MATCHMAKING.widenEveryMs);
  return Math.min(
    CONFIG.MATCHMAKING.maxRange,
    CONFIG.MATCHMAKING.baseRange + steps * CONFIG.MATCHMAKING.widenStep,
  );
}

export function botConfig(difficulty: Difficulty) {
  return CONFIG.BOTS[difficulty];
}
