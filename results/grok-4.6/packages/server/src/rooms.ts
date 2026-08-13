import { randomBytes, randomInt } from "node:crypto";
import {
  ANIMALS,
  CONFIG,
  type AnimalId,
  type BotDifficulty,
  type CreateRoomOpts,
  type HatId,
  type Mode,
  type PlayerInput,
  type Profile,
  type RoomInfo,
  type ServerMsg,
  type SlotKind,
  type SlotState,
} from "@splash/shared";
import type { WebSocket } from "ws";
import type { DbApi } from "./dbApi.js";
import type { GameSession } from "./gameLoop.js";

type SessionFactory = (room: Room, db: DbApi) => GameSession;
let makeSession: SessionFactory | null = null;

export function bindSessionFactory(fn: SessionFactory): void {
  makeSession = fn;
}

export interface Client {
  ws: WebSocket;
  playerId: string | null;
  profile: Profile | null;
  roomCode: string | null;
  queuedMode: Mode | null;
  queuedAt: number;
  lastMsgs: number[];
  lastInput: PlayerInput | null;
  lastPong: number;
  alive: boolean;
}

export interface Room {
  code: string;
  name: string;
  public: boolean;
  hostId: string;
  mode: Mode;
  theme: CreateRoomOpts["theme"];
  roundsToWin: number;
  botFill: boolean;
  slots: SlotState[];
  ranked: boolean;
  createdAt: number;
  lastActive: number;
  session: GameSession | null;
  rematchVotes: Set<string>;
  clients: Map<string, Client>;
  hidden: boolean;
}

const rooms = new Map<string, Room>();

export function allRooms(): Room[] {
  return [...rooms.values()];
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function publicRoomList(): RoomInfo[] {
  return [...rooms.values()]
    .filter((r) => r.public && !r.hidden && !r.ranked)
    .map((r) => ({
      code: r.code,
      name: r.name,
      mode: r.mode,
      public: r.public,
      playerCount: r.slots.filter((s) => s.kind !== "empty").length,
      maxPlayers: r.slots.length,
      theme: r.theme,
      hostName: r.slots.find((s) => s.playerId === r.hostId)?.nickname ?? "Host",
      inMatch: !!r.session,
    }));
}

function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[randomInt(chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function emptySlots(n: number): SlotState[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    kind: "empty" as const,
    ready: false,
    connected: false,
  }));
}

export function createRoom(host: Client, opts: CreateRoomOpts, ranked = false, hidden = false): Room {
  const code = ranked ? `R${randomBytes(3).toString("hex").toUpperCase()}` : makeCode();
  const size = opts.size;
  const room: Room = {
    code,
    name: opts.name.slice(0, 24) || "Splash Room",
    public: opts.public && !ranked,
    hostId: host.playerId ?? "",
    mode: size === 2 ? "duel" : "ffa",
    theme: opts.theme,
    roundsToWin: opts.roundsToWin,
    botFill: opts.botFill,
    slots: emptySlots(size),
    ranked,
    createdAt: Date.now(),
    lastActive: Date.now(),
    session: null,
    rematchVotes: new Set(),
    clients: new Map(),
    hidden,
  };
  rooms.set(code, room);
  if (host.playerId && host.profile) occupySlot(room, 0, host);
  return room;
}

export function createRankedRoom(players: Client[], mode: Mode): Room {
  const size = mode === "duel" ? 2 : 4;
  const dummy = players[0]!;
  const room = createRoom(
    dummy,
    { name: "Ranked", size, public: false, theme: "random", roundsToWin: 3, botFill: false },
    true,
    true,
  );
  room.slots = emptySlots(size);
  room.hostId = "";
  players.forEach((c, i) => {
    if (c.playerId && c.profile) occupySlot(room, i, c);
  });
  return room;
}

function occupySlot(room: Room, index: number, client: Client): boolean {
  const slot = room.slots[index];
  if (!slot || slot.kind === "human") return false;
  const p = client.profile!;
  slot.kind = "human";
  slot.playerId = p.id;
  slot.nickname = p.nickname;
  slot.tag = p.tag;
  slot.animal = p.selectedAnimal;
  slot.hat = p.selectedHat;
  slot.ready = false;
  slot.connected = true;
  slot.difficulty = undefined;
  client.roomCode = room.code;
  room.clients.set(p.id, client);
  room.lastActive = Date.now();
  return true;
}

export function joinRoom(client: Client, code: string): Room | string {
  const room = rooms.get(code.toUpperCase());
  if (!room) return "Room not found";
  if (room.session) return "Match already in progress";
  if (!client.profile) return "Not logged in";
  const empty = room.slots.find((s) => s.kind === "empty" || s.kind === "bot");
  if (!empty) return "Room is full";
  occupySlot(room, empty.index, client);
  return room;
}

