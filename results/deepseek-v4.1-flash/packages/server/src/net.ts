import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AnimalId, ClientMessage, Dir, HatId, ServerMessage } from "@splash/shared";
import { ANIMALS, HATS } from "@splash/shared";

export interface ClientConnection {
  readonly id: string;
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export interface NetHandlers {
  connect(connection: ClientConnection): void;
  message(connection: ClientConnection, message: ClientMessage): void;
  disconnect(connection: ClientConnection): void;
}

interface SocketState {
  socket: WebSocket;
  connection: ClientConnection;
  tokens: number;
  lastRefill: number;
  lagMs: number;
  closed: boolean;
  recvTimers: Set<NodeJS.Timeout>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, max = 64): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function validDir(value: unknown): boolean {
  return value === "up" || value === "down" || value === "left" || value === "right" || value === "none";
}

function validateMessage(raw: unknown): { ok: true; msg: ClientMessage } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: "Message must be an object." };
  const t = raw.t;
  if (typeof t !== "string") return { ok: false, error: "Missing message type." };
  switch (t) {
    case "hello":
      if (raw.token !== undefined && !isString(raw.token, 128)) {
        return { ok: false, error: "Invalid token." };
      }
      if (raw.lagMs !== undefined && typeof raw.lagMs !== "number") {
        return { ok: false, error: "Invalid lag value." };
      }
      return { ok: true, msg: { t: "hello", token: raw.token as string | undefined } };
    case "set_nickname":
      if (!isString(raw.nickname, 32)) return { ok: false, error: "Invalid nickname." };
      return { ok: true, msg: { t: "set_nickname", nickname: raw.nickname } };
    case "queue_join":
      if (raw.mode !== "duel" && raw.mode !== "ffa") return { ok: false, error: "Invalid mode." };
      return { ok: true, msg: { t: "queue_join", mode: raw.mode } };
    case "queue_leave":
      return { ok: true, msg: { t: "queue_leave" } };
    case "create_room": {
      const opts = raw.opts;
      if (!isObject(opts)) return { ok: false, error: "Missing room options." };
      if (!isString(opts.name, 40)) return { ok: false, error: "Invalid room name." };
      if (opts.size !== 2 && opts.size !== 4) return { ok: false, error: "Invalid room size." };
      if (!isBoolean(opts.isPrivate)) return { ok: false, error: "Invalid privacy." };
      if (!["backyard", "beach", "pool", "random"].includes(String(opts.theme))) {
        return { ok: false, error: "Invalid theme." };
      }
      if (opts.roundsToWin !== 2 && opts.roundsToWin !== 3 && opts.roundsToWin !== 5) {
        return { ok: false, error: "Invalid round count." };
      }
      if (!isBoolean(opts.botFill)) return { ok: false, error: "Invalid bot fill." };
      if (opts.practice !== undefined && !isBoolean(opts.practice)) {
        return { ok: false, error: "Invalid practice flag." };
      }
      return {
        ok: true,
        msg: {
          t: "create_room",
          opts: {
            name: opts.name,
            size: opts.size,
            isPrivate: opts.isPrivate,
            theme: opts.theme as "backyard" | "beach" | "pool" | "random",
            roundsToWin: opts.roundsToWin,
            botFill: opts.botFill,
            practice: opts.practice as boolean | undefined,
          },
        },
      };
    }
    case "join_room":
      if (!isString(raw.code, 12)) return { ok: false, error: "Invalid room code." };
      return { ok: true, msg: { t: "join_room", code: raw.code } };
    case "room_list_request":
      return { ok: true, msg: { t: "room_list_request" } };
    case "leave_room":
      return { ok: true, msg: { t: "leave_room" } };
    case "set_slot":
      if (!isInt(raw.slot, 0, 3)) return { ok: false, error: "Invalid slot." };
      if (raw.kind !== "empty" && raw.kind !== "bot") return { ok: false, error: "Invalid slot kind." };
      if (
        raw.difficulty !== undefined &&
        raw.difficulty !== "easy" &&
        raw.difficulty !== "medium" &&
        raw.difficulty !== "hard"
      ) {
        return { ok: false, error: "Invalid difficulty." };
      }
      return {
        ok: true,
        msg: {
          t: "set_slot",
          slot: raw.slot,
          kind: raw.kind,
          difficulty: raw.difficulty as "easy" | "medium" | "hard" | undefined,
        },
      };
    case "set_ready":
      if (!isBoolean(raw.ready)) return { ok: false, error: "Invalid ready state." };
      return { ok: true, msg: { t: "set_ready", ready: raw.ready } };
    case "start_match":
      return { ok: true, msg: { t: "start_match" } };
    case "input":
      if (!isInt(raw.seq, 1, 10_000_000)) return { ok: false, error: "Invalid sequence." };
      if (!isInt(raw.tick, 0, 10_000_000)) return { ok: false, error: "Invalid tick." };
      if (!validDir(raw.dir)) return { ok: false, error: "Invalid direction." };
      if (!isBoolean(raw.balloonPressed)) return { ok: false, error: "Invalid balloon input." };
      return {
        ok: true,
        msg: {
          t: "input",
          seq: raw.seq,
          tick: raw.tick,
          dir: raw.dir as Dir,
          balloonPressed: raw.balloonPressed,
        },
      };
    case "emote":
      if (!isInt(raw.id, 1, 4)) return { ok: false, error: "Invalid emote." };
      return { ok: true, msg: { t: "emote", id: raw.id } };
    case "rematch_vote":
      return { ok: true, msg: { t: "rematch_vote" } };
    case "pong":
      if (typeof raw.sentAt !== "number") return { ok: false, error: "Invalid pong." };
      return { ok: true, msg: { t: "pong", sentAt: raw.sentAt } };
    case "set_cosmetics": {
      const animal = ANIMALS.some((entry) => entry.id === raw.animal);
      const hat = HATS.some((entry) => entry.id === raw.hat);
      if (!animal || !hat) return { ok: false, error: "Invalid cosmetic." };
      return {
        ok: true,
        msg: {
          t: "set_cosmetics",
          animal: raw.animal as AnimalId,
          hat: raw.hat as HatId,
        },
      };
    }
    case "tutorial_complete":
      return { ok: true, msg: { t: "tutorial_complete" } };
    default:
      return { ok: false, error: "Unknown message type." };
  }
}

