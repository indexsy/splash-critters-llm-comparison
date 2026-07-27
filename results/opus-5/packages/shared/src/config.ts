/**
 * Splash Critters - single source of truth for every tunable number.
 *
 * Everything the simulation, the bots, the matchmaker, Elo and progression need
 * lives in this one typed object. Nothing else in the codebase should hard-code
 * a gameplay constant.
 */

import type { AnimalId, BotDifficulty, HatId, MapTheme, PowerupType, RankTierId } from './types.js';

export interface DropWeight {
  type: PowerupType;
  weight: number;
}

export interface BotProfile {
  /** Milliseconds between decisions. */
  intervalMs: number;
  /** Chance per decision to misjudge the danger map (0..1). */
  errorRate: number;
  /** 0..1 - how eagerly the bot walks toward enemies to attack. */
  aggression: number;
  /** Manhattan tile distance within which the bot will try to bomb a player. */
  attackRange: number;
  /** Hunts the closest player across the whole map rather than farming. */
  hunts: boolean;
  /** Deliberately tries to set up chain bursts and uses kicks. */
  engineersChains: boolean;
}

export interface RankTier {
  id: RankTierId;
  name: string;
  min: number;
  max: number;
}

export interface AnimalDef {
  id: AnimalId;
  name: string;
  /** Level required to unlock. 0 = available from the start. */
  unlockLevel: number;
  /** Base palette: [dark outline, body, belly/highlight]. */
  palette: [string, string, string];
  /** Emote sound tag. */
  voice: 'ribbit' | 'quack' | 'squeak' | 'honk' | 'meow' | 'chitter' | 'grunt';
  /** Cats hate water: extra dramatic soak animation. */
  dramaticSoak?: boolean;
}

export interface HatDef {
  id: HatId;
  name: string;
  unlockLevel: number;
}

export interface ThemeDef {
  id: MapTheme;
  name: string;
  /** [floor A, floor B, boulder, boulder shade, castle, castle shade] */
  palette: [string, string, string, string, string, string];
}

