import { randomInt, randomUUID } from "node:crypto";
import {
  CONFIG,
  createRound,
  defaultPlayer,
  resolveTheme,
  simulateTick,
  type PlayerInput,
  type RoundState,
  type SlotState,
} from "@splash/shared";
import { createBrain, think, type BotBrain } from "./bots/bot.js";
import { computeElo, persistElo } from "./elo.js";
import { addXp, recordMatch } from "./db/index.js";
import type { DbApi } from "./dbApi.js";
import { broadcast, type Room } from "./rooms.js";

export class GameSession {
  room: Room;
  db: DbApi;
  round: RoundState | null = null;
  roundNo = 0;
  scores = new Map<string, number>();
  soaks = new Map<string, number>();
  castles = new Map<string, number>();
  survived = new Map<string, number>();
  biggestChain = 0;
  chainOwner = "";
  phase: "intro" | "countdown" | "play" | "roundEnd" | "matchEnd" = "intro";
  phaseUntil = 0;
  bots = new Map<string, BotBrain>();
  inputs = new Map<string, PlayerInput>();
  snapshotAcc = 0;
  tickAcc = 0;
  lastTs = Date.now();
  matchId = randomUUID();
  startedAt = Date.now();
  finished = false;
  forfeits = new Set<string>();
  pendingBotSwap: { from: string; slot: SlotState } | null = null;
  disconnectAt = new Map<string, number>();

  constructor(room: Room, db: DbApi) {
    this.room = room;
    this.db = db;
  }

  start(): void {
    this.finished = false;
    this.roundNo = 0;
    this.scores.clear();
    this.phase = "intro";
    this.phaseUntil = Date.now() + 2500;
    for (const s of this.room.slots) {
      if (s.kind === "empty" || !s.playerId) continue;
      this.scores.set(s.playerId, 0);
      this.soaks.set(s.playerId, 0);
      this.castles.set(s.playerId, 0);
      this.survived.set(s.playerId, 0);
      if (s.kind === "bot") this.bots.set(s.playerId, createBrain(s.playerId, s.difficulty ?? "medium"));
    }
    const theme = resolveTheme(this.room.theme, randomInt(1e9));
    const players = this.room.slots
      .filter((s) => s.kind !== "empty" && s.playerId)
      .map((s) => {
        const rating = s.kind === "human" && s.playerId ? this.ratingOf(s.playerId) : undefined;
        return {
          id: s.playerId!,
          nickname: s.nickname ?? "Critter",
          tag: s.tag ?? 0,
          animal: s.animal ?? "frog",
          hat: s.hat ?? "none",
          rating,
          tier: rating !== undefined ? undefined : undefined,
          slot: s.index,
        };
      });
    broadcast(this.room, {
      type: "match_start",
      config: {
        mode: this.room.mode,
        ranked: this.room.ranked,
        roundsToWin: this.room.roundsToWin,
        theme,
        width: this.room.mode === "duel" ? CONFIG.DUEL_WIDTH : CONFIG.FFA_WIDTH,
        height: this.room.mode === "duel" ? CONFIG.DUEL_HEIGHT : CONFIG.FFA_HEIGHT,
        enableKick: CONFIG.ENABLE_KICK,
        enableRevengeDucks: this.room.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
      },
      players,
    });
  }

  ratingOf(playerId: string): number | undefined {
    const p = this.db.loadProfile(playerId);
    return p?.ratings[this.room.mode].rating;
  }

  replaceWithBot(humanId: string, slot: SlotState): void {
    this.disconnectAt.set(humanId, Date.now());
    this.pendingBotSwap = { from: humanId, slot };
  }

  markForfeit(playerId: string): void {
    this.disconnectAt.set(playerId, Date.now());
  }

  pushInput(playerId: string, input: PlayerInput): void {
    this.inputs.set(playerId, input);
  }

  tick(): void {
    const now = Date.now();
    const dt = now - this.lastTs;
    this.lastTs = now;

    this.checkDisconnects(now);

    if (this.phase === "intro" && now >= this.phaseUntil) {
      this.beginRound();
      return;
    }
    if (this.phase === "countdown") {
      return;
    }
    if (this.phase === "roundEnd" && now >= this.phaseUntil) {
      const winScore = Math.max(0, ...this.scores.values());
      if (winScore >= this.room.roundsToWin) {
        this.endMatch();
      } else {
        this.beginRound();
      }
      return;
    }
    if (this.phase !== "play" || !this.round) return;

    this.tickAcc += dt;
    const step = 1000 / CONFIG.TICK_RATE;
    let guard = 0;
    while (this.tickAcc >= step && guard++ < 5) {
      this.tickAcc -= step;
      this.simOnce();
    }
  }

