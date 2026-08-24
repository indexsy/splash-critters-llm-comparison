import type { ClientMsg, ServerMsg } from "@sc/shared";

type Handler = (msg: ServerMsg) => void;

class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: ClientMsg[] = [];
  connected = false;
  ping = 0;

  connect(): Promise<void> {
    return new Promise((resolve) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      this.ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws.onopen = () => {
        this.connected = true;
        for (const m of this.queue) this.send(m);
        this.queue = [];
        resolve();
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMsg;
          if (msg.t === "ping") {
            this.send({ t: "pong", t1: msg.time });
            return;
          }
          for (const h of this.handlers) h(msg);
        } catch {
          // ignore malformed
        }
      };
      this.ws.onclose = () => {
        this.connected = false;
        setTimeout(() => this.connect().catch(() => {}), 1500);
      };
    });
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }
}

export const net = new Net();
