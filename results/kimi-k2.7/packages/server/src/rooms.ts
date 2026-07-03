import type { Animal, Difficulty, Hat, LobbySlot, Mode, RoomInfo, RoomOpts, Theme } from "@splash/shared";
import { CONFIG, THEMES } from "@splash/shared";
import { randomUUID } from "crypto";
import type { ServerMsg } from "@splash/shared";
import type { Connection } from "./net.js";
import { broadcastToRoom, roomConnections } from "./net.js";
import { startMatch, type RunningMatch } from "./gameLoop.js";
import type { MatchState } from "@splash/shared";

export type Room = {
  code: string;
  name: string;
  hostId: string;
  mode: Mode;
  public: boolean;
  ranked?: boolean;
  theme: Theme | "random";
  roundsToWin: number;
  botFill: boolean;
  slots: LobbySlot[];
  createdAt: number;
  lastActivityAt: number;
  runningMatch?: RunningMatch;
  rematchVotes: Set<string>;
};

const rooms = new Map<string, Room>();
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += codeChars[Math.floor(Math.random() * codeChars.length)];
  return code;
}

export function createRoom(hostConn: Connection, opts: RoomOpts): Room {
  const code = genCode();
  const maxPlayers = opts.mode === "duel" ? 2 : 4;
  const room: Room = {
    code,
    name: opts.name,
    hostId: hostConn.playerId,
    mode: opts.mode,
    public: opts.public,
    theme: opts.theme,
    roundsToWin: opts.roundsToWin,
    botFill: opts.botFill,
    slots: Array.from({ length: maxPlayers }, (_, i) => ({
      slot: i,
      kind: i === 0 ? "human" : opts.botFill ? "bot" : "closed",
      difficulty: i === 0 ? undefined : "medium",
      ready: i === 0,
    })),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    rematchVotes: new Set(),
  };
  // Fill first slot with host
  room.slots[0] = {
    slot: 0,
    kind: "human",
    playerId: hostConn.playerId,
    nickname: hostConn.nickname,
    animal: hostConn.profile.selectedAnimal,
    hat: hostConn.profile.selectedHat,
    ready: true,
  };
  if (opts.botFill) fillBotSlots(room);
  rooms.set(code, room);
  hostConn.roomCode = code;
  broadcastLobby(room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function listPublicRooms(mode?: Mode): RoomInfo[] {
  return [...rooms.values()]
    .filter((r) => r.public && !r.runningMatch && (!mode || r.mode === mode))
    .map((r) => ({
      code: r.code,
      name: r.name,
      mode: r.mode,
      public: r.public,
      theme: r.theme,
      players: r.slots.filter((s) => s.kind === "human").length,
      maxPlayers: r.slots.length,
      host: r.slots.find((s) => s.slot === 0)?.nickname || "?",
    }));
}

export function joinRoom(conn: Connection, code: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  if (room.runningMatch) return false;
  const openSlot = room.slots.find((s) => s.kind === "closed" || s.kind === "bot");
  if (!openSlot) return false;
  openSlot.kind = "human";
  openSlot.playerId = conn.playerId;
  openSlot.nickname = conn.nickname;
  openSlot.animal = conn.profile.selectedAnimal;
  openSlot.hat = conn.profile.selectedHat;
  openSlot.ready = false;
  conn.roomCode = code;
  room.lastActivityAt = Date.now();
  broadcastLobby(room);
  return true;
}

export function leaveRoom(conn: Connection) {
  const room = rooms.get(conn.roomCode || "");
  if (!room) {
    conn.roomCode = null;
    return;
  }
  const slot = room.slots.find((s) => s.playerId === conn.playerId);
  if (slot) {
    slot.kind = room.botFill ? "bot" : "closed";
    slot.playerId = undefined;
    slot.nickname = undefined;
    slot.animal = undefined;
    slot.hat = undefined;
    slot.ready = false;
    slot.difficulty = "medium";
    if (room.botFill) fillBotSlots(room);
  }
  conn.roomCode = null;
  room.lastActivityAt = Date.now();
  // If running match, convert to bot after grace (handled elsewhere)
  broadcastLobby(room);
  if (room.slots.every((s) => s.kind !== "human")) {
    rooms.delete(room.code);
  }
}

export function setSlot(room: Room, slotIdx: number, kind: "human" | "bot" | "closed", difficulty?: Difficulty) {
  if (room.runningMatch) return;
  const slot = room.slots[slotIdx];
  if (!slot || slotIdx === 0) return;
  slot.kind = kind;
  slot.difficulty = kind === "bot" ? difficulty || "medium" : undefined;
  if (kind !== "human") {
    slot.playerId = undefined;
    slot.nickname = undefined;
    slot.ready = false;
  }
  if (room.botFill) fillBotSlots(room);
  room.lastActivityAt = Date.now();
  broadcastLobby(room);
}

export function setReady(room: Room, playerId: string, ready: boolean) {
  const slot = room.slots.find((s) => s.playerId === playerId);
  if (slot) slot.ready = ready;
  room.lastActivityAt = Date.now();
  broadcastLobby(room);
}

export function canStart(room: Room): boolean {
  if (room.runningMatch) return false;
  const humanCount = room.slots.filter((s) => s.kind === "human").length;
  if (humanCount === 0) return false;
  return room.slots.every((s) => s.kind === "closed" || s.ready || s.kind === "bot");
}

export function startRoomMatch(room: Room, onFinish: (rm: RunningMatch) => void): RunningMatch | null {
  if (!canStart(room)) return null;
  room.rematchVotes.clear();
  const resolvedTheme: Theme = room.theme === "random" ? THEMES[Math.floor(Math.random() * THEMES.length)] : room.theme;
  const matchId = randomUUID();
  const match: MatchState = {
    id: matchId,
    mode: room.mode,
    ranked: false,
    theme: resolvedTheme,
    roundWins: {},
    roundNo: 0,
    players: [],
    startedAt: Date.now(),
    ended: false,
  };

  const conns: Connection[] = [];
  const botSlots: { slot: number; difficulty: Difficulty; playerId: string; nickname: string; animal: Animal; hat: Hat }[] = [];

  for (let i = 0; i < room.slots.length; i++) {
    const slot = room.slots[i];
    if (slot.kind === "human" && slot.playerId) {
      match.players.push({
        id: slot.playerId,
        nickname: slot.nickname || "Player",
        animal: slot.animal || "frog",
        hat: slot.hat || "none",
      });
      const conn = roomConnections(room.code).find((c) => c.playerId === slot.playerId);
      if (conn) conns.push(conn);
    } else if (slot.kind === "bot") {
      const botId = `bot_${room.code}_${i}`;
      botSlots.push({
        slot: i,
        difficulty: slot.difficulty || "medium",
        playerId: botId,
        nickname: `Bot ${i + 1}`,
        animal: "duck",
        hat: "none",
      });
    }
  }

  const rm = startMatch(match, room.code, conns, botSlots, onFinish);
  room.runningMatch = rm;
  room.lastActivityAt = Date.now();
  return rm;
}

export function rematchVote(room: Room, playerId: string, vote: boolean) {
  if (!room.runningMatch?.ended) return;
  if (vote) room.rematchVotes.add(playerId);
  else room.rematchVotes.delete(playerId);
  const humans = room.slots.filter((s) => s.kind === "human").length;
  if (room.rematchVotes.size >= Math.ceil(humans / 2)) {
    // restart same room
    room.runningMatch = undefined;
    room.slots.forEach((s) => (s.ready = s.kind === "bot" || s.kind === "closed"));
    broadcastLobby(room);
  }
}

export function gcRooms(now: number) {
  for (const [code, room] of rooms) {
    if (now - room.lastActivityAt > CONFIG.ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
    }
  }
}

function fillBotSlots(room: Room) {
  for (const slot of room.slots) {
    if (slot.slot === 0) continue;
    if (slot.kind === "closed" || slot.kind === "bot") {
      slot.kind = "bot";
      slot.difficulty = slot.difficulty || "medium";
    }
  }
}

export function broadcastLobby(room: Room) {
  const hostSlot = room.slots[0];
  const msg: ServerMsg = {
    type: "lobby_state",
    code: room.code,
    name: room.name,
    host: hostSlot.nickname || "?",
    mode: room.mode,
    slots: room.slots.map((s) => ({ ...s })),
    started: !!room.runningMatch,
  };
  broadcastToRoom(room.code, msg);
}

export function roomHasPlayer(room: Room, playerId: string): boolean {
  return room.slots.some((s) => s.playerId === playerId);
}

export function getAllRunningMatches(): RunningMatch[] {
  return [...rooms.values()].map((r) => r.runningMatch).filter(Boolean) as RunningMatch[];
}

export function assignRandomBotNames(): string[] {
  const names = ["SoggyBot", "WetBot", "SplashBot", "DrippyBot", "PuddleBot"];
  return names;
}
