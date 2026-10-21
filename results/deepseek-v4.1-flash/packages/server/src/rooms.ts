import {
  ANIMALS,
  CONFIG,
  HATS,
  createRoundState,
  duelDelta,
  ffaDeltas,
  generateArena,
  hashString,
  levelFromXp,
  randomSeed,
  roundSeed,
  simulateTick,
  snapshotRound,
  tierForRating,
  type AnimalId,
  type Arena,
  type ArenaRoundStart,
  type ArenaTheme,
  type Difficulty,
  type Dir,
  type GameMode,
  type HatId,
  type LobbySlotView,
  type LobbyView,
  type MatchAwards,
  type MatchConfig,
  type MatchEndPayload,
  type MatchPlacement,
  type MatchPlayerInfo,
  type PlayerInput,
  type PlayerProfile,
  type PlayerSnapshot,
  type RoomSummary,
  type RoundEndPayload,
  type RoundState,
  type ServerMessage,
  type Vec,
} from "@splash/shared";
import {
  type CompletedMatchPlayer,
  getProfile,
  getSingleRating,
  recordCompletedMatch,
} from "./db/queries.js";
import type { SplashDb } from "./db/index.js";
import { BotBrain } from "./bots/bot.js";

export interface RoomTransport {
  send(playerId: string, message: ServerMessage): void;
  isOnline(playerId: string): boolean;
  roomListChanged(): void;
  profileChanged(playerId: string): void;
}

interface Member {
  id: string;
  playerId: string | null;
  name: string;
  animal: AnimalId;
  hat: HatId;
  level: number;
  rating: number | null;
  isBot: boolean;
  difficulty: Difficulty | null;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  botReplaced: boolean;
  left: boolean;
  leaver: boolean;
  lastEmoteAt: number;
}

interface MatchStat {
  soaks: number;
  castles: number;
  biggestChain: number;
  roundsWon: number;
  survivedTicks: number;
}

interface MatchRuntime {
  startedAt: number;
  matchSeed: number;
  matchCount: number;
  phase: "intro" | "countdown" | "playing" | "round_end" | "done";
  phaseTicks: number;
  roundNo: number;
  sim: RoundState | null;
  arena: Arena | null;
  lastRoundStart: ArenaRoundStart | null;
  lastRoundEnd: RoundEndPayload | null;
  bots: Map<string, BotBrain>;
  inputs: Map<string, PlayerInput>;
  lastSeq: Map<string, number>;
  acks: Record<string, number>;
  stats: Map<string, MatchStat>;
  roundsWon: Record<string, number>;
  pendingMatchEnd: boolean;
  rematchVotes: Set<string>;
  matchEndPayload: MatchEndPayload | null;
  disconnectCounter: number;
  roundSurvivalCounted: boolean;
}

export interface CreateRoomOptionsInternal {
  name: string;
  size: 2 | 4;
  isPrivate: boolean;
  theme: ArenaTheme | "random";
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  practice?: boolean;
}

interface BotTemplate {
  name: string;
  animal: AnimalId;
  hat: HatId;
}

const BOT_NAMES: BotTemplate[] = [
  { name: "Bubbles", animal: "frog", hat: "bucket" },
  { name: "Waddles", animal: "duck", hat: "none" },
  { name: "Pebble", animal: "turtle", hat: "snorkel" },
  { name: "Noodle", animal: "otter", hat: "bandana" },
  { name: "Tux", animal: "penguin", hat: "crown" },
  { name: "Mochi", animal: "cat", hat: "propeller" },
  { name: "Bandit", animal: "raccoon", hat: "bucket" },
  { name: "Biscuit", animal: "capybara", hat: "none" },
  { name: "Sprinkles", animal: "duck", hat: "snorkel" },
  { name: "Splashy", animal: "frog", hat: "propeller" },
  { name: "Pudding", animal: "otter", hat: "bucket" },
  { name: "Captain", animal: "penguin", hat: "bandana" },
];

const TICKS_PER_MS = CONFIG.TICK_RATE / 1000;

function ticksForMs(ms: number): number {
  return Math.ceil(ms * TICKS_PER_MS);
}

function memberFromProfile(profile: PlayerProfile, rating: number | null): Member {
  return {
    id: profile.id,
    playerId: profile.id,
    name: profile.displayName,
    animal: profile.selectedAnimal,
    hat: profile.selectedHat,
    level: profile.level,
    rating,
    isBot: false,
    difficulty: null,
    ready: false,
    connected: true,
    disconnectedAt: null,
    botReplaced: false,
    left: false,
    leaver: false,
    lastEmoteAt: 0,
  };
}

function emptySlotView(slot: number): LobbySlotView {
  return {
    slot,
    kind: "empty",
    playerId: null,
    name: "",
    animal: "frog",
    hat: "none",
    difficulty: null,
    ready: false,
    connected: false,
    host: false,
  };
}

function slotView(member: Member | null, slot: number, hostId: string | null): LobbySlotView {
  if (!member) return emptySlotView(slot);
  return {
    slot,
    kind: member.isBot ? "bot" : "human",
    playerId: member.playerId,
    name: member.name,
    animal: member.animal,
    hat: member.hat,
    difficulty: member.difficulty,
    ready: member.ready || member.isBot,
    connected: member.connected || member.isBot,
    host: hostId === member.id,
  };
}

function validDir(value: unknown): value is Dir {
  return value === "up" || value === "down" || value === "left" || value === "right" || value === "none";
}

function maxOf<T>(items: T[], value: (item: T) => number): T | null {
  let best: T | null = null;
  let bestValue = -Infinity;
  for (const item of items) {
    const candidate = value(item);
    if (candidate > bestValue) {
      best = item;
      bestValue = candidate;
    }
  }
  return best;
}

