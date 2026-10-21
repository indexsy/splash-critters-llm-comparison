import { createHash, randomUUID } from 'node:crypto';
import {
  CONFIG,
  beginRound,
  createMatchState,
  isAnimal,
  isHat,
  mixSeed,
  simulateTick,
  tierName,
  type AnimalId,
  type GameState,
  type HatId,
  type Mode,
  type Placement,
  type PlayerInput,
  type ServerMessage,
  type SimEvent,
  type Snapshot,
  type Theme,
} from '@splash-critters/shared';
import { BotBrain } from './bots/bot.js';
import type { BotDifficulty } from '@splash-critters/shared';

export interface RoomClient {
  playerId: string;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  rating: number;
  ping: number;
  send(message: ServerMessage): void;
}

export interface RoomSlot {
  index: number;
  kind: 'empty' | 'human' | 'bot';
  playerId: string | null;
  client: RoomClient | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  difficulty?: BotDifficulty;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  rating: number;
  lastSeq: number;
  pendingInput: PlayerInput | null;
  disconnectedAt: number | null;
}

export type RoomPhase = 'lobby' | 'playing' | 'roundEnd' | 'matchEnd';

export interface RoomStandings {
  slotIndex: number;
  playerId: string | null;
  nickname: string;
  tag: string;
  roundWins: number;
  soaks: number;
  castlesWashed: number;
  biggestChain: number;
  survivedTicks: number;
}

export interface RoomOptionsInternal {
  name: string;
  maxPlayers: 2 | 4;
  isPublic: boolean;
  theme: Theme | 'random';
  roundsToWin: number;
  botFill: boolean;
  ranked: boolean;
  mode: Mode;
}

export interface MatchEndPayload {
  placements: Placement[];
  ratingDeltas: {
    playerId: string;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    tier: string;
    tierBefore: string;
  }[];
  xp: { playerId: string; xp: number; totalXp: number; level: number; levelUp: boolean }[];
  stats: {
    mostSoaks?: string;
    castleCrusher?: string;
    longestSurvivor?: string;
    biggestChain?: string;
  };
}

export interface RoomDeps {
  onMatchEnd(room: Room, standings: RoomStandings[]): MatchEndPayload;
}

const ROUND_END_PAUSE_MS = 3600;

export class Room {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly maxPlayers: 2 | 4;
  readonly isPublic: boolean;
  theme: Theme | 'random';
  roundsToWin: number;
  botFill: boolean;
  readonly ranked: boolean;
  readonly mode: Mode;
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  phase: RoomPhase = 'lobby';
  state: GameState | null = null;
  matchId = '';
  matchStartedAt = 0;
  rematchVotes = new Set<string>();
  private roundEndAt = 0;
  private nextRoundAt = 0;
  private seed: number;
  private bots = new Map<number, BotBrain>();
  private hostId: string | null = null;
  private snapshotCounter = 0;
  private deps: RoomDeps;

  slots: RoomSlot[] = [];
  private activeSlotIndices: number[] = [];
  private pendingEvents: SimEvent[] = [];

  constructor(options: RoomOptionsInternal, code: string, deps: RoomDeps) {
    this.id = randomUUID();
    this.code = code;
    this.name = options.name;
    this.maxPlayers = options.maxPlayers;
    this.isPublic = options.isPublic;
    this.theme = options.theme;
    this.roundsToWin = options.roundsToWin;
    this.botFill = options.botFill;
    this.ranked = options.ranked;
    this.mode = options.mode;
    this.seed = Math.floor(Math.random() * 0xffffffff);
    this.deps = deps;
    for (let i = 0; i < options.maxPlayers; i++) {
      this.slots.push(this.emptySlot(i));
    }
  }

