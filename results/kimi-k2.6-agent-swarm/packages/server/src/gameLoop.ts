import { EventEmitter } from 'node:events';
import {
  CONFIG,
  createRoundState,
  simulateTick,
  resolveRoundEnd,
} from '@splash-critters/shared';
import type {
  PlayerId,
  RoundState,
  GameConfig,
  InputFrame,
  Snapshot,
  RoundResult,
  MatchResult,
  MatchId,
  PlayerState,
} from '@splash-critters/shared';
import type { DatabaseInstance } from './db/queries.js';
import { createMatch, finishMatch, recordMatchPlayer } from './db/queries.js';
import { applyMatchElo, getPlayerRating } from './elo.js';

interface QueuedInput {
  tick: number;
  input: InputFrame;
}

export class GameLoop extends EventEmitter {
  roundState: RoundState | null = null;
  matchConfig: GameConfig;
  playerInputs: Map<PlayerId, InputFrame[]> = new Map();

  private inputBuffers = new Map<PlayerId, QueuedInput[]>();
  private matchId: MatchId;
  private matchDbId: number | null = null;
  private db: DatabaseInstance | null;
  private ranked: boolean;
  private playerIds: PlayerId[];
  private scores = new Map<PlayerId, number>();
  private roundResults: RoundResult[] = [];
  snapshotCounter = 0;
  matchEnded = false;
  private biggestChain = 0;

  constructor(options: {
    matchId: MatchId;
    matchConfig: GameConfig;
    db?: DatabaseInstance;
    ranked: boolean;
    playerIds: PlayerId[];
  }) {
    super();
    this.matchId = options.matchId;
    this.matchConfig = options.matchConfig;
    this.db = options.db ?? null;
    this.ranked = options.ranked;
    this.playerIds = options.playerIds;
    for (const id of options.playerIds) {
      this.scores.set(id, 0);
      this.playerInputs.set(id, []);
    }
    if (this.db && this.ranked) {
      this.matchDbId = createMatch(this.db, this.matchConfig.mode, true);
    }
  }

  startRound(roundNo: number, mapSeed: number, players: PlayerState[]): void {
    this.roundState = createRoundState(
      this.matchConfig,
      mapSeed,
      roundNo,
      players
    );
    this.snapshotCounter = 0;
    for (const id of this.playerIds) {
      this.inputBuffers.set(id, []);
      this.playerInputs.set(id, []);
    }
    this.emit('round_start', roundNo, mapSeed, players);
  }

  tick(): void {
    if (!this.roundState || this.roundState.ended || this.matchEnded) return;

    const tickInputs = new Map<PlayerId, InputFrame>();
    for (const player of this.roundState.players) {
      const buffer = this.inputBuffers.get(player.playerId) || [];
      const entry = buffer.find((b) => b.tick === this.roundState!.tick);
      if (entry) {
        tickInputs.set(player.playerId, entry.input);
        const idx = buffer.indexOf(entry);
        if (idx !== -1) buffer.splice(0, idx + 1);
      } else {
        const last = buffer.length > 0 ? buffer[buffer.length - 1] : null;
        if (
          last &&
          last.tick < this.roundState.tick &&
          this.roundState.tick - last.tick <= 5
        ) {
          tickInputs.set(player.playerId, {
            dir: last.input.dir,
            balloonPressed: false,
          });
        } else {
          tickInputs.set(player.playerId, { dir: null, balloonPressed: false });
        }
        if (last && last.tick < this.roundState.tick - 5) {
          buffer.length = 0;
        }
      }
    }

    this.roundState = simulateTick(
      this.roundState,
      { tick: this.roundState.tick, playerInputs: tickInputs },
      CONFIG
    );

    for (const ev of this.roundState.events) {
      if (ev.type === 'chain_burst' && ev.chainCount > this.biggestChain) {
        this.biggestChain = ev.chainCount;
      }
    }

    if (this.roundState.ended) {
      this.endRound();
    }
  }

