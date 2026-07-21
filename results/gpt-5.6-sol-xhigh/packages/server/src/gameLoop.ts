import {
  CONFIG,
  createGameState,
  publicMap,
  simulateTick,
  type ClientMessage,
  type GameState,
  type Mode,
  type PlayerInput,
  type ServerMessage,
  type SimEvent,
  type SimPlayer
} from "@splash/shared";
import type Database from "better-sqlite3";
import type { WebSocket } from "ws";
import {
  type MatchContext,
  type MatchParticipant,
  type Room,
  type RoomStore
} from "./rooms.js";
import { decideBotInput, nextBotSeq } from "./bots/bot.js";
import { applyDuelResult, applyFfaResult, type PlayerSlot } from "./elo.js";
import { addXp, getPlayerById, recordMatch, type MatchRecordInput } from "./db/queries.js";

const TICK_MS = Math.round(1000 / CONFIG.TICK_RATE);
const SNAPSHOT_EVERY = Math.max(1, Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE));
const ROUND_END_DELAY_TICKS = 90;
const MATCH_END_DELAY_TICKS = 120;
const STALE_TICK_CAP = 30 * 60 * 5;
const RECONNECT_GRACE_TICKS = Math.round((CONFIG.RECONNECT_GRACE_MS / 1000) * CONFIG.TICK_RATE);

export interface ServerContext {
  readonly db: Database.Database;
  readonly rooms: RoomStore;
  readonly connections: Map<string, WebSocket>;
  readonly playerConnections: Map<string, WebSocket>;
  broadcast: (room: Room, message: ServerMessage) => void;
  sendToPlayer: (playerId: string, message: ServerMessage) => void;
}

export interface GameLoop {
  start: () => void;
  stop: () => void;
  pushInput: (room: Room, playerId: string, input: PlayerInput) => void;
  markParticipantDisconnect: (room: Room, playerId: string) => void;
  reconnected: (room: Room, playerId: string) => void;
}

interface RoomRuntime {
  state: GameState;
  roundNo: number;
}

const roomRuntimes = new WeakMap<MatchContext, RoomRuntime>();

export function createGameLoop(ctx: ServerContext): GameLoop {
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  let ticking = false;

  const pushInput: GameLoop["pushInput"] = (room, playerId, input) => {
    const match = room.match;
    if (!match) return;
    const participant = match.participants.find((p) => p.playerId === playerId);
    if (!participant || participant.isBot) return;
    participant.pendingInput = input;
  };

  const markParticipantDisconnect: GameLoop["markParticipantDisconnect"] = (room, playerId) => {
    const match = room.match;
    if (!match) return;
    const participant = match.participants.find((p) => p.playerId === playerId);
    if (!participant || participant.isBot) return;
    if (participant.disconnectedAt === undefined) participant.disconnectedAt = match.durationTicks;
  };

  const reconnected: GameLoop["reconnected"] = (room, playerId) => {
    const match = room.match;
    if (!match) return;
    const participant = match.participants.find((p) => p.playerId === playerId);
    if (!participant) return;
    if (!match.ranked || !participant.forfeited) {
      participant.isBot = false;
      delete participant.difficulty;
      delete participant.pendingInput;
      delete participant.disconnectedAt;
      participant.forfeited = false;
    }
    ctx.sendToPlayer(playerId, {
      type: "match_start",
      config: { mode: match.mode, ranked: match.ranked, roundsToWin: match.roundsToWin, theme: match.theme }
    });
    const runtime = roomRuntimes.get(match);
    if (runtime) {
      ctx.sendToPlayer(playerId, {
        type: "round_start",
        roundNo: match.roundNo,
        mapSeed: runtime.state.map.seed,
        castleGrid: runtime.state.map.tiles.map((row) => row.map((tile) => tile as number)),
        theme: match.theme
      });
      ctx.sendToPlayer(playerId, {
        type: "snapshot",
        state: { ...runtime.state, map: publicMap(runtime.state.map) },
        serverTime: Date.now(),
        ackSeq: participant.lastSeq
      });
    }
  };

  const tick = (): void => {
    if (ticking) return;
    ticking = true;
    try {
      for (const room of ctx.rooms.list()) {
        const match = room.match;
        if (!match || match.finished) continue;
        if (room.phase !== "playing") continue;
        stepRoom(ctx, room, match);
      }
    } catch (err) {
      logError("gameloop", err);
    } finally {
      ticking = false;
    }
  };

  const start: GameLoop["start"] = () => {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
  };
  const stop: GameLoop["stop"] = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  return { start, stop, pushInput, markParticipantDisconnect, reconnected };
}

