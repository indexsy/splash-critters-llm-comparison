/**
 * CONFIG — single typed source of truth for all tunable game constants.
 * Shared verbatim by server (authority), client (prediction) and tests.
 */

import type { Difficulty, MapTheme, Mode, PowerUpType, RankTier } from './types';

export const CONFIG = {
  // ---- Netcode ----
  TICK_RATE: 30, // server sim ticks/sec (fixed)
  SNAPSHOT_RATE: 15, // snapshots/sec sent to clients
  INPUT_SEND_RATE: 30, // client input flushes/sec
  INPUT_SAMPLE_RATE: 60, // client polls keyboard at 60Hz
  INTERP_DELAY_MS: 100, // render remote entities at serverTime - this
  PING_INTERVAL_MS: 2000,
  INPUT_BUFFER_TICKS: 30, // ~1s of predicted inputs kept for reconciliation

  // ---- Arena dimensions per mode (odd so even pillars land on a border grid) ----
  ARENA: {
    duel: { w: 13, h: 11, players: 2 },
    ffa: { w: 15, h: 13, players: 4 },
  } as Record<Mode, { w: number; h: number; players: number }>,

  DEFAULT_ROUNDS_TO_WIN: 3,
  ALLOWED_ROUNDS_TO_WIN: [2, 3, 5] as const,

  // ---- Player stats (base + upgrade caps) ----
  SPEED_BASE: 4.0, // tiles / second
  SPEED_PER_FLIPPER: 0.4,
  SPEED_CAP: 7.0,
  BALLOON_BASE: 1,
  BALLOON_CAP: 8,
  RANGE_BASE: 2,
  RANGE_CAP: 10,
  PLAYER_RADIUS: 0.35, // collision radius in tiles

  // ---- Water balloons ----
  FUSE_TICKS: 90, // 3.0s @30Hz
  SPLASH_LINGER_TICKS: 12, // ~0.4s the splash soaks/lingers
  KICK_SLIDE_TILES_PER_SEC: 8, // sliding speed of a kicked balloon
  ENABLE_KICK: true,

  // ---- Map generation ----
  CASTLE_DENSITY: 0.75, // fraction of free (non-boulder) tiles that become sandcastles
  SPAWN_CLEAR_RADIUS: 2, // spawn tile + this many tiles per open direction kept clear

  // ---- Power-ups (pre-rolled per castle at map gen) ----
  POWERUP_BLOCK_CHANCE: 0.3, // chance a given castle hides a power-up
  POWERUP_WEIGHTS: {
    extraBalloon: 0.38,
    bigSplash: 0.38,
    flippers: 0.19,
    rubberBoots: 0.05,
  } as Record<PowerUpType, number>,

  // ---- Rising Tide (sudden death) ----
  TIDE_START_TICKS: 120 * 30, // 2:00
  TIDE_RING_INTERVAL_TICKS: Math.round(1.5 * 30), // one ring / ~1.5s
  ROUND_HARD_CAP_TICKS: 210 * 30, // absolute safety cap (3:30) -> draw if reached

  // ---- Revenge Ducks (casual fun; off in ranked) ----
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_RANKED: false,
  REVENGE_LOB_COOLDOWN_TICKS: 5 * 30,
  REVENGE_LOB_TILES: 3,

  // ---- Emotes ----
  EMOTE_COOLDOWN_TICKS: Math.round(1.5 * 30),
  EMOTE_BUBBLE_TICKS: Math.round(2.0 * 30),

  // ---- Bots ----
  BOT: {
    easy: { decisionMs: 450, dangerMisjudge: 0.25, attackRange: 0, aggression: 0.2 },
    medium: { decisionMs: 250, dangerMisjudge: 0.0, attackRange: 4, aggression: 0.55 },
    hard: { decisionMs: 120, dangerMisjudge: 0.0, attackRange: 99, aggression: 0.92 },
  } as Record<Difficulty, { decisionMs: number; dangerMisjudge: number; attackRange: number; aggression: number }>,

  // ---- Matchmaking ----
  MM_TICK_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN_PER_INTERVAL: 50,
  MM_WIDEN_INTERVAL_MS: 10000,
  MM_MAX_RANGE: 400,

  // ---- Elo / ranked ----
  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64, // first N games in a mode
  ELO_PROVISIONAL_GAMES: 10,
  ELO_K_ESTABLISHED: 32,
  RANK_TIERS: [
    { id: 'puddle', name: 'Puddle', min: -Infinity, max: 999 },
    { id: 'pond', name: 'Pond', min: 1000, max: 1149 },
    { id: 'river', name: 'River', min: 1150, max: 1299 },
    { id: 'lake', name: 'Lake', min: 1300, max: 1499 },
    { id: 'ocean', name: 'Ocean', min: 1500, max: 1749 },
    { id: 'tsunami', name: 'Tsunami', min: 1750, max: Infinity },
  ] as ReadonlyArray<RankTier>,

  // ---- Progression / XP ----
  XP: {
    participation: 50,
    perPlacement: [120, 70, 40, 20], // 1st..4th place bonus
    perSoak: 15,
    perCastle: 2,
    perRoundWon: 10,
  },
  // xpForLevel(n) = 100 + 25n  (xp needed to go from level n -> n+1)
  LEVEL_BASE_XP: 100,
  LEVEL_XP_PER_LEVEL: 25,
  MAX_LEVEL: 60,

  // ---- Lobby / lifecycle ----
  RECONNECT_GRACE_MS: 15000,
  ROOM_IDLE_TTL_MS: 10 * 60 * 1000,
  DISCONNECT_BOT_DIFFICULTY: 'medium' as Difficulty,

  // ---- Anti-cheat / rate limits ----
  MSG_RATE_PER_SEC: 60,
  MSG_RATE_BURST: 90,
  SPEED_TOLERANCE: 1.35, // allow this multiple of max speed before rejecting a move

  // ---- Themes ----
  THEMES: ['backyard', 'beach', 'pool'] as ReadonlyArray<MapTheme>,

  // ---- Countdown ----
  ROUND_INTRO_TICKS: 3 * 30, // "3-2-1-SPLASH!"
} as const;

export type Config = typeof CONFIG;

// ---- Derived helpers (pure) ----

/** XP required to advance FROM level n to n+1. */
export function xpForLevel(n: number): number {
  return CONFIG.LEVEL_BASE_XP + CONFIG.LEVEL_XP_PER_LEVEL * n;
}

/** Total cumulative XP required to REACH level n (level 1 = 0 xp). */
export function totalXpForLevel(n: number): number {
  let total = 0;
  for (let i = 1; i < n; i++) total += xpForLevel(i);
  return total;
}

/** Resolve a cumulative XP amount into { level, into, need }. */
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  while (level < CONFIG.MAX_LEVEL) {
    const need = xpForLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return { level, into: remaining, need: xpForLevel(level) };
}

export function tierForRating(rating: number): RankTier {
  for (const t of CONFIG.RANK_TIERS) {
    if (rating >= t.min && rating <= t.max) return t;
  }
  return CONFIG.RANK_TIERS[0];
}

export function effectiveKFactor(gamesPlayed: number): number {
  return gamesPlayed < CONFIG.ELO_PROVISIONAL_GAMES
    ? CONFIG.ELO_K_PROVISIONAL
    : CONFIG.ELO_K_ESTABLISHED;
}

/** Revenge ducks enabled for this match? */
export function revengeDucksEnabled(ranked: boolean): boolean {
  if (!CONFIG.ENABLE_REVENGE_DUCKS) return false;
  return ranked ? CONFIG.REVENGE_DUCKS_RANKED : true;
}
