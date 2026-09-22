import {
  CONFIG,
  applyDuel,
  applyFfa,
  createRoundState,
  generateMap,
  matchXp,
  mulberry32,
  placementsFromScores,
  snapshotFromState,
  simulateTick,
  tierFor,
  type BotDiff,
  type Dir,
  type Mode,
  type PlayerCard,
  type ServerMsg,
  type SimState,
  type Theme,
} from '@splash/shared';
import { Bot } from './bots/bot.js';

export interface MatchPlayer {
  id: string;
  name: string;
  tag: string;
  animal: string;
  hat: string;
  bot: boolean;
  difficulty?: BotDiff;
  rating: number;
  games: number;
  roundWins: number;
  soaks: number;
  castles: number;
  biggestChain: number;
  survived: number;
  connected: boolean;
  disconnectAt: number | null;
  human: boolean;
}

export interface LiveMatchConfig {
  id: string;
  mode: Mode;
  ranked: boolean;
  kind: 'ranked' | 'casual' | 'tutorial' | 'practice';
  theme: Theme;
  roundsToWin: number;
  width: number;
  height: number;
  players: MatchPlayer[];
  revenge: boolean;
}

export interface MatchResult {
  matchId: string;
  mode: Mode;
  ranked: boolean;
  kind: LiveMatchConfig['kind'];
  placements: {
    id: string;
    name: string;
    tag: string;
    animal: string;
    hat: string;
    placement: number;
    roundWins: number;
    soaks: number;
    castles: number;
    bot: boolean;
    rating: number;
    games: number;
    human: boolean;
  }[];
  xp: Record<string, number>;
  forfeited: boolean;
}

export class LiveMatch {
  phase: 'intro' | 'countdown' | 'playing' | 'intermission' | 'ended' = 'intro';
  phaseTicks: number = CONFIG.INTRO_TICKS;
  round = 0;
  state: SimState | null = null;
  selfSoaks = 0;
  pendingDeltas: { id: string; before: number; delta: number; after: number }[] = [];
  readonly players: MatchPlayer[];
  private bots = new Map<string, Bot>();
  private queues = new Map<string, { seq: number; dir: Dir; balloon: boolean }[]>();
  private lastInput = new Map<string, { seq: number; dir: Dir; balloon: boolean }>();
  private ack = new Map<string, number>();
  private pings = new Map<string, number>();
  private forfeiters = new Set<string>();
  private lastRoundStart: Extract<ServerMsg, { t: 'round_start' }> | null = null;
  private matchStartMsg: Extract<ServerMsg, { t: 'match_start' }>;
  private rng: () => number;

  constructor(
    readonly config: LiveMatchConfig,
    private hooks: {
      send: (playerId: string, msg: ServerMsg) => void;
      onEnd: (result: MatchResult) => void;
    },
  ) {
    this.players = config.players;
    this.rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    for (const p of this.players) {
      if (p.bot) this.bots.set(p.id, new Bot(p.id, p.difficulty ?? 'medium', this.rng));
      this.queues.set(p.id, []);
    }
    this.matchStartMsg = {
      t: 'match_start',
      matchId: config.id,
      mode: config.mode,
      ranked: config.ranked,
      kind: config.kind,
      theme: config.theme,
      roundsToWin: config.roundsToWin,
      players: this.cards(),
    };
  }

