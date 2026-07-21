import type { ClientMessage, LobbyView, Profile, ServerMessage } from "@splash/shared";

const TOKEN_KEY = "splash.token.v1";
const NICK_KEY = "splash.nick.v1";

export type ConnectionStatus = "idle" | "connecting" | "online" | "reconnecting" | "offline";

export interface NetListeners {
  onStatus?: (status: ConnectionStatus) => void;
  onWelcome?: (playerId: string, profile: Profile, token: string) => void;
  onProfile?: (profile: Profile) => void;
  onError?: (code: string, msg: string) => void;
  onLobby?: (lobby: LobbyView) => void;
  onQueueStatus?: (eta: number, searchRange: number, elapsed: number) => void;
  onMatchFound?: (roomCode: string) => void;
  onRoomCreated?: (code: string) => void;
  onRoomList?: (rooms: RoomSummaryLike[]) => void;
  onMessage?: (msg: ServerMessage) => void;
  onPing?: (rtt: number) => void;
}

export interface RoomSummaryLike {
  code: string;
  name: string;
  mode: "duel" | "ffa";
  players: number;
  maxPlayers: number;
  theme: string;
  host: string;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  nickname?: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
  animal: string;
  hat: string;
  tier?: string;
  winrate?: number;
}

export interface LeaderboardResponse {
  scope: string;
  mode: string;
  entries: LeaderboardEntry[];
}

export class Net {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Set<NetListeners>();
  private status: ConnectionStatus = "idle";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastPingSent = 0;
  public profile: Profile | null = null;
  public playerId: string | null = null;
  private helloSent = false;
  private disposed = false;
  private readonly artificialLatency = Math.max(0, Number(new URLSearchParams(window.location.search).get("latency") ?? import.meta.env.VITE_ARTIFICIAL_LATENCY_MS ?? 0));

  constructor(url = "/ws") {
    this.url = url;
  }

  add(l: NetListeners): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const l of this.listeners) l.onStatus?.(s);
  }

  getStatus(): ConnectionStatus { return this.status; }

  connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus(this.reconnectAttempts === 0 ? "connecting" : "reconnecting");
    const full = new URL(this.url, window.location.href);
    full.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      this.ws = new WebSocket(full.toString());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("open", () => this.handleOpen());
    this.ws.addEventListener("message", (e) => {
      if (this.artificialLatency > 0) window.setTimeout(() => this.handleMessage(e), this.artificialLatency);
      else this.handleMessage(e);
    });
    this.ws.addEventListener("close", () => this.handleClose());
    this.ws.addEventListener("error", () => { try { this.ws?.close(); } catch { /* noop */ } });
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.setStatus("online");
    this.helloSent = false;
    this.sendHello();
    this.startPing();
  }

  private sendHello(): void {
    if (this.helloSent) return;
    let token = this.loadToken();
    if (!token) {
      token = crypto.randomUUID();
      this.saveToken(token);
    }
    const msg: ClientMessage = { type: "hello", token };
    this.send(msg);
    this.helloSent = true;
  }

  setNickname(nick: string): void {
    try { localStorage.setItem(NICK_KEY, nick); } catch { /* ignore */ }
  }
  getNickname(): string | null {
    try { return localStorage.getItem(NICK_KEY); } catch { return null; }
  }

  loadToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  private saveToken(token: string): void {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  }
  clearToken(): void {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    this.profile = null;
    this.playerId = null;
  }

  private handleMessage(ev: MessageEvent): void {
    let data: unknown;
    try {
      data = typeof ev.data === "string" ? JSON.parse(ev.data) : JSON.parse(new TextDecoder().decode(ev.data));
    } catch {
      return;
    }
    const msg = data as ServerMessage;
    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;
    switch (msg.type) {
      case "welcome":
        this.playerId = msg.playerId;
        this.profile = msg.profile;
        this.saveToken(msg.token);
        for (const l of this.listeners) l.onWelcome?.(msg.playerId, msg.profile, msg.token);
        break;
      case "profile_updated":
        this.profile = msg.profile;
        for (const l of this.listeners) l.onProfile?.(msg.profile);
        break;
      case "lobby_state":
        for (const l of this.listeners) l.onLobby?.(msg.lobby);
        break;
      case "queue_status":
        for (const l of this.listeners) l.onQueueStatus?.(msg.eta, msg.searchRange, msg.elapsed);
        break;
      case "match_found":
        for (const l of this.listeners) l.onMatchFound?.(msg.roomCode);
        break;
      case "room_created":
        for (const l of this.listeners) l.onRoomCreated?.(msg.code);
        break;
      case "room_list":
        for (const l of this.listeners) l.onRoomList?.(msg.rooms as unknown as RoomSummaryLike[]);
        break;
      case "error":
        for (const l of this.listeners) l.onError?.(msg.code, msg.msg);
        break;
      case "ping":
        this.send({ type: "pong", t: msg.t });
        if (this.lastPingSent > 0) {
          const rtt = Math.max(0, performance.now() - this.lastPingSent);
          for (const l of this.listeners) l.onPing?.(rtt);
        }
        break;
      default:
        break;
    }
    for (const l of this.listeners) l.onMessage?.(msg);
  }

  private handleClose(): void {
    this.ws = null;
    this.stopPing();
    this.setStatus("offline");
    this.helloSent = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(15000, 500 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.lastPingSent = performance.now();
      this.send({ type: "pong", t: this.lastPingSent });
    }, 5000);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) { window.clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(msg);
      const transmit = (): void => { try { this.ws?.send(payload); } catch { /* ignore */ } };
      if (this.artificialLatency > 0) window.setTimeout(transmit, this.artificialLatency);
      else transmit();
    }
  }

  isOnline(): boolean { return this.status === "online"; }

  dispose(): void {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.listeners.clear();
  }

  async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async fetchLeaderboard(mode: "duel" | "ffa" = "duel", scope = "global"): Promise<LeaderboardResponse> {
    return this.rest<LeaderboardResponse>(`/api/leaderboard?mode=${encodeURIComponent(mode)}&scope=${encodeURIComponent(scope)}`);
  }
}
