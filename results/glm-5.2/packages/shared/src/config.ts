// config.ts — single typed CONFIG object (spec §11).
// All tunables live here. Pure data, no logic.

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ; // ~33.33ms
export const SNAPSHOT_HZ = 15;
export const SNAPSHOT_EVERY_TICKS = TICK_HZ / SNAPSHOT_HZ; // 2
export const INTERP_DELAY_MS = 100;
export const INPUT_BUFFER_MS = 1000;
export const PING_INTERVAL_MS = 2000;

// Player stat progression
export const PLAYER_STATS = {
  speedBase: 4.0, // tiles/sec
  speedPerFlippers: 0.4,
  speedCap: 7.0,
  balloonCountBase: 1,
  balloonCountCap: 8,
  splashRangeBase: 2,
  splashRangeCap: 10,
} as const;

// Balloons & splashes
export const BALLOON_FUSE_TICKS = 90; // 3.0s
export const SPLASH_LINGER_TICKS = 12; // ~0.4s

// Map generation
export const CASTLE_DENSITY = 0.75; // fraction of empty tiles that become sandcastles

// Power-up odds (per castle). spec §4
export const POWERUP_BLOCK_CHANCE = 0.30; // 30% of castles are empty (no pickup)
export const POWERUP_WEIGHTS = {
  extraBalloon: 0.38,
  bigSplash: 0.38,
  flippers: 0.19,
  rubberBoots: 0.05,
} as const;

// Feature flags
export const ENABLE_KICK = true;
export const ENABLE_REVENGE_DUCKS_CASUAL = true;
export const ENABLE_REVENGE_DUCKS_RANKED = false;

// Rising Tide sudden death
export const TIDE_START_TICKS = 2 * 60 * TICK_HZ; // 2:00
export const TIDE_INTERVAL_TICKS = Math.round(1.5 * TICK_HZ); // ~1.5s per ring

// Bot parameters
export const BOTS = {
  easy: { decisionMs: 450, dangerMisjudge: 0.15, attackChance: 0.10 },
  medium: { decisionMs: 250, dangerMisjudge: 0.0, attackChance: 0.5 },
  hard: { decisionMs: 120, dangerMisjudge: 0.0, attackChance: 0.9 },
} as const;

// Matchmaking
export const MM = {
  tickMs: 2000,
  initialRange: 100,
  widenEveryMs: 10000,
  widenBy: 50,
  capRange: 400,
} as const;

// Elo
export const ELO = {
  start: 1000,
  provisionalGames: 10,
  KProvisional: 64,
  KNormal: 32,
} as const;

export const TIERS = [
  { name: "Puddle", min: 0 },
  { name: "Pond", min: 1000 },
  { name: "River", min: 1150 },
  { name: "Lake", min: 1300 },
  { name: "Ocean", min: 1500 },
  { name: "Tsunami", min: 1750 },
] as const;

export function tierFor(rating: number): string {
  let t: string = TIERS[0].name;
  for (const tier of TIERS) if (rating >= tier.min) t = tier.name;
  return t;
}

// XP & levels
export const XP = {
  perParticipation: 40,
  perPlacement: [120, 70, 40, 20], // 1st..4th
  perSoak: 15,
  perCastle: 3,
} as const;

export function xpForLevel(n: number): number {
  return 100 + 25 * n;
}

// Reconnect / rooms
export const RECONNECT_GRACE_MS = 15000;
export const ROOM_IDLE_TTL_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MSGS_PER_SEC = 60;

export const MODES = {
  duel: { arena: { w: 13, h: 11 }, roundsToWin: 3, players: 2 },
  ffa: { arena: { w: 15, h: 13 }, rounds: 3, players: 4, roundsToWin: 3 },
} as const;

export type GameMode = keyof typeof MODES;

export const ANIMALS = [
  "frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara",
] as const;
export type Animal = (typeof ANIMALS)[number];

export const HATS = [
  "none", "bucket", "snorkel", "crown", "bandana", "propeller",
] as const;
export type Hat = (typeof HATS)[number];

// Unlock levels (animal/hat)
export const UNLOCKS: Record<string, { level: number; kind: "animal" | "hat" }> = {
  frog: { level: 1, kind: "animal" },
  duck: { level: 1, kind: "animal" },
  otter: { level: 3, kind: "animal" },
  penguin: { level: 5, kind: "animal" },
  cat: { level: 8, kind: "animal" },
  raccoon: { level: 12, kind: "animal" },
  turtle: { level: 16, kind: "animal" },
  capybara: { level: 20, kind: "animal" },
  bucket: { level: 1, kind: "hat" },
  snorkel: { level: 4, kind: "hat" },
  crown: { level: 10, kind: "hat" },
  bandana: { level: 7, kind: "hat" },
  propeller: { level: 14, kind: "hat" },
};

export const DEFAULT_NICKNAME_ANIMALS = [
  "Otter", "Cat", "Duck", "Frog", "Penguin", "Raccoon", "Turtle", "Capybara",
];
export const DEFAULT_NICKNAME_ADJECTIVES = [
  "Soggy", "Splashy", "Damp", "Soaked", "Bubbly", "Drippy", "Puddled", "Misty",
];