  private checkDisconnects(now: number): void {
    for (const [id, at] of this.disconnectAt) {
      if (now - at < CONFIG.RECONNECT_GRACE_MS) continue;
      this.disconnectAt.delete(id);
      if (this.room.ranked) {
        this.forfeits.add(id);
        if (this.round) {
          const p = this.round.players.find((x) => x.id === id);
          if (p && p.status === "alive") p.status = "soaked";
        }
        if (!this.finished) this.endMatch();
      } else if (this.pendingBotSwap && this.round) {
        const { from, slot } = this.pendingBotSwap;
        const p = this.round.players.find((x) => x.id === from);
        if (p && slot.playerId) {
          p.id = slot.playerId;
          p.isBot = true;
          p.botDifficulty = slot.difficulty;
          p.nickname = slot.nickname ?? "Bot";
          this.bots.set(p.id, createBrain(p.id, slot.difficulty ?? "medium"));
          const sc = this.scores.get(from) ?? 0;
          this.scores.set(p.id, sc);
        }
        this.pendingBotSwap = null;
      }
    }
  }

  private beginRound(): void {
    this.roundNo++;
    const width = this.room.mode === "duel" ? CONFIG.DUEL_WIDTH : CONFIG.FFA_WIDTH;
    const height = this.room.mode === "duel" ? CONFIG.DUEL_HEIGHT : CONFIG.FFA_HEIGHT;
    const seed = randomInt(1, 2 ** 31 - 1);
    const theme = resolveTheme(this.room.theme, seed);
    const plist = this.room.slots
      .filter((s) => s.kind !== "empty" && s.playerId && !this.forfeits.has(s.playerId))
      .map((s) =>
        defaultPlayer(s.playerId!, s.index, s.nickname ?? "Critter", {
          tag: s.tag ?? 0,
          animal: s.animal ?? "frog",
          hat: s.hat ?? "none",
          isBot: s.kind === "bot",
          botDifficulty: s.difficulty,
        }),
      );
    if (plist.length < 2) {
      this.endMatch();
      return;
    }
    this.round = createRound(seed, width, height, theme, plist);
    this.inputs.clear();
    this.phase = "countdown";
    const values: (number | "SPLASH")[] = [3, 2, 1, "SPLASH"];
    values.forEach((v, i) => {
      setTimeout(() => {
        broadcast(this.room, { type: "countdown", value: v });
        if (v === "SPLASH") this.phase = "play";
      }, i * 700);
    });
    broadcast(this.room, {
      type: "round_start",
      roundNo: this.roundNo,
      mapSeed: seed,
      castleGrid: this.round.arena.tiles.slice(),
      theme,
      width,
      height,
    });
  }

  private simOnce(): void {
    if (!this.round || this.round.ended) return;
    const merged = new Map(this.inputs);
    for (const p of this.round.players) {
      if (!p.isBot) continue;
      let brain = this.bots.get(p.id);
      if (!brain) {
        brain = createBrain(p.id, p.botDifficulty ?? "medium");
        this.bots.set(p.id, brain);
      }
      merged.set(p.id, think(this.round, brain, p));
    }
    simulateTick(this.round, merged, {
      enableRevengeDucks: this.room.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
    });
    for (const ev of this.round.events) {
      broadcast(this.room, { type: "event", event: ev });
      if (ev.type === "chain_burst") {
        const n = (ev.count as number) ?? 0;
        if (n > this.biggestChain) this.biggestChain = n;
      }
      if (ev.type === "player_soaked") {
        const by = ev.by as string | undefined;
        if (by) this.soaks.set(by, (this.soaks.get(by) ?? 0) + 1);
      }
    }
    this.snapshotAcc++;
    if (this.snapshotAcc >= CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE) {
      this.snapshotAcc = 0;
      this.sendSnapshot();
    }
    if (this.round.ended) this.finishRound();
  }

  private sendSnapshot(): void {
    if (!this.round) return;
    broadcast(this.room, {
      type: "snapshot",
      snap: {
        tick: this.round.tick,
        players: this.round.players,
        balloons: this.round.balloons,
        splashes: this.round.splashes,
        exposed: this.round.exposed,
        tideRing: this.round.tideRing,
        hitstop: this.round.hitstop,
      },
    });
  }

  private finishRound(): void {
    if (!this.round) return;
    for (const p of this.round.players) {
      this.castles.set(p.id, (this.castles.get(p.id) ?? 0) + p.castlesWashed);
      this.survived.set(p.id, (this.survived.get(p.id) ?? 0) + p.survivedTicks);
    }
    if (!this.round.draw) {
      for (const id of this.round.winnerIds) {
        this.scores.set(id, (this.scores.get(id) ?? 0) + 1);
      }
    }
    const scores: Record<string, number> = {};
    for (const [k, v] of this.scores) scores[k] = v;
    broadcast(this.room, {
      type: "round_end",
      winnerIds: this.round.winnerIds,
      draw: this.round.draw,
      scores,
    });
    this.phase = "roundEnd";
    this.phaseUntil = Date.now() + 2800;
  }

