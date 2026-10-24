import { randomInt, randomUUID } from "node:crypto";
import { CONFIG, randomSeed } from "@splash/shared";
import type {
  Animal,
  BotDifficulty,
  ClientMessage,
  FunStats,
  GameMode,
  LobbySlot,
  MatchConfig,
  MatchPlacement,
  PlayerProfile,
  RatingInfo,
  RoomListItem,
  RoomOptions,
  ServerMessage,
  Theme
} from "@splash/shared";
import { sendError, sendMessage, type ClientConnection } from "./net.js";
import { GameLoop, type RuntimePlayer } from "./gameLoop.js";
import { rankPlacements, ratingChanges, xpForMatch } from "./elo.js";
import type { MatchPlayerRecord, SplashDatabase } from "./db/index.js";

interface HumanSlot {
  kind: "human";
  playerId: string;
  accountId: string;
  profile: PlayerProfile;
  connection: ClientConnection | null;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number;
  rematchVote: boolean;
}

interface BotSlot {
  kind: "bot";
  playerId: string;
  accountId: string | null;
  nickname: string;
  animal: Animal;
  hat: "none";
  difficulty: BotDifficulty;
}

type RoomSlot = HumanSlot | BotSlot | null;
type MatchEndMessage = Extract<ServerMessage, { type: "match_end" }>;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_ANIMALS: Animal[] = ["otter", "penguin", "cat", "raccoon", "turtle", "capybara"];

function themeFrom(choice: RoomOptions["theme"]): Theme {
  if (choice !== "random") return choice;
  const themes: Theme[] = ["backyard", "beach", "pool"];
  return themes[randomInt(themes.length)];
}

function displayName(profile: PlayerProfile): string {
  return `${profile.nickname}#${profile.tag}`;
}

export class Room {
  readonly code: string;
  readonly name: string;
  readonly mode: GameMode;
  readonly maxPlayers: number;
  readonly theme: Theme;
  readonly roundsToWin: number;
  readonly botFill: boolean;
  readonly ranked: boolean;
  readonly listed: boolean;
  readonly tutorial: boolean;
  readonly practice: boolean;
  readonly slots: RoomSlot[];
  hostId = "";
  inMatch = false;
  lastActive = Date.now();
  gameLoop: GameLoop | null = null;
  lastResults: MatchEndMessage | null = null;
  private ratingsAtStart = new Map<string, RatingInfo>();

  constructor(
    readonly manager: RoomManager,
    options: { code: string; name: string; maxPlayers: number; theme: Theme; roundsToWin: number; botFill: boolean; ranked: boolean; listed: boolean; tutorial?: boolean; practice?: boolean }
  ) {
    this.code = options.code;
    this.name = options.name;
    this.maxPlayers = options.maxPlayers;
    this.mode = options.maxPlayers === 2 ? "duel" : "ffa";
    this.theme = options.theme;
    this.roundsToWin = options.roundsToWin;
    this.botFill = options.botFill;
    this.ranked = options.ranked;
    this.listed = options.listed;
    this.tutorial = options.tutorial ?? false;
    this.practice = options.practice ?? false;
    this.slots = new Array<RoomSlot>(this.maxPlayers).fill(null);
  }

  get humanCount(): number {
    return this.slots.filter((slot) => slot?.kind === "human").length;
  }

  get connectedHumanCount(): number {
    return this.slots.filter((slot) => slot?.kind === "human" && slot.connected).length;
  }

