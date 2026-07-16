import {
  CONFIG,
  createRoundState,
  simulateTick,
  toSnapshot,
  type AnimalId,
  type BotDifficulty,
  type Dir,
  type GameMode,
  type GameState,
  type HatId,
  type InputMap,
  type MapTheme,
  type MatchConfig,
  type MatchKind,
  type PlayerInput,
  dimensionsForMode,
} from '@splash/shared';
import { botThink, createBot, type BotController } from './bots/bot.js';

export type MatchPlayer = {
  id: string;
  slot: number;
  nickname: string;
  animal: AnimalId;
  hat: HatId;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  rating?: number;
  connected: boolean;
  disconnectAt?: number;
  roundsWon: number;
  totalSoaks: number;
  totalCastles: number;
  longestAlive: number;
};

export type MatchCallbacks = {
  onSnapshot: (snap: ReturnType<typeof toSnapshot>) => void;
  onEvents: (events: GameState['events']) => void;
  onRoundStart: (data: {
    roundNo: number;
    mapSeed: number;
    castleGrid: number[];
    theme: MapTheme;
    width: number;
    height: number;
    scores: Record<string, number>;
  }) => void;
  onRoundEnd: (data: {
    roundNo: number;
    winnerIds: string[];
    draw: boolean;
    scores: Record<string, number>;
    soaks: Record<string, number>;
  }) => void;
  onMatchEnd: (data: {
    placements: Array<{
      playerId: string;
      nickname: string;
      placement: number;
      soaks: number;
      roundsWon: number;
      castlesWashed: number;
    }>;
    funStats: {
      mostSoaks: { playerId: string; nickname: string; value: number } | null;
      castleCrusher: { playerId: string; nickname: string; value: number } | null;
      longestSurvivor: { playerId: string; nickname: string; value: number } | null;
      biggestChain: number;
    };
    biggestChain: number;
  }) => void;
  onCountdown: (value: number | string) => void;
};

export class GameMatch {
  matchId: string;
  mode: GameMode;
  kind: MatchKind;
  ranked: boolean;
  roundsToWin: number;
  theme: MapTheme;
  players: MatchPlayer[];
  roundNo = 0;
  state: GameState | null = null;
  phase: 'intro' | 'countdown' | 'playing' | 'round_end' | 'match_end' = 'intro';
  phaseTicks = 0;
  inputs: Map<string, PlayerInput> = new Map();
  bots: BotController[] = [];
  botSeq = 0;
  biggestChain = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapAccum = 0;
  private cbs: MatchCallbacks;
  private ended = false;

