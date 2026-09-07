export const CONFIG = {
  TICK_RATE: 30,
  SNAPSHOT_RATE: 15,
  INPUT_RATE: 30,
  INTERPOLATION_MS: 100,
  INPUT_BUFFER_TICKS: 30,
  BASE_SPEED: 4,
  SPEED_UPGRADE: 0.4,
  MAX_SPEED: 7,
  BASE_BALLOONS: 1,
  MAX_BALLOONS: 8,
  BASE_RANGE: 2,
  MAX_RANGE: 10,
  PLAYER_RADIUS: 0.28,
  FUSE_TICKS: 90,
  SPLASH_TICKS: 12,
  KICK_STEP_TICKS: 4,
  CASTLE_DENSITY: 0.75,
  POWERUP_BLOCK_CHANCE: 0.3,
  POWERUP_WEIGHTS: { balloon: 0.38, range: 0.38, speed: 0.19, kick: 0.05 },
  ENABLE_KICK: true,
  ENABLE_REVENGE_DUCKS: true,
  RANKED_REVENGE_DUCKS: false,
  REVENGE_COOLDOWN_TICKS: 150,
  REVENGE_RANGE: 3,
  TIDE_START_TICKS: 3600,
  TIDE_INTERVAL_TICKS: 45,
  ROUND_COUNTDOWN_TICKS: 90,
  ROUND_BREAK_MS: 2800,
  BOT_INTERVAL_TICKS: { easy: 14, medium: 8, hard: 4 },
  BOT_ERROR_RATE: { easy: 0.12, medium: 0, hard: 0 },
  MATCHMAKER_INTERVAL_MS: 2000,
  MATCHMAKER_INITIAL_RANGE: 100,
  MATCHMAKER_WIDEN_BY: 50,
  MATCHMAKER_WIDEN_MS: 10000,
  MATCHMAKER_MAX_RANGE: 400,
  INITIAL_RATING: 1000,
  ELO_PROVISIONAL_GAMES: 10,
  ELO_K_PROVISIONAL: 64,
  ELO_K: 32,
  TIERS: [
    { name: "Puddle", min: 0, color: "#9aaeb9" },
    { name: "Pond", min: 1000, color: "#79be86" },
    { name: "River", min: 1150, color: "#55b8df" },
    { name: "Lake", min: 1300, color: "#868de9" },
    { name: "Ocean", min: 1500, color: "#f2bd57" },
    { name: "Tsunami", min: 1750, color: "#f77f86" },
  ],
  XP: {
    participation: 30,
    placement: [60, 35, 20, 10],
    soak: 8,
    castle: 1,
    tutorial: 50,
  },
  LEVEL_BASE_XP: 100,
  LEVEL_STEP_XP: 25,
  RECONNECT_GRACE_MS: 15000,
  ROOM_TTL_MS: 600000,
  RATE_LIMIT: 60,
  MAX_MESSAGE_BYTES: 4096,
  EMOTE_COOLDOWN_MS: 1500,
  PING_INTERVAL_MS: 2000,
  INPUT_STALE_MS: 250,
  MAX_ROOMS: 200,
  MAX_CONNECTIONS: 800,
  ARENAS: {
    duel: { width: 13, height: 11, players: 2 },
    ffa: { width: 15, height: 13, players: 4 },
  },
  ANIMALS: [
    { id: "frog", name: "Frog", level: 1, color: "#a9db65" },
    { id: "duck", name: "Duck", level: 1, color: "#ffd36e" },
    { id: "otter", name: "Otter", level: 3, color: "#bb886c" },
    { id: "penguin", name: "Penguin", level: 5, color: "#849cb4" },
    { id: "cat", name: "Cat", level: 7, color: "#f59b82" },
    { id: "raccoon", name: "Raccoon", level: 10, color: "#aca7bb" },
    { id: "turtle", name: "Turtle", level: 14, color: "#6da987" },
    { id: "capybara", name: "Capybara", level: 20, color: "#cba07a" },
  ],
  HATS: [
    { id: "none", name: "Just me", level: 1 },
    { id: "bucket", name: "Bucket Hat", level: 2 },
    { id: "snorkel", name: "Snorkel", level: 4 },
    { id: "bandana", name: "Pirate Bandana", level: 6 },
    { id: "propeller", name: "Propeller Cap", level: 9 },
    { id: "crown", name: "Tiny Crown", level: 12 },
  ],
} as const;

export function xpForLevel(level: number): number {
  return CONFIG.LEVEL_BASE_XP + CONFIG.LEVEL_STEP_XP * level;
}

export function levelProgress(xp: number): {
  level: number;
  current: number;
  required: number;
} {
  let level = 1;
  let current = Math.max(0, xp);
  while (current >= xpForLevel(level)) {
    current -= xpForLevel(level);
    level++;
  }
  return { level, current, required: xpForLevel(level) };
}

export function rankTier(rating: number): (typeof CONFIG.TIERS)[number] {
  return (
    [...CONFIG.TIERS].reverse().find((t) => rating >= t.min) ?? CONFIG.TIERS[0]
  );
}