  get occupiedCount(): number {
    return this.slots.filter(Boolean).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  broadcast(message: ServerMessage): void {
    for (const slot of this.slots) {
      if (slot?.kind === "human" && slot.connection) sendMessage(slot.connection, message);
    }
  }

  lobbyMessage(connection: ClientConnection): Extract<ServerMessage, { type: "lobby_state" }> {
    const slots: LobbySlot[] = this.slots.map((slot, index) => {
      if (!slot) return { slot: index, kind: "open", playerId: null, nickname: "", animal: "frog", hat: "none", difficulty: null, ready: false, connected: true };
      if (slot.kind === "bot") return { slot: index, kind: "bot", playerId: slot.playerId, nickname: slot.nickname, animal: slot.animal, hat: slot.hat, difficulty: slot.difficulty, ready: true, connected: true };
      return { slot: index, kind: "human", playerId: slot.playerId, nickname: displayName(slot.profile), animal: slot.profile.selectedAnimal, hat: slot.profile.selectedHat, difficulty: null, ready: slot.ready, connected: slot.connected };
    });
    const humans = Math.max(1, this.connectedHumanCount);
    return {
      type: "lobby_state",
      code: this.code,
      you: connection.id,
      name: this.name,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      theme: this.theme,
      hostId: this.hostId,
      public: this.listed,
      roundsToWin: this.roundsToWin,
      botFill: this.botFill,
      inMatch: this.inMatch,
      slots,
      rematchVotes: this.slots.filter((slot) => slot?.kind === "human" && slot.rematchVote).length,
      rematchNeeded: Math.floor(humans / 2) + 1
    };
  }

  broadcastLobby(): void {
    for (const slot of this.slots) {
      if (slot?.kind === "human" && slot.connection) sendMessage(slot.connection, this.lobbyMessage(slot.connection));
    }
    this.manager.broadcastRoomList();
  }

  listItem(): RoomListItem {
    const host = this.slots.find((slot) => slot?.kind === "human" && slot.playerId === this.hostId);
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      players: this.occupiedCount,
      maxPlayers: this.maxPlayers,
      theme: this.theme,
      host: host?.kind === "human" ? displayName(host.profile) : "",
      inMatch: this.inMatch
    };
  }

  canJoin(): boolean {
    return !this.inMatch && this.slots.some((slot) => slot === null);
  }

  addHuman(connection: ClientConnection, reclaim = false): boolean {
    if (!connection.profile || !connection.accountId) return false;
    if (!reclaim) {
      const index = this.slots.findIndex((slot) => slot === null);
      if (index < 0 || this.inMatch) return false;
      const participant: HumanSlot = {
        kind: "human",
        playerId: connection.id,
        accountId: connection.accountId,
        profile: connection.profile,
        connection,
        ready: false,
        connected: true,
        disconnectedAt: 0,
        rematchVote: false
      };
      this.slots[index] = participant;
      if (!this.hostId) this.hostId = participant.playerId;
    }
    connection.roomCode = this.code;
    this.touch();
    this.broadcastLobby();
    if (this.inMatch) this.gameLoop?.resync(connection);
    else if (this.lastResults) sendMessage(connection, this.lastResults);
    return true;
  }

  reclaim(connection: ClientConnection): boolean {
    if (!connection.accountId || !connection.profile) return false;
    const participant = this.slots.find((slot): slot is HumanSlot => slot?.kind === "human" && slot.accountId === connection.accountId && !slot.connected);
    if (!participant) return false;
    connection.id = participant.playerId;
    connection.roomCode = this.code;
    participant.connection = connection;
    participant.profile = connection.profile;
    participant.connected = true;
    participant.disconnectedAt = 0;
    this.gameLoop?.setConnection(participant.playerId, connection);
    this.touch();
    this.broadcastLobby();
    if (this.inMatch) this.gameLoop?.resync(connection);
    else if (this.lastResults) sendMessage(connection, this.lastResults);
    return true;
  }

  disconnect(connection: ClientConnection): void {
    const participant = this.slots.find((slot): slot is HumanSlot => slot?.kind === "human" && slot.playerId === connection.id);
    if (!participant) return;
    participant.connection = null;
    participant.connected = false;
    participant.disconnectedAt = Date.now();
    this.touch();
    this.broadcastLobby();
  }

  leave(connection: ClientConnection, voluntary = true): void {
    const index = this.slots.findIndex((slot) => slot?.kind === "human" && slot.playerId === connection.id);
    if (index < 0) {
      connection.roomCode = null;
      return;
    }
    const participant = this.slots[index] as HumanSlot;
    if (this.inMatch && this.gameLoop) {
      if (this.ranked) this.gameLoop.forfeit(participant.playerId);
      else this.convertToBot(index, "medium");
    } else {
      this.slots[index] = null;
    }
    connection.roomCode = null;
    if (this.hostId === participant.playerId) {
      this.hostId = this.slots.find((slot) => slot?.kind === "human")?.playerId ?? "";
    }
    this.touch();
    this.broadcastLobby();
    if (voluntary && this.humanCount === 0 && !this.ranked) this.gameLoop?.stop();
  }

