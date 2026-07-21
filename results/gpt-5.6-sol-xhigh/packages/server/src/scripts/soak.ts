import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import {
  CONFIG,
  createGameState,
  publicMap,
  simulateTick,
  type Difficulty,
  type GameState,
  type Mode,
  type PlayerInput
} from "@splash/shared";
import { resolveTheme } from "../rooms.js";
import { decideBotInput, nextBotSeq } from "../bots/bot.js";
import { runMigrations } from "../db/migrations.js";
import { recordMatch } from "../db/queries.js";

const TICK_RATE = CONFIG.TICK_RATE;
const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_RATE / CONFIG.SNAPSHOT_RATE));
const ROUND_END_DELAY_TICKS = 90;
const MATCH_END_DELAY_TICKS = 60;
const STALE_TICK_CAP = 30 * 60 * 8;
const FIXED_SEED = 0xc0ffee;

interface SoakParticipant {
  playerId: string;
  name: string;
  difficulty: Difficulty;
  pendingInput?: PlayerInput;
  lastSeq: number;
  nextDecisionTick: number;
  matchSoaks: number;
  matchCastles: number;
  placement: number;
}

interface SoakRuntime {
  state: GameState;
  roundNo: number;
}

function makeParticipants(mode: Mode): SoakParticipant[] {
  const size = mode === "duel" ? 2 : 4;
  const difficulties: Difficulty[] = ["easy", "medium", "hard", "medium"];
  const participants: SoakParticipant[] = [];
  for (let i = 0; i < size; i++) {
    participants.push({
      playerId: `bot_${i}`,
      name: `Bot${i}(${difficulties[i]})`,
      difficulty: difficulties[i]!,
      lastSeq: 0,
      nextDecisionTick: 0,
      matchSoaks: 0,
      matchCastles: 0,
      placement: 0
    });
  }
  return participants;
}

interface MatchRunResult {
  durationTicks: number;
  finalScores: Record<string, number>;
  placements: Array<{ playerId: string; placement: number; soaks: number; castles: number }>;
  snapshots: number;
}

function runMatch(mode: Mode, roundsToWin: number): MatchRunResult {
  const participants = makeParticipants(mode);
  const players = participants.map((p) => ({ id: p.playerId, name: p.name }));
  const scores = new Map<string, number>(participants.map((p) => [p.playerId, 0]));
  void resolveTheme("random");
  const startSeed = (FIXED_SEED + 1 * 2654435761) >>> 0;
  const runtime: SoakRuntime = { state: createGameState(startSeed, mode, players), roundNo: 1 };
  runtime.state.roundStartedAt = 0;
  let durationTicks = 0;
  let roundEndAt: number | undefined = undefined;
  let matchEndAt: number | undefined = undefined;
  let snapshots = 0;

  const startRound = (roundNo: number): void => {
    const seed = (FIXED_SEED + roundNo * 2654435761) >>> 0;
    runtime.state = createGameState(seed, mode, players);
    runtime.roundNo = roundNo;
    runtime.state.roundStartedAt = 0;
    roundEndAt = undefined;
    for (const p of participants) {
      delete p.pendingInput;
      p.lastSeq = 0;
      p.nextDecisionTick = 0;
    }
  };

  while (durationTicks < STALE_TICK_CAP) {
    durationTicks++;
    const state = runtime.state;

    if (matchEndAt !== undefined) {
      if (durationTicks - matchEndAt >= MATCH_END_DELAY_TICKS) break;
      if (durationTicks % SNAPSHOT_EVERY === 0) {
        verifySnapshot(state);
        snapshots++;
      }
      continue;
    }

    if (state.roundOver) {
      if (roundEndAt === undefined) {
        roundEndAt = durationTicks;
        for (const id of state.winnerIds) scores.set(id, (scores.get(id) ?? 0) + 1);
        for (const p of participants) {
          const sim = state.players.find((sp) => sp.id === p.playerId);
          if (sim) {
            p.matchSoaks += sim.soaks;
            p.matchCastles += sim.castlesWashed;
          }
        }
      }
      if (durationTicks - roundEndAt >= ROUND_END_DELAY_TICKS) {
        const reached = [...scores.values()].some((s) => s >= roundsToWin);
        if (reached) {
          matchEndAt = durationTicks;
        } else {
          startRound(runtime.roundNo + 1);
        }
      }
      if (durationTicks % SNAPSHOT_EVERY === 0) {
        verifySnapshot(state);
        snapshots++;
      }
      continue;
    }

    const inputs: PlayerInput[] = [];
    for (const p of participants) {
      const interval = CONFIG.BOT_INTERVAL_TICKS[p.difficulty];
      const shouldDecide = durationTicks >= p.nextDecisionTick;
      if (shouldDecide) {
        p.nextDecisionTick = durationTicks + interval;
        const rng = makeRng(state.map.seed + state.tick * 7919 + p.playerId.length + runtime.roundNo);
        const decision = decideBotInput(state, p.playerId, p.difficulty, nextBotSeq(), rng);
        decision.tick = state.tick + 1;
        p.pendingInput = decision;
      } else if (p.pendingInput) {
        p.pendingInput = { ...p.pendingInput, seq: nextBotSeq(), tick: state.tick + 1 };
      } else {
        p.pendingInput = { playerId: p.playerId, seq: nextBotSeq(), tick: state.tick + 1, dir: "none", balloonPressed: false };
      }
      if (p.pendingInput && p.pendingInput.seq > p.lastSeq) {
        inputs.push(p.pendingInput);
      }
    }
    simulateTick(state, inputs);
    for (const p of participants) {
      if (p.pendingInput && p.pendingInput.seq > p.lastSeq) p.lastSeq = p.pendingInput.seq;
    }
    if (durationTicks % SNAPSHOT_EVERY === 0) {
      verifySnapshot(state);
      snapshots++;
    }
  }

  if (matchEndAt === undefined) {
    throw new Error(`match stalled: duration=${durationTicks}, scores=${JSON.stringify(Object.fromEntries(scores))}`);
  }

  const sorted = [...participants].sort((a, b) => {
    const sa = scores.get(a.playerId) ?? 0;
    const sb = scores.get(b.playerId) ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.matchSoaks + b.matchCastles) - (a.matchSoaks + a.matchCastles);
  });
  sorted.forEach((p, idx) => { p.placement = idx + 1; });
  return {
    durationTicks,
    finalScores: Object.fromEntries(scores),
    placements: sorted.map((p) => ({ playerId: p.playerId, placement: p.placement, soaks: p.matchSoaks, castles: p.matchCastles })),
    snapshots
  };
}

