import { CONFIG, TICK_MS, computePlacements, createSimState, makeSnapshot, simulateTick } from "@sc/shared";
import type {
  BotDifficulty,
  GameMode,
  MatchConfig,
  MatchEndMsg,
  Placement,
  RoundEndMsg,
  RoundStartMsg,
  SimEventMsg,
  SimPlayerInput,
  SnapshotMsg,
} from "@sc/shared";
import type { ActiveMatch, MatchEntity } from "./rooms";
import { botThink, createBot, type BotBrain } from "./bots/bot";

export interface MatchHostDeps {
  broadcastMatch(match: ActiveMatch, msg: object): void;
  sendToEntity(match: ActiveMatch, entityId: string, msg: object): void;
  onMatchEnd(match: ActiveMatch, end: MatchEndMsg): void;
}

export class GameLoop {
  private matches = new Set<ActiveMatch>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private deps: MatchHostDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickAll(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  add(match: ActiveMatch): void {
    this.matches.add(match);
    this.startRound(match);
  }

  remove(match: ActiveMatch): void {
    this.matches.delete(match);
    if (match.timer) {
      clearInterval(match.timer);
      match.timer = null;
    }
  }

  applyInput(match: ActiveMatch, entityId: string, input: SimPlayerInput): void {
    match.latestInputs.set(entityId, input);
  }

  private tickAll(): void {
    for (const m of [...this.matches]) this.simTick(m);
  }

  private startRound(match: ActiveMatch): void {
    const roundNo = match.roundNo + 1;
    match.roundNo = roundNo;
    const seed = (match.config.mapSeed ^ (roundNo * 0x9e3779b9)) >>> 0;
    const roundConfig: MatchConfig = { ...match.config, mapSeed: seed };
    const entityIds = match.entities.map((e) => e.id);
    match.sim = createSimState(roundConfig, entityIds);
    // bots never auto-kick (sliding balloons are unpredictable for their danger map)
    match.entities.forEach((e, i) => {
      if (e.isBot) match.sim!.players[i]!.autoKick = false;
    });
    match.latestInputs.clear();
    match.roundSoaks = [];
    match.biggestChain = { entityId: null, depth: 0 };
    match.betweenRounds = false;

    const gridPacked = Array.from(match.sim.grid);
    const msg: RoundStartMsg = {
      t: "round_start",
      roundNo,
      mapSeed: seed,
      castleGrid: gridPacked,
      w: roundConfig.w,
      h: roundConfig.h,
      theme: roundConfig.theme,
      spawns: match.entities.map((e, i) => ({
        entityId: e.id,
        x: match.sim!.players[i]!.spawnX,
        y: match.sim!.players[i]!.spawnY,
      })),
      scores: Object.fromEntries(match.entities.map((e) => [e.id, match.scores[e.id] ?? 0])),
    };
    this.deps.broadcastMatch(match, msg);

    // per-round interval driving sim ticks
    if (match.timer) clearInterval(match.timer);
    let tickAcc = 0;
    let last = Date.now();
    match.timer = setInterval(() => {
      const now = Date.now();
      tickAcc += now - last;
      last = now;
      let steps = 0;
      while (tickAcc >= TICK_MS && steps < 5) {
        tickAcc -= TICK_MS;
        steps++;
        this.simTick(match);
        if (match.betweenRounds) break;
      }
    }, TICK_MS);
  }

  private simTick(match: ActiveMatch): void {
    const sim = match.sim!;
    // bots
    for (const e of match.entities) {
      if (!e.isBot || !e.brain) continue;
      const input = botThink(sim, e.brain as BotBrain);
      match.latestInputs.set(e.id, input);
    }
    const inputs: Record<string, SimPlayerInput> = {};
    for (const [id, inp] of match.latestInputs) inputs[id] = inp;
    // one-shot press edges are handled inside sim via prevBalloonPressed

    const events = simulateTick(sim, inputs);

    // track soaks for kill feed / stats
    for (const ev of events) {
      if (ev.type === "player_soaked" && ev.target) {
        match.lastSoakTick.set(ev.target, sim.tick);
        match.roundSoaks.push({
          entityId: ev.target,
          byEntityId: ev.by ?? null,
          revenge: !!ev.revenge,
        });
      }
      if (ev.type === "chain_burst" && (ev.chain ?? 0) > (match.biggestChain.depth ?? 0)) {
        match.biggestChain = { entityId: ev.by ?? null, depth: ev.chain ?? 0 };
      }
    }

    // forward events
    for (const ev of events) {
      const msg: SimEventMsg = { t: "event", event: { ...ev } };
      this.deps.broadcastMatch(match, msg);
    }

    // snapshots at snapshotRate
    if (sim.tick % Math.max(1, Math.round(CONFIG.tickRate / CONFIG.snapshotRate)) === 0) {
      const snap: SnapshotMsg = { t: "snapshot", snapshot: makeSnapshot(sim) };
      this.deps.broadcastMatch(match, snap);
    }

    if (sim.roundOver && !match.betweenRounds) {
      this.endRound(match);
    }
  }

  private endRound(match: ActiveMatch): void {
    const sim = match.sim!;
    const winners = sim.winnerIds;
    for (const id of winners) match.scores[id] = (match.scores[id] ?? 0) + 1;

    const scoresSnapshot = { ...match.scores };
    const endMsg: RoundEndMsg = {
      t: "round_end",
      roundNo: match.roundNo,
      winners,
      soakedThisRound: match.roundSoaks,
      scores: scoresSnapshot,
    };
    this.deps.broadcastMatch(match, endMsg);
    match.betweenRounds = true;

    const topScore = Math.max(...match.entities.map((e) => match.scores[e.id] ?? 0));
    if (topScore >= match.config.roundsToWin) {
      setTimeout(() => this.endMatch(match), 2500);
    } else {
      setTimeout(() => this.startRound(match), 3000);
    }
  }

  private endMatch(match: ActiveMatch): void {
    const sim = match.sim!;
    const stats = match.entities.map((e) => {
      const sp = sim.players.find((p) => p.id === e.id)!;
      return {
        entityId: e.id,
        roundsWon: match.scores[e.id] ?? 0,
        soaks: sp?.soaks ?? 0,
        castlesWashed: sp?.castlesWashed ?? 0,
        survivedTicks: sp?.soakedTick ?? sim.tick,
      };
    });
    const placements = computePlacements(stats);
    const placementOf = new Map(placements.map((p) => [p.entityId, p.placement]));

    const placementMsgs: Placement[] = match.entities.map((e) => {
      const s = stats.find((x) => x.entityId === e.id)!;
      return {
        entityId: e.id,
        playerId: e.playerId,
        nickname: e.nickname,
        placement: placementOf.get(e.id) ?? match.entities.length,
        roundsWon: s.roundsWon,
        soaks: s.soaks,
        castlesWashed: s.castlesWashed,
      };
    });

    // fun stats
    const mostSoaks = [...placementMsgs].sort((a, b) => b.soaks - a.soaks)[0];
    const crusher = [...placementMsgs].sort((a, b) => b.castlesWashed - a.castlesWashed)[0];
    const survivor = [...stats].sort((a, b) => b.survivedTicks - a.survivedTicks)[0];

    const xpByEntity: Record<string, number> = {};
    for (const e of match.entities) {
      const s = stats.find((x) => x.entityId === e.id)!;
      const place = placementOf.get(e.id) ?? match.entities.length;
      const xp =
        CONFIG.xpParticipation +
        (match.entities.length - place) * CONFIG.xpPerPlacementPoint +
        s.soaks * CONFIG.xpPerSoak +
        s.castlesWashed * CONFIG.xpPerCastle;
      xpByEntity[e.id] = xp;
    }

    const end: MatchEndMsg = {
      t: "match_end",
      placements: placementMsgs,
      funStats: {
        mostSoaks: mostSoaks?.entityId,
        castleCrusher: crusher?.entityId,
        longestSurvivor: survivor?.entityId,
        biggestChain: match.biggestChain.entityId ?? undefined,
      },
      xp: xpByEntity,
      levelUps: {},
      ratingDeltas: {},
      unlocks: {},
    };

    // Elo + persistence handled by rooms layer callback
    this.deps.onMatchEnd(match, end);
    this.remove(match);
  }
}