export class Room {
  readonly code: string;
  readonly size: 2 | 4;
  readonly mode: GameMode;
  readonly isPrivate: boolean;
  readonly ranked: boolean;
  readonly practice: boolean;
  name: string;
  theme: ArenaTheme;
  roundsToWin: number;
  slots: Array<Member | null>;
  hostId: string | null;
  status: "lobby" | "playing" | "match_end" = "lobby";
  lastActivity = Date.now();
  runtime: MatchRuntime | null = null;
  private botCounter = 0;
  private closed = false;
  private readonly transport: RoomTransport;
  private readonly db: SplashDb;
  private readonly onClosed: (code: string) => void;

  constructor(
    code: string,
    options: {
      name: string;
      size: 2 | 4;
      isPrivate: boolean;
      theme: ArenaTheme;
      roundsToWin: number;
      ranked?: boolean;
      practice?: boolean;
    },
    db: SplashDb,
    transport: RoomTransport,
    onClosed: (code: string) => void,
  ) {
    this.code = code;
    this.name = options.name;
    this.size = options.size;
    this.mode = options.size === 2 ? "duel" : "ffa";
    this.isPrivate = options.isPrivate;
    this.theme = options.theme;
    this.roundsToWin = options.roundsToWin;
    this.ranked = options.ranked ?? false;
    this.practice = options.practice ?? false;
    this.slots = Array.from({ length: this.size }, () => null);
    this.hostId = null;
    this.db = db;
    this.transport = transport;
    this.onClosed = onClosed;
  }

  get isFull(): boolean {
    return this.slots.every((slot) => slot !== null);
  }

  filledMembers(): Member[] {
    return this.slots.filter((slot): slot is Member => slot !== null);
  }

  humanMembers(includeLeft = false): Member[] {
    return this.filledMembers().filter(
      (member) => !member.isBot && (includeLeft || !member.left),
    );
  }

  connectedHumans(): Member[] {
    return this.humanMembers().filter((member) => member.connected);
  }