export function leaveRoom(client: Client): void {
  if (!client.roomCode || !client.playerId) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;
  room.clients.delete(client.playerId);
  const slot = room.slots.find((s) => s.playerId === client.playerId);
  if (slot) {
    if (room.session && !room.ranked) {
      slot.kind = "bot";
      slot.difficulty = "medium";
      slot.playerId = `bot-${room.code}-${slot.index}`;
      slot.nickname = botName(slot.difficulty);
      slot.tag = 0;
      slot.animal = ANIMALS[slot.index % ANIMALS.length]!.id as AnimalId;
      slot.hat = "none";
      slot.connected = true;
      room.session.replaceWithBot(client.playerId, slot);
    } else if (room.session && room.ranked) {
      room.session.markForfeit(client.playerId);
      slot.connected = false;
    } else {
      slot.kind = "empty";
      slot.playerId = undefined;
      slot.nickname = undefined;
      slot.ready = false;
      slot.connected = false;
    }
  }
  if (room.hostId === client.playerId) {
    const next = room.slots.find((s) => s.kind === "human" && s.playerId);
    room.hostId = next?.playerId ?? "";
  }
  if (!room.slots.some((s) => s.kind === "human" && s.connected) && !room.session) {
    rooms.delete(room.code);
  }
  broadcastLobby(room);
}

export function setSlot(room: Room, hostId: string, slot: number, kind: SlotKind, difficulty?: BotDifficulty): string | null {
  if (room.hostId !== hostId) return "Only the host can change slots";
  if (room.session) return "Match in progress";
  const s = room.slots[slot];
  if (!s) return "Invalid slot";
  if (s.kind === "human" && kind !== "human") return "Cannot overwrite a player";
  if (kind === "bot") {
    s.kind = "bot";
    s.difficulty = difficulty ?? "medium";
    s.playerId = `bot-${room.code}-${slot}`;
    s.nickname = botName(s.difficulty);
    s.tag = 0;
    s.animal = ANIMALS[slot % ANIMALS.length]!.id as AnimalId;
    s.hat = "none" as HatId;
    s.ready = true;
    s.connected = true;
  } else if (kind === "empty") {
    s.kind = "empty";
    s.playerId = undefined;
    s.nickname = undefined;
    s.difficulty = undefined;
    s.ready = false;
    s.connected = false;
  }
  return null;
}

function botName(d: BotDifficulty): string {
  const names = ["DrizzleBot", "PuddleBot", "TideBot", "FoamBot"];
  return `${names[Math.floor(Math.random() * names.length)]} (${d})`;
}

export function lobbyPayload(room: Room): ServerMsg {
  return {
    type: "lobby_state",
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    slots: room.slots,
    theme: room.theme,
    roundsToWin: room.roundsToWin,
    public: room.public,
    mode: room.mode,
    votes: [...room.rematchVotes],
  };
}

export function broadcastLobby(room: Room): void {
  const msg = lobbyPayload(room);
  for (const c of room.clients.values()) send(c, msg);
}

export function send(client: Client, msg: ServerMsg): void {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

export function broadcast(room: Room, msg: ServerMsg): void {
  for (const c of room.clients.values()) send(c, msg);
}

export function gcRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.session) continue;
    if (now - room.lastActive > CONFIG.ROOM_TTL_MS) rooms.delete(code);
  }
}

export function startMatch(room: Room, db: DbApi): string | null {
  if (room.session) return "Already started";
  const filled = room.slots.filter((s) => s.kind !== "empty");
  if (filled.length < 2) return "Need at least 2 players";
  if (!room.ranked) {
    const humans = room.slots.filter((s) => s.kind === "human");
    if (humans.some((h) => !h.ready && h.playerId !== room.hostId)) return "Players not ready";
  }
  if (!makeSession) return "Server not ready";
  room.session = makeSession(room, db);
  room.session.start();
  return null;
}

export function handleRoomInput(room: Room, playerId: string, input: PlayerInput): void {
  room.session?.pushInput(playerId, input);
}

export function tickRooms(): void {
  for (const room of rooms.values()) {
    room.session?.tick();
    if (room.session?.finished) {
      /* keep session until rematch / leave */
    }
  }
}

export function voteRematch(room: Room, playerId: string, db: DbApi): void {
  if (!room.session?.finished || room.ranked) return;
  room.rematchVotes.add(playerId);
  broadcastLobby(room);
  const humans = room.slots.filter((s) => s.kind === "human" && s.connected);
  if (humans.length && room.rematchVotes.size > humans.length / 2) {
    room.rematchVotes.clear();
    if (!makeSession) return;
    room.session = makeSession(room, db);
    room.session.start();
  }
}

export { rooms };
