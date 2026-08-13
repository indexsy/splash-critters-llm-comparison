import type { ClientMsg, ServerMsg } from "@splash/shared";

type Handler = (msg: ServerMsg) => void;

export class Net {
  ws: WebSocket | null = null;
  handlers = new Set<Handler>();
  lastPingAt = 0;
  pingMs = 0;
  clockOffset = 0;
  connected = false;

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => {
      this.connected = true;
      const token = localStorage.getItem("splash_token") ?? undefined;
      this.send({ type: "hello", token });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      if (msg.type === "ping") {
        this.lastPingAt = performance.now();
        this.send({ type: "pong", t: msg.t });
        this.clockOffset = Date.now() - msg.t;
        return;
      }
      if (msg.type === "welcome") {
        localStorage.setItem("splash_token", msg.token);
      }
      for (const h of this.handlers) h(msg);
    });
    this.ws.addEventListener("close", () => {
      this.connected = false;
      setTimeout(() => this.connect(), 1200);
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}

export const net = new Net();
