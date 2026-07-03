import {
  CONFIG,
  type BotDifficulty,
  type CreateRoomOpts,
  type GameMode,
  type MapTheme,
  type RoomSummary,
  type S2C,
  type SlotInfo,
} from "../../shared/src/index.js";
import { botName } from "./names.js";
import { gameLoop, Match, type Sender, type SeatSpec } from "./gameLoop.js";

export interface RoomMember extends Sender {
  playerId: string;
  displayName: string; // nickname#tag
  animal: string;
  hat: string;
}

type RoomSlot =
  | { kind: "open" }
  | { kind: "closed" }
  | { kind: "bot"; difficulty: BotDifficulty }
  | { kind: "human"; member: RoomMember; ready: boolean; connected: boolean };

const THEMES: MapTheme[] = ["backyard", "beach", "pool"];

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  slots: RoomSlot[];
  state: "lobby" | "playing" | "post" = "lobby";
  match: Match | null = null;
  hostPlayerId: string;
  rematchVotes = new Set<string>();

  constructor(
    code: string,
    public opts: CreateRoomOpts,
    host: RoomMember,
    public hidden = false // ranked rooms never appear in the browser
  ) {
    this.code = code;
    this.hostPlayerId = host.playerId;
    const max = CONFIG.ARENAS[opts.mode].maxPlayers;
    this.slots = Array.from({ length: max }, (_, i) =>
      i === 0 ? { kind: "human", member: host, ready: true, connected: true } : { kind: "open" }
    );
  }

  get maxPlayers(): number {
    return this.slots.length;
  }

  humanMembers(): { slot: number; member: RoomMember; ready: boolean; connected: boolean }[] {
    const out: { slot: number; member: RoomMember; ready: boolean; connected: boolean }[] = [];
    this.slots.forEach((s, slot) => {
      if (s.kind === "human") out.push({ slot, member: s.member, ready: s.ready, connected: s.connected });
    });
    return out;
  }

  occupiedCount(): number {
    return this.slots.filter((s) => s.kind === "human" || s.kind === "bot").length;
  }

  summary(): RoomSummary {
    const host = this.humanMembers().find((h) => h.member.playerId === this.hostPlayerId);
    return {
      code: this.code,
      name: this.opts.name,
      mode: this.opts.mode,
      players: this.occupiedCount(),
      maxPlayers: this.maxPlayers,
      theme: this.opts.theme,
      host: host?.member.displayName ?? "?",
    };
  }

  broadcast(msg: S2C): void {
    for (const h of this.humanMembers()) if (h.connected) h.member.send(msg);
  }

  broadcastLobbyState(): void {
    const slotInfos: SlotInfo[] = this.slots.map((s): SlotInfo => {
      if (s.kind === "human") {
        return {
          kind: "human",
          playerId: s.member.playerId,
          nickname: s.member.displayName,
          animal: s.member.animal,
          hat: s.member.hat,
          ready: s.ready,
          connected: s.connected,
        };
      }
      if (s.kind === "bot") return { kind: "bot", difficulty: s.difficulty };
      return { kind: s.kind };
    });
    const hostSlot = this.slots.findIndex(
      (s) => s.kind === "human" && s.member.playerId === this.hostPlayerId
    );
    for (const h of this.humanMembers()) {
      if (!h.connected) continue;
      h.member.send({
        t: "lobby_state",
        code: this.code,
        name: this.opts.name,
        mode: this.opts.mode,
        isPublic: this.opts.isPublic,
        theme: this.opts.theme,
        roundsToWin: this.opts.roundsToWin,
        hostSlot,
        yourSlot: h.slot,
        slots: slotInfos,
      });
    }
  }

  addHuman(member: RoomMember): number | null {
    const i = this.slots.findIndex((s) => s.kind === "open");
    if (i < 0) return null;
    this.slots[i] = { kind: "human", member, ready: false, connected: true };
    this.touch();
    return i;
  }

  removeHuman(playerId: string): void {
    this.slots = this.slots.map((s) =>
      s.kind === "human" && s.member.playerId === playerId ? { kind: "open" } : s
    );
    this.rematchVotes.delete(playerId);
    if (this.hostPlayerId === playerId) {
      const next = this.humanMembers()[0];
      if (next) this.hostPlayerId = next.member.playerId;
    }
    this.touch();
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  setConnected(playerId: string, connected: boolean): void {
    for (const s of this.slots) {
      if (s.kind === "human" && s.member.playerId === playerId) s.connected = connected;
    }
    if (this.state === "lobby") this.broadcastLobbyState();
    this.touch();
  }

  setReady(playerId: string, ready: boolean): void {
    for (const s of this.slots) {
      if (s.kind === "human" && s.member.playerId === playerId) s.ready = ready;
    }
    this.touch();
  }

  resolveTheme(): MapTheme {
    if (this.opts.theme !== "random") return this.opts.theme;
    return THEMES[Math.floor(Math.random() * THEMES.length)];
  }

  buildSeats(): SeatSpec[] {
    const seats: SeatSpec[] = [];
    this.slots.forEach((s, i) => {
      if (s.kind === "human") {
        seats.push({
          playerId: s.member.playerId,
          nickname: s.member.displayName,
          animal: s.member.animal,
          hat: s.member.hat,
          isBot: false,
          conn: s.connected ? s.member : null,
        });
      } else if (s.kind === "bot") {
        seats.push({
          playerId: `bot:${this.code}:${i}`,
          nickname: botName(s.difficulty, i),
          animal: ["duck", "frog", "otter", "penguin"][i % 4],
          hat: "none",
          isBot: true,
          difficulty: s.difficulty,
          conn: null,
        });
      }
    });
    return seats;
  }
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusable 0/O/1/I/L
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  byPlayer = new Map<string, Room>();

  constructor() {
    setInterval(() => this.gc(), 60_000).unref();
  }

  create(opts: CreateRoomOpts, host: RoomMember, hidden = false): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const name = (opts.name || `${host.displayName}'s room`).slice(0, CONFIG.MAX_ROOM_NAME_LEN);
    const roundsToWin = (CONFIG.ROUNDS_TO_WIN_OPTIONS as readonly number[]).includes(opts.roundsToWin)
      ? opts.roundsToWin
      : CONFIG.DEFAULT_ROUNDS_TO_WIN;
    const room = new Room(code, { ...opts, name, roundsToWin }, host, hidden);
    this.rooms.set(code, room);
    this.byPlayer.set(host.playerId, room);
    return room;
  }

  publicList(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.hidden && r.opts.isPublic && r.state === "lobby" && r.occupiedCount() < r.maxPlayers)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((r) => r.summary());
  }

  join(code: string, member: RoomMember): Room | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "Room not found." };
    if (room.state === "playing") {
      // Allow rejoining a match you belong to (reconnect path handles it).
      return { error: "That match is already underway." };
    }
    if (room.occupiedCount() >= room.maxPlayers) return { error: "Room is full." };
    const slot = room.addHuman(member);
    if (slot === null) return { error: "Room is full." };
    this.byPlayer.set(member.playerId, room);
    room.broadcastLobbyState();
    return room;
  }

  leave(playerId: string): void {
    const room = this.byPlayer.get(playerId);
    if (!room) return;
    this.byPlayer.delete(playerId);
    room.removeHuman(playerId);
    if (room.humanMembers().length === 0) {
      this.destroy(room);
    } else {
      room.broadcastLobbyState();
    }
  }

  startMatch(room: Room, ranked = false): Match | { error: string } {
    if (room.state === "playing") return { error: "Match already running." };
    // Bot-fill open slots at start when the room asked for it.
    if (room.opts.botFill) {
      room.slots = room.slots.map((s) => (s.kind === "open" ? { kind: "bot", difficulty: "medium" } : s));
    }
    const seats = room.buildSeats();
    if (seats.length < 2) return { error: "Need at least 2 players (add a bot?)." };
    const unready = room.humanMembers().filter((h) => !h.ready && h.member.playerId !== room.hostPlayerId);
    if (unready.length > 0) return { error: "Everyone must be ready." };
    room.state = "playing";
    room.rematchVotes.clear();
    room.touch();
    const match = new Match({
      mode: room.opts.mode,
      ranked,
      roundsToWin: room.opts.roundsToWin,
      theme: room.resolveTheme(),
      seats,
      onEnd: () => {
        room.state = "post";
        room.touch();
        if (room.hidden) this.destroy(room); // ranked rooms evaporate after the match
      },
    });
    room.match = match;
    gameLoop.add(match);
    return match;
  }

  rematchVote(room: Room, playerId: string): void {
    if (room.state !== "post" || !room.match) return;
    room.rematchVotes.add(playerId);
    const humans = room.humanMembers().filter((h) => h.connected);
    const needed = Math.floor(humans.length / 2) + 1;
    room.broadcast({
      t: "rematch_state",
      votes: this.countValidVotes(room),
      needed,
      voted: room.slots.map((s) => s.kind === "human" && room.rematchVotes.has(s.member.playerId)),
    });
    if (this.countValidVotes(room) >= needed) {
      // Reset readiness and restart the same room.
      room.slots = room.slots.map((s) => (s.kind === "human" ? { ...s, ready: true } : s));
      room.state = "lobby";
      room.match = null;
      this.startMatch(room);
    }
  }

  private countValidVotes(room: Room): number {
    return room.humanMembers().filter((h) => h.connected && room.rematchVotes.has(h.member.playerId)).length;
  }

  destroy(room: Room): void {
    if (room.match && room.state === "playing") room.match.endMatch();
    for (const h of room.humanMembers()) this.byPlayer.delete(h.member.playerId);
    this.rooms.delete(room.code);
  }

  private gc(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.lastActivity > CONFIG.ROOM_IDLE_TTL_MS;
      const empty = room.humanMembers().length === 0;
      if (empty || (idle && room.state !== "playing")) this.destroy(room);
    }
  }
}

export const roomManager = new RoomManager();
