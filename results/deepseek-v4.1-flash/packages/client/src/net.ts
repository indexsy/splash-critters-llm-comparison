import type {
  AnimalId,
  ClientMessage,
  CreateRoomOptions,
  Difficulty,
  Dir,
  GameMode,
  HatId,
  ServerMessage,
} from "@splash/shared";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface NetHandlers {
  onStatus(status: ConnectionStatus): void;
  onMessage(message: ServerMessage): void;
  onOpen(): void;
}

export class NetClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private manualClose = false;
  token = "";
  lagMs = 0;

  constructor(private readonly handlers: NetHandlers) {}

  get status(): ConnectionStatus {
    if (!this.socket) return "idle";
    if (this.socket.readyState === WebSocket.OPEN) return "open";
    if (this.socket.readyState === WebSocket.CONNECTING) return this.attempts > 0 ? "reconnecting" : "connecting";
    return "closed";
  }

  connect(token: string): void {
    this.token = token;
    this.manualClose = false;
    this.open();
  }

  private open(): void {
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.handlers.onStatus(this.attempts > 0 ? "reconnecting" : "connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (this.lagMs > 0) params.set("lag", String(this.lagMs));
    const query = params.toString();
    const url = `${protocol}//${location.host}/ws${query ? `?${query}` : ""}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus("open");
      this.send({ t: "hello", token: this.token || undefined });
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object" || !("t" in parsed)) return;
      this.handlers.onMessage(parsed as ServerMessage);
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.manualClose) {
        this.handlers.onStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    this.handlers.onStatus("reconnecting");
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(8000, 500 * 2 ** Math.min(this.attempts, 5));
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  setLatency(ms: number): void {
    this.lagMs = Math.max(0, Math.min(1000, Math.round(ms)));
    if (this.socket) {
      this.attempts = 0;
      this.open();
    }
  }

  queueJoin(mode: GameMode): void {
    this.send({ t: "queue_join", mode });
  }

  queueLeave(): void {
    this.send({ t: "queue_leave" });
  }

  createRoom(opts: CreateRoomOptions): void {
    this.send({ t: "create_room", opts });
  }

  joinRoom(code: string): void {
    this.send({ t: "join_room", code: code.trim().toUpperCase() });
  }

  requestRoomList(): void {
    this.send({ t: "room_list_request" });
  }

  leaveRoom(): void {
    this.send({ t: "leave_room" });
  }

  setSlot(slot: number, kind: "empty" | "bot", difficulty?: Difficulty): void {
    this.send({ t: "set_slot", slot, kind, difficulty });
  }

  setReady(ready: boolean): void {
    this.send({ t: "set_ready", ready });
  }

  startMatch(): void {
    this.send({ t: "start_match" });
  }

  input(input: { seq: number; tick: number; dir: Dir; balloonPressed: boolean }): void {
    this.send({ t: "input", ...input });
  }

  emote(id: number): void {
    this.send({ t: "emote", id });
  }

  rematchVote(): void {
    this.send({ t: "rematch_vote" });
  }

  pong(sentAt: number): void {
    this.send({ t: "pong", sentAt });
  }

  setNickname(nickname: string): void {
    this.send({ t: "set_nickname", nickname });
  }

  setCosmetics(animal: AnimalId, hat: HatId): void {
    this.send({ t: "set_cosmetics", animal, hat });
  }

  tutorialComplete(): void {
    this.send({ t: "tutorial_complete" });
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus("closed");
  }
}
