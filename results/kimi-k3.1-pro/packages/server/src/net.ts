import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { CONFIG } from "@splash/shared";
import type { Animal, ClientMessage, GameMode, Hat, PlayerInput, PlayerProfile, RoomOptions, ServerMessage } from "@splash/shared";

export interface ClientConnection {
  id: string;
  ws: WebSocket;
  accountId: string | null;
  profile: PlayerProfile | null;
  roomCode: string | null;
  queueMode: GameMode | null;
  inputBuffer: PlayerInput[];
  lastInput: PlayerInput;
  lastReceivedSeq: number;
  rateWindowStart: number;
  rateCount: number;
  lastEmoteAt: number;
  rtt: number;
  latencyMs: number;
}

export function createConnection(ws: WebSocket, latencyMs: number): ClientConnection {
  return {
    id: randomUUID(),
    ws,
    accountId: null,
    profile: null,
    roomCode: null,
    queueMode: null,
    inputBuffer: [],
    lastInput: { seq: 0, dir: "none", balloonPressed: false },
    lastReceivedSeq: 0,
    rateWindowStart: Date.now(),
    rateCount: 0,
    lastEmoteAt: 0,
    rtt: 0,
    latencyMs
  };
}

export function sendMessage(client: ClientConnection, message: ServerMessage): void {
  const send = () => {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
  };
  if (client.latencyMs > 0) setTimeout(send, client.latencyMs);
  else send();
}

export function sendError(client: ClientConnection, code: string, msg: string): void {
  sendMessage(client, { type: "error", code, msg });
}

export function allowMessage(client: ClientConnection): boolean {
  const now = Date.now();
  if (now - client.rateWindowStart >= 1000) {
    client.rateWindowStart = now;
    client.rateCount = 0;
  }
  client.rateCount += 1;
  return client.rateCount <= CONFIG.RATE_LIMIT_MESSAGES_PER_SECOND;
}

const DIRECTIONS = new Set(["none", "up", "down", "left", "right"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const THEMES = new Set(["backyard", "beach", "pool", "random"]);
const MODES = new Set(["duel", "ffa"]);
const ANIMALS = new Set(Object.keys(CONFIG.UNLOCKS.animals));
const HATS = new Set(Object.keys(CONFIG.UNLOCKS.hats));
const PROFANITY = ["asshole", "bitch", "cunt", "dickhead", "fuck", "motherfucker", "nigger", "shit", "slut", "whore"];

export function nicknameProblem(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (trimmed.length < CONFIG.NICKNAME_MIN || trimmed.length > CONFIG.NICKNAME_MAX) return "Nickname must be 3–16 characters";
  if (!/^[\p{L}\p{N} _-]+$/u.test(trimmed)) return "Use letters, numbers, spaces, _ or -";
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/[013457@$]/g, (character) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" })[character] ?? character);
  if (PROFANITY.some((word) => normalized.includes(word))) return "That nickname is not allowed";
  return null;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validOptions(value: unknown): boolean {
  if (!object(value)) return false;
  return typeof value.name === "string" && value.name.trim().length >= 1 && value.name.length <= 24 &&
    (value.maxPlayers === 2 || value.maxPlayers === 4) && typeof value.public === "boolean" &&
    typeof value.theme === "string" && THEMES.has(value.theme) &&
    (value.roundsToWin === 2 || value.roundsToWin === 3 || value.roundsToWin === 5) && typeof value.botFill === "boolean";
}

export function parseClientMessage(raw: WebSocket.RawData): ClientMessage | null {
  if (typeof raw !== "string" && !Buffer.isBuffer(raw)) return null;
  const text = raw.toString();
  if (text.length > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!object(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "hello":
      return value.token === undefined || typeof value.token === "string" ? { type: "hello", token: value.token as string | undefined } : null;
    case "set_nickname":
      return typeof value.nickname === "string" ? { type: "set_nickname", nickname: value.nickname } : null;
    case "set_cosmetics":
      return typeof value.animal === "string" && ANIMALS.has(value.animal) && typeof value.hat === "string" && HATS.has(value.hat) ? { type: "set_cosmetics", animal: value.animal as Animal, hat: value.hat as Hat } : null;
    case "queue_join":
      return typeof value.mode === "string" && MODES.has(value.mode) ? { type: "queue_join", mode: value.mode as GameMode } : null;
    case "queue_leave":
    case "room_list_request":
      if (value.type === "room_list_request") {
        return value.filter === undefined || value.filter === "all" || (typeof value.filter === "string" && MODES.has(value.filter)) ? { type: "room_list_request", filter: value.filter as GameMode | "all" | undefined } : null;
      }
      return { type: "queue_leave" };
    case "create_room":
      return validOptions(value.opts) ? { type: "create_room", opts: value.opts as unknown as RoomOptions } : null;
    case "join_room":
      return typeof value.code === "string" && /^[A-Z0-9]{6}$/i.test(value.code) ? { type: "join_room", code: value.code.toUpperCase() } : null;
    case "leave_room":
    case "start_match":
    case "tutorial_start":
      return { type: value.type };
    case "set_slot":
      return Number.isInteger(value.slot) && (value.kind === "open" || value.kind === "bot") && (value.difficulty === undefined || (typeof value.difficulty === "string" && DIFFICULTIES.has(value.difficulty))) ? { type: "set_slot", slot: value.slot as number, kind: value.kind, difficulty: value.difficulty as "easy" | "medium" | "hard" | undefined } : null;
    case "set_ready":
      return value.ready === undefined || typeof value.ready === "boolean" ? { type: "set_ready", ready: value.ready as boolean | undefined } : null;
    case "practice_start":
      return typeof value.difficulty === "string" && DIFFICULTIES.has(value.difficulty) ? { type: "practice_start", difficulty: value.difficulty as "easy" | "medium" | "hard" } : null;
    case "input":
      return Number.isSafeInteger(value.seq) && (value.seq as number) > 0 && Number.isSafeInteger(value.tick) && (value.tick as number) >= 0 && typeof value.dir === "string" && DIRECTIONS.has(value.dir) && typeof value.balloonPressed === "boolean" ? { type: "input", seq: value.seq as number, tick: value.tick as number, dir: value.dir as PlayerInput["dir"], balloonPressed: value.balloonPressed } : null;
    case "emote":
      return Number.isInteger(value.id) && (value.id as number) >= 1 && (value.id as number) <= 4 ? { type: "emote", id: value.id as number } : null;
    case "rematch_vote":
      return value.vote === undefined || typeof value.vote === "boolean" ? { type: "rematch_vote", vote: value.vote as boolean | undefined } : null;
    case "pong":
      return typeof value.t === "number" && Number.isFinite(value.t) ? { type: "pong", t: value.t } : null;
    default:
      return null;
  }
}
