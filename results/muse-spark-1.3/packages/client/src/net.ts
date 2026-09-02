import type { ClientMsg, ServerMsg } from '@splash/shared';

type Handler = (m: ServerMsg) => void;

export class Net {
  ws: WebSocket | null = null;
  handlers = new Set<Handler>();
  queue: string[] = [];
  connected = false;
  pingMs = 0;
  private lastPing = 0;

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    // In dev (vite :5173) the proxy handles /ws; location.host is vite host so this works.
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      for (const q of this.queue) this.ws?.send(q);
      this.queue = [];
      const token = localStorage.getItem('sc_token') || undefined;
      this.send({ kind: 'hello', token } as ClientMsg);
    };
    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.kind === 'welcome') {
          localStorage.setItem('sc_token', (m as { token: string }).token);
        }
        if (m.kind === 'ping') {
          this.send({ kind: 'pong', t: (m as { t: number }).t } as ClientMsg);
          this.pingMs = Date.now() - (m as { t: number }).t;
          return;
        }
        for (const h of [...this.handlers]) h(m);
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => {
      this.connected = false;
      setTimeout(() => this.connect(), 1500);
    };
  }

  send(m: ClientMsg): void {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else this.queue.push(s);
  }
}

export const net = new Net();
void 0;
export function latencyFlag(): number {
  const v = Number(new URLSearchParams(location.search).get('latency') || 0);
  return isFinite(v) ? v : 0;
}