  cards(): PlayerCard[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      tag: p.tag,
      animal: p.animal,
      hat: p.hat,
      rating: p.rating,
      tier: tierFor(p.rating).name,
      bot: p.bot,
      difficulty: p.difficulty,
    }));
  }

  start(): void {
    this.broadcast(this.matchStartMsg);
  }

  pushInput(playerId: string, seq: number, dir: Dir, balloon: boolean): void {
    const q = this.queues.get(playerId);
    if (!q) return;
    if (q.length && q[q.length - 1]!.seq >= seq) return;
    q.push({ seq, dir, balloon });
    if (q.length > 60) q.splice(0, q.length - 60);
  }

  setPing(playerId: string, rtt: number): void {
    this.pings.set(playerId, rtt);
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || !p.human) return;
    if (p.bot && connected) return;
    p.connected = connected;
    p.disconnectAt = connected ? null : Date.now();
    if (!connected) {
      this.queues.set(playerId, []);
      this.lastInput.set(playerId, { seq: this.ack.get(playerId) ?? 0, dir: 'none', balloon: false });
    } else this.resync(playerId);
  }

  promoteToBot(playerId: string): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || p.bot) return;
    p.bot = true;
    p.difficulty = 'medium';
    p.connected = false;
    p.disconnectAt = null;
    this.bots.set(playerId, new Bot(playerId, 'medium', this.rng));
  }

  forfeit(playerId: string): void {
    if (this.phase === 'ended') return;
    this.forfeiters.add(playerId);
    this.finish(true);
  }

  emote(playerId: string, id: number): void {
    this.broadcast({ t: 'emote', playerId, id });
  }

  resync(playerId: string): void {
    this.hooks.send(playerId, this.matchStartMsg);
    if (this.lastRoundStart) this.hooks.send(playerId, this.lastRoundStart);
    if (this.state) this.hooks.send(playerId, { t: 'snapshot', snap: this.snapFor(playerId) });
  }

  tick(): void {
    if (this.phase === 'ended') return;
    this.checkDisconnects();
    if (this.phase === 'intro') {
      this.phaseTicks -= 1;
      if (this.phaseTicks <= 0) this.beginRound();
      return;
    }
    if (this.phase === 'countdown') {
      this.phaseTicks -= 1;
      if (this.phaseTicks <= 0) this.phase = 'playing';
      return;
    }
    if (this.phase === 'intermission') {
      this.phaseTicks -= 1;
      if (this.phaseTicks <= 0) this.afterIntermission();
      return;
    }
    if (!this.state) return;
    const inputs = this.players.map((p) => {
      if (p.bot) {
        let bot = this.bots.get(p.id);
        if (!bot) {
          bot = new Bot(p.id, p.difficulty ?? 'medium', this.rng);
          this.bots.set(p.id, bot);
        }
        return bot.input(this.state!, this.state!.tick);
      }
      const q = this.queues.get(p.id) ?? [];
      let input = this.lastInput.get(p.id) ?? { seq: 0, dir: 'none' as Dir, balloon: false };
      if (q.length) {
        input = q.shift()!;
        this.lastInput.set(p.id, input);
        this.ack.set(p.id, input.seq);
      }
      return { id: p.id, dir: input.dir, balloon: input.balloon };
    });
    simulateTick(this.state, inputs);
    for (const e of this.state.events) {
      if (e.t === 'player_soaked' && e.by === e.playerId) this.selfSoaks += 1;
      this.broadcast({ t: 'event', event: e });
    }
    if (this.state.tick % 2 === 0) {
      for (const p of this.players) {
        if (p.human && p.connected && !p.bot) this.hooks.send(p.id, { t: 'snapshot', snap: this.snapFor(p.id) });
      }
    }
    if (this.state.phase === 'round_end') this.onRoundEnd();
  }

  private checkDisconnects(): void {
    const now = Date.now();
    for (const p of this.players) {
      if (!p.human || p.bot || p.connected || !p.disconnectAt) continue;
      if (now - p.disconnectAt < CONFIG.RECONNECT_GRACE_MS) continue;
      if (this.config.ranked) this.forfeit(p.id);
      else this.promoteToBot(p.id);
    }
  }

  private beginRound(): void {
    this.round += 1;
    const seed = Math.floor(this.rng() * 0x7fffffff);
    const lootSalt = Math.floor(this.rng() * 0x7fffffff) + 1;
    const map = generateMap({
      width: this.config.width,
      height: this.config.height,
      seed,
      players: this.players.length,
      lootSalt,
    });
    this.state = createRoundState({
      map,
      players: this.players.map((p) => ({ id: p.id, name: p.name, animal: p.animal, hat: p.hat })),
      enableKick: CONFIG.ENABLE_KICK,
      enableRevenge: this.config.revenge,
    });
    const now = Date.now();
    this.lastRoundStart = {
      t: 'round_start',
      roundNo: this.round,
      mapSeed: seed,
      width: map.width,
      height: map.height,
      castleGrid: map.tiles.slice(),
      theme: this.config.theme,
      spawns: map.spawns,
      serverTime: now,
      goAt: now + (CONFIG.COUNTDOWN_TICKS * 1000) / CONFIG.TICK_RATE,
      revenge: this.config.revenge,
    };
    this.broadcast(this.lastRoundStart);
    this.phase = 'countdown';
    this.phaseTicks = CONFIG.COUNTDOWN_TICKS;
  }

  private onRoundEnd(): void {
    if (!this.state) return;
    for (const sp of this.state.players) {
      const mp = this.players.find((p) => p.id === sp.id);
      if (!mp) continue;
      mp.soaks += sp.soaks;
      mp.castles += sp.castles;
      mp.biggestChain = Math.max(mp.biggestChain, sp.biggestChain);
      mp.survived += sp.survived;
    }
    if (this.state.winnerId) {
      const winner = this.players.find((p) => p.id === this.state!.winnerId);
      if (winner) winner.roundWins += 1;
    }
    this.broadcast({
      t: 'round_end',
      roundNo: this.round,
      winnerId: this.state.winnerId,
      draw: this.state.draw,
      scores: this.players.map((p) => ({ id: p.id, wins: p.roundWins, name: p.name })),
    });
    if (this.config.kind === 'tutorial') {
      const human = this.players.find((p) => p.human);
      if (human && this.state.winnerId === human.id) {
        this.finish(false);
        return;
      }
      this.phase = 'intermission';
      this.phaseTicks = 45;
      return;
    }
    if (this.players.some((p) => p.roundWins >= this.config.roundsToWin) || this.round >= CONFIG.MAX_ROUNDS) {
      this.finish(false);
      return;
    }
    this.phase = 'intermission';
    this.phaseTicks = CONFIG.INTERMISSION_TICKS;
  }

  private afterIntermission(): void {
    if (this.phase === 'ended') return;
    if (this.players.some((p) => p.roundWins >= this.config.roundsToWin) || this.round >= CONFIG.MAX_ROUNDS) {
      this.finish(false);
    } else this.beginRound();
  }

  private finish(forfeited: boolean): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const result = this.buildResult(forfeited);
    const deltas = this.eloDeltas(result);
    this.pendingDeltas = deltas;
    const ratingDeltas: Extract<ServerMsg, { t: 'match_end' }>['ratingDeltas'] = {};
    for (const d of deltas) {
      const after = Math.max(0, d.after);
      ratingDeltas[d.id] = {
        before: d.before,
        after,
        delta: after - d.before,
        tierBefore: tierFor(d.before).name,
        tierAfter: tierFor(after).name,
      };
    }
    this.broadcast({
      t: 'match_end',
      placements: result.placements.map((p) => ({
        id: p.id,
        name: p.name,
        tag: p.tag,
        animal: p.animal,
        hat: p.hat,
        placement: p.placement,
        roundWins: p.roundWins,
        soaks: p.soaks,
        castles: p.castles,
        bot: !p.human || p.bot,
      })),
      ratingDeltas,
      xp: result.xp,
      stats: {
        mostSoaks: stat(result.placements, (p) => p.soaks),
        castleCrusher: stat(result.placements, (p) => p.castles),
        longestSurvivor: stat(
          this.players.map((p) => ({ id: p.id, name: p.name, n: p.survived })),
          (p) => p.n,
        ),
        biggestChain: stat(
          this.players.map((p) => ({ id: p.id, name: p.name, n: p.biggestChain })),
          (p) => p.n,
        ),
      },
      ranked: this.config.ranked,
      casual: this.config.kind === 'casual',
    });
    this.hooks.onEnd(result);
  }

  private eloDeltas(result: MatchResult) {
    if (!this.config.ranked) return [];
    const humans = result.placements.filter((p) => p.human);
    if (this.config.mode === 'duel') {
      if (humans.length < 2) return [];
      const winner = humans.reduce((a, b) => (a.placement < b.placement ? a : b));
      return applyDuel(
        { id: humans[0]!.id, rating: humans[0]!.rating, games: humans[0]!.games },
        { id: humans[1]!.id, rating: humans[1]!.rating, games: humans[1]!.games },
        winner.id,
      );
    }
    return applyFfa(humans.map((p) => ({ id: p.id, rating: p.rating, games: p.games, placement: p.placement })));
  }

  private buildResult(forfeited: boolean): MatchResult {
    const active = this.players.filter((p) => !this.forfeiters.has(p.id));
    const placed = placementsFromScores(active.map((p) => ({ id: p.id, roundWins: p.roundWins, soaks: p.soaks })));
    const last = active.length + 1;
    const rows = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      tag: p.tag,
      animal: p.animal,
      hat: p.hat,
      placement: placed.find((x) => x.id === p.id)?.placement ?? last,
      roundWins: p.roundWins,
      soaks: p.soaks,
      castles: p.castles,
      bot: p.bot,
      rating: p.rating,
      games: p.games,
      human: p.human,
    }));
    const xp: Record<string, number> = {};
    for (const row of rows) {
      if (!row.human) continue;
      if (this.config.kind === 'tutorial') xp[row.id] = row.placement === 1 ? CONFIG.XP_TUTORIAL : 0;
      else if (this.forfeiters.has(row.id)) xp[row.id] = CONFIG.XP_PARTICIPATION;
      else xp[row.id] = matchXp(row.placement, row.soaks, row.castles);
    }
    return {
      matchId: this.config.id,
      mode: this.config.mode,
      ranked: this.config.ranked,
      kind: this.config.kind,
      placements: rows,
      xp,
      forfeited,
    };
  }

  private snapFor(playerId: string) {
    const wins: Record<string, number> = {};
    const pings: Record<string, number> = {};
    for (const p of this.players) {
      wins[p.id] = p.roundWins;
      pings[p.id] = this.pings.get(p.id) ?? 0;
    }
    return snapshotFromState(this.state!, this.ack.get(playerId) ?? 0, Date.now(), {
      round: this.round,
      roundWins: wins,
      pings,
    });
  }

  private broadcast(msg: ServerMsg): void {
    for (const p of this.players) {
      if (p.human && p.connected && !p.bot) this.hooks.send(p.id, msg);
    }
  }
}

function stat<T extends { id: string; name: string }>(
  rows: T[],
  score: (row: T) => number,
): { id: string; name: string; value: number } | null {
  let top: T | null = null;
  let value = 0;
  for (const row of rows) {
    const v = score(row);
    if (!top || v > value) {
      top = row;
      value = v;
    }
  }
  if (!top || value <= 0) return null;
  return { id: top.id, name: top.name, value };
}