export const CONFIG = {
  // ---------------------------------------------------------------- net/timing
  /** Server simulation rate. All *_TICKS values are in these units. */
  TICK_RATE: 30,
  TICK_MS: 1000 / 30,
  /** Snapshots per second sent to clients (every 2nd tick). */
  SNAPSHOT_RATE: 15,
  /** Remote entities are rendered this far in the past, in ms. */
  INTERP_DELAY_MS: 100,
  /** Client keeps ~1s of inputs for rewind-replay reconciliation. */
  INPUT_BUFFER_TICKS: 30,
  /** Client input sample rate (Hz) and send rate (Hz). */
  INPUT_SAMPLE_HZ: 60,
  INPUT_SEND_HZ: 30,
  PING_INTERVAL_MS: 2000,

  // ------------------------------------------------------------------- arenas
  DUEL_WIDTH: 13,
  DUEL_HEIGHT: 11,
  FFA_WIDTH: 15,
  FFA_HEIGHT: 13,
  /** Fraction of free (non-boulder, non-spawn) tiles filled with sandcastles. */
  CASTLE_DENSITY: 0.75,
  /** Tiles kept clear in each cardinal direction from a spawn tile. */
  SPAWN_CLEAR_RADIUS: 2,

  // ------------------------------------------------------------- player stats
  SPEED_BASE: 4.0,
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7.0,
  BALLOONS_BASE: 1,
  BALLOONS_CAP: 8,
  RANGE_BASE: 2,
  RANGE_CAP: 10,
  /** Half-width of the player's square collision box, in tiles. */
  PLAYER_RADIUS: 0.35,
  /**
   * Guard band used when snapping flush against a wall. It has to survive the
   * three-decimal rounding snapshots go out with, otherwise a client rebuilding
   * a blocked critter from the wire would place its leading edge exactly on the
   * wall boundary and predict straight through it.
   */
  COLLISION_EPSILON: 0.001,

  // ----------------------------------------------------------------- balloons
  /** 90 ticks @30Hz = 3.0s. */
  FUSE_TICKS: 90,
  /** Splash lingers ~0.4s. */
  SPLASH_TICKS: 12,
  ENABLE_KICK: true,
  /** Tiles per second a kicked balloon slides. */
  KICK_SPEED: 8,
  /** Player must be this close to the lane centre to kick. */
  KICK_ALIGN_TOLERANCE: 0.3,

  // ----------------------------------------------------------------- power-ups
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: [
    { type: 'extra_balloon', weight: 0.38 },
    { type: 'big_splash', weight: 0.38 },
    { type: 'flippers', weight: 0.19 },
    { type: 'boots', weight: 0.05 },
  ] as DropWeight[],

  // --------------------------------------------------------- rounds & the tide
  /** 3-2-1-SPLASH! freeze before a round begins. */
  COUNTDOWN_TICKS: 90,
  /** Freeze after the last critter is soaked, before the next round. */
  ROUND_END_TICKS: 90,
  /** Rising Tide begins at 2:00 of round time. */
  TIDE_START_TICKS: 120 * 30,
  /** Ticks for one full ring to flood (~1.5s). */
  TIDE_RING_TICKS: 45,
  /** Alarm event fires this many ticks before the first flood. */
  TIDE_WARNING_TICKS: 90,
  /** Hard stop so a round can never run forever. */
  ROUND_MAX_TICKS: 300 * 30,

  // ------------------------------------------------------------- revenge ducks
  ENABLE_REVENGE_DUCKS: true,
  /** Ranked always overrides the above to false. */
  REVENGE_DUCKS_RANKED: false,
  /** 5s between lobs. */
  REVENGE_LOB_COOLDOWN_TICKS: 150,
  /** How far a lobbed balloon flies into the arena. */
  REVENGE_LOB_TILES: 3,
  /** Tiles per second the lob travels. */
  REVENGE_LOB_SPEED: 9,
  /** Fuse of the balloon a lob leaves behind. */
  REVENGE_LOB_FUSE_TICKS: 30,
  REVENGE_LOB_RANGE: 2,
  /** Tiles per second a duck paddles around the border. */
  DUCK_SPEED: 5,

  // -------------------------------------------------------------------- emotes
  EMOTE_COUNT: 4,
  EMOTE_COOLDOWN_TICKS: 45,
  EMOTE_BUBBLE_TICKS: 60,

  // --------------------------------------------------------------------- match
  /** Allowed "first to N round wins" options in the create-room dialog. */
  ROUNDS_TO_WIN_OPTIONS: [2, 3, 5],
  DEFAULT_ROUNDS_TO_WIN: 3,
  /** The tutorial is one scripted round, not a match, so it sits outside the options. */
  TUTORIAL_ROUNDS_TO_WIN: 1,
  MAX_ROUNDS: 9,

  // ---------------------------------------------------------------------- bots
  BOT_PROFILES: {
    easy: {
      intervalMs: 450,
      errorRate: 0.13,
      aggression: 0.1,
      attackRange: 2,
      hunts: false,
      engineersChains: false,
    },
    medium: {
      intervalMs: 250,
      errorRate: 0,
      aggression: 0.5,
      attackRange: 4,
      hunts: false,
      engineersChains: false,
    },
    hard: {
      intervalMs: 120,
      errorRate: 0,
      aggression: 1,
      attackRange: 8,
      hunts: true,
      engineersChains: true,
    },
  } as Record<BotDifficulty, BotProfile>,
  /** Extra ticks of margin a bot demands before trusting an escape route. */
  BOT_SAFETY_MARGIN_TICKS: 6,

  // ------------------------------------------------------------- matchmaking
  MM_TICK_MS: 2000,
  MM_RANGE_START: 100,
  MM_RANGE_WIDEN: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_RANGE_MAX: 400,

  // --------------------------------------------------------------------- elo
  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_PROVISIONAL_GAMES: 10,
  ELO_K: 32,
  RANK_TIERS: [
    { id: 'puddle', name: 'Puddle', min: -Infinity, max: 999 },
    { id: 'pond', name: 'Pond', min: 1000, max: 1149 },
    { id: 'river', name: 'River', min: 1150, max: 1299 },
    { id: 'lake', name: 'Lake', min: 1300, max: 1499 },
    { id: 'ocean', name: 'Ocean', min: 1500, max: 1749 },
    { id: 'tsunami', name: 'Tsunami', min: 1750, max: Infinity },
  ] as RankTier[],

  // ------------------------------------------------------------------ progression
  XP_PARTICIPATION: 50,
  /** Indexed by placement - 1. */
  XP_PLACEMENT: [100, 60, 35, 20],
  XP_PER_SOAK: 15,
  XP_PER_CASTLE: 2,
  XP_PER_ROUND_WIN: 25,
  XP_TUTORIAL: 150,
  /** XP required to advance from level n to n + 1. */
  XP_LEVEL_BASE: 100,
  XP_LEVEL_STEP: 25,
  MAX_LEVEL: 60,

  // ------------------------------------------------------------------ lifecycle
  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 10 * 60 * 1000,
  /** Rooms whose match never starts are also swept on this interval. */
  ROOM_SWEEP_MS: 30000,

  // ---------------------------------------------------------------- rate limits
  MAX_MSGS_PER_SEC: 60,
  /** Hard kill if a client exceeds this many violations. */
  MAX_RATE_VIOLATIONS: 20,
  MAX_MSG_BYTES: 8192,
  NICKNAME_MIN: 3,
  NICKNAME_MAX: 16,
  ROOM_NAME_MAX: 24,
  ROOM_CODE_LENGTH: 6,

  // ------------------------------------------------------------------ cosmetics
  ANIMALS: [
    { id: 'frog', name: 'Frog', unlockLevel: 0, palette: ['#123d1a', '#4fbe3f', '#a5e86b'], voice: 'ribbit' },
    { id: 'duck', name: 'Duck', unlockLevel: 0, palette: ['#5a3a06', '#ffd93d', '#fff3b0'], voice: 'quack' },
    { id: 'otter', name: 'Otter', unlockLevel: 3, palette: ['#33200f', '#a06a3a', '#e0b183'], voice: 'squeak' },
    { id: 'penguin', name: 'Penguin', unlockLevel: 5, palette: ['#0d1220', '#38455f', '#eef2ff'], voice: 'honk' },
    { id: 'cat', name: 'Cat', unlockLevel: 8, palette: ['#2c1c14', '#d98a4a', '#ffe0b8'], voice: 'meow', dramaticSoak: true },
    { id: 'raccoon', name: 'Raccoon', unlockLevel: 11, palette: ['#1b1b22', '#6b7280', '#d8dbe3'], voice: 'chitter' },
    { id: 'turtle', name: 'Turtle', unlockLevel: 15, palette: ['#123027', '#2f8f6a', '#9ee0b8'], voice: 'grunt' },
    { id: 'capybara', name: 'Capybara', unlockLevel: 20, palette: ['#3b2412', '#9a6b41', '#d9ab77'], voice: 'grunt' },
  ] as AnimalDef[],
  HATS: [
    { id: 'none', name: 'No Hat', unlockLevel: 0 },
    { id: 'bucket', name: 'Bucket Hat', unlockLevel: 2 },
    { id: 'snorkel', name: 'Snorkel', unlockLevel: 4 },
    { id: 'crown', name: 'Tiny Crown', unlockLevel: 7 },
    { id: 'bandana', name: 'Pirate Bandana', unlockLevel: 10 },
    { id: 'propeller', name: 'Propeller Cap', unlockLevel: 14 },
  ] as HatDef[],
  THEMES: [
    { id: 'backyard', name: 'Backyard', palette: ['#3c7d33', '#347029', '#8d6b4a', '#6b4f36', '#e6c48a', '#c49a5f'] },
    { id: 'beach', name: 'Beach', palette: ['#e8d59a', '#dcc888', '#8a8f98', '#6b7079', '#f0dfae', '#cdb17a'] },
    { id: 'pool', name: 'Pool Party', palette: ['#57c4d8', '#48b0c4', '#dfe6ec', '#b6c2ce', '#f4f7fb', '#c9d6e2'] },
  ] as ThemeDef[],

  /** Colourblind-safe splash palette toggle target (client render only). */
  SPLASH_COLORS: ['#7fdcff', '#39a9f0', '#ffffff'],
  SPLASH_COLORS_CB: ['#ffe066', '#f59f00', '#ffffff'],
};

