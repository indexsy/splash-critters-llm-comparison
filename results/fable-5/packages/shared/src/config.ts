// Single source of truth for every tunable in the game.
// Server, client, and bots all read from this object — never hardcode a value
// that belongs here.

export type GameMode = "duel" | "ffa";
export type MapTheme = "backyard" | "beach" | "pool";
export type BotDifficulty = "easy" | "medium" | "hard";
export type PowerupType = "extra_balloon" | "big_splash" | "flippers" | "rubber_boots";

export interface TierBand {
  name: string;
  min: number; // inclusive lower bound; bands sorted ascending
}

export const CONFIG = {
  // --- Simulation timing ---
  TICK_RATE: 30, // server sim Hz
  SNAPSHOT_RATE: 15, // snapshots per second
  INTERP_DELAY_MS: 100, // remote entity interpolation delay
  INPUT_BUFFER_MS: 1000, // client-side input history for reconciliation
  PING_INTERVAL_MS: 2000,

  // --- Arenas ---
  ARENAS: {
    duel: { w: 13, h: 11, maxPlayers: 2 },
    ffa: { w: 15, h: 13, maxPlayers: 4 },
  } as Record<GameMode, { w: number; h: number; maxPlayers: number }>,
  CASTLE_DENSITY: 0.75, // fraction of eligible tiles that get a sandcastle

  // --- Player stats ---
  SPEED_BASE: 4.0, // tiles/sec
  SPEED_STEP: 0.4, // per Flippers pickup
  SPEED_CAP: 7.0,
  BALLOON_BASE: 1,
  BALLOON_CAP: 8,
  RANGE_BASE: 2,
  RANGE_CAP: 10,
  PLAYER_HALF_WIDTH: 0.38, // collision half-extent in tiles

  // --- Balloons & splashes ---
  FUSE_TICKS: 90, // 3.0s at 30Hz
  SPLASH_TICKS: 12, // splash lingers ~0.4s
  ENABLE_KICK: true,
  KICK_TICKS_PER_TILE: 4, // kicked balloon slides 1 tile per 4 ticks

  // --- Power-ups (pre-rolled into castles at map gen) ---
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: {
    extra_balloon: 0.38,
    big_splash: 0.38,
    flippers: 0.19,
    rubber_boots: 0.05,
  } as Record<PowerupType, number>,

  // --- Round timer & sudden death (Rising Tide) ---
  ROUND_INTRO_TICKS: 90, // "3-2-1-SPLASH!" freeze at round start
  TIDE_START_TICKS: 30 * 120, // 2:00 into the round
  TIDE_INTERVAL_TICKS: 45, // one ring per ~1.5s

  // --- Revenge ducks (casual only by default) ---
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_IN_RANKED: false,
  REVENGE_LOB_COOLDOWN_TICKS: 150, // 5s
  REVENGE_LOB_DISTANCE: 3, // tiles inward from the border
  REVENGE_LOB_FUSE_TICKS: 30, // 1s after landing
  REVENGE_LOB_RANGE: 1,
  DUCK_SPEED: 3.0, // tiles/sec along the border

  // --- Emotes ---
  EMOTE_COOLDOWN_MS: 1500,
  EMOTE_COUNT: 4,

  // --- Match structure ---
  DEFAULT_ROUNDS_TO_WIN: 3,
  ROUNDS_TO_WIN_OPTIONS: [2, 3, 5],
  MAX_ROUNDS: 15, // draw-round safety valve: most round wins takes the match
  ROUND_END_PAUSE_TICKS: 90, // scoreboard beat between rounds

  // --- Bots ---
  BOTS: {
    easy: { decisionMs: 450, errorRate: 0.12, attackRange: 1, aggression: 0.1 },
    medium: { decisionMs: 250, errorRate: 0, attackRange: 4, aggression: 0.5 },
    hard: { decisionMs: 120, errorRate: 0, attackRange: 99, aggression: 1.0 },
  } as Record<BotDifficulty, { decisionMs: number; errorRate: number; attackRange: number; aggression: number }>,

  // --- Matchmaking ---
  MATCHMAKER_TICK_MS: 2000,
  MM_INITIAL_RANGE: 100,
  MM_WIDEN_PER_10S: 50,
  MM_MAX_RANGE: 400,

  // --- Elo ---
  ELO_START: 1000,
  ELO_K_NEW: 64, // first N games in a mode
  ELO_K: 32,
  ELO_NEW_GAME_COUNT: 10,
  TIERS: [
    { name: "Puddle", min: 0 },
    { name: "Pond", min: 1000 },
    { name: "River", min: 1150 },
    { name: "Lake", min: 1300 },
    { name: "Ocean", min: 1500 },
    { name: "Tsunami", min: 1750 },
  ] as TierBand[],

  // --- XP & levels ---
  XP_PARTICIPATION: 25,
  XP_PER_SOAK: 15,
  XP_PER_CASTLE: 1,
  XP_PLACEMENT: [60, 35, 20, 10], // by placement 1..4
  XP_TUTORIAL: 50,

  // --- Connections & rooms ---
  RECONNECT_GRACE_MS: 15_000,
  ROOM_IDLE_TTL_MS: 10 * 60_000,
  RATE_LIMIT_MSGS_PER_SEC: 60,
  MAX_ROOM_NAME_LEN: 24,
  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,
} as const;

/** XP needed to go from level n to n+1. */
export function xpForLevel(n: number): number {
  return 100 + 25 * n;
}

/** Total XP → current level (level 1 at 0 XP). */
export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return level;
}

/** XP progress within the current level: [earned, needed]. */
export function xpProgress(xp: number): [number, number] {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return [remaining, xpForLevel(level)];
}

export function tierForRating(rating: number): string {
  let tier = CONFIG.TIERS[0].name;
  for (const band of CONFIG.TIERS) {
    if (rating >= band.min) tier = band.name;
  }
  return tier;
}

// --- Cosmetics (all cosmetic, never pay/power) ---
export interface AnimalDef {
  id: string;
  name: string;
  unlockLevel: number;
}
export interface HatDef {
  id: string;
  name: string;
  unlockLevel: number;
}

export const ANIMALS: AnimalDef[] = [
  { id: "frog", name: "Frog", unlockLevel: 1 },
  { id: "duck", name: "Duck", unlockLevel: 1 },
  { id: "otter", name: "Otter", unlockLevel: 3 },
  { id: "penguin", name: "Penguin", unlockLevel: 5 },
  { id: "cat", name: "Cat", unlockLevel: 8 },
  { id: "raccoon", name: "Raccoon", unlockLevel: 11 },
  { id: "turtle", name: "Turtle", unlockLevel: 14 },
  { id: "capybara", name: "Capybara", unlockLevel: 20 },
];

export const HATS: HatDef[] = [
  { id: "none", name: "No Hat", unlockLevel: 1 },
  { id: "bucket", name: "Bucket Hat", unlockLevel: 2 },
  { id: "snorkel", name: "Snorkel", unlockLevel: 4 },
  { id: "crown", name: "Tiny Crown", unlockLevel: 7 },
  { id: "bandana", name: "Pirate Bandana", unlockLevel: 10 },
  { id: "propeller", name: "Propeller Cap", unlockLevel: 15 },
];
