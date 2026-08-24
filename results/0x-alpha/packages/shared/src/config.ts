/** Single typed CONFIG — identical on server (authority) and client (prediction). */

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 15;
export const INTERP_DELAY_MS = 100;

export type MapTheme = "backyard" | "beach" | "pool";

export interface PowerupWeights {
  balloon: number;
  range: number;
  speed: number;
  boots: number;
}

export interface Config {
  tickRate: number;
  tickMs: number;
  snapshotRate: number;
  interpDelayMs: number;
  inputSendHz: number;
  pingIntervalMs: number;
  reconnectGraceMs: number;
  roomTtlMs: number;
  maxMsgsPerSec: number;
  emoteCooldownMs: number;

  speedBase: number;
  speedPerFlipper: number;
  speedCap: number;
  balloonCountBase: number;
  balloonCountCap: number;
  splashRangeBase: number;
  splashRangeCap: number;

  fuseTicks: number; // 90 ticks = 3.0s
  splashLingerTicks: number; // 12 ticks
  hitStopTicks: number;

  castleDensity: number;
  powerupBlockChance: number;
  powerupWeights: PowerupWeights;

  enableKick: boolean;
  kickSpeedTilesPerSec: number;

  roundsToWinDefault: number;
  roundTimeSec: number;
  tideStartSec: number;
  tideRingIntervalTicks: number;

  enableRevengeDucksCasual: boolean;
  enableRevengeDucksRanked: boolean;
  revengeDuckCooldownTicks: number;
  revengeRange: number;

  botIntervalsMs: { easy: number; medium: number; hard: number };
  botErrorRates: { easy: number; medium: number; hard: number };

  matchmakerTickMs: number;
  matchmakerStartRange: number;
  matchmakerWidenPer10s: number;
  matchmakerMaxRange: number;

  eloStart: number;
  eloKFresh: number;
  eloKNormal: number;
  freshGamesThreshold: number;

  tierBands: Array<{ name: string; min: number }>;

  xpParticipation: number;
  xpPerPlacementPoint: number;
  xpPerSoak: number;
  xpPerCastle: number;
  levelCurveBase: number;
  levelCurveSlope: number;

  unlocks: {
    animalsByLevel: Record<string, number>;
    hatsByLevel: Record<string, number>;
    startAnimals: string[];
  };
}

export const CONFIG: Config = {
  tickRate: TICK_RATE,
  tickMs: TICK_MS,
  snapshotRate: SNAPSHOT_RATE,
  interpDelayMs: INTERP_DELAY_MS,
  inputSendHz: 30,
  pingIntervalMs: 2000,
  reconnectGraceMs: 15000,
  roomTtlMs: 600000,
  maxMsgsPerSec: 60,
  emoteCooldownMs: 1500,

  speedBase: 4.0,
  speedPerFlipper: 0.4,
  speedCap: 7.0,
  balloonCountBase: 1,
  balloonCountCap: 8,
  splashRangeBase: 2,
  splashRangeCap: 10,

  fuseTicks: 90,
  splashLingerTicks: 12,
  hitStopTicks: 2,

  castleDensity: 0.75,
  powerupBlockChance: 0.3,
  powerupWeights: { balloon: 0.38, range: 0.38, speed: 0.19, boots: 0.05 },

  enableKick: true,
  kickSpeedTilesPerSec: 8,

  roundsToWinDefault: 3,
  roundTimeSec: 120,
  tideStartSec: 120,
  tideRingIntervalTicks: Math.round(1.5 * TICK_RATE),

  enableRevengeDucksCasual: true,
  enableRevengeDucksRanked: false,
  revengeDuckCooldownTicks: 5 * TICK_RATE,
  revengeRange: 3,

  botIntervalsMs: { easy: 450, medium: 250, hard: 120 },
  botErrorRates: { easy: 0.125, medium: 0.0, hard: 0.0 },

  matchmakerTickMs: 2000,
  matchmakerStartRange: 100,
  matchmakerWidenPer10s: 50,
  matchmakerMaxRange: 400,

  eloStart: 1000,
  eloKFresh: 64,
  eloKNormal: 32,
  freshGamesThreshold: 10,

  tierBands: [
    { name: "Puddle", min: -Infinity },
    { name: "Pond", min: 1000 },
    { name: "River", min: 1150 },
    { name: "Lake", min: 1300 },
    { name: "Ocean", min: 1500 },
    { name: "Tsunami", min: 1750 },
  ],

  xpParticipation: 20,
  xpPerPlacementPoint: 25,
  xpPerSoak: 15,
  xpPerCastle: 2,
  levelCurveBase: 100,
  levelCurveSlope: 25,

  unlocks: {
    startAnimals: ["frog", "duck"],
    animalsByLevel: {
      otter: 2,
      penguin: 4,
      cat: 6,
      raccoon: 9,
      turtle: 13,
      capybara: 20,
    },
    hatsByLevel: {
      bucket_hat: 1,
      snorkel: 3,
      tiny_crown: 5,
      pirate_bandana: 8,
      propeller_cap: 12,
    },
  },
};

export function tierFor(rating: number): string {
  let name = CONFIG.tierBands[0]!.name;
  for (const band of CONFIG.tierBands) if (rating >= band.min) name = band.name;
  return name;
}
