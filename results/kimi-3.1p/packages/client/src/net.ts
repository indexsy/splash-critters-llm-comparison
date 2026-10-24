import type { ClientMessage, ServerMessage } from "@splash/shared";

export class SplashNet {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private clockOffset = 0;
  private offsetReady = false;
  private readonly latency: number;
  connected = false;

  constructor(private readonly onMessage: (message: ServerMessage) => void, private readonly onConnection: (connected: boolean) => void) {
    const requested = Number(new URLSearchParams(location.search).get("latency") ?? 0);
    this.latency = Number.isFinite(requested) ? Math.max(0, Math.min(1000, requested)) : 0;
  }

  connect(): void {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.onConnection(true);
      const token = localStorage.getItem("splash-device-token") ?? crypto.randomUUID();
      localStorage.setItem("splash-device-token", token);
      this.send({ type: "hello", token });
    });
    this.socket.addEventListener("message", (event) => {
      const process = () => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === "ping") {
            this.updateOffset(message.t);
            this.send({ type: "pong", t: message.t });
          }
          if (message.type === "snapshot") this.updateOffset(message.serverTime);
          this.onMessage(message);
        } catch {
          this.onMessage({ type: "error", code: "BAD_SERVER_MESSAGE", msg: "Invalid server message" });
        }
      };
      if (this.latency > 0) window.setTimeout(process, this.latency / 2);
      else process();
    });
    this.socket.addEventListener("close", () => {
      this.connected = false;
      this.onConnection(false);
      if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1000);
    });
    this.socket.addEventListener("error", () => {
      this.connected = false;
      this.onConnection(false);
    });
  }

  private updateOffset(serverTime: number): void {
    const offset = serverTime - Date.now();
    this.clockOffset = this.offsetReady ? this.clockOffset * 0.85 + offset * 0.15 : offset;
    this.offsetReady = true;
  }

  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  send(message: ClientMessage): void {
    const send = () => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    };
    if (this.latency > 0) window.setTimeout(send, this.latency / 2);
    else send();
  }
}