function stepRoom(ctx: ServerContext, room: Room, match: MatchContext): void {
  const runtime = ensureRuntime(ctx, room, match);
  if (!runtime) return;
  const state = runtime.state;
  match.durationTicks++;
  handleDisconnectGraces(ctx, room, match, state);
  if (match.matchEndAt !== undefined) {
    if (match.durationTicks - match.matchEndAt >= MATCH_END_DELAY_TICKS) concludeMatch(ctx, room, match, state);
    accumulateRoundStats(match, state);
    maybeSnapshot(ctx, room, match, state);
    return;
  }
  if (state.roundOver) {
    if (match.roundEndAt === undefined) {
      match.roundEndAt = match.durationTicks;
      finalizeRound(ctx, room, match, state);
    }
      if (match.durationTicks - match.roundEndAt >= ROUND_END_DELAY_TICKS) {
        const reached = [...match.scores.values()].some((s) => s >= match.roundsToWin);
        if (reached) {
          delete match.roundEndAt;
          match.matchEndAt = match.durationTicks;
        } else {
          startNextRound(ctx, room, match);
          return;
        }
      }
    accumulateRoundStats(match, state);
    maybeSnapshot(ctx, room, match, state);
    return;
  }
  advancePending(ctx, room, match, state);
  if (state.tick > STALE_TICK_CAP && match.roundEndAt === undefined) {
    state.roundOver = true;
    match.roundEndAt = match.durationTicks;
    finalizeRound(ctx, room, match, state);
  }
  accumulateRoundStats(match, state);
  maybeSnapshot(ctx, room, match, state);
}

function ensureRuntime(ctx: ServerContext, room: Room, match: MatchContext): RoomRuntime | null {
  const existing = roomRuntimes.get(match);
  if (existing) return existing;
  match.roundNo++;
  const seed = (match.mapSeed + match.roundNo * 2654435761) >>> 0;
  const players = match.participants.map((p) => ({
    id: p.playerId,
    name: p.name,
    animal: p.animal as SimPlayer["animal"],
    hat: p.hat as SimPlayer["hat"]
  }));
  const state = createGameState(seed, match.mode, players, match.ranked);
  state.roundStartedAt = 0;
  match.participants.forEach((p, i) => {
    const sim = state.players[i];
    if (sim) sim.roundsWon = match.scores.get(p.playerId) ?? 0;
    delete p.pendingInput;
    p.lastSeq = 0;
  });
  const runtime: RoomRuntime = { state, roundNo: match.roundNo };
  roomRuntimes.set(match, runtime);
  broadcastRoundStart(ctx, room, match, state);
  return runtime;
}

function startNextRound(ctx: ServerContext, room: Room, match: MatchContext): void {
  const runtime = roomRuntimes.get(match);
  if (!runtime) return;
  match.roundNo++;
  const seed = (match.mapSeed + match.roundNo * 2654435761) >>> 0;
  const players = match.participants.map((p) => ({
    id: p.playerId,
    name: p.name,
    animal: p.animal as SimPlayer["animal"],
    hat: p.hat as SimPlayer["hat"]
  }));
  const state = createGameState(seed, match.mode, players, match.ranked);
  match.participants.forEach((p, i) => {
    const sim = state.players[i];
    if (sim) sim.roundsWon = match.scores.get(p.playerId) ?? 0;
    delete p.pendingInput;
    p.lastSeq = 0;
  });
  runtime.state = state;
  runtime.roundNo = match.roundNo;
  delete match.roundEndAt;
  broadcastRoundStart(ctx, room, match, state);
}

