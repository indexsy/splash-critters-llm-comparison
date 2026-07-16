import type { C2S, S2C, Profile } from '@splash/shared';

export type NetHandlers = {
  onWelcome?: (playerId: string, profile: Profile, token: string) => void;
  onMessage?: (msg: S2C) => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
};

export class Net {
  ws: WebSocket | null = null;
  handlers: NetHandlers = {};
  playerId: string | null = null;
  profile: Profile | null = null;
  token: string | null = null;
  connected = false;
  rtt = 0;
  clockOffset = 0;
  private lastPingSent = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams(location.search);
    const latency = params.get('latency');
    const qs = latency ? `?latency=${latency}` : '';
    const url = `${proto}://${location.host}/ws${qs}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      this.handlers.onConnect?.();
      const token = localStorage.getItem('splash_token') ?? undefined;
      this.send({ t: 'hello', token });
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as S2C;
        this.handle(msg);
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.handlers.onDisconnect?.();
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
  }

  private handle(msg: S2C): void {
    if (msg.t === 'welcome') {
      this.playerId = msg.playerId;
      this.profile = msg.profile;
      this.token = msg.token;
      localStorage.setItem('splash_token', msg.token);
      this.handlers.onWelcome?.(msg.playerId, msg.profile, msg.token);
    }
    if (msg.t === 'profile_update') {
      this.profile = msg.profile;
    }
    if (msg.t === 'ping') {
      this.send({ t: 'pong', time: msg.time });
      const now = Date.now();
      if (this.lastPingSent) {
        this.rtt = now - this.lastPingSent;
      }
      this.lastPingSent = now;
      this.clockOffset = msg.time + this.rtt / 2 - now;
    }
    this.handlers.onMessage?.(msg);
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