  getSnapshot(): Snapshot | null {
    if (!this.roundState) return null;
    this.snapshotCounter++;
    if (this.snapshotCounter % 2 !== 0) {
      return null;
    }
    return {
      tick: this.roundState.tick,
      roundNo: this.roundState.roundNo,
      players: this.roundState.players,
      balloons: this.roundState.balloons,
      splashes: this.roundState.splashes,
      powerUps: Array.from(
        this.roundState.exposedPowerUps.entries()
      ).map(([key, type]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, type };
      }),
      tideRing: this.roundState.tideRing,
      events: this.roundState.events,
    };
  }

  addInput(playerId: PlayerId, tick: number, input: InputFrame): boolean {
    if (!this.roundState) return false;
    if (!this.playerIds.includes(playerId)) return false;
    if (
      tick < this.roundState.tick - 10 ||
      tick > this.roundState.tick + 10
    ) {
      return false;
    }

    let buffer = this.inputBuffers.get(playerId);
    if (!buffer) {
      buffer = [];
      this.inputBuffers.set(playerId, buffer);
    }

    const last = buffer.length > 0 ? buffer[buffer.length - 1] : null;
    if (last && tick <= last.tick) {
      const idx = buffer.findIndex((b) => b.tick === tick);
      if (idx !== -1) {
        buffer[idx] = { tick, input };
      } else {
        return false;
      }
    } else {
      buffer.push({ tick, input });
    }
    if (buffer.length > 20) buffer.splice(0, buffer.length - 20);

    const inputs = this.playerInputs.get(playerId) || [];
    inputs.push(input);
    if (inputs.length > 20) inputs.splice(0, inputs.length - 20);
    this.playerInputs.set(playerId, inputs);

    return true;
  }

  endRound(): RoundResult {
    if (!this.roundState) throw new Error('No round in progress');
    const result = resolveRoundEnd(this.roundState);
    if (!result) throw new Error('Round not ended');

    if (result.winner) {
      const currentScore = this.scores.get(result.winner) || 0;
      this.scores.set(result.winner, currentScore + 1);
    }

    this.roundResults.push(result);
    this.emit('round_end', result, Object.fromEntries(this.scores));
    return result;
  }

  endMatch(): MatchResult {
    if (this.matchEnded) throw new Error('Match already ended');
    this.matchEnded = true;

    const placements = this.computePlacements();
    const stats = this.computeMatchStats();

    const xp: Record<PlayerId, number> = {};
    for (const playerId of this.playerIds) {
      xp[playerId] = this.calculateXP(playerId, placements, stats);
    }

    const result: MatchResult = {
      matchId: this.matchId,
      mode: this.matchConfig.mode,
      ranked: this.ranked,
      placements,
      ratingDeltas: {},
      xp,
      stats,
    };

    if (this.db && this.ranked && this.matchDbId !== null) {
      const ratingsBefore = new Map<PlayerId, number>();
      for (const pid of this.playerIds) {
        ratingsBefore.set(pid, getPlayerRating(this.db, pid, this.matchConfig.mode));
      }

      applyMatchElo(this.db, result, this.matchConfig.mode);

      finishMatch(this.db, this.matchDbId);
      for (let i = 0; i < placements.length; i++) {
        const playerId = placements[i];
        const numId = Number(playerId);
        const roundsWon = this.scores.get(playerId) || 0;
        const before = ratingsBefore.get(playerId) ?? 1000;
        const delta = result.ratingDeltas[playerId] || 0;
        const after = before + delta;
        const xpEarned = xp[playerId] || 0;
        const soaks = stats.soaks[playerId] || 0;
        recordMatchPlayer(
          this.db,
          this.matchDbId,
          numId,
          i + 1,
          soaks,
          roundsWon,
          before,
          after,
          xpEarned
        );
      }
    }

    this.emit('match_end', result);
    return result;
  }

  getScores(): Map<PlayerId, number> {
    return new Map(this.scores);
  }

  getMatchResult(): MatchResult {
    return this.endMatch();
  }

  checkMatchEnd(): boolean {
    for (const [, score] of this.scores) {
      if (score >= this.matchConfig.roundsToWin) {
        return true;
      }
    }
    return false;
  }

  private computePlacements(): PlayerId[] {
    const playerStats = new Map<PlayerId, { wins: number; soaks: number }>();
    for (const id of this.playerIds) {
      playerStats.set(id, { wins: this.scores.get(id) || 0, soaks: 0 });
    }
    for (const rr of this.roundResults) {
      for (const [pid, soaks] of Object.entries(rr.stats.soaks)) {
        const stat = playerStats.get(pid);
        if (stat) stat.soaks += soaks;
      }
    }
    const sorted = [...this.playerIds].sort((a, b) => {
      const sa = playerStats.get(a)!;
      const sb = playerStats.get(b)!;
      if (sa.wins !== sb.wins) return sb.wins - sa.wins;
      return sb.soaks - sa.soaks;
    });
    return sorted;
  }

  private computeMatchStats(): MatchResult['stats'] {
    const soaks: Record<PlayerId, number> = {};
    const castlesWashed: Record<PlayerId, number> = {};
    let longestSurvivor: PlayerId = this.playerIds[0] ?? '';
    let maxSoaks = -1;

    for (const id of this.playerIds) {
      soaks[id] = 0;
      castlesWashed[id] = 0;
    }

    for (const rr of this.roundResults) {
      for (const [pid, count] of Object.entries(rr.stats.soaks)) {
        soaks[pid] = (soaks[pid] || 0) + count;
      }
      for (const [pid, count] of Object.entries(rr.stats.castlesWashed)) {
        castlesWashed[pid] = (castlesWashed[pid] || 0) + count;
      }
    }

    for (const id of this.playerIds) {
      if (soaks[id] > maxSoaks) {
        maxSoaks = soaks[id];
        longestSurvivor = id;
      }
    }

    return {
      soaks,
      castlesWashed,
      longestSurvivor,
      biggestChain: this.biggestChain,
    };
  }

  private calculateXP(
    playerId: PlayerId,
    placements: PlayerId[],
    stats: MatchResult['stats']
  ): number {
    let total = CONFIG.XP_PARTICIPATION;
    const placement = placements.indexOf(playerId);
    if (placement === 0) total += CONFIG.XP_PLACEMENT_1;
    else if (placement === 1) total += CONFIG.XP_PLACEMENT_2;
    else if (placement === 2) total += CONFIG.XP_PLACEMENT_3;
    else if (placement === 3) total += CONFIG.XP_PLACEMENT_4;

    total += (stats.soaks[playerId] || 0) * CONFIG.XP_PER_SOAK;
    total +=
      (stats.castlesWashed[playerId] || 0) * CONFIG.XP_PER_CASTLE;
    return total;
  }
}
