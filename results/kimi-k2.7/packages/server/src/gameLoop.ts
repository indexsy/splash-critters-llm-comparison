import type { Difficulty, InputState, MatchState, SimInput, Theme } from "@splash/shared";
import { CONFIG } from "@splash/shared";
import { buildSnapshot, createRoundState, resetIdCounter, simulateTick } from "@splash/shared";
import type { Connection } from "./net.js";
import { broadcastToRoom, send } from "./net.js";
import { createBot, getBotInput, type BotController } from "./bots/bot.js";

export type RunningMatch = {
  match: MatchState;
  roomCode: string;
  conns: Map<string, Connection>;
  bots: Map<string, BotController>;
  inputs: Map<string, InputState>;
  roundStartDelayTicks: number;
  ended: boolean;
  stats: Record<string, { soaks: number; castles: number; roundsWon: number }>;
  soaksBy: Record<string, Record<string, number>>;
  onFinish: (m: RunningMatch) => void;
  finishHandled: boolean;
};

export function startMatch(
  match: MatchState,
  roomCode: string,
  conns: Connection[],
  botSlots: { slot: number; difficulty: Difficulty; playerId: string; nickname: string; animal: string; hat: string }[],
  onFinish: (m: RunningMatch) => void
): RunningMatch {
  resetIdCounter();
  const rm: RunningMatch = {
    match,
    roomCode,
    conns: new Map(conns.map((c) => [c.playerId, c])),
    bots: new Map(),
    inputs: new Map(),
    roundStartDelayTicks: CONFIG.TICK_RATE * 3,
    ended: false,
    stats: {},
    soaksBy: {},
    onFinish,
    finishHandled: false,
  };

  // Add bot players
  for (const b of botSlots) {
    match.players.push({ id: b.playerId, nickname: b.nickname, animal: b.animal as any, hat: b.hat as any });
    rm.bots.set(b.playerId, createBot(b.playerId, b.difficulty));
  }

  // Init stats
  for (const p of match.players) {
    rm.stats[p.id] = { soaks: 0, castles: 0, roundsWon: 0 };
    rm.soaksBy[p.id] = {};
  }

  broadcastMatchStart(rm);
  startRound(rm, 1);
  return rm;
}

export function startRound(rm: RunningMatch, roundNo: number) {
  const mode = rm.match.mode;
  const theme: Theme = rm.match.theme;
  const seed = Math.floor(Math.random() * 0x7fffffff);
  rm.match.roundNo = roundNo;
  rm.match.round = createRoundState(
    mode,
    roundNo,
    seed,
    theme,
    rm.match.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      animal: p.animal,
      hat: p.hat,
      slot: 0,
      botDifficulty: rm.bots.has(p.id) ? rm.bots.get(p.id)!.difficulty : undefined,
    }))
  );
  rm.inputs.clear();
  rm.roundStartDelayTicks = CONFIG.TICK_RATE * 3;

  // Send round_start to humans
  const grid = rm.match.round.castles.map((col) => col.map((c) => !!c?.hasCastle)
  );
  for (const c of rm.conns.values()) {
    send(c.ws, { type: "round_start", roundNo, mapSeed: seed, castleGrid: grid, theme });
  }
}

export function tickMatch(rm: RunningMatch) {
  if (rm.ended) return;
  const round = rm.match.round;
  if (!round) return;

  if (rm.roundStartDelayTicks > 0) {
    rm.roundStartDelayTicks--;
    return;
  }

  // Collect inputs
  const simInputs: SimInput[] = [];
  for (const p of round.players) {
    if (rm.bots.has(p.id)) {
      const bot = rm.bots.get(p.id)!;
      const input = getBotInput(round, bot, round.tick);
      simInputs.push({ playerId: p.id, tick: round.tick, dir: input.dir, balloonPressed: input.balloonPressed, kickPressed: input.kickPressed });
    } else {
      const c = rm.conns.get(p.id);
      let input: InputState | undefined;
      if (c) {
        // Use latest buffered input
        input = c.inputBuffer[c.inputBuffer.length - 1];
      }
      simInputs.push({
        playerId: p.id,
        tick: round.tick,
        dir: input?.dir ?? { x: 0, y: 0 },
        balloonPressed: input?.balloonPressed ?? false,
        kickPressed: input?.kickPressed ?? false,
      });
    }
  }

  simulateTick(round, simInputs);

  // Track stats from events
  for (const ev of round.events) {
    if (ev.type === "player_soaked" && ev.byPlayerId) {
      rm.stats[ev.byPlayerId].soaks++;
      rm.soaksBy[ev.byPlayerId][ev.playerId] = (rm.soaksBy[ev.byPlayerId][ev.playerId] ?? 0) + 1;
    }
    if (ev.type === "castle_washed") {
      // approximate: count all castle washes, no owner attribution
    }
  }

  // Snapshot humans every other tick (15Hz)
  if (round.tick % (CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE) === 0) {
    const snap = buildSnapshot(round);
    for (const c of rm.conns.values()) {
      send(c.ws, { type: "snapshot", snap });
    }
  }

  // Also send events individually so clients don't miss them
  for (const ev of round.events) {
    for (const c of rm.conns.values()) {
      send(c.ws, { type: "event", event: ev });
    }
  }

  if (round.ended) {
    handleRoundEnd(rm);
  }
}

function handleRoundEnd(rm: RunningMatch) {
  const round = rm.match.round!;
  let winnerId = round.winnerId;
  if (round.draw) winnerId = null;
  if (winnerId) {
    rm.match.roundWins[winnerId] = (rm.match.roundWins[winnerId] ?? 0) + 1;
    rm.stats[winnerId].roundsWon++;
  }

  broadcastToRoom(rm.roomCode, {
    type: "round_end",
    roundNo: round.roundNo,
    winnerId,
    draw: round.draw,
    roundWins: { ...rm.match.roundWins },
  });

  // Check match end
  const target = CONFIG.ROUND_WIN_FIRST_TO;
  const winner = Object.entries(rm.match.roundWins).find(([, wins]) => wins >= target);
  if (winner) {
    endMatch(rm);
  } else {
    setTimeout(() => startRound(rm, round.roundNo + 1), 2000);
  }
}

function endMatch(rm: RunningMatch) {
  rm.ended = true;
  if (!rm.finishHandled) {
    rm.finishHandled = true;
    rm.onFinish(rm);
  }
}

function broadcastMatchStart(rm: RunningMatch) {
  broadcastToRoom(rm.roomCode, {
    type: "match_start",
    matchId: rm.match.id,
    mode: rm.match.mode,
    theme: rm.match.theme as any,
    players: rm.match.players.map((p) => ({ id: p.id, nickname: p.nickname, animal: p.animal, hat: p.hat })),
  });
}

export function setPlayerInput(rm: RunningMatch, playerId: string, input: InputState) {
  rm.inputs.set(playerId, input);
}

export function addConnectionToMatch(rm: RunningMatch, conn: Connection) {
  rm.conns.set(conn.playerId, conn);
}

export function removeConnectionFromMatch(rm: RunningMatch, playerId: string) {
  rm.conns.delete(playerId);
}