function advancePending(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  if (state.roundOver) return;
  const inputs: PlayerInput[] = [];
  for (const p of match.participants) {
    if (p.isBot) handleBotDecision(match, p, state);
    if (p.pendingInput && p.pendingInput.seq > p.lastSeq) {
      inputs.push(p.pendingInput);
    }
  }
  const result = simulateTick(state, inputs);
  for (const p of match.participants) {
    if (p.pendingInput && p.pendingInput.seq > p.lastSeq) p.lastSeq = p.pendingInput.seq;
    if (p.pendingInput && p.pendingInput.tick >= state.tick) delete p.pendingInput;
  }
  for (const event of result.events) {
    ctx.broadcast(room, { type: "event", event });
  }
}

function handleBotDecision(match: MatchContext, p: MatchParticipant, state: GameState): void {
  const diff = p.difficulty ?? "medium";
  const interval = CONFIG.BOT_INTERVAL_TICKS[diff];
  const shouldDecide = match.durationTicks >= p.nextDecisionTick;
  if (shouldDecide) {
    p.nextDecisionTick = match.durationTicks + interval;
    const rng = makeRng(state.map.seed + state.tick * 7919 + p.playerId.length + match.roundNo);
    const decision = decideBotInput(state, p.playerId, diff, nextBotSeq(), rng);
    decision.tick = state.tick + 1;
    p.pendingInput = decision;
  } else if (p.pendingInput) {
    p.pendingInput = { ...p.pendingInput, seq: nextBotSeq(), tick: state.tick + 1 };
  } else {
    p.pendingInput = { playerId: p.playerId, seq: nextBotSeq(), tick: state.tick + 1, dir: "none", balloonPressed: false };
  }
}

function handleDisconnectGraces(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  for (const p of match.participants) {
    if (p.isBot || p.disconnectedAt === undefined) continue;
    if (p.forfeited) continue;
    const elapsed = match.durationTicks - p.disconnectedAt;
    if (elapsed < RECONNECT_GRACE_TICKS) continue;
    if (match.ranked) {
      p.forfeited = true;
      p.placement = match.participants.length;
      const sim = state.players.find((sp) => sp.id === p.playerId);
      if (sim && sim.alive) {
        sim.alive = false;
        ctx.broadcast(room, { type: "event", event: { type: "player_soaked", playerId: p.playerId, ownerId: "forfeit" } });
      }
      const remaining = match.participants.filter((q) => !q.forfeited && !q.isBot);
      if (remaining.length <= 1) {
        if (remaining[0]) match.scores.set(remaining[0].playerId, match.roundsToWin);
        if (match.matchEndAt === undefined) {
          commitCurrentRoundStats(match, state);
          match.matchEndAt = match.durationTicks;
        }
      }
    } else {
      p.isBot = true;
      p.difficulty = p.difficulty ?? "medium";
      delete p.disconnectedAt;
    }
  }
}

function commitCurrentRoundStats(match: MatchContext, state: GameState): void {
  for (const participant of match.participants) {
    const sim = state.players.find((player) => player.id === participant.playerId);
    if (!sim) continue;
    participant.matchSoaks += sim.soaks;
    participant.matchCastles += sim.castlesWashed;
    participant.roundSoaks = sim.soaks;
    participant.roundCastles = sim.castlesWashed;
  }
}

function accumulateRoundStats(match: MatchContext, state: GameState): void {
  for (const p of match.participants) {
    const sim = state.players.find((sp) => sp.id === p.playerId);
    if (!sim) continue;
    p.roundSoaks = sim.soaks;
    p.roundCastles = sim.castlesWashed;
  }
}