  setSlot(connection: ClientConnection, slotIndex: number, kind: "open" | "bot", difficulty: BotDifficulty = "medium"): void {
    if (this.hostId !== connection.id || this.inMatch || slotIndex < 0 || slotIndex >= this.maxPlayers) return sendError(connection, "NOT_ALLOWED", "Only the host can change open slots");
    const existing = this.slots[slotIndex];
    if (existing?.kind === "human") return sendError(connection, "SLOT_OCCUPIED", "That slot has a player");
    this.slots[slotIndex] = kind === "open" ? null : {
      kind: "bot",
      playerId: randomUUID(),
      accountId: null,
      nickname: `SplashBot ${slotIndex + 1}`,
      animal: BOT_ANIMALS[slotIndex % BOT_ANIMALS.length],
      hat: "none",
      difficulty
    };
    this.touch();
    this.broadcastLobby();
  }

  setReady(connection: ClientConnection, ready?: boolean): void {
    const participant = this.slots.find((slot): slot is HumanSlot => slot?.kind === "human" && slot.playerId === connection.id);
    if (!participant || this.inMatch) return;
    participant.ready = ready ?? !participant.ready;
    if (participant.playerId === this.hostId && participant.ready) participant.ready = true;
    this.touch();
    this.broadcastLobby();
  }

  private convertToBot(index: number, difficulty: BotDifficulty): void {
    const participant = this.slots[index];
    if (participant?.kind !== "human") return;
    this.slots[index] = {
      kind: "bot",
      playerId: participant.playerId,
      accountId: participant.accountId,
      nickname: displayName(participant.profile),
      animal: participant.profile.selectedAnimal,
      hat: "none",
      difficulty
    };
    this.gameLoop?.convertToBot(participant.playerId, difficulty);
  }

  checkDisconnects(now: number): void {
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      if (slot?.kind !== "human" || slot.connected || now - slot.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;
      if (this.inMatch) {
        if (this.ranked) this.gameLoop?.forfeit(slot.playerId);
        else this.convertToBot(index, "medium");
      } else {
        this.slots[index] = null;
        if (this.hostId === slot.playerId) this.hostId = this.slots.find((candidate) => candidate?.kind === "human")?.playerId ?? "";
      }
      this.broadcastLobby();
    }
  }

  updateProfile(profile: PlayerProfile): void {
    for (const slot of this.slots) {
      if (slot?.kind === "human" && slot.accountId === profile.id) slot.profile = profile;
    }
    this.broadcastLobby();
  }

