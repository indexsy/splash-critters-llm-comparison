// Single typed CONFIG object: every tunable gameplay/net/matchmaking number lives here.
import type { Difficulty, Mode, TierId } from './types';

export interface ModeConfig {
  w: number;
  h: number;
  maxPlayers: number;
}

export interface BotTuning {
  /** Milliseconds between (re)decisions; converted to ticks by the bot runner. */
  decisionMs: number;
  /** Chance per decision to misjudge danger timing (treat soon-to-burst tiles as later). */
  misjudgeChance: number;
  /** Chance per decision to go on the offensive when a target is in attackRadius. */
  aggression: number;
  /** Tile distance within which the bot considers attacking. */
  attackRadius: number;
  /** Hard-only behaviours: movement prediction, corridor cutting, chain engineering, kicks. */
  predictive: boolean;
}

export interface TierBand {
  id: TierId;
  name: string;
  /** Inclusive lower bound. */
  min: number;
}

export const CONFIG = {
  // ---- protocol / timing -------------------------------------------------
  PROTOCOL_VERSION: 1,
  TICK_RATE: 30,
  TICK_MS: 1000 / 30,
  /** Snapshot every N ticks: 30 / 2 = 15 Hz. */
  SNAPSHOT_EVERY_TICKS: 2,
  INPUT_SAMPLE_HZ: 60,
  INPUT_SEND_HZ: 30,
  /** Remote entities render at serverTime - this. */
  INTERP_DELAY_MS: 100,
  /** Client keeps up to ~1 s of unacknowledged inputs for rewind-replay. */
  INPUT_BUFFER_TICKS: 30,
  /** Server keeps at most this many queued inputs per player (oldest dropped). */
  SERVER_INPUT_QUEUE_MAX: 6,
  PING_INTERVAL_MS: 2000,
  MAX_MESSAGE_BYTES: 8192,

  // ---- geometry ------------------------------------------------------------
  /** Sub-units per tile. 3000 makes every speed step an integer units/tick. */
  SUB: 3000,
  /** Half-size of a critter's collision box in sub-units (0.4 tile). */
  PLAYER_HALF: 1200,
  MODES: {
    duel: { w: 13, h: 11, maxPlayers: 2 },
    ffa: { w: 15, h: 13, maxPlayers: 4 },
  } as Record<Mode, ModeConfig>,
  CASTLE_DENSITY: 0.75,
  /** Tiles kept clear in each direction from a spawn. */
  SPAWN_CLEAR: 2,

  // ---- match flow ------------------------------------------------------------
  ROUNDS_TO_WIN_DEFAULT: 3,
  ROUNDS_TO_WIN_OPTIONS: [2, 3, 5] as const,
  /** Hard cap on rounds (draw rounds do not score) to avoid endless matches. */
  MAX_ROUNDS: 15,
  MATCH_INTRO_MS: 3500,
  ROUND_INTRO_MS: 3000,
  /** Time after a round is decided before round_end is sent (splashes settle). */
  ROUND_OVER_DELAY_MS: 1500,
  /** Time the round result card stays up before the next round_start. */
  ROUND_END_MS: 3000,
  REMATCH_VOTE_MS: 30000,

  // ---- player stats -----------------------------------------------------------
  SPEED_BASE: 4.0,
  SPEED_STEP: 0.4,
  SPEED_CAP: 7.0,
  BALLOONS_BASE: 1,
  BALLOONS_CAP: 8,
  RANGE_BASE: 2,
  RANGE_CAP: 10,

  // ---- balloons & splashes -------------------------------------------------------
  FUSE_TICKS: 90,
  SPLASH_TICKS: 12,
  ENABLE_KICK: true,
  /** Kicked balloon slide speed in tiles/sec. */
  KICK_SPEED: 10,

  // ---- power-ups --------------------------------------------------------------------
  POWERUP_BLOCK_CHANCE: 0.3,
  /** Relative weights; order = PowerUp codes 1..4. */
  POWERUP_WEIGHTS: {
    balloon: 0.38, // Extra Balloon  (+1 balloonCount)
    range: 0.38, // Big Splash     (+1 splashRange)
    speed: 0.19, // Flippers       (+0.4 tiles/s)
    boots: 0.05, // Rubber Boots   (kick; applies once per player per round)
  },

  // ---- rising tide (sudden death) --------------------------------------------------
  /** 2:00 at 30 Hz. */
  TIDE_START_TICKS: 3600,
  /** One ring every ~1.5 s. */
  TIDE_INTERVAL_TICKS: 45,

  // ---- revenge ducks ----------------------------------------------------------------
  ENABLE_REVENGE_DUCKS: true,
  REVENGE_DUCKS_IN_RANKED: false,
  DUCK_SPEED: 6, // tiles/sec along the border loop
  DUCK_LOB_COOLDOWN_TICKS: 150, // 5 s
  DUCK_LOB_DISTANCE: 3,
  DUCK_BALLOON_RANGE: 2,
  DUCK_FUSE_TICKS: 60,

  // ---- emotes ---------------------------------------------------------------------
  EMOTE_COOLDOWN_MS: 1200,
  EMOTE_NAMES: ['quack', 'ribbit', 'squeak', 'honk'] as const,

  // ---- juice (client) -----------------------------------------------------------------
  HIT_STOP_TICKS: 2,
  SHAKE_BURST_PX: 2,
  SHAKE_CHAIN_PX: 4,

  // ---- bots ---------------------------------------------------------------------------
  BOTS: {
    easy: { decisionMs: 450, misjudgeChance: 0.125, aggression: 0.1, attackRadius: 3, predictive: false },
    medium: { decisionMs: 250, misjudgeChance: 0, aggression: 0.5, attackRadius: 4, predictive: false },
    hard: { decisionMs: 120, misjudgeChance: 0, aggression: 1, attackRadius: 99, predictive: true },
  } as Record<Difficulty, BotTuning>,
  /** Casual disconnects become this bot after RECONNECT_GRACE_MS. */
  DISCONNECT_BOT_DIFFICULTY: 'medium' as Difficulty,

  // ---- matchmaking ---------------------------------------------------------------------
  MM_TICK_MS: 2000,
  MM_BASE_RANGE: 100,
  MM_WIDEN_STEP: 50,
  MM_WIDEN_EVERY_MS: 10000,
  MM_MAX_RANGE: 400,

  // ---- Elo ------------------------------------------------------------------------------
  ELO_START: 1000,
  ELO_K_PROVISIONAL: 64,
  ELO_K: 32,
  ELO_PROVISIONAL_GAMES: 10,
  TIERS: [
    { id: 'puddle', name: 'Puddle', min: -Infinity },
    { id: 'pond', name: 'Pond', min: 1000 },
    { id: 'river', name: 'River', min: 1150 },
    { id: 'lake', name: 'Lake', min: 1300 },
    { id: 'ocean', name: 'Ocean', min: 1500 },
    { id: 'tsunami', name: 'Tsunami', min: 1750 },
  ] as TierBand[],

  // ---- XP & levels (curve: xpForLevel(n) = LEVEL_BASE + LEVEL_STEP * n) ---------------------
  XP: {
    PARTICIPATION: 40,
    /** Index = placement - 1. */
    PLACEMENT: [100, 60, 35, 20],
    ROUND_WIN: 15,
    PER_SOAK: 12,
    PER_CASTLE: 1,
    CASTLE_CAP: 60,
    TUTORIAL: 150,
    /** Practice vs bots earns this fraction of normal XP. */
    PRACTICE_MULT: 0.5,
  },
  LEVEL_BASE: 100,
  LEVEL_STEP: 25,

  // ---- server / accounts -------------------------------------------------------------------
  RECONNECT_GRACE_MS: 15000,
  ROOM_IDLE_TTL_MS: 10 * 60 * 1000,
  /** Rooms with no connected humans are removed after this long. */
  ROOM_EMPTY_TTL_MS: 60 * 1000,
  RATE_LIMIT_PER_SEC: 60,
  ROOM_CODE_LEN: 6,
  /** Room code characters: capitals and digits without look-alikes (no I, O, 0, 1). */
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  ROOM_NAME_MAX: 24,
  NICK_MIN: 3,
  NICK_MAX: 16,
} as const;

/** Movement speed in sub-units per tick for a given number of Flippers. Always an integer. */
export function speedUnitsPerTick(speedUps: number): number {
  const tilesPerSec = Math.min(CONFIG.SPEED_CAP, CONFIG.SPEED_BASE + CONFIG.SPEED_STEP * speedUps);
  return Math.round((tilesPerSec * CONFIG.SUB) / CONFIG.TICK_RATE);
}

/** Speed in tiles/sec for HUD display. */
export function speedTilesPerSec(speedUps: number): number {
  return Math.min(CONFIG.SPEED_CAP, CONFIG.SPEED_BASE + CONFIG.SPEED_STEP * speedUps);
}