  constructor(
    config: MatchConfig,
    cbs: MatchCallbacks,
  ) {
    this.matchId = config.matchId;
    this.mode = config.mode;
    this.kind = config.kind;
    this.ranked = config.ranked;
    this.roundsToWin = config.roundsToWin;
    this.theme = config.theme === 'random' ? 'backyard' : config.theme;
    this.players = config.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      nickname: p.nickname,
      animal: p.animal,
      hat: p.hat,
      isBot: p.isBot,
      botDifficulty: p.isBot ? ('medium' as BotDifficulty) : undefined,
      rating: p.rating,
      connected: !p.isBot,
      roundsWon: 0,
      totalSoaks: 0,
      totalCastles: 0,
      longestAlive: 0,
    }));
    // Fix bot difficulties from config if present
    for (const cp of config.players) {
      const mp = this.players.find((p) => p.id === cp.id);
      if (mp && cp.isBot) {
        // difficulty may be encoded in id bot-easy-0 etc — default medium
        const m = cp.id.match(/^bot-(easy|medium|hard)-/);
        if (m) mp.botDifficulty = m[1] as BotDifficulty;
      }
    }
    this.cbs = cbs;
  }

  start(): void {
    this.phase = 'intro';
    this.phaseTicks = 0;
    this.tickTimer = setInterval(() => this.tick(), 1000 / CONFIG.TICK_RATE);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  setInput(playerId: string, input: PlayerInput): void {
    this.inputs.set(playerId, input);
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = connected;
    if (!connected) p.disconnectAt = Date.now();
    else p.disconnectAt = undefined;
  }

  convertToBot(playerId: string, difficulty: BotDifficulty = 'medium'): void {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || p.isBot) return;
    p.isBot = true;
    p.botDifficulty = difficulty;
    p.connected = true;
    this.bots.push(createBot(playerId, difficulty));
    if (this.state) {
      const sp = this.state.players.find((x) => x.id === playerId);
      if (sp) {
        sp.isBot = true;
        sp.botDifficulty = difficulty;
      }
    }
  }

  private scores(): Record<string, number> {
    const s: Record<string, number> = {};
    for (const p of this.players) s[p.id] = p.roundsWon;
    return s;
  }

  private startRound(): void {
    this.roundNo++;
    const dims = dimensionsForMode(this.mode);
    const mapSeed = (Math.random() * 0xffffffff) >>> 0;
    const theme = this.theme;

    this.bots = [];
    for (const p of this.players) {
      if (p.isBot) {
        this.bots.push(createBot(p.id, p.botDifficulty ?? 'medium'));
      }
    }

    this.state = createRoundState({
      width: dims.width,
      height: dims.height,
      mapSeed,
      theme,
      ranked: this.ranked,
      players: this.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        nickname: p.nickname,
        animal: p.animal,
        hat: p.hat,
        isBot: p.isBot,
        botDifficulty: p.botDifficulty,
      })),
    });

    this.inputs.clear();
    this.cbs.onRoundStart({
      roundNo: this.roundNo,
      mapSeed,
      castleGrid: this.state.grid.slice(),
      theme: this.state.theme,
      width: this.state.width,
      height: this.state.height,
      scores: this.scores(),
    });
  }

  private tick(): void {
    if (this.ended) return;
    this.phaseTicks++;

    // Disconnect forfeit check (ranked)
    if (this.ranked && this.phase === 'playing') {
      for (const p of this.players) {
        if (!p.connected && !p.isBot && p.disconnectAt) {
          if (Date.now() - p.disconnectAt > CONFIG.RECONNECT_GRACE_MS) {
            // Forfeit: mark as soaked in state
            if (this.state) {
              const sp = this.state.players.find((x) => x.id === p.id);
              if (sp && sp.alive && !sp.soaked) {
                sp.soaked = true;
                sp.alive = false;
                sp.soakTick = this.state.tick;
                this.state.livingCount = this.state.players.filter((x) => x.alive && !x.soaked).length;
                if (this.state.livingCount <= 1) {
                  this.state.roundOver = true;
                  const living = this.state.players.filter((x) => x.alive && !x.soaked);
                  this.state.winnerIds = living.map((x) => x.id);
                }
              }
            }
          }
        }
      }
    }

    // Casual disconnect → bot after grace
    if (!this.ranked && this.phase === 'playing') {
      for (const p of this.players) {
        if (!p.connected && !p.isBot && p.disconnectAt) {
          if (Date.now() - p.disconnectAt > CONFIG.RECONNECT_GRACE_MS) {
            this.convertToBot(p.id, 'medium');
          }
        }
      }
    }

    if (this.phase === 'intro') {
      if (this.phaseTicks === 1) this.cbs.onCountdown('VS');
      if (this.phaseTicks >= CONFIG.TICK_RATE * 2) {
        this.phase = 'countdown';
        this.phaseTicks = 0;
        this.startRound();
      }
      return;
    }

    if (this.phase === 'countdown') {
      const sec = 3 - Math.floor(this.phaseTicks / CONFIG.TICK_RATE);
      if (this.phaseTicks % CONFIG.TICK_RATE === 0 && sec >= 0) {
        this.cbs.onCountdown(sec === 0 ? 'SPLASH!' : sec);
      }
      if (this.phaseTicks >= CONFIG.TICK_RATE * 3) {
        this.phase = 'playing';
        this.phaseTicks = 0;
      }
      return;
    }

    if (this.phase === 'round_end') {
      if (this.phaseTicks >= CONFIG.TICK_RATE * 3) {
        // Check match over
        const maxRounds = Math.max(...this.players.map((p) => p.roundsWon));
        if (maxRounds >= this.roundsToWin) {
          this.finishMatch();
        } else {
          this.phase = 'countdown';
          this.phaseTicks = 0;
          this.startRound();
        }
      }
      return;
    }

    if (this.phase === 'match_end') return;

    if (this.phase === 'playing' && this.state) {
      // Bot inputs
      const inputMap: InputMap = {};
      for (const bot of this.bots) {
        this.botSeq++;
        inputMap[bot.playerId] = botThink(bot, this.state, this.botSeq);
      }
      // Human inputs
      for (const p of this.players) {
        if (p.isBot) continue;
        const inp = this.inputs.get(p.id);
        if (inp) inputMap[p.id] = inp;
      }

      simulateTick(this.state, inputMap);

      // Track chain
      for (const e of this.state.events) {
        if (e.type === 'chain_burst') {
          this.biggestChain = Math.max(this.biggestChain, e.count);
        }
      }

      if (this.state.events.length) {
        this.cbs.onEvents(this.state.events.slice());
      }

      // Snapshots at 15Hz (every 2 ticks at 30Hz)
      this.snapAccum++;
      if (this.snapAccum >= Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE)) {
        this.snapAccum = 0;
        this.cbs.onSnapshot(toSnapshot(this.state));
      }

      if (this.state.roundOver) {
        // Accumulate stats
        for (const sp of this.state.players) {
          const mp = this.players.find((p) => p.id === sp.id);
          if (!mp) continue;
          mp.totalSoaks += sp.soaks;
          mp.totalCastles += sp.castlesWashed;
          if (!sp.soaked) mp.longestAlive = Math.max(mp.longestAlive, this.state.tick);
          else mp.longestAlive = Math.max(mp.longestAlive, sp.soakTick);
        }

        const winnerIds = this.state.winnerIds.slice();
        const draw = winnerIds.length === 0;
        if (!draw) {
          for (const wid of winnerIds) {
            const mp = this.players.find((p) => p.id === wid);
            if (mp) mp.roundsWon++;
          }
        }

        const soaks: Record<string, number> = {};
        for (const sp of this.state.players) soaks[sp.id] = sp.soaks;

        this.cbs.onRoundEnd({
          roundNo: this.roundNo,
          winnerIds,
          draw,
          scores: this.scores(),
          soaks,
        });

        this.phase = 'round_end';
        this.phaseTicks = 0;
      }
    }
  }

  private finishMatch(): void {
    this.ended = true;
    this.phase = 'match_end';
    this.stop();

    // Placements by rounds won, tiebreak soaks
    const sorted = [...this.players].sort((a, b) => {
      if (b.roundsWon !== a.roundsWon) return b.roundsWon - a.roundsWon;
      return b.totalSoaks - a.totalSoaks;
    });

    // Assign placement with ties
    const placements: Array<{
      playerId: string;
      nickname: string;
      placement: number;
      soaks: number;
      roundsWon: number;
      castlesWashed: number;
    }> = [];
    let place = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        if (cur.roundsWon !== prev.roundsWon || cur.totalSoaks !== prev.totalSoaks) {
          place = i + 1;
        }
      }
      const p = sorted[i]!;
      placements.push({
        playerId: p.id,
        nickname: p.nickname,
        placement: place,
        soaks: p.totalSoaks,
        roundsWon: p.roundsWon,
        castlesWashed: p.totalCastles,
      });
    }

    const mostSoaks = [...this.players].sort((a, b) => b.totalSoaks - a.totalSoaks)[0];
    const castleCrusher = [...this.players].sort((a, b) => b.totalCastles - a.totalCastles)[0];
    const longest = [...this.players].sort((a, b) => b.longestAlive - a.longestAlive)[0];

    this.cbs.onMatchEnd({
      placements,
      funStats: {
        mostSoaks: mostSoaks
          ? { playerId: mostSoaks.id, nickname: mostSoaks.nickname, value: mostSoaks.totalSoaks }
          : null,
        castleCrusher: castleCrusher
          ? { playerId: castleCrusher.id, nickname: castleCrusher.nickname, value: castleCrusher.totalCastles }
          : null,
        longestSurvivor: longest
          ? { playerId: longest.id, nickname: longest.nickname, value: longest.longestAlive }
          : null,
        biggestChain: this.biggestChain,
      },
      biggestChain: this.biggestChain,
    });
  }
}