function verifySnapshot(state: GameState): void {
  const safe = publicMap(state.map);
  if (Object.keys(safe.hiddenPowerups).length > 0) {
    throw new Error("public snapshot leaked hiddenPowerups");
  }
}

function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function persistSoakMatch(db: Database.Database, mode: Mode, result: MatchRunResult): void {
  recordMatch(db, {
    mode,
    ranked: false,
    roomCode: "SOAK",
    roundsToWin: 3,
    theme: "backyard",
    durationTicks: result.durationTicks
  }, result.placements.map((p) => ({
    playerId: p.playerId,
    bot: true,
    placement: p.placement,
    roundsWon: result.finalScores[p.playerId] ?? 0,
    soaks: p.soaks,
    castles: p.castles,
    ratingBefore: 0,
    ratingAfter: 0,
    ratingDelta: 0,
    xpGained: 0
  })));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const iterationsArg = args.findIndex((a) => a === "--iterations");
  const iterations = iterationsArg >= 0 ? Number(args[iterationsArg + 1] ?? 1) : 1;
  const mode: Mode = args.includes("--duel") ? "duel" : "ffa";
  const roundsToWin = 3;
  const failures: string[] = [];
  let lastResult: MatchRunResult | null = null;

  for (let i = 0; i < iterations; i++) {
    try {
      const result = runMatch(mode, roundsToWin);
      lastResult = result;
      console.log(
        `[soak] iter=${i + 1}/${iterations} mode=${mode} ticks=${result.durationTicks} ` +
        `snapshots=${result.snapshots} scores=${JSON.stringify(result.finalScores)} ` +
        `placements=${result.placements.map((p) => `${p.playerId}=${p.placement}`).join(",")}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`iter=${i + 1}: ${msg}`);
      console.error(`[soak] iter=${i + 1} FAILED: ${msg}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      break;
    }
  }

  const tmpDir = process.env.SOAK_DATA_DIR ?? "/tmp/splash-soak";
  mkdirSync(tmpDir, { recursive: true });
  const db = new Database(`${tmpDir}/soak.db`);
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  if (lastResult) {
    persistSoakMatch(db, mode, lastResult);
    console.log(`[soak] persisted 1 match record to ${tmpDir}/soak.db`);
  }
  db.close();

  if (failures.length > 0) {
    console.error(`[soak] ${failures.length} failure(s).`);
    return 1;
  }
  if (!lastResult) {
    console.error("[soak] no result produced");
    return 2;
  }
  if (lastResult.durationTicks >= STALE_TICK_CAP) {
    console.error("[soak] match stalled without completion");
    return 3;
  }
  if (mode === "ffa" && lastResult.placements.length !== 4) {
    console.error("[soak] placements incomplete for FFA");
    return 4;
  }
  if (mode === "ffa") {
    const hard = lastResult.placements.find((entry) => entry.playerId === "bot_2");
    const easy = lastResult.placements.find((entry) => entry.playerId === "bot_0");
    if (!hard || !easy || hard.placement >= easy.placement) {
      console.error("[soak] hard bot did not beat easy bot");
      return 6;
    }
  }
  if (mode === "duel" && lastResult.placements.length !== 2) {
    console.error("[soak] placements incomplete for duel");
    return 5;
  }
  console.log("[soak] OK");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[soak] crash", err);
    process.exit(99);
  });
