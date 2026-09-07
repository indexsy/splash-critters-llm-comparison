import {
  CONFIG,
  type ClientMessage,
  type Profile,
  type ServerMessage,
} from "@splash/shared";
import { WebSocket, type RawData } from "ws";

export interface Peer {
  ws: WebSocket;
  id: string | null;
  profile: Profile | null;
  roomCode: string | null;
  queue: "duel" | "ffa" | null;
  messages: number;
  windowAt: number;
  lastSeen: number;
  lastEmote: number;
  rtt: number;
  pingSent: number;
  lastSeq: number;
  listSubscribed: boolean;
  listMode?: "duel" | "ffa";
}
export function send(peer: Peer, message: ServerMessage): void {
  if (peer.ws.readyState !== WebSocket.OPEN) return;
  if (peer.ws.bufferedAmount > 1024 * 1024) {
    peer.ws.close(1013, "Connection is too slow");
    return;
  }
  peer.ws.send(JSON.stringify(message));
}
export function error(peer: Peer, msg: string, code = "INVALID_ACTION"): void {
  send(peer, { type: "error", code, msg });
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): boolean =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const oneOf = (v: unknown, choices: readonly unknown[]): boolean =>
  choices.includes(v);
export function parseMessage(raw: RawData): ClientMessage | null {
  const data = Array.isArray(raw)
    ? Buffer.concat(raw)
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : raw;
  if (data.byteLength > CONFIG.MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (!isObject(value) || typeof value.type !== "string") return null;
  const v = value;
  let valid = false;
  switch (v.type) {
    case "hello":
      valid =
        v.token === undefined ||
        (typeof v.token === "string" && v.token.length <= 64);
      break;
    case "set_nickname":
      valid = typeof v.nickname === "string" && v.nickname.length <= 32;
      break;
    case "queue_join":
      valid = oneOf(v.mode, ["duel", "ffa"]);
      break;
    case "room_list_request":
      valid = v.mode === undefined || oneOf(v.mode, ["duel", "ffa"]);
      break;
    case "join_room":
      valid = typeof v.code === "string" && /^[A-Z0-9]{6}$/i.test(v.code);
      break;
    case "set_slot":
      valid =
        integer(v.slot, 0, 3) &&
        oneOf(v.kind, ["open", "bot"]) &&
        (v.difficulty === undefined ||
          oneOf(v.difficulty, ["easy", "medium", "hard"]));
      break;
    case "set_ready":
      valid = typeof v.ready === "boolean";
      break;
    case "input":
      valid =
        integer(v.seq, 0, 2147483647) &&
        integer(v.tick, 0, 2147483647) &&
        oneOf(v.dir, ["none", "up", "down", "left", "right"]) &&
        typeof v.balloonPressed === "boolean" &&
        Object.keys(v).every((k) =>
          ["type", "seq", "tick", "dir", "balloonPressed"].includes(k),
        );
      break;
    case "emote":
      valid = integer(v.id, 0, 3);
      break;
    case "pong":
      valid = typeof v.t === "number" && Number.isFinite(v.t);
      break;
    case "equip":
      valid =
        CONFIG.ANIMALS.some((a) => a.id === v.animal) &&
        CONFIG.HATS.some((h) => h.id === v.hat);
      break;
    case "create_room": {
      const o = v.opts;
      valid =
        isObject(o) &&
        typeof o.name === "string" &&
        o.name.trim().length >= 1 &&
        o.name.length <= 32 &&
        oneOf(o.mode, ["duel", "ffa"]) &&
        typeof o.isPublic === "boolean" &&
        oneOf(o.theme, ["backyard", "beach", "pool", "random"]) &&
        oneOf(o.roundsToWin, [2, 3, 5]) &&
        typeof o.botFill === "boolean" &&
        (o.practice === undefined || typeof o.practice === "boolean") &&
        (o.tutorial === undefined || typeof o.tutorial === "boolean");
      break;
    }
    case "queue_leave":
    case "leave_room":
    case "start_match":
    case "rematch_vote":
    case "tutorial_complete":
      valid = true;
      break;
  }
  return valid ? (v as unknown as ClientMessage) : null;
}