  private emptySlot(index: number): RoomSlot {
    return {
      index,
      kind: 'empty',
      playerId: null,
      client: null,
      nickname: '',
      tag: '',
      animal: 'frog',
      hat: 'none',
      connected: false,
      ready: false,
      isHost: false,
      rating: CONFIG.ELO.start,
      lastSeq: 0,
      pendingInput: null,
      disconnectedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // lobby
  // -------------------------------------------------------------------------

  get host(): RoomSlot | undefined {
    return this.slots.find((s) => s.isHost);
  }

  get humanCount(): number {
    return this.slots.filter((s) => s.kind === 'human').length;
  }

  get occupiedCount(): number {
    return this.slots.filter((s) => s.kind !== 'empty').length;
  }

  get inProgress(): boolean {
    return this.phase !== 'lobby';
  }

  addHuman(client: RoomClient): { ok: boolean; msg?: string } {
    if (this.phase !== 'lobby') {
      return { ok: false, msg: 'That match already started.' };
    }
    const existing = this.slots.find((s) => s.playerId === client.playerId);
    if (existing) {
      existing.client = client;
      existing.connected = true;
      existing.disconnectedAt = null;
      this.lastActivity = Date.now();
      return { ok: true };
    }
    const slot = this.slots.find((s) => s.kind === 'empty');
    if (!slot) return { ok: false, msg: 'That room is full.' };
    slot.kind = 'human';
    slot.playerId = client.playerId;
    slot.client = client;
    slot.nickname = client.nickname;
    slot.tag = client.tag;
    slot.animal = client.animal;
    slot.hat = client.hat;
    slot.rating = client.rating;
    slot.connected = true;
    slot.ready = false;
    slot.lastSeq = 0;
    slot.pendingInput = null;
    if (!this.hostId) {
      slot.isHost = true;
      this.hostId = client.playerId;
    }
    this.lastActivity = Date.now();
    return { ok: true };
  }

  /** Detaches a client. The slot stays reserved for the reconnect grace time. */
  removeHuman(playerId: string): void {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot) return;
    slot.client = null;
    slot.connected = false;
    slot.disconnectedAt = Date.now();
    slot.pendingInput = null;
    this.lastActivity = Date.now();
  }

  /** Fully removes a player from the lobby (never started a match). */
  removeFromLobby(playerId: string): void {
    const slot = this.slots.find((s) => s.playerId === playerId);
    if (!slot) return;
    slot.kind = 'empty';
    slot.playerId = null;
    slot.client = null;
    slot.nickname = '';
    slot.tag = '';
    slot.connected = false;
    slot.ready = false;
    slot.disconnectedAt = null;
    slot.pendingInput = null;
    slot.lastSeq = 0;
    if (slot.isHost) {
      slot.isHost = false;
      this.hostId = null;
      const next = this.slots.find((s) => s.kind === 'human');
      if (next) {
        next.isHost = true;
        this.hostId = next.playerId;
      }
    }
  }

  setSlot(
    index: number,
    kind: 'empty' | 'human' | 'bot',
    difficulty: BotDifficulty | undefined,
  ): boolean {
    const slot = this.slots[index];
    if (!slot) return false;
    if (slot.kind === 'human' && slot.connected) return false; // never kick a live player
    slot.kind = kind;
    slot.playerId = null;
    slot.client = null;
    slot.connected = false;
    slot.ready = false;
    slot.nickname = kind === 'bot' ? `${difficulty ?? 'medium'} bot` : '';
    slot.tag = '';
    slot.difficulty = kind === 'bot' ? difficulty ?? 'medium' : undefined;
    slot.animal = this.pickAnimal(index);
    slot.hat = 'none';
    slot.lastSeq = 0;
    slot.pendingInput = null;
    this.bots.delete(index);
    return true;
  }

  private pickAnimal(index: number): AnimalId {
    const pool: AnimalId[] = ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara'];
    return pool[index % pool.length];
  }

  /** Fills the remaining slots with bots when the host asked for it. */
  fillWithBots(): void {
    for (const slot of this.slots) {
      if (slot.kind === 'empty') {
        slot.kind = 'bot';
        slot.difficulty = 'medium';
        slot.nickname = 'medium bot';
        slot.animal = this.pickAnimal(slot.index);
      }
    }
  }

  get canStart(): boolean {
    if (this.phase !== 'lobby') return false;
    const humans = this.slots.filter((s) => s.kind === 'human');
    const filled = this.slots.filter((s) => s.kind !== 'empty');
    if (filled.length < 2) return false;
    if (this.botFill) return filled.length === this.slots.length;
    // a host may also start a match with bots in some slots
    return humans.length >= 1 && filled.length >= 2;
  }

  // -------------------------------------------------------------------------
  // match lifecycle
  // -------------------------------------------------------------------------

  startMatch(): boolean {
    if (!this.canStart) return false;
    this.activeSlotIndices = this.slots
      .filter((s) => s.kind !== 'empty')
      .map((s) => s.index);
    const players = this.activeSlotIndices.map((index) => ({
      animal: this.slots[index].animal,
      hat: this.slots[index].hat,
    }));
    const seed = this.seed;
    this.state = createMatchState({
      mode: this.mode,
      roundsToWin: this.roundsToWin,
      theme: this.resolveTheme(),
      seed,
      players,
      revengeDucks: this.ranked
        ? CONFIG.ENABLE_REVENGE_DUCKS_RANKED
        : CONFIG.ENABLE_REVENGE_DUCKS,
      enableKick: CONFIG.ENABLE_KICK,
    });
    this.matchId = randomUUID();
    this.matchStartedAt = Date.now();
    this.phase = 'playing';
    this.rematchVotes.clear();
    this.pendingEvents.length = 0;
    this.bots.clear();
    for (const index of this.activeSlotIndices) {
      const slot = this.slots[index];
      const playerId = this.activeSlotIndices.indexOf(index);
      const p = this.state.players[playerId];
      if (slot.kind === 'bot') {
        this.bots.set(index, new BotBrain(slot.difficulty ?? 'medium'));
      }
      if (!p) continue;
      p.nickname = slot.nickname;
      p.tag = slot.tag;
      p.isBot = slot.kind === 'bot';
      p.botDifficulty = slot.kind === 'bot' ? slot.difficulty : undefined;
    }
    this.broadcast({
      t: 'match_start',
      config: this.matchConfig(),
    });
    this.beginNextRound(1);
    return true;
  }

  resolveTheme(): Theme {
    if (this.theme === 'random') {
      const pool: Theme[] = ['backyard', 'beach', 'pool'];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return this.theme;
  }

  matchConfig() {
    return {
      mode: this.mode,
      roundsToWin: this.roundsToWin,
      theme: this.theme,
      ranked: this.ranked,
      enableRevengeDucks: this.ranked
        ? CONFIG.ENABLE_REVENGE_DUCKS_RANKED
        : CONFIG.ENABLE_REVENGE_DUCKS,
      enableKick: CONFIG.ENABLE_KICK,
      players: this.slots.map((slot) => ({
        id: slot.index,
        playerId: slot.playerId ?? undefined,
        nickname: slot.nickname,
        tag: slot.tag,
        animal: slot.animal,
        hat: slot.hat,
        isBot: slot.kind === 'bot',
        rating: slot.rating,
        tier: tierName(slot.rating),
      })),
    };
  }

  private beginNextRound(roundNo: number): void {
    if (!this.state) return;
    const theme = this.resolveTheme();
    const mapSeed = mixSeed(this.seed, roundNo, Date.now() & 0xffff);
    beginRound(this.state, roundNo, mapSeed, theme);
    this.phase = 'playing';
    this.roundEndAt = 0;
    this.nextRoundAt = 0;
    const castleGrid = this.state.arena.castles.map((c) => (c ? '1' : '0')).join('');
    this.broadcast({
      t: 'round_start',
      roundNo,
      mapSeed,
      castleGrid,
      theme,
      config: this.matchConfig(),
    });
  }

  /** One simulation step. Returns the events produced by the tick. */
  tick(now: number): SimEvent[] {
    this.lastActivity = now;
    if (this.phase === 'matchEnd') return [];
    if (this.phase === 'lobby') {
      this.maybeFillBots(now);
      return [];
    }
    if (!this.state) return [];

    this.handleDisconnects(now);

    if (this.phase === 'roundEnd') {
      if (now >= this.nextRoundAt) {
        this.beginNextRound(this.state.roundNo + 1);
      }
      return [];
    }

    const inputs = this.collectInputs(now);
    const result = simulateTick(this.state, inputs);
    this.pendingEvents.push(...this.state.events);

    if (result.roundEnded) {
      this.phase = 'roundEnd';
      this.roundEndAt = now;
      this.nextRoundAt = now + ROUND_END_PAUSE_MS;
      const scores = this.state.players.map((p) => ({
        id: p.id,
        nickname: p.nickname ?? '',
        tag: p.tag ?? '',
        roundWins: p.roundWins,
      }));
      this.broadcast({
        t: 'round_end',
        roundNo: this.state.roundNo,
        winners: result.winners,
        draw: result.draw,
        scores,
        nextInMs: ROUND_END_PAUSE_MS,
      });
      const champion = this.state.players.find((p) => p.roundWins >= this.roundsToWin);
      if (champion) {
        this.endMatch();
      }
    }
    return this.pendingEvents;
  }

  private maybeFillBots(now: number): void {
    if (!this.botFill) return;
    let changed = false;
    for (const slot of this.slots) {
      if (slot.kind === 'empty') {
        slot.kind = 'bot';
        slot.difficulty = 'medium';
        slot.nickname = 'medium bot';
        slot.animal = this.pickAnimal(slot.index);
        changed = true;
      }
    }
    if (changed) this.lastActivity = now;
  }

  private handleDisconnects(now: number): void {
    for (const slot of this.slots) {
      if (slot.kind !== 'human' || slot.connected || !slot.disconnectedAt) continue;
      if (now - slot.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;
      if (this.ranked) {
        // The leaver forfeits: the match ends with them in last place.
        this.forfeit(slot);
        return;
      }
      // Casual: the empty slot becomes a medium bot.
      slot.kind = 'bot';
      slot.difficulty = 'medium';
      slot.nickname = 'medium bot';
      slot.connected = false;
      slot.disconnectedAt = null;
      slot.client = null;
      this.bots.set(slot.index, new BotBrain('medium'));
      const p = this.playerForSlot(slot.index);
      if (p) {
        p.isBot = true;
        p.botDifficulty = 'medium';
        p.nickname = 'medium bot';
      }
    }
  }

  /** The simulation player that belongs to a lobby slot. */
  playerForSlot(slotIndex: number): GameState['players'][number] | undefined {
    if (!this.state) return undefined;
    const pos = this.activeSlotIndices.indexOf(slotIndex);
    if (pos < 0) return undefined;
    return this.state.players[pos];
  }

  /** The lobby slot that belongs to a simulation player. */
  slotForPlayer(playerId: number): RoomSlot | undefined {
    const index = this.activeSlotIndices[playerId];
    if (index === undefined) return undefined;
    return this.slots[index];
  }

  private forfeit(slot: RoomSlot): void {
    if (!this.state) return;
    for (const p of this.state.players) p.roundWins = 0;
    const leaver = this.playerForSlot(slot.index);
    if (leaver) leaver.roundWins = -1; // the leaver takes last place
    this.phase = 'matchEnd';
    this.endMatch(true);
  }

  private collectInputs(now: number): PlayerInput[] {
    const inputs: PlayerInput[] = [];
    if (!this.state) return inputs;
    for (const index of this.activeSlotIndices) {
      const slot = this.slots[index];
      const playerId = this.activeSlotIndices.indexOf(index);
      if (slot.kind === 'human') {
        const input = slot.pendingInput;
        slot.pendingInput = null;
        if (!input) continue;
        if (input.seq <= slot.lastSeq) continue; // ignore replayed or impossible inputs
        slot.lastSeq = input.seq;
        inputs.push({
          playerId,
          seq: input.seq,
          dir: input.dir & 15,
          balloon: input.balloon === true,
        });
      } else if (slot.kind === 'bot') {
        const brain = this.bots.get(index);
        if (!brain) continue;
        const input = brain.update(this.state, playerId);
        if (input) inputs.push(input);
      }
    }
    return inputs;
  }

  queueInput(slot: RoomSlot, input: { seq: number; tick: number; dir: number; balloon: boolean }): void {
    if (input.seq <= slot.lastSeq) return;
    if (input.seq > slot.lastSeq + 240) return; // impossible sequence, ignore
    slot.pendingInput = {
      playerId: slot.index,
      seq: input.seq,
      dir: input.dir & 15,
      balloon: input.balloon === true,
    };
  }

  emitEmote(slotIndex: number, id: number): void {
    this.broadcast({
      t: 'event',
      event: { t: 'emote', player: slotIndex, id },
    });
  }

  // -------------------------------------------------------------------------
  // snapshots
  // -------------------------------------------------------------------------

  buildSnapshot(): Snapshot {
    if (!this.state) {
      return {
        tick: 0,
        phase: 'countdown',
        roundNo: 0,
        countdown: 0,
        timeLeft: 0,
        tideRing: -1,
        castles: '',
        players: [],
        balloons: [],
        splashes: [],
        exposed: [],
        events: [],
        serverTime: Date.now(),
      };
    }
    const s = this.state;
    return {
      tick: s.tick,
      phase: s.phase,
      roundNo: s.roundNo,
      countdown: s.countdown,
      timeLeft: s.timeLeft,
      tideRing: s.tideRing,
      castles: s.arena.castles.map((c) => (c ? '1' : '0')).join(''),
      players: s.players.map((p) => ({
        id: p.id,
        animal: p.animal,
        hat: p.hat,
        nickname: p.nickname ?? '',
        tag: p.tag ?? '',
        x: p.x,
        y: p.y,
        facing: p.facing,
        moving: p.moving,
        alive: p.alive,
        speed: p.speed,
        balloonCount: p.balloonCount,
        splashRange: p.splashRange,
        hasBoots: p.hasBoots,
        roundWins: p.roundWins,
        soaks: p.soaks,
        castlesWashed: p.castlesWashed,
        biggestChain: p.biggestChain,
        duck: p.duck ? { x: p.duck.x, y: p.duck.y, dir: p.duck.dir } : null,
        isBot: p.isBot,
        lastSeq: p.lastSeq,
      })),
      balloons: s.balloons.map((b) => ({
        id: b.id,
        owner: b.owner,
        x: b.x,
        y: b.y,
        fuse: b.fuse,
        range: b.range,
        revenge: b.revenge,
        sliding: b.sliding,
        slideDir: b.slideDir,
      })),
      splashes: s.splashes.map((sp) => ({
        id: sp.id,
        x: sp.x,
        y: sp.y,
        lens: sp.lens,
        ticks: sp.ticks,
        depth: sp.depth,
      })),
      exposed: s.exposed.map((e) => ({ id: e.id, x: e.x, y: e.y, kind: e.kind })),
      events: this.pendingEvents.splice(0, this.pendingEvents.length),
      serverTime: Date.now(),
    };
  }

  broadcastSnapshot(snapshot: Snapshot): void {
    this.broadcast({ t: 'snapshot', snapshot });
  }

  shouldSendSnapshot(): boolean {
    this.snapshotCounter += 1;
    return this.snapshotCounter % 2 === 0;
  }

  // -------------------------------------------------------------------------
  // results
  // -------------------------------------------------------------------------

  standings(): RoomStandings[] {
    if (!this.state) return [];
    return this.state.players.map((p) => {
      const slotIndex = this.activeSlotIndices[p.id];
      return {
        slotIndex,
        playerId: this.slots[slotIndex]?.playerId ?? null,
        nickname: this.slots[slotIndex]?.nickname ?? 'critter',
        tag: this.slots[slotIndex]?.tag ?? '',
        roundWins: p.roundWins,
        soaks: p.soaks,
        castlesWashed: p.castlesWashed,
        biggestChain: p.biggestChain,
        survivedTicks: p.survivalTicks,
      };
    });
  }

  endMatch(forfeit = false): void {
    if (!this.state) return;
    this.phase = 'matchEnd';
    this.lastActivity = Date.now();
    const standings = this.standings();
    const payload = this.deps.onMatchEnd(this, standings);
    this.broadcast({
      t: 'match_end',
      mode: this.mode,
      ranked: this.ranked,
      placements: payload.placements,
      ratingDeltas: payload.ratingDeltas,
      xp: payload.xp,
      stats: payload.stats,
    });
    void forfeit;
  }

  /** Majority vote restarts the match in the same room. */
  requestRematch(playerId: string): boolean {
    this.rematchVotes.add(playerId);
    return this.canRematch();
  }

  canRematch(): boolean {
    const humans = this.slots.filter((s) => s.kind === 'human');
    if (humans.length === 0) return false;
    const needed = Math.floor(humans.length / 2) + 1;
    return this.rematchVotes.size >= needed;
  }

  /** Puts the room back into the lobby and starts the rematch right away. */
  resetForRematch(): boolean {
    this.rematchVotes.clear();
    this.state = null;
    this.phase = 'lobby';
    for (const slot of this.slots) slot.ready = false;
    if (!this.canStart) return false;
    return this.startMatch();
  }

  broadcast(message: ServerMessage): void {
    for (const slot of this.slots) {
      slot.client?.send(message);
    }
  }

  info() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      maxPlayers: this.maxPlayers,
      players: this.occupiedCount,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      host: this.host?.nickname ?? 'host',
      isPublic: this.isPublic,
      inProgress: this.inProgress,
    };
  }

  lobbyState() {
    return {
      ...this.info(),
      slots: this.slots.map((slot) => ({
        index: slot.index,
        kind: slot.kind,
        nickname: slot.nickname,
        tag: slot.tag,
        animal: slot.animal,
        hat: slot.hat,
        difficulty: slot.difficulty,
        playerId: slot.playerId ?? undefined,
        connected: slot.connected,
        ready: slot.ready,
        isHost: slot.isHost,
        rating: slot.rating,
      })),
      phase: this.phase,
      ranked: this.ranked,
      rematchVotes: [...this.rematchVotes],
      countdown: 0,
    };
  }
}
