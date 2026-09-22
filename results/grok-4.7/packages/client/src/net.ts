import type { ClientMsg, ServerMsg } from '@splash/shared';

type Handler = (msg: ServerMsg) => void;

export class Net {
  ws: WebSocket | null = null;
  lag = 0;
  private handlers = new Set<Handler>();
  private queue: ClientMsg[] = [];
  token: string | null = localStorage.getItem('splash.token');

  constructor() {
    const lag = Number(new URLSearchParams(location.search).get('lag') || 0);
    this.lag = Number.isFinite(lag) ? Math.max(0, lag) : 0;
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', token: this.token ?? undefined });
      for (const msg of this.queue) this.send(msg);
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      const deliver = () => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.token = msg.token;
          localStorage.setItem('splash.token', msg.token);
        }
        if (msg.t === 'ping') this.send({ t: 'pong', clientTime: Date.now(), serverTime: msg.serverTime });
        for (const h of this.handlers) h(msg);
      };
      if (this.lag) setTimeout(deliver, this.lag);
      else deliver();
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 800);
    };
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    const raw = JSON.stringify(msg);
    const go = () => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(raw);
      else if (msg.t !== 'pong' && msg.t !== 'input') this.queue.push(msg);
    };
    if (this.lag && msg.t !== 'hello') setTimeout(go, this.lag);
    else go();
  }
}