  start(connection: ClientConnection | null, automatic = false): void {
    if (this.inMatch) return;
    if (!automatic && (!connection || this.hostId !== connection.id)) {
      if (connection) sendError(connection, "NOT_HOST", "Only the host can start");
      return;
    }
    const humans = this.slots.filter((slot): slot is HumanSlot => slot?.kind === "human" && slot.connected);
    if (!automatic && humans.some((participant) => participant.playerId !== this.hostId && !participant.ready)) {
      if (connection) sendError(connection, "NOT_READY", "Guests need to ready up first");
      return;
    }
    if (this.botFill) {
      for (let index = 0; index < this.slots.length; index += 1) {
        if (!this.slots[index]) {
          this.slots[index] = { kind: "bot", playerId: randomUUID(), accountId: null, nickname: `SplashBot ${index + 1}`, animal: BOT_ANIMALS[index % BOT_ANIMALS.length], hat: "none", difficulty: "medium" };
        }
      }
    }
    if (this.occupiedCount < 2 || (this.ranked && this.occupiedCount !== this.maxPlayers)) {
      if (connection) sendError(connection, "NOT_ENOUGH_PLAYERS", "At least two players or bots are needed");
      return;
    }
    const runtime: RuntimePlayer[] = [];
    const ratings: Record<string, number | null> = {};
    this.ratingsAtStart = new Map();
    for (const slot of this.slots) {
      if (!slot) continue;
      if (slot.kind === "human") {
        runtime.push({
          descriptor: { id: slot.playerId, nickname: displayName(slot.profile), animal: slot.profile.selectedAnimal, hat: slot.profile.selectedHat, bot: false },
          accountId: slot.accountId,
          connection: slot.connection,
          difficulty: null,
          forfeited: false
        });
        const rating = this.manager.db.getRating(slot.accountId, this.mode);
        this.ratingsAtStart.set(slot.playerId, rating);
        ratings[slot.playerId] = this.ranked ? rating.rating : null;
      } else {
        runtime.push({
          descriptor: { id: slot.playerId, nickname: slot.nickname, animal: slot.animal, hat: slot.hat, bot: true, difficulty: slot.difficulty },
          accountId: slot.accountId,
          connection: null,
          difficulty: slot.difficulty,
          forfeited: false
        });
        ratings[slot.playerId] = null;
      }
    }
    const config: MatchConfig = {
      mode: this.mode,
      ranked: this.ranked,
      roundsToWin: this.roundsToWin,
      theme: this.theme,
      revengeDucks: CONFIG.ENABLE_REVENGE_DUCKS && (!this.ranked || CONFIG.REVENGE_DUCKS_RANKED),
      kick: CONFIG.ENABLE_KICK,
      tutorial: this.tutorial
    };
    this.lastResults = null;
    this.inMatch = true;
    for (const participant of humans) {
      participant.ready = false;
      participant.rematchVote = false;
    }
    this.gameLoop = new GameLoop(runtime, config, ratings, {
      broadcast: (message) => this.broadcast(message),
      matchEnded: (state, players) => this.matchEnded(state, players)
    }, randomSeed());
    this.touch();
    this.broadcastLobby();
    this.gameLoop.start();
  }

  private matchEnded(state: NonNullable<GameLoop["state"]>, runtime: RuntimePlayer[]): void {
    const participants = runtime.map((player) => {
      const statePlayer = state.players.find((candidate) => candidate.id === player.descriptor.id);
      return {
        playerId: player.descriptor.id,
        accountId: player.accountId ?? "",
        roundsWon: statePlayer?.roundsWon ?? 0,
        soaks: statePlayer?.soaks ?? 0,
        forfeited: player.forfeited
      };
    });
    const placementMap = rankPlacements(participants);
    const rated = participants.filter((participant) => participant.accountId).map((participant) => ({ ...participant, rating: this.ratingsAtStart.get(participant.playerId) ?? this.manager.db.getRating(participant.accountId, this.mode) }));
    const changes = this.ranked ? ratingChanges(rated, this.mode, placementMap) : { before: new Map<string, number>(), after: new Map<string, number>(), deltas: {} };
    const xp: Record<string, number> = {};
    const matchPlayers: MatchPlayerRecord[] = [];
    const placements: MatchPlacement[] = state.players.map((player) => {
      const runtimePlayer = runtime.find((candidate) => candidate.descriptor.id === player.id);
      const placement = placementMap.get(player.id) ?? runtime.length;
      let earned = runtimePlayer?.accountId ? xpForMatch(placement, player.soaks, player.castlesWashed) : 0;
      let tutorialComplete = false;
      if (runtimePlayer?.accountId && this.tutorial && placement === 1) {
        const profile = this.manager.db.getProfile(runtimePlayer.accountId);
        tutorialComplete = !profile?.tutorialComplete;
        if (tutorialComplete) earned += CONFIG.XP.TUTORIAL;
      }
      xp[player.id] = earned;
      if (runtimePlayer?.accountId) {
        matchPlayers.push({
          accountId: runtimePlayer.accountId,
          placement,
          soaks: player.soaks,
          roundsWon: player.roundsWon,
          ratingBefore: this.ranked ? changes.before.get(player.id) ?? null : null,
          ratingAfter: this.ranked ? changes.after.get(player.id) ?? null : null,
          xpEarned: earned,
          tutorialComplete
        });
      }
      return {
        playerId: player.id,
        nickname: player.nickname,
        animal: player.animal,
        placement,
        roundWins: player.roundsWon,
        soaks: player.soaks,
        castlesWashed: player.castlesWashed,
        survivalTicks: player.totalSurvivalTicks,
        biggestChain: player.biggestChain,
        xpEarned: earned,
        ratingBefore: this.ranked ? changes.before.get(player.id) ?? null : null,
        ratingAfter: this.ranked ? changes.after.get(player.id) ?? null : null
      };
    }).sort((a, b) => a.placement - b.placement || a.playerId.localeCompare(b.playerId));
    if (matchPlayers.length > 0) {
      try {
        this.manager.db.recordMatch({ id: randomUUID(), mode: this.mode, ranked: this.ranked, startedAt: this.gameLoop?.startedAt ?? Date.now(), endedAt: Date.now(), players: matchPlayers });
      } catch (error) {
        console.error("Failed to record match", error);
      }
    }
    const top = (key: "soaks" | "castlesWashed" | "totalSurvivalTicks" | "biggestChain") => [...state.players].sort((a, b) => b[key] - a[key])[0]?.id ?? null;
    const funStats: FunStats = { mostSoaks: top("soaks"), castleCrusher: top("castlesWashed"), longestSurvivor: top("totalSurvivalTicks"), biggestChain: top("biggestChain") };
    this.lastResults = { type: "match_end", placements, ratingDeltas: changes.deltas, xp, funStats };
    this.inMatch = false;
    this.touch();
    this.broadcast(this.lastResults);
    for (const slot of this.slots) {
      if (slot?.kind !== "human") continue;
      const profile = this.manager.db.getProfile(slot.accountId);
      if (profile) {
        slot.profile = profile;
        if (slot.connection) {
          slot.connection.profile = profile;
          sendMessage(slot.connection, { type: "profile_update", profile });
        }
      }
      slot.rematchVote = false;
    }
    this.broadcastLobby();
  }

