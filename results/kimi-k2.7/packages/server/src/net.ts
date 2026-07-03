import type { ClientMsg, InputState, ServerMsg } from "@splash/shared";
import { CONFIG } from "@splash/shared";
import type { WebSocket } from "ws";

export type Connection = {
  ws: WebSocket;
  playerId: string;
  token: string;
  nickname: string;
  profile: any;
  roomCode: string | null;
  queueMode: "duel" | "ffa" | null;
  queueJoinedAt: number;
  lastMsgTime: number;
  msgCount: number;
  rateLimitWindowStart: number;
  pingSentAt: number;
  latency: number;
  inputBuffer: InputState[];
};

const conns = new Map<WebSocket, Connection>();

export function addConnection(ws: WebSocket, playerId: string, token: string, profile: any): Connection {
  const c: Connection = {
    ws,
    playerId,
    token,
    nickname: profile.nickname,
    profile,
    roomCode: null,
    queueMode: null,
    queueJoinedAt: 0,
    lastMsgTime: Date.now(),
    msgCount: 0,
    rateLimitWindowStart: Date.now(),
    pingSentAt: 0,
    latency: 50,
    inputBuffer: [],
  };
  conns.set(ws, c);
  return c;
}

export function removeConnection(ws: WebSocket) {
  conns.delete(ws);
}

export function getConnection(ws: WebSocket): Connection | undefined {
  return conns.get(ws);
}

export function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function sendToPlayer(playerId: string, msg: ServerMsg) {
  for (const c of conns.values()) {
    if (c.playerId === playerId) {
      send(c.ws, msg);
      return;
    }
  }
}

export function broadcastToRoom(roomCode: string, msg: ServerMsg, exclude?: string) {
  for (const c of conns.values()) {
    if (c.roomCode === roomCode && c.playerId !== exclude) {
      send(c.ws, msg);
    }
  }
}

export function roomConnections(roomCode: string): Connection[] {
  return [...conns.values()].filter((c) => c.roomCode === roomCode);
}

export function isRateLimited(c: Connection): boolean {
  const now = Date.now();
  if (now - c.rateLimitWindowStart >= 1000) {
    c.rateLimitWindowStart = now;
    c.msgCount = 0;
  }
  c.msgCount++;
  return c.msgCount > CONFIG.RATE_LIMIT_MSG_PER_SEC;
}

export function parseClientMsg(data: string): ClientMsg | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed.type !== "string") return null;
    return parsed as ClientMsg;
  } catch {
    return null;
  }
}

export function validateInput(input: any): InputState | null {
  if (!input || typeof input.seq !== "number" || typeof input.tick !== "number") return null;
  if (!input.dir || typeof input.dir.x !== "number" || typeof input.dir.y !== "number") return null;
  if (typeof input.balloonPressed !== "boolean") return null;
  return {
    seq: input.seq,
    tick: input.tick,
    dir: { x: input.dir.x, y: input.dir.y },
    balloonPressed: input.balloonPressed,
    kickPressed: !!input.kickPressed,
  };
}