  private endMatch(): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = "matchEnd";
    const rows = [...this.scores.entries()].map(([id, roundsWon]) => ({
      id,
      roundsWon,
      soaks: this.soaks.get(id) ?? 0,
      slot: this.room.slots.find((s) => s.playerId === id),
    }));
    rows.sort((a, b) => {
      if (this.forfeits.has(a.id) !== this.forfeits.has(b.id)) return this.forfeits.has(a.id) ? 1 : -1;
      if (b.roundsWon !== a.roundsWon) return b.roundsWon - a.roundsWon;
      return b.soaks - a.soaks;
    });
    let place = 1;
    const placements = rows.map((r, i) => {
      if (i > 0) {
        const prev = rows[i - 1]!;
        if (r.roundsWon !== prev.roundsWon || r.soaks !== prev.soaks || this.forfeits.has(r.id) !== this.forfeits.has(prev.id)) {
          place = i + 1;
        }
      }
      return { ...r, place };
    });

    const eloPlayers = placements
      .filter((p) => p.slot?.kind === "human" && p.id)
      .map((p) => {
        const prof = this.db.loadProfile(p.id);
        return {
          id: p.id,
          rating: prof?.ratings[this.room.mode].rating ?? CONFIG.ELO_START,
          games: prof?.ratings[this.room.mode].games ?? 0,
          placement: p.place,
        };
      });

    const eloResults = this.room.ranked && eloPlayers.length >= 2 ? computeElo(this.room.mode, eloPlayers) : [];
    const eloMap = Object.fromEntries(eloResults.map((e) => [e.id, e]));
    if (this.room.ranked && eloResults.length) {
      persistElo(this.db.raw, this.room.mode, eloResults, placements[0]?.id);
    }

    const xpMap: Record<string, number> = {};
    const ratingDeltas: Record<string, number> = {};
    const out = placements.map((p) => {
      const xp =
        CONFIG.XP_PARTICIPATION +
        (CONFIG.XP_PER_PLACEMENT[p.place - 1] ?? 10) +
        (this.soaks.get(p.id) ?? 0) * CONFIG.XP_PER_SOAK +
        (this.castles.get(p.id) ?? 0) * CONFIG.XP_PER_CASTLE;
      xpMap[p.id] = xp;
      if (p.slot?.kind === "human") addXp(this.db.raw, p.id, xp);
      const er = eloMap[p.id];
      if (er) ratingDeltas[p.id] = er.delta;
      return {
        playerId: p.id,
        nickname: p.slot?.nickname ?? "Critter",
        tag: p.slot?.tag ?? 0,
        place: p.place,
        soaks: this.soaks.get(p.id) ?? 0,
        roundsWon: p.roundsWon,
        ratingBefore: er?.before,
        ratingAfter: er?.after,
        xpEarned: xp,
      };
    });

    recordMatch(this.db.raw, {
      id: this.matchId,
      mode: this.room.mode,
      ranked: this.room.ranked,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      players: out.map((p) => ({
        playerId: p.playerId,
        placement: p.place,
        soaks: p.soaks,
        roundsWon: p.roundsWon,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
        xpEarned: p.xpEarned,
      })),
    });

    const nameOf = (id: string) => this.room.slots.find((s) => s.playerId === id)?.nickname ?? id;
    let mostSoaks: { name: string; value: number } | undefined;
    let castleCrusher: { name: string; value: number } | undefined;
    let longestSurvivor: { name: string; value: number } | undefined;
    for (const [id, v] of this.soaks) {
      if (!mostSoaks || v > mostSoaks.value) mostSoaks = { name: nameOf(id), value: v };
    }
    for (const [id, v] of this.castles) {
      if (!castleCrusher || v > castleCrusher.value) castleCrusher = { name: nameOf(id), value: v };
    }
    for (const [id, v] of this.survived) {
      if (!longestSurvivor || v > longestSurvivor.value) longestSurvivor = { name: nameOf(id), value: v };
    }

    broadcast(this.room, {
      type: "match_end",
      placements: out,
      ratingDeltas,
      xp: xpMap,
      fun: {
        mostSoaks,
        castleCrusher,
        longestSurvivor,
        biggestChain: this.biggestChain ? { name: "Arena", value: this.biggestChain } : undefined,
      },
      ranked: this.room.ranked,
    });
  }
}