  voteRematch(connection: ClientConnection, vote = true): void {
    if (this.ranked || this.inMatch || !this.lastResults) return;
    const participant = this.slots.find((slot): slot is HumanSlot => slot?.kind === "human" && slot.playerId === connection.id);
    if (!participant) return;
    participant.rematchVote = vote;
    this.touch();
    this.broadcastLobby();
    const connected = this.slots.filter((slot): slot is HumanSlot => slot?.kind === "human" && slot.connected);
    const needed = Math.floor(connected.length / 2) + 1;
    if (connected.filter((slot) => slot.rematchVote).length >= needed) {
      for (const slot of connected) slot.rematchVote = false;
      this.start(null, true);
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly clients = new Set<ClientConnection>();
  private readonly gcTimer: NodeJS.Timeout;

  constructor(readonly db: SplashDatabase) {
    this.gcTimer = setInterval(() => this.gc(), 1000);
  }

  register(connection: ClientConnection): void {
    this.clients.add(connection);
  }

  private code(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Unable to allocate room code");
  }

  createRoom(connection: ClientConnection, options: RoomOptions): Room {
    if (connection.roomCode) this.leave(connection);
    const room = new Room(this, {
      code: this.code(),
      name: options.name.trim(),
      maxPlayers: options.maxPlayers,
      theme: themeFrom(options.theme),
      roundsToWin: options.roundsToWin,
      botFill: options.botFill,
      ranked: false,
      listed: options.public
    });
    this.rooms.set(room.code, room);
    room.addHuman(connection);
    sendMessage(connection, { type: "room_created", code: room.code, url: `/#/room/${room.code}` });
    room.broadcastLobby();
    return room;
  }

  createSpecial(connection: ClientConnection, kind: "practice" | "tutorial", difficulty: BotDifficulty = "easy"): Room {
    if (connection.roomCode) this.leave(connection);
    const tutorial = kind === "tutorial";
    const room = new Room(this, {
      code: this.code(),
      name: tutorial ? "Tutorial" : "Practice",
      maxPlayers: tutorial ? 2 : 4,
      theme: "backyard",
      roundsToWin: tutorial ? 1 : 3,
      botFill: false,
      ranked: false,
      listed: false,
      tutorial,
      practice: !tutorial
    });
    this.rooms.set(room.code, room);
    room.addHuman(connection);
    const count = tutorial ? 1 : 3;
    for (let index = 1; index <= count; index += 1) room.setSlot({ id: room.hostId } as ClientConnection, index, "bot", difficulty);
    room.start(null, true);
    return room;
  }

  createRanked(connections: ClientConnection[], mode: GameMode): Room {
    const room = new Room(this, {
      code: this.code(),
      name: mode === "duel" ? "Ranked Duel" : "Ranked Free-for-All",
      maxPlayers: mode === "duel" ? 2 : 4,
      theme: themeFrom("random"),
      roundsToWin: 3,
      botFill: false,
      ranked: true,
      listed: false
    });
    this.rooms.set(room.code, room);
    for (const connection of connections) {
      if (connection.roomCode) this.leave(connection);
      room.addHuman(connection);
      sendMessage(connection, { type: "match_found", mode, code: room.code });
    }
    room.start(null, true);
    return room;
  }

  join(connection: ClientConnection, code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return sendError(connection, "ROOM_NOT_FOUND", "That room code does not exist");
    if (connection.roomCode === room.code) {
      room.broadcastLobby();
      if (room.inMatch) room.gameLoop?.resync(connection);
      return;
    }
    if (connection.roomCode) this.leave(connection);
    if (room.reclaim(connection)) return;
    if (!room.canJoin()) return sendError(connection, "ROOM_FULL", "That room is full or already playing");
    room.addHuman(connection);
  }

  leave(connection: ClientConnection): void {
    if (!connection.roomCode) return;
    this.rooms.get(connection.roomCode)?.leave(connection);
    connection.roomCode = null;
    this.broadcastRoomList();
  }

  disconnect(connection: ClientConnection): void {
    this.clients.delete(connection);
    if (connection.roomCode) this.rooms.get(connection.roomCode)?.disconnect(connection);
    this.broadcastRoomList();
  }

  roomAction(connection: ClientConnection, message: ClientMessage): void {
    const room = connection.roomCode ? this.rooms.get(connection.roomCode) : undefined;
    if (!room) return;
    room.touch();
    if (message.type === "set_slot") room.setSlot(connection, message.slot, message.kind, message.difficulty);
    if (message.type === "set_ready") room.setReady(connection, message.ready);
    if (message.type === "start_match") room.start(connection);
    if (message.type === "input" && room.inMatch) room.gameLoop?.queueInput(connection, { seq: message.seq, dir: message.dir, balloonPressed: message.balloonPressed });
    if (message.type === "emote" && room.inMatch) {
      const now = Date.now();
      if (now - connection.lastEmoteAt >= CONFIG.EMOTE_COOLDOWN_MS) {
        connection.lastEmoteAt = now;
        room.gameLoop?.queueEmote(connection.id, message.id);
      }
    }
    if (message.type === "rematch_vote") room.voteRematch(connection, message.vote);
  }

  profileUpdated(profile: PlayerProfile): void {
    for (const client of this.clients) {
      if (client.accountId === profile.id) client.profile = profile;
    }
    for (const room of this.rooms.values()) room.updateProfile(profile);
  }

  roomList(filter: GameMode | "all" = "all"): RoomListItem[] {
    return [...this.rooms.values()].filter((room) => room.listed && room.canJoin() && (filter === "all" || room.mode === filter)).map((room) => room.listItem()).sort((a, b) => a.name.localeCompare(b.name));
  }

  requestRoomList(connection: ClientConnection, filter: GameMode | "all" = "all"): void {
    sendMessage(connection, { type: "room_list", rooms: this.roomList(filter) });
  }

  broadcastRoomList(): void {
    for (const client of this.clients) {
      if (client.ws.readyState === 1) this.requestRoomList(client);
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.checkDisconnects(now);
      if (now - room.lastActive > CONFIG.ROOM_TTL_MS && (!room.inMatch || room.humanCount === 0)) {
        room.gameLoop?.stop();
        this.rooms.delete(room.code);
        this.broadcastRoomList();
      }
    }
  }

  stop(): void {
    clearInterval(this.gcTimer);
    for (const room of this.rooms.values()) room.gameLoop?.stop();
  }
}
