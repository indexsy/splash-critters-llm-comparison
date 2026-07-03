import WebSocket from 'ws';
import { decodeMsg, encodeMsg } from '@splash-critters/shared';
import type { ClientMsg, ServerMsg, PlayerId, Profile } from '@splash-critters/shared';

export type AuthState = 'unauthenticated' | 'authenticated';

const PING_INTERVAL_MS = 2000;
const PONG_TIMEOUT_MS = 10000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 1000;
const RECONNECT_GRACE_MS = 15000;

export interface NetCallbacks {
  authenticate: (token: string | undefined) => { playerId: PlayerId; profile: Profile; token: string } | null;
  onMessage: (playerId: PlayerId, msg: ClientMsg) => void;
  onDisconnect: (playerId: PlayerId) => void;
  onReconnectTimeout: (playerId: PlayerId) => void;
}

export interface Connection {
  ws: WebSocket;
  ip: string;
  state: AuthState;
  playerId: PlayerId | null;
  lastPong: number;
  pingTimer: ReturnType<typeof setInterval> | null;
}

export class ConnectionManager {
  private connections = new Map<PlayerId, Connection>();
  private ipMessageCounts = new Map<string, { count: number; windowStart: number }>();
  private reconnectTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();
  private callbacks: NetCallbacks;

  constructor(callbacks: NetCallbacks) {
    this.callbacks = callbacks;
  }

  handleConnection(ws: WebSocket, ip: string): void {
    const conn: Connection = {
      ws,
      ip,
      state: 'unauthenticated',
      playerId: null,
      lastPong: Date.now(),
      pingTimer: null,
    };

    conn.pingTimer = setInterval(() => {
      this.sendPing(conn);
    }, PING_INTERVAL_MS);

    ws.on('message', (rawData) => {
      this.handleMessage(conn, rawData);
    });

    ws.on('close', () => {
      this.handleClose(conn);
    });

    ws.on('error', (err) => {
      console.error(`[ws error] ${ip}:`, err.message);
      this.handleClose(conn);
    });
  }

  private sendPing(conn: Connection): void {
    const now = Date.now();
    if (now - conn.lastPong > PONG_TIMEOUT_MS) {
      this.closeConnection(conn, 'pong timeout');
      return;
    }
    if (conn.state === 'authenticated' && conn.playerId) {
      this.sendRaw(conn.ws, { type: 'ping', t: now });
    }
  }

  private handleMessage(conn: Connection, rawData: WebSocket.RawData): void {
    if (!this.checkRateLimit(conn.ip)) {
      this.closeConnection(conn, 'rate limit exceeded');
      return;
    }

    const data = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');
    const parsed = decodeMsg(data);
    if (!parsed || !this.isValidClientMsg(parsed)) {
      return;
    }

    const msg = parsed as ClientMsg;

    if (conn.state === 'unauthenticated') {
      if (msg.type !== 'hello') {
        this.sendRaw(conn.ws, { type: 'error', code: 'NOT_AUTHENTICATED', msg: 'Send hello first' });
        return;
      }
      const token = 'token' in msg && typeof msg.token === 'string' ? msg.token : undefined;
      const result = this.callbacks.authenticate(token);
      if (!result) {
        this.sendRaw(conn.ws, { type: 'error', code: 'AUTH_FAILED', msg: 'Authentication failed' });
        return;
      }

      const existingTimer = this.reconnectTimers.get(result.playerId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.reconnectTimers.delete(result.playerId);
      }

      const existingConn = this.connections.get(result.playerId);
      if (existingConn) {
        this.closeSocket(existingConn.ws);
        this.connections.delete(result.playerId);
      }

      conn.playerId = result.playerId;
      conn.state = 'authenticated';
      this.connections.set(result.playerId, conn);
      this.sendRaw(conn.ws, { type: 'welcome', playerId: result.playerId, profile: result.profile, token: result.token });
      return;
    }

    if (!conn.playerId) {
      return;
    }

    if (msg.type === 'pong') {
      conn.lastPong = Date.now();
      this.callbacks.onMessage(conn.playerId, msg);
      return;
    }

    this.callbacks.onMessage(conn.playerId, msg);
  }

  private handleClose(conn: Connection): void {
    if (conn.pingTimer) {
      clearInterval(conn.pingTimer);
      conn.pingTimer = null;
    }

    if (conn.state === 'authenticated' && conn.playerId) {
      const playerId = conn.playerId;
      this.connections.delete(playerId);
      this.callbacks.onDisconnect(playerId);

      const timer = setTimeout(() => {
        this.reconnectTimers.delete(playerId);
        this.callbacks.onReconnectTimeout(playerId);
      }, RECONNECT_GRACE_MS);
      this.reconnectTimers.set(playerId, timer);
    }
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.ipMessageCounts.get(ip);
    if (!entry) {
      this.ipMessageCounts.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.ipMessageCounts.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return false;
    }
    return true;
  }

  private closeConnection(conn: Connection, reason: string): void {
    if (conn.state === 'authenticated' && conn.playerId) {
      this.connections.delete(conn.playerId);
      this.callbacks.onDisconnect(conn.playerId);
    }
    if (conn.pingTimer) {
      clearInterval(conn.pingTimer);
      conn.pingTimer = null;
    }
    try {
      conn.ws.close(1008, reason);
    } catch {
      // ignore
    }
  }

  private closeSocket(ws: WebSocket): void {
    try {
      ws.close(1001, 'replaced by new connection');
    } catch {
      // ignore
    }
  }

  private sendRaw(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeMsg(msg));
    }
  }

  sendTo(playerId: PlayerId, msg: ServerMsg): boolean {
    const conn = this.connections.get(playerId);
    if (!conn) return false;
    this.sendRaw(conn.ws, msg);
    return true;
  }

  broadcast(msg: ServerMsg, playerIds: PlayerId[]): void {
    for (const id of playerIds) {
      this.sendTo(id, msg);
    }
  }

  broadcastAll(msg: ServerMsg): void {
    for (const conn of this.connections.values()) {
      this.sendRaw(conn.ws, msg);
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  private isValidClientMsg(msg: unknown): boolean {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, unknown>;
    if (!('type' in m) || typeof m.type !== 'string') return false;

    switch (m.type) {
      case 'hello':
        return !('token' in m) || typeof m.token === 'string';
      case 'set_nickname':
        return typeof m.nickname === 'string';
      case 'queue_join':
        return m.mode === 'duel' || m.mode === 'ffa';
      case 'queue_leave':
        return true;
      case 'create_room':
        return typeof m.opts === 'object' && m.opts !== null;
      case 'join_room':
        return typeof m.code === 'string';
      case 'room_list_request':
        return !('filter' in m) || m.filter === 'duel' || m.filter === 'ffa';
      case 'leave_room':
        return true;
      case 'set_slot':
        return typeof m.slot === 'number' &&
          (m.kind === 'human' || m.kind === 'bot') &&
          (!('difficulty' in m) || ['easy', 'medium', 'hard'].includes(m.difficulty as string));
      case 'set_ready':
        return typeof m.ready === 'boolean';
      case 'start_match':
        return true;
      case 'input':
        return typeof m.seq === 'number' &&
          typeof m.tick === 'number' &&
          typeof m.balloonPressed === 'boolean' &&
          (!('dir' in m) || ['up', 'down', 'left', 'right'].includes(m.dir as string));
      case 'emote':
        return typeof m.id === 'number' && [1, 2, 3, 4].includes(m.id);
      case 'rematch_vote':
        return typeof m.vote === 'boolean';
      case 'pong':
        return typeof m.t === 'number';
      default:
        return false;
    }
  }
}