function finalizeRound(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  for (const id of state.winnerIds) {
    match.scores.set(id, (match.scores.get(id) ?? 0) + 1);
  }
  for (const p of match.participants) {
    const sim = state.players.find((sp) => sp.id === p.playerId);
    if (!sim) continue;
    p.matchSoaks += sim.soaks;
    p.matchCastles += sim.castlesWashed;
    p.roundSoaks = sim.soaks;
    p.roundCastles = sim.castlesWashed;
  }
  const scoresObj: Record<string, number> = {};
  for (const [k, v] of match.scores) scoresObj[k] = v;
  ctx.broadcast(room, { type: "round_end", winnerIds: state.winnerIds, scores: scoresObj });
}

function maybeSnapshot(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  if (match.durationTicks % SNAPSHOT_EVERY !== 0) return;
  const safe: GameState = { ...state, map: publicMap(state.map) };
  const serverTime = Date.now();
  for (const participant of match.participants) {
    if (!participant.isBot) ctx.sendToPlayer(participant.playerId, { type: "snapshot", state: safe, serverTime, ackSeq: participant.lastSeq });
  }
}

function concludeMatch(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  match.finished = true;
  room.phase = "results";
  finalizePlacements(match);
  const eloResult = computeElo(ctx, match);
  const ratingDeltas: Record<string, number> = {};
  for (const [pid, r] of eloResult.byPlayer) ratingDeltas[pid] = r.delta;
  const xp = computeXp(ctx, match);
  const matchRecord: MatchRecordInput[] = match.participants.map((p) => {
    const elo = eloResult.byPlayer.get(p.playerId);
    return {
      playerId: p.playerId,
      bot: p.isBot,
      placement: p.placement ?? match.participants.length,
      roundsWon: match.scores.get(p.playerId) ?? 0,
      soaks: p.matchSoaks,
      castles: p.matchCastles,
      ratingBefore: elo?.before ?? 0,
      ratingAfter: elo?.after ?? 0,
      ratingDelta: elo?.delta ?? 0,
      xpGained: xp[p.playerId] ?? 0
    };
  });
  recordMatch(ctx.db, {
    mode: match.mode,
    ranked: match.ranked,
    roomCode: room.code,
    roundsToWin: match.roundsToWin,
    theme: match.theme,
    durationTicks: match.durationTicks
  }, matchRecord);
  const placements = match.participants.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    placement: p.placement ?? match.participants.length,
    soaks: p.matchSoaks,
    castles: p.matchCastles
  }));
  ctx.broadcast(room, { type: "match_end", placements, ratingDeltas, xp });
  for (const p of match.participants) {
    if (p.isBot) continue;
    const row = getPlayerById(ctx.db, p.playerId);
    if (row) ctx.sendToPlayer(p.playerId, { type: "profile_updated", profile: profileFromRow(row) });
  }
}

function profileFromRow(row: {
  id: string; nickname: string; tag: string; xp: number; level: number;
  selected_animal: string; selected_hat: string; has_custom_nickname: number;
}): import("@splash/shared").Profile {
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    xp: row.xp,
    level: row.level,
    selectedAnimal: row.selected_animal as import("@splash/shared").Animal,
    selectedHat: row.selected_hat as import("@splash/shared").Hat,
    hasCustomNickname: row.has_custom_nickname === 1
  };
}

function finalizePlacements(match: MatchContext): void {
  const sorted = [...match.participants].sort((a, b) => {
    if (!!a.forfeited !== !!b.forfeited) return a.forfeited ? 1 : -1;
    const sa = match.scores.get(a.playerId) ?? 0;
    const sb = match.scores.get(b.playerId) ?? 0;
    if (sb !== sa) return sb - sa;
    return b.matchSoaks - a.matchSoaks;
  });
  sorted.forEach((participant, index) => {
    const previous = sorted[index - 1];
    const tied = previous && !participant.forfeited && !previous.forfeited &&
      (match.scores.get(participant.playerId) ?? 0) === (match.scores.get(previous.playerId) ?? 0) && participant.matchSoaks === previous.matchSoaks;
    participant.placement = tied ? previous.placement! : index + 1;
  });
}

