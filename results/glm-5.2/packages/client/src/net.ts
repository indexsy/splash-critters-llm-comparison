// net.ts — WebSocket client. Reconnect, JSON protocol, typed send/recv.
import type { ClientMsg, ServerMsg } from "@splash/shared";

export class Net {
  ws: WebSocket | null = null;
  url: string;
  handlers = new Map<string, ((msg: any) => void)[]>();
  onOpen?: () => void;
  onClose?: () => void;
  token: string | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onclose = () => {
      this.onClose?.();
      // auto-reconnect after 1.5s
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        const hs = this.handlers.get(msg.t);
        if (hs) for (const h of hs) h(msg);
        const all = this.handlers.get("*");
        if (all) for (const h of all) h(msg);
      } catch {
        /* ignore */
      }
    };
  }

  on(t: string, h: (msg: any) => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t)!.push(h);
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

export function makeNet(): Net {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new Net(`${proto}//${location.host}/ws`);
}
