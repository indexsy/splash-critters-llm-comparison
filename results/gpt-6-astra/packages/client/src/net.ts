import type { ClientMessage, ServerMessage } from "@splash/shared";

export class Network {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private storage = new URLSearchParams(location.search).has("guest")
    ? sessionStorage
    : localStorage;
  private readonly tokenKey = "splash-token";
  readonly latency = Math.max(
    0,
    Math.min(
      1000,
      Number(new URLSearchParams(location.search).get("latency")) || 0,
    ),
  );
  ping = 0;
  clockOffset = 0;
  constructor(
    private receive: (message: ServerMessage) => void,
    private status: (state: string) => void,
  ) {}
  connect(): void {
    if (this.stopped) return;
    this.status("connecting");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    );
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      let token = this.storage.getItem(this.tokenKey);
      if (!token) {
        token = crypto.randomUUID();
        this.storage.setItem(this.tokenKey, token);
      }
      this.send({ type: "hello", token });
    };
    ws.onmessage = (e) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      const dispatch = () => {
        if (ws !== this.ws) return;
        if (message.type === "welcome") {
          this.storage.setItem(this.tokenKey, message.token);
          this.status("online");
        }
        if (message.type === "ping") {
          this.ping = message.rtt ?? this.latency;
          this.clockOffset = message.t + this.ping / 2 - Date.now();
          this.send({ type: "pong", t: message.t });
        }
        this.receive(message);
      };
      if (this.latency) setTimeout(dispatch, this.latency / 2);
      else dispatch();
    };
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      if (e.code === 4001) {
        this.stopped = true;
        this.status("another-tab");
        return;
      }
      this.status("reconnecting");
      if (!this.stopped)
        setTimeout(
          () => this.connect(),
          Math.min(5000, 500 * 2 ** this.retry++),
        );
    };
    ws.onerror = () => {
      /* onclose owns reconnection and the visible status. */
    };
  }
  send(message: ClientMessage): void {
    const ws = this.ws;
    const transmit = () => {
      if (ws === this.ws && ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(message));
    };
    if (this.latency) setTimeout(transmit, this.latency / 2);
    else transmit();
  }
}