function computeElo(ctx: ServerContext, match: MatchContext): { byPlayer: Map<string, { before: number; after: number; delta: number }> } {
  if (!match.ranked) return { byPlayer: new Map() };
  if (!match.participants.every((p) => !p.isBot)) return { byPlayer: new Map() };
  if (match.mode === "duel") {
    const [a, b] = match.participants;
    if (!a || !b) return { byPlayer: new Map() };
    const ra = lookupRating(ctx, a.playerId, "duel");
    const rb = lookupRating(ctx, b.playerId, "duel");
    const sa = match.scores.get(a.playerId) ?? 0;
    const sb = match.scores.get(b.playerId) ?? 0;
    const winnerId = sa > sb ? a.playerId : sb > sa ? b.playerId : null;
    const slotA: PlayerSlot = { playerId: a.playerId, rating: ra.rating, games: ra.games, placement: a.placement ?? 1 };
    const slotB: PlayerSlot = { playerId: b.playerId, rating: rb.rating, games: rb.games, placement: b.placement ?? 2 };
    const result = applyDuelResult(ctx.db, [slotA, slotB], winnerId, "duel");
    return { byPlayer: new Map(result.results.map((r) => [r.id, { before: r.before, after: r.after, delta: r.delta }])) };
  }
  if (match.mode === "ffa" && match.participants.length === 4) {
    const slots: PlayerSlot[] = match.participants.map((p) => {
      const r = lookupRating(ctx, p.playerId, "ffa");
      return { playerId: p.playerId, rating: r.rating, games: r.games, placement: p.placement ?? 1, bot: p.isBot };
    });
    const result = applyFfaResult(ctx.db, slots as [PlayerSlot, PlayerSlot, PlayerSlot, PlayerSlot], "ffa");
    return { byPlayer: new Map(result.results.map((r) => [r.id, { before: r.before, after: r.after, delta: r.delta }])) };
  }
  return { byPlayer: new Map() };
}

function computeXp(ctx: ServerContext, match: MatchContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of match.participants) {
    if (p.isBot) continue;
    const placement = p.placement ?? match.participants.length;
    let amount = CONFIG.XP.participation + (CONFIG.XP.placement[placement - 1] ?? 0);
    amount += p.matchSoaks * CONFIG.XP.soak;
    amount += p.matchCastles * CONFIG.XP.castle;
    if (amount > 0) addXp(ctx.db, p.playerId, amount);
    out[p.playerId] = amount;
  }
  return out;
}

function lookupRating(ctx: ServerContext, playerId: string, mode: Mode): { rating: number; games: number } {
  const r = ctx.db.prepare("SELECT rating, games FROM ratings WHERE player_id = ? AND mode = ?").get(playerId, mode) as
    | { rating: number; games: number }
    | undefined;
  return r ?? { rating: CONFIG.START_RATING, games: 0 };
}

function broadcastRoundStart(ctx: ServerContext, room: Room, match: MatchContext, state: GameState): void {
  const castleGrid: number[][] = state.map.tiles.map((row) => row.map((t) => t as number));
  for (const p of match.participants) {
    if (p.isBot) continue;
    ctx.sendToPlayer(p.playerId, {
      type: "round_start",
      roundNo: match.roundNo,
      mapSeed: state.map.seed,
      castleGrid,
      theme: match.theme
    });
  }
}

function logError(scope: string, err: unknown): void {
  console.error(`[${scope}]`, err);
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

export type { ClientMessage, ServerMessage, SimEvent };