export type GameConfig = typeof CONFIG;

/** XP required to advance from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return CONFIG.XP_LEVEL_BASE + CONFIG.XP_LEVEL_STEP * level;
}

/** Resolve total lifetime XP into a level plus progress inside that level. */
export function levelFromXp(totalXp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (level < CONFIG.MAX_LEVEL) {
    const needed = xpForLevel(level);
    if (remaining < needed) return { level, into: remaining, needed };
    remaining -= needed;
    level++;
  }
  return { level: CONFIG.MAX_LEVEL, into: 0, needed: xpForLevel(CONFIG.MAX_LEVEL) };
}

export function tierForRating(rating: number): RankTier {
  for (const tier of CONFIG.RANK_TIERS) {
    if (rating >= tier.min && rating <= tier.max) return tier;
  }
  return CONFIG.RANK_TIERS[0];
}

export function animalDef(id: AnimalId): AnimalDef {
  return CONFIG.ANIMALS.find((a) => a.id === id) ?? CONFIG.ANIMALS[0];
}

export function hatDef(id: HatId): HatDef {
  return CONFIG.HATS.find((h) => h.id === id) ?? CONFIG.HATS[0];
}

export function themeDef(id: MapTheme): ThemeDef {
  return CONFIG.THEMES.find((t) => t.id === id) ?? CONFIG.THEMES[0];
}
