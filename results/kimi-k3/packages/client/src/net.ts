import { ClientMessage, ProfileDto, ServerMessage } from '@splash/shared';

type Handler = (msg: ServerMessage) => void;

const TOKEN_KEY = 'splash-token';

export class Net {
  ws: WebSocket | null = null;
  playerId = '';
  token = '';
  profile: ProfileDto | null = null;
  private handlers = new Map<string, Handler[]>();
  private anyHandlers: Handler[] = [];
  connected = false;
  rtt = 0;
  private pingSentAt = 0;
  private reconnectTimer: number | null = null;
  private queued: ClientMessage[] = [];

  on<T extends ServerMessage['t']>(type: T, fn: (msg: Extract<ServerMessage, { t: T }>) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as Handler);
    this.handlers.set(type, list);
    return () => {
      const l = this.handlers.get(type);
      if (!l) return;
      const i = l.indexOf(fn as Handler);
      if (i >= 0) l.splice(i, 1);
    };
  }

  onAny(fn: Handler): void {
    this.anyHandlers.push(fn);
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
      this.sendRaw({ t: 'hello', token });
      for (const m of this.queued) this.sendRaw(m);
      this.queued = [];
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.profile = msg.profile;
        localStorage.setItem(TOKEN_KEY, msg.token);
      } else if (msg.t === 'profile') {
        this.profile = msg.profile;
      } else if (msg.t === 'ping') {
        this.pingSentAt = performance.now();
        this.sendRaw({ t: 'pong', t0: msg.t0 });
        return;
      }
      const list = this.handlers.get(msg.t);
      if (list) for (const fn of list) fn(msg as never);
      for (const fn of this.anyHandlers) fn(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1000);
      }
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.sendRaw(msg);
    else if (msg.t !== 'input') this.queued.push(msg);
  }
}

export const net = new Net();