  hostName(): string {
    const host = this.hostId
      ? this.filledMembers().find((member) => member.id === this.hostId)
      : null;
    return host?.name ?? "";
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      size: this.size,
      players: this.filledMembers().length,
      theme: this.theme,
      host: this.hostName(),
      status: this.status === "lobby" ? "lobby" : "playing",
    };
  }

  lobbyView(playerId: string): LobbyView {
    const runtime = this.runtime;
    const voters = this.connectedHumans();
    const rematchNeeded = Math.max(1, Math.floor(voters.length / 2) + 1);
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      size: this.size,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      slots: this.slots.map((member, index) => slotView(member, index, this.hostId)),
      youAreHost: this.hostId === playerId,
      rematchVotes: runtime?.rematchVotes.size ?? 0,
      rematchNeeded,
      status: this.status === "lobby" ? "lobby" : this.status === "playing" ? "playing" : "match_end",
    };
  }

  send(playerId: string, message: ServerMessage): void {
    this.transport.send(playerId, message);
  }

  private sendToHumans(message: ServerMessage): void {
    for (const member of this.filledMembers()) {
      if (!member.isBot && member.playerId && member.connected) {
        this.transport.send(member.playerId, message);
      }
    }
  }

  broadcastLobby(): void {
    if (this.ranked) return;
    for (const member of this.humanMembers()) {
      if (member.playerId && member.connected) {
        this.transport.send(member.playerId, {
          t: "lobby_state",
          lobby: this.lobbyView(member.playerId),
        });
      }
    }
  }

  addHuman(profile: PlayerProfile): Member | null {
    if (this.status !== "lobby") return null;
    let slotIndex = this.slots.findIndex((slot) => slot === null);
    if (slotIndex < 0) {
      slotIndex = this.slots.findIndex((slot) => slot?.isBot);
    }
    if (slotIndex < 0) return null;
    const old = this.slots[slotIndex];
    if (old?.isBot) {
      this.slots[slotIndex] = null;
    }
    const ratings = this.ranked
      ? getSingleRating(this.db, profile.id, this.mode)
      : null;
    const member = memberFromProfile(profile, ratings?.rating ?? null);
    this.slots[slotIndex] = member;
    if (!this.hostId) this.hostId = member.id;
    this.lastActivity = Date.now();
    this.broadcastLobby();
    this.transport.roomListChanged();
    return member;
  }

  removeHuman(playerId: string): void {
    const index = this.slots.findIndex((slot) => slot?.playerId === playerId);
    if (index < 0) return;
    this.slots[index] = null;
    if (this.hostId === playerId) {
      const next = this.filledMembers().find((member) => !member.isBot);
      this.hostId = next?.id ?? null;
    }
    this.lastActivity = Date.now();
    if (this.humanMembers(true).length === 0) {
      this.close();
      return;
    }
    this.broadcastLobby();
    this.transport.roomListChanged();
  }

  fillBots(difficulty: Difficulty, fillAll = true): void {
    if (this.status !== "lobby") return;
    for (let index = 0; index < this.slots.length; index += 1) {
      if (this.slots[index]) continue;
      this.slots[index] = this.makeBot(index, difficulty);
      if (!fillAll) break;
    }
    this.broadcastLobby();
    this.transport.roomListChanged();
  }

  setBotSlot(slot: number, kind: "empty" | "bot", difficulty: Difficulty = "medium", byPlayer: string): string | null {
    if (this.hostId !== byPlayer) return "Only the host can edit slots.";
    if (this.status !== "lobby") return "The match has already started.";
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.size) return "Invalid slot.";
    const existing = this.slots[slot];
    if (existing && !existing.isBot) return "That slot is occupied by a player.";
    if (kind === "empty") {
      this.slots[slot] = null;
    } else if (kind === "bot") {
      const bot = this.makeBot(slot, difficulty, existing?.id);
      this.slots[slot] = bot;
    } else {
      return "Invalid slot type.";
    }
    this.lastActivity = Date.now();
    this.broadcastLobby();
    this.transport.roomListChanged();
    return null;
  }

  setReady(playerId: string, ready: boolean): void {
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member || this.status !== "lobby") return;
    member.ready = ready;
    this.lastActivity = Date.now();
    this.broadcastLobby();
  }

  canStart(playerId: string): string | null {
    if (this.hostId !== playerId) return "Only the host can start the match.";
    if (this.status !== "lobby") return "Match already in progress.";
    const members = this.filledMembers();
    if (members.length < 2) return "Fill at least two slots first.";
    const humans = members.filter((member) => !member.isBot);
    for (const human of humans) {
      if (!human.connected) return `${human.name} is disconnected.`;
      if (human.id !== this.hostId && !human.ready) return `${human.name} is not ready.`;
    }
    return null;
  }

  startMatch(playerId: string): string | null {
    const error = this.canStart(playerId);
    if (error) return error;
    this.startMatchInternal();
    return null;
  }

  startRanked(): void {
    this.startMatchInternal();
  }

  private startMatchInternal(): void {
    const previousCount = this.runtime?.matchCount ?? 0;
    const runtime: MatchRuntime = {
      startedAt: Date.now(),
      matchSeed: randomSeed(),
      matchCount: previousCount + 1,
      phase: "intro",
      phaseTicks: ticksForMs(CONFIG.MATCH_INTRO_MS),
      roundNo: 0,
      sim: null,
      arena: null,
      lastRoundStart: null,
      lastRoundEnd: null,
      bots: new Map(),
      inputs: new Map(),
      lastSeq: new Map(),
      acks: {},
      stats: new Map(),
      roundsWon: {},
      pendingMatchEnd: false,
      rematchVotes: new Set(),
      matchEndPayload: null,
      disconnectCounter: 0,
      roundSurvivalCounted: false,
    };
    for (const member of this.filledMembers()) {
      runtime.stats.set(member.id, {
        soaks: 0,
        castles: 0,
        biggestChain: 0,
        roundsWon: 0,
        survivedTicks: 0,
      });
      runtime.roundsWon[member.id] = 0;
      runtime.acks[member.id] = 0;
      member.leaver = false;
      member.ready = member.isBot;
      if (member.isBot || member.botReplaced) {
        this.ensureBotBrain(runtime, member);
      }
    }
    this.runtime = runtime;
    this.status = "playing";
    this.lastActivity = Date.now();
    const config = this.matchConfig();
    this.sendToHumans({ t: "match_start", config });
    this.transport.roomListChanged();
  }

  private makeBot(slot: number, difficulty: Difficulty, existingId?: string): Member {
    const template = BOT_NAMES[(slot + this.botCounter + hashString(this.code)) % BOT_NAMES.length] ?? BOT_NAMES[0]!;
    this.botCounter += 1;
    const tag = 1000 + ((hashString(`${this.code}:${slot}:${this.botCounter}`) % 9000) | 0);
    const id = existingId ?? `bot:${this.code}:${slot}:${this.botCounter}`;
    return {
      id,
      playerId: null,
      name: `${template.name}Bot#${tag}`,
      animal: template.animal,
      hat: template.hat,
      level: 1,
      rating: null,
      isBot: true,
      difficulty,
      ready: true,
      connected: true,
      disconnectedAt: null,
      botReplaced: false,
      left: false,
      leaver: false,
      lastEmoteAt: 0,
    };
  }

  private ensureBotBrain(runtime: MatchRuntime, member: Member): void {
    if (!member.difficulty) member.difficulty = "medium";
    if (!runtime.bots.has(member.id)) {
      runtime.bots.set(
        member.id,
        new BotBrain(
          member.id,
          member.difficulty,
          hashString(`${this.code}:${runtime.matchSeed}:${member.id}:${runtime.roundNo}`),
        ),
      );
    }
  }

  matchPlayerInfos(): MatchPlayerInfo[] {
    const infos: MatchPlayerInfo[] = [];
    for (const member of this.filledMembers()) {
      const rating = member.rating ?? undefined;
      infos.push({
        id: member.id,
        name: member.name,
        animal: member.animal,
        hat: member.hat,
        isBot: member.isBot,
        difficulty: member.difficulty,
        rating,
        tier: this.ranked && rating !== undefined ? tierForRating(rating) : undefined,
        level: member.level,
      });
    }
    return infos;
  }

  matchConfig(): MatchConfig {
    return {
      roomCode: this.code,
      mode: this.mode,
      ranked: this.ranked,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      players: this.matchPlayerInfos(),
      introMs: CONFIG.MATCH_INTRO_MS,
    };
  }

  tick(): void {
    this.lastActivity = Date.now();
    const runtime = this.runtime;
    if (!runtime || this.status === "lobby" || this.status === "match_end") return;
    runtime.disconnectCounter += 1;
    if (runtime.disconnectCounter >= CONFIG.TICK_RATE) {
      runtime.disconnectCounter = 0;
      this.checkDisconnects();
      if (runtime.phase === "done") return;
    }

    if (runtime.phase === "intro") {
      runtime.phaseTicks -= 1;
      if (runtime.phaseTicks <= 0) this.beginRound();
      return;
    }

    if (runtime.phase === "countdown") {
      runtime.phaseTicks -= 1;
      if (runtime.phaseTicks <= 0) {
        runtime.phase = "playing";
        runtime.inputs.clear();
        this.sendSnapshot(true);
      }
      return;
    }

    if (runtime.phase === "round_end") {
      runtime.phaseTicks -= 1;
      if (runtime.phaseTicks <= 0) {
        if (runtime.pendingMatchEnd) this.endMatch();
        else this.beginRound();
      }
      return;
    }

    if (runtime.phase !== "playing" || !runtime.sim) return;
    this.stepPlaying(runtime);
  }

  private buildBotInput(runtime: MatchRuntime, member: Member): PlayerInput | undefined {
    const brain = runtime.bots.get(member.id);
    if (!brain || !runtime.sim) return undefined;
    return brain.decide(runtime.sim);
  }

  private stepPlaying(runtime: MatchRuntime): void {
    const sim = runtime.sim;
    if (!sim) return;
    const inputs: Record<string, PlayerInput | undefined> = {};
    for (const member of this.filledMembers()) {
      if (member.isBot || member.botReplaced) {
        inputs[member.id] = this.buildBotInput(runtime, member);
      } else if (member.connected) {
        inputs[member.id] = runtime.inputs.get(member.id);
        if (inputs[member.id]) {
          runtime.acks[member.id] = inputs[member.id]?.seq ?? runtime.acks[member.id] ?? 0;
        }
      }
    }
    const events = simulateTick(sim, inputs);
    for (const event of events) {
      this.trackEvent(runtime, event);
      this.sendToHumans({ t: "event", ...event });
    }
    if (sim.tick % Math.max(1, Math.round(CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE)) === 0) {
      this.sendSnapshot(true);
    }
    if (sim.ended && runtime.phase === "playing") {
      this.finishRound(runtime);
    }
  }

  private trackEvent(runtime: MatchRuntime, event: ReturnType<typeof simulateTick>[number]): void {
    if (event.type === "castle_washed" && event.ownerId) {
      const stat = runtime.stats.get(event.ownerId);
      if (stat) stat.castles += 1;
    } else if (event.type === "chain_burst") {
      for (const owner of event.ownerIds) {
        const stat = runtime.stats.get(owner);
        if (stat) stat.biggestChain = Math.max(stat.biggestChain, event.count);
      }
    } else if (event.type === "player_soaked" && event.byId && event.byId !== event.playerId) {
      const stat = runtime.stats.get(event.byId);
      if (stat) stat.soaks += 1;
    }
  }

  private countRoundSurvival(runtime: MatchRuntime): void {
    if (runtime.roundSurvivalCounted || !runtime.sim) return;
    runtime.roundSurvivalCounted = true;
    for (const member of this.filledMembers()) {
      const stat = runtime.stats.get(member.id);
      const player = runtime.sim.players.find((entry) => entry.id === member.id);
      if (!stat || !player) continue;
      const survived = player.alive ? runtime.sim.tick : player.eliminatedTick ?? runtime.sim.tick;
      stat.survivedTicks += survived;
    }
  }

  private finishRound(runtime: MatchRuntime): void {
    const sim = runtime.sim;
    if (!sim) return;
    this.countRoundSurvival(runtime);
    if (sim.winnerId) {
      runtime.roundsWon[sim.winnerId] = (runtime.roundsWon[sim.winnerId] ?? 0) + 1;
      const stat = runtime.stats.get(sim.winnerId);
      if (stat) stat.roundsWon += 1;
    }
    const winnerMember = this.filledMembers().find((member) => member.id === sim.winnerId);
    runtime.pendingMatchEnd = Object.values(runtime.roundsWon).some(
      (wins) => wins >= this.roundsToWin,
    );
    const scores: Record<string, number> = {};
    for (const member of this.filledMembers()) {
      scores[member.id] = runtime.roundsWon[member.id] ?? 0;
    }
    const payload: RoundEndPayload = {
      roundNo: runtime.roundNo,
      draw: sim.draw,
      winnerId: sim.winnerId,
      winnerName: winnerMember?.name ?? null,
      scores,
      nextRoundInMs: CONFIG.ROUND_END_MS,
    };
    runtime.lastRoundEnd = payload;
    runtime.phase = "round_end";
    runtime.phaseTicks = ticksForMs(CONFIG.ROUND_END_MS);
    this.sendSnapshot(true);
    this.sendToHumans({ t: "round_end", data: payload });
  }

  private beginRound(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    runtime.roundNo += 1;
    const seed = roundSeed(runtime.matchSeed, runtime.roundNo);
    const arena = generateArena(this.mode, seed, this.theme);
    runtime.arena = arena;
    const participants = this.filledMembers().map((member, index) => ({
      id: member.id,
      slot: index,
      name: member.name,
      animal: member.animal,
      hat: member.hat,
      isBot: member.isBot || member.botReplaced,
      difficulty: member.difficulty,
    }));
    runtime.sim = createRoundState(this.mode, arena, participants, {
      roundNo: runtime.roundNo,
      enableKick: CONFIG.ENABLE_KICK,
      enableRevengeDucks: this.ranked
        ? CONFIG.REVENGE_DUCKS_RANKED && CONFIG.ENABLE_REVENGE_DUCKS
        : CONFIG.ENABLE_REVENGE_DUCKS,
    });
    runtime.roundSurvivalCounted = false;
    runtime.inputs.clear();
    runtime.acks = {};
    for (const member of this.filledMembers()) {
      runtime.acks[member.id] = 0;
      runtime.lastSeq.delete(member.id);
      if (member.isBot || member.botReplaced) {
        runtime.bots.set(
          member.id,
          new BotBrain(
            member.id,
            member.difficulty ?? "medium",
            hashString(`${this.code}:${runtime.matchSeed}:${runtime.roundNo}:${member.id}`),
          ),
        );
      }
    }
    const data: ArenaRoundStart = {
      roundNo: runtime.roundNo,
      mapSeed: seed,
      castleGrid: arena.castles.map((row) => [...row]),
      boulderGrid: arena.boulders.map((row) => [...row]),
      w: arena.w,
      h: arena.h,
      theme: arena.theme,
      spawnTiles: arena.spawnTiles.map((spawn) => ({ ...spawn })),
      countdownMs: CONFIG.ROUND_COUNTDOWN_MS,
    };
    runtime.lastRoundStart = data;
    runtime.lastRoundEnd = null;
    runtime.phase = "countdown";
    runtime.phaseTicks = ticksForMs(CONFIG.ROUND_COUNTDOWN_MS);
    this.sendToHumans({ t: "round_start", data });
    this.transport.roomListChanged();
  }

  private sendSnapshot(force = false): void {
    const runtime = this.runtime;
    if (!runtime?.sim) return;
    if (!force && runtime.phase !== "playing") return;
    const snap = snapshotRound(runtime.sim, runtime.acks);
    this.sendToHumans({
      t: "snapshot",
      tick: snap.tick,
      players: snap.players,
      balloons: snap.balloons,
      splashes: snap.splashes,
      powerups: snap.powerups,
      tide: snap.tide,
      ended: snap.ended,
      winnerId: snap.winnerId,
      draw: snap.draw,
      acks: snap.acks,
    });
  }

  handleInput(
    playerId: string,
    input: { seq: number; tick: number; dir: Dir; balloonPressed: boolean },
  ): void {
    const runtime = this.runtime;
    if (!runtime?.sim || runtime.phase !== "playing") return;
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member || !member.connected || member.botReplaced) return;
    if (!validDir(input.dir)) return;
    const last = runtime.lastSeq.get(member.id) ?? 0;
    if (!Number.isFinite(input.seq) || input.seq <= last) return;
    runtime.lastSeq.set(member.id, input.seq);
    runtime.inputs.set(member.id, {
      seq: input.seq,
      tick: input.tick,
      dir: input.dir,
      balloonPressed: Boolean(input.balloonPressed),
    });
  }

  handleEmote(playerId: string, id: number): void {
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member || !member.connected) return;
    if (this.status !== "playing") return;
    if (id < 1 || id > 4) return;
    const now = Date.now();
    if (now - member.lastEmoteAt < 1500) return;
    member.lastEmoteAt = now;
    this.sendToHumans({ t: "emote", playerId: member.id, id });
  }

  markDisconnected(playerId: string): void {
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member) return;
    member.connected = false;
    member.disconnectedAt = Date.now();
    if (this.status === "playing" || this.status === "match_end") {
      this.sendToHumans({
        t: "notice",
        msg: `${member.name} disconnected. ${Math.round(CONFIG.RECONNECT_GRACE_MS / 1000)}s reconnect grace.`,
      });
    }
    this.lastActivity = Date.now();
  }

  resumePlayer(playerId: string): boolean {
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member || this.closed) return false;
    member.connected = true;
    member.disconnectedAt = null;
    if (member.botReplaced) {
      member.botReplaced = false;
      this.runtime?.bots.delete(member.id);
      const player = this.runtime?.sim?.players.find((entry) => entry.id === member.id);
      if (player) {
        player.isBot = false;
        player.difficulty = null;
      }
      this.sendToHumans({ t: "notice", msg: `${member.name} reconnected.` });
    }
    if (this.status === "lobby") {
      this.broadcastLobby();
      this.send(playerId, { t: "lobby_state", lobby: this.lobbyView(playerId) });
      return true;
    }
    if (this.status === "match_end") {
      if (this.runtime?.matchEndPayload) {
        this.send(playerId, { t: "match_end", data: this.runtime.matchEndPayload });
      }
      return true;
    }
    const runtime = this.runtime;
    if (!runtime) return true;
    this.send(playerId, { t: "match_start", config: this.matchConfig() });
    if (runtime.lastRoundStart) {
      const countdownMs =
        runtime.phase === "countdown" ? Math.max(0, Math.ceil(runtime.phaseTicks / TICKS_PER_MS)) : 0;
      this.send(playerId, {
        t: "round_start",
        data: { ...runtime.lastRoundStart, countdownMs },
      });
    }
    this.send(playerId, { t: "snapshot", ...snapshotRound(runtime.sim!, runtime.acks) });
    if (runtime.phase === "round_end" && runtime.lastRoundEnd) {
      this.send(playerId, { t: "round_end", data: runtime.lastRoundEnd });
    }
    return true;
  }

  private checkDisconnects(): void {
    const runtime = this.runtime;
    if (!runtime || runtime.phase === "done") return;
    if (this.status !== "playing") return;
    const now = Date.now();
    for (const member of this.humanMembers()) {
      if (member.connected || member.botReplaced || member.left) continue;
      if (!member.disconnectedAt) continue;
      if (now - member.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;
      if (this.ranked) {
        member.leaver = true;
        this.sendToHumans({ t: "notice", msg: `${member.name} forfeited the ranked match.` });
        this.endMatch();
        return;
      }
      member.botReplaced = true;
      member.disconnectedAt = null;
      this.ensureBotBrain(runtime, member);
      const player = runtime.sim?.players.find((entry) => entry.id === member.id);
      if (player) {
        player.isBot = true;
        player.difficulty = "medium";
      }
      member.difficulty = "medium";
      this.sendToHumans({ t: "notice", msg: `${member.name} was replaced by a Medium bot.` });
    }
  }

  playerLeave(playerId: string): void {
    const member = this.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member) return;
    if (this.status === "lobby" || this.status === "match_end") {
      this.removeHuman(playerId);
      return;
    }
    if (this.ranked) {
      member.leaver = true;
      member.connected = false;
      member.left = true;
      this.sendToHumans({ t: "notice", msg: `${member.name} left the match.` });
      this.endMatch();
      return;
    }
    member.left = true;
    member.connected = false;
    member.disconnectedAt = null;
    member.botReplaced = true;
    if (this.runtime) this.ensureBotBrain(this.runtime, member);
    const player = this.runtime?.sim?.players.find((entry) => entry.id === member.id);
    if (player) {
      player.isBot = true;
      player.difficulty = "medium";
    }
    this.sendToHumans({ t: "notice", msg: `${member.name} left. A bot is taking over.` });
    if (this.connectedHumans().length === 0) this.close();
  }

  voteRematch(playerId: string): void {
    const runtime = this.runtime;
    if (!runtime || this.ranked || this.status !== "match_end") return;
    const member = this.humanMembers().find((entry) => entry.playerId === playerId);
    if (!member || !member.connected) return;
    runtime.rematchVotes.add(member.id);
    const needed = Math.max(1, Math.floor(this.connectedHumans().length / 2) + 1);
    this.sendToHumans({ t: "rematch_status", votes: runtime.rematchVotes.size, needed });
    if (runtime.rematchVotes.size >= needed) {
      runtime.rematchVotes.clear();
      this.startMatchInternal();
    }
  }

  private addXpForMember(member: Member, placement: number): number {
    if (member.isBot || !member.playerId) return 0;
    const runtime = this.runtime;
    const stat = runtime?.stats.get(member.id);
    if (!stat) return 0;
    const placementBonus =
      CONFIG.XP.placement[Math.min(placement - 1, CONFIG.XP.placement.length - 1)] ??
      CONFIG.XP.placement[CONFIG.XP.placement.length - 1] ??
      5;
    return (
      CONFIG.XP.participation +
      placementBonus +
      stat.soaks * CONFIG.XP.soak +
      stat.castles * CONFIG.XP.castle +
      stat.roundsWon * CONFIG.XP.roundWin
    );
  }

  private computePlacements(): Map<string, number> {
    const members = this.filledMembers();
    const runtime = this.runtime;
    const placements = new Map<string, number>();
    if (!runtime) return placements;
    const leavers = members.filter((member) => member.leaver);
    const regular = members.filter((member) => !member.leaver);
    const sorted = [...regular].sort((a, b) => {
      const aWins = runtime.roundsWon[a.id] ?? 0;
      const bWins = runtime.roundsWon[b.id] ?? 0;
      if (aWins !== bWins) return bWins - aWins;
      const aSoaks = runtime.stats.get(a.id)?.soaks ?? 0;
      const bSoaks = runtime.stats.get(b.id)?.soaks ?? 0;
      if (aSoaks !== bSoaks) return bSoaks - aSoaks;
      return a.id.localeCompare(b.id);
    });
    let lastPlace = 1;
    let previousWins = -1;
    let previousSoaks = -1;
    sorted.forEach((member, index) => {
      const wins = runtime.roundsWon[member.id] ?? 0;
      const soaks = runtime.stats.get(member.id)?.soaks ?? 0;
      if (index === 0 || wins !== previousWins || soaks !== previousSoaks) {
        lastPlace = index + 1;
      }
      placements.set(member.id, lastPlace);
      previousWins = wins;
      previousSoaks = soaks;
    });
    const last = Math.max(1, members.length);
    for (const member of leavers) placements.set(member.id, last);
    return placements;
  }

  private endMatch(): void {
    const runtime = this.runtime;
    if (!runtime || runtime.phase === "done" || this.status === "match_end") return;
    runtime.phase = "done";
    this.countRoundSurvival(runtime);
    const members = this.filledMembers();
    const placements = this.computePlacements();
    const ratingsBefore = new Map<string, number>();
    const ratingAfter = new Map<string, number>();
    const eloPlayers = [];
    if (this.ranked) {
      for (const member of members) {
        if (member.isBot || !member.playerId) continue;
        const rating = getSingleRating(this.db, member.playerId, this.mode);
        ratingsBefore.set(member.id, rating.rating);
        eloPlayers.push({
          id: member.id,
          rating: rating.rating,
          games: rating.games,
          placement: placements.get(member.id) ?? members.length,
        });
      }
      const placementMap: Record<string, number> = {};
      for (const member of members) placementMap[member.id] = placements.get(member.id) ?? members.length;
      let deltas: Record<string, number> = {};
      if (this.mode === "duel" && eloPlayers.length === 2) {
        const [a, b] = eloPlayers;
        if (a && b) {
          const aScore = (placements.get(a.id) ?? 2) < (placements.get(b.id) ?? 2) ? 1 : 0;
          const aDelta = duelDelta(
            { id: a.id, rating: a.rating, games: a.games },
            { id: b.id, rating: b.rating, games: b.games },
            aScore === 1 ? 1 : 0,
          );
          const bDelta = duelDelta(
            { id: b.id, rating: b.rating, games: b.games },
            { id: a.id, rating: a.rating, games: a.games },
            aScore === 1 ? 0 : 1,
          );
          deltas = { [a.id]: aDelta, [b.id]: bDelta };
        }
      } else {
        deltas = ffaDeltas(
          eloPlayers.map((entry) => ({ id: entry.id, rating: entry.rating, games: entry.games })),
          placementMap,
        );
      }
      for (const entry of eloPlayers) {
        ratingAfter.set(entry.id, Math.max(0, entry.rating + (deltas[entry.id] ?? 0)));
      }
    }

    const profiles = new Map<string, PlayerProfile>();
    for (const member of members) {
      if (!member.playerId) continue;
      const profile = getProfile(this.db, member.playerId);
      profiles.set(member.id, profile);
    }

    const xpTotals: Record<string, { earned: number; total: number; level: number; levelBefore: number }> = {};
    const matchRows: CompletedMatchPlayer[] = [];
    const placementRows: MatchPlacement[] = [];
    for (const member of members) {
      const stat = runtime.stats.get(member.id) ?? {
        soaks: 0,
        castles: 0,
        biggestChain: 0,
        roundsWon: 0,
        survivedTicks: 0,
      };
      const placement = placements.get(member.id) ?? members.length;
      const profile = profiles.get(member.id);
      const xpEarned = this.addXpForMember(member, placement);
      let totalXp = profile?.xp ?? 0;
      let level = profile?.level ?? member.level;
      const levelBefore = level;
      if (profile) {
        totalXp = profile.xp + xpEarned;
        level = levelFromXp(totalXp);
        xpTotals[member.id] = { earned: xpEarned, total: totalXp, level, levelBefore };
      }
      const ratingBefore = this.ranked ? ratingsBefore.get(member.id) ?? null : null;
      const ratingAfterValue = this.ranked ? ratingAfter.get(member.id) ?? null : null;
      placementRows.push({
        playerId: member.id,
        name: member.name,
        animal: member.animal,
        hat: member.hat,
        placement,
        roundsWon: runtime.roundsWon[member.id] ?? 0,
        soaks: stat.soaks,
        castles: stat.castles,
        biggestChain: stat.biggestChain,
        survivedTicks: stat.survivedTicks,
        ratingBefore,
        ratingAfter: ratingAfterValue,
        xpEarned,
        level: profile ? level : null,
      });
      if (member.playerId && !member.isBot) {
        matchRows.push({
          playerId: member.playerId,
          placement,
          soaks: stat.soaks,
          roundsWon: runtime.roundsWon[member.id] ?? 0,
          ratingBefore,
          ratingAfter: ratingAfterValue,
          xpEarned,
          castles: stat.castles,
          biggestChain: stat.biggestChain,
          survivedTicks: stat.survivedTicks,
        });
      }
    }

    try {
      recordCompletedMatch(this.db, {
        mode: this.mode,
        ranked: this.ranked,
        startedAt: runtime.startedAt,
        endedAt: Date.now(),
        roomCode: this.code,
        players: matchRows,
      });
    } catch (error) {
      console.error("Failed to record match", error);
    }

    placementRows.sort((a, b) => a.placement - b.placement || a.playerId.localeCompare(b.playerId));
    const awards: MatchAwards = {
      mostSoaks: maxOf(placementRows, (entry) => entry.soaks)?.playerId ?? null,
      castleCrusher: maxOf(placementRows, (entry) => entry.castles)?.playerId ?? null,
      longestSurvivor: maxOf(placementRows, (entry) => entry.survivedTicks)?.playerId ?? null,
      biggestChain: maxOf(placementRows, (entry) => entry.biggestChain)?.playerId ?? null,
    };
    if ((maxOf(placementRows, (entry) => entry.soaks)?.soaks ?? 0) === 0) awards.mostSoaks = null;
    if ((maxOf(placementRows, (entry) => entry.castles)?.castles ?? 0) === 0) awards.castleCrusher = null;
    if ((maxOf(placementRows, (entry) => entry.biggestChain)?.biggestChain ?? 0) === 0) awards.biggestChain = null;

    const ratingDeltas: Record<string, number> = {};
    for (const member of members) {
      if (!this.ranked) continue;
      const before = ratingsBefore.get(member.id);
      const after = ratingAfter.get(member.id);
      if (before === undefined || after === undefined) continue;
      ratingDeltas[member.id] = after - before;
    }

    const payload: MatchEndPayload = {
      roomCode: this.code,
      mode: this.mode,
      ranked: this.ranked,
      placements: placementRows,
      ratingDeltas,
      xp: xpTotals,
      awards,
      rematchAllowed: !this.ranked,
    };
    runtime.matchEndPayload = payload;
    runtime.rematchVotes.clear();
    this.status = "match_end";
    this.sendToHumans({ t: "match_end", data: payload });
    for (const member of this.filledMembers()) {
      if (member.playerId && !member.isBot) {
        const profile = getProfile(this.db, member.playerId);
        this.transport.send(member.playerId, { t: "profile_update", profile });
        this.transport.profileChanged(member.playerId);
      }
    }
    this.transport.roomListChanged();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed(this.code);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export interface RoomManagerResult {
  ok: boolean;
  error?: string;
  room?: Room;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRooms = new Map<string, string>();
  private lastGc = 0;

  constructor(
    private readonly db: SplashDb,
    private readonly transport: RoomTransport,
  ) {}

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let i = 0; i < 6; i += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  private resolveTheme(theme: ArenaTheme | "random"): ArenaTheme {
    if (theme !== "random") return theme;
    const themes: ArenaTheme[] = ["backyard", "beach", "pool"];
    return themes[Math.floor(Math.random() * themes.length)] ?? "beach";
  }

  findRoomForPlayer(playerId: string): Room | null {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  createRoom(playerId: string, options: CreateRoomOptionsInternal): RoomManagerResult {
    if (this.playerRooms.has(playerId)) return { ok: false, error: "Leave your current room first." };
    if (options.size !== 2 && options.size !== 4) return { ok: false, error: "Invalid room size." };
    if (!CONFIG.ROUNDS_OPTIONS.includes(options.roundsToWin)) {
      return { ok: false, error: "Rounds must be 2, 3 or 5." };
    }
    const profile = getProfile(this.db, playerId);
    const code = this.generateCode();
    const room = new Room(
      code,
      {
        name: options.name.trim().slice(0, 28) || `${options.practice ? "Practice" : "Splash"} ${options.size}P`,
        size: options.size,
        isPrivate: options.practice ? true : options.isPrivate,
        theme: this.resolveTheme(options.theme),
        roundsToWin: options.roundsToWin,
        practice: Boolean(options.practice),
      },
      this.db,
      this.transport,
      (closedCode) => this.closeRoom(closedCode),
    );
    this.rooms.set(code, room);
    const member = room.addHuman(profile);
    if (!member) {
      this.rooms.delete(code);
      return { ok: false, error: "Could not seat the host." };
    }
    this.playerRooms.set(playerId, code);
    this.transport.send(playerId, { t: "room_created", code });
    if (options.practice) {
      room.fillBots("medium", true);
      room.broadcastLobby();
      room.startRanked();
    } else if (options.botFill) {
      room.fillBots("medium", true);
    }
    this.transport.roomListChanged();
    return { ok: true, room };
  }

  joinRoom(playerId: string, code: string): RoomManagerResult {
    if (this.playerRooms.has(playerId)) return { ok: false, error: "Leave your current room first." };
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room || room.ranked) return { ok: false, error: "Room not found." };
    if (room.status !== "lobby") return { ok: false, error: "That match has already started." };
    if (room.isFull) return { ok: false, error: "That room is full." };
    if (!this.transport.isOnline(playerId)) return { ok: false, error: "You are offline." };
    const profile = getProfile(this.db, playerId);
    const member = room.addHuman(profile);
    if (!member) return { ok: false, error: "That room is full." };
    this.playerRooms.set(playerId, room.code);
    this.transport.send(playerId, {
      t: "lobby_state",
      lobby: room.lobbyView(playerId),
    });
    this.transport.roomListChanged();
    return { ok: true, room };
  }

  createRanked(mode: GameMode, playerIds: string[]): boolean {
    const size = mode === "duel" ? 2 : 4;
    if (playerIds.length !== size) return false;
    for (const id of playerIds) {
      if (this.playerRooms.has(id) || !this.transport.isOnline(id)) return false;
    }
    const profiles: PlayerProfile[] = [];
    for (const id of playerIds) {
      try {
        profiles.push(getProfile(this.db, id));
      } catch {
        return false;
      }
    }
    const code = this.generateCode();
    const room = new Room(
      code,
      {
        name: mode === "duel" ? "Ranked Duel" : "Ranked Free-for-All",
        size,
        isPrivate: true,
        theme: this.resolveTheme("random"),
        roundsToWin: CONFIG.ROUNDS_TO_WIN,
        ranked: true,
      },
      this.db,
      this.transport,
      (closedCode) => this.closeRoom(closedCode),
    );
    this.rooms.set(code, room);
    for (const profile of profiles) {
      room.addHuman(profile);
      this.playerRooms.set(profile.id, code);
    }
    const players = room.matchPlayerInfos();
    for (const playerId of playerIds) {
      this.transport.send(playerId, {
        t: "match_found",
        mode,
        ranked: true,
        players,
        roomCode: code,
      });
    }
    room.startRanked();
    this.transport.roomListChanged();
    return true;
  }

  leaveRoom(playerId: string, explicit = true): void {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return;
    if (!explicit) {
      this.transport.send(playerId, { t: "notice", msg: "You left the room." });
    }
    if (room.status === "lobby" || room.status === "match_end") {
      const remaining = room.humanMembers(true).length;
      room.removeHuman(playerId);
      this.playerRooms.delete(playerId);
      if (remaining <= 1 || room.isClosed) {
        this.closeRoom(room.code);
      }
      this.transport.roomListChanged();
      return;
    }
    room.playerLeave(playerId);
    this.playerRooms.delete(playerId);
    if (room.isClosed) this.closeRoom(room.code);
  }

  disconnect(playerId: string): void {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return;
    if (room.status === "lobby") {
      room.removeHuman(playerId);
      this.playerRooms.delete(playerId);
      if (room.isClosed) this.closeRoom(room.code);
      return;
    }
    room.markDisconnected(playerId);
  }

  resume(playerId: string): boolean {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return false;
    return room.resumePlayer(playerId);
  }

  setSlot(playerId: string, slot: number, kind: "empty" | "bot", difficulty: Difficulty): RoomManagerResult {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return { ok: false, error: "You are not in a room." };
    const error = room.setBotSlot(slot, kind, difficulty, playerId);
    return error ? { ok: false, error } : { ok: true, room };
  }

  setReady(playerId: string, ready: boolean): RoomManagerResult {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return { ok: false, error: "You are not in a room." };
    room.setReady(playerId, ready);
    return { ok: true, room };
  }

  startMatch(playerId: string): RoomManagerResult {
    const room = this.findRoomForPlayer(playerId);
    if (!room) return { ok: false, error: "You are not in a room." };
    const error = room.startMatch(playerId);
    return error ? { ok: false, error } : { ok: true, room };
  }

  handleInput(playerId: string, input: { seq: number; tick: number; dir: Dir; balloonPressed: boolean }): void {
    this.findRoomForPlayer(playerId)?.handleInput(playerId, input);
  }

  handleEmote(playerId: string, id: number): void {
    this.findRoomForPlayer(playerId)?.handleEmote(playerId, id);
  }

  voteRematch(playerId: string): void {
    this.findRoomForPlayer(playerId)?.voteRematch(playerId);
  }

  publicRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => !room.ranked && !room.isPrivate && room.status === "lobby")
      .map((room) => room.summary())
      .sort((a, b) => b.players - a.players || a.name.localeCompare(b.name));
  }

  tick(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.tick();
    }
    if (now - this.lastGc > 30000) {
      this.lastGc = now;
      for (const room of [...this.rooms.values()]) {
        if (room.isClosed) continue;
        if (now - room.lastActivity > CONFIG.ROOM_TTL_MS) {
          this.closeRoom(room.code);
        } else if (room.status !== "playing" && room.humanMembers(true).length === 0) {
          this.closeRoom(room.code);
        }
      }
    }
  }

  closeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const member of room.filledMembers()) {
      if (member.playerId) {
        if (this.playerRooms.get(member.playerId) === code) this.playerRooms.delete(member.playerId);
      }
    }
    this.rooms.delete(code);
    this.transport.roomListChanged();
  }

  updateCosmetics(playerId: string, animal: AnimalId, hat: HatId): void {
    const room = this.findRoomForPlayer(playerId);
    if (!room || room.status !== "lobby") return;
    const member = room.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member) return;
    member.animal = animal;
    member.hat = hat;
    room.broadcastLobby();
  }

  updateNickname(playerId: string, name: string): void {
    const room = this.findRoomForPlayer(playerId);
    if (!room || room.status !== "lobby") return;
    const member = room.filledMembers().find((entry) => entry.playerId === playerId);
    if (!member) return;
    member.name = name;
    room.broadcastLobby();
  }

  allRooms(): Room[] {
    return [...this.rooms.values()];
  }
}