export class NetServer {
  private readonly wss: WebSocketServer;
  private readonly states = new Map<WebSocket, SocketState>();
  private counter = 0;
  private readonly baseLagMs: number;
  private readonly allowClientLag: boolean;

  constructor(
    server: HttpServer,
    private readonly handlers: NetHandlers,
    options: { latencyMs?: number; allowClientLag?: boolean } = {},
  ) {
    this.baseLagMs = Math.max(0, options.latencyMs ?? 0);
    this.allowClientLag = options.allowClientLag ?? false;
    this.wss = new WebSocketServer({
      server,
      path: "/ws",
      maxPayload: 4096,
      perMessageDeflate: false,
    });
    this.wss.on("connection", (socket, request) => this.onConnection(socket, request));
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? "/ws", "http://localhost");
    const queryLag = this.allowClientLag ? Number(url.searchParams.get("lag") ?? 0) : 0;
    const lagMs = Math.min(1000, Math.max(0, Number.isFinite(queryLag) ? queryLag : 0) || this.baseLagMs);
    const state: SocketState = {
      socket,
      connection: {
        id: `conn-${++this.counter}`,
        send: (message) => this.sendLater(socket, message, lagMs / 2),
        close: (code = 1000, reason = "closed") => {
          if (state.closed) return;
          state.closed = true;
          socket.close(code, reason);
        },
      },
      tokens: 30,
      lastRefill: Date.now(),
      lagMs,
      closed: false,
      recvTimers: new Set(),
    };
    this.states.set(socket, state);
    this.handlers.connect(state.connection);
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.reject(state, "BAD_MESSAGE", "Binary messages are not supported.");
        return;
      }
      const now = Date.now();
      const elapsed = (now - state.lastRefill) / 1000;
      state.lastRefill = now;
      state.tokens = Math.min(30, state.tokens + elapsed * 60);
      if (state.tokens < 1) {
        state.connection.send({ t: "error", code: "RATE_LIMIT", msg: "Slow down." });
        state.connection.close(1008, "rate limit");
        return;
      }
      state.tokens -= 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        this.reject(state, "BAD_JSON", "Invalid JSON.");
        return;
      }
      const result = validateMessage(parsed);
      if (!result.ok) {
        this.reject(state, "BAD_MESSAGE", result.error);
        return;
      }
      const deliver = (): void => {
        if (state.closed) return;
        this.handlers.message(state.connection, result.msg);
      };
      if (lagMs > 0) {
        const timer = setTimeout(() => {
          state.recvTimers.delete(timer);
          deliver();
        }, lagMs / 2);
        state.recvTimers.add(timer);
      } else {
        deliver();
      }
    });
    socket.on("close", () => {
      for (const timer of state.recvTimers) clearTimeout(timer);
      state.recvTimers.clear();
      state.closed = true;
      this.states.delete(socket);
      this.handlers.disconnect(state.connection);
    });
    socket.on("error", () => {
      if (!state.closed) socket.terminate();
    });
  }

  private reject(state: SocketState, code: string, message: string): void {
    state.connection.send({ t: "error", code, msg: message });
  }

  private sendLater(socket: WebSocket, message: ServerMessage, delayMs: number): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (delayMs <= 0) {
      socket.send(JSON.stringify(message));
      return;
    }
    setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }, delayMs);
  }

  close(): void {
    for (const state of this.states.values()) {
      state.closed = true;
      state.socket.close(1001, "server shutdown");
    }
    this.wss.close();
  }
}
