import { CONFIG, type C2S, type S2C } from "@splash/shared";
import { app } from "./app.js";

// Tokens: localStorage holds the primary account; sessionStorage lets a second
// tab get its own guest account (the server mints one if the primary is
// already connected elsewhere).
const LS_TOKEN = "splash-token";
const SS_TOKEN = "splash-session-token";

export class Net {
  private ws: WebSocket | null = null;
  private reconnectDelay = 500;
  private pingTimer: number | null = null;
  private closedByUs = false;

  connect(): void {
    this.closedByUs = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectDelay = 500;
      const token = sessionStorage.getItem(SS_TOKEN) || localStorage.getItem(LS_TOKEN) || undefined;
      this.send({ t: "hello", token });
    };
    ws.onmessage = (ev) => {
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      this.dispatch(msg);
    };
    ws.onclose = () => {
      app.connected = false;
      if (this.pingTimer !== null) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.closedByUs) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private dispatch(msg: S2C): void {
    switch (msg.t) {
      case "welcome": {
        app.connected = true;
        app.profile = msg.profile;
        try {
          sessionStorage.setItem(SS_TOKEN, msg.token);
          if (!localStorage.getItem(LS_TOKEN)) localStorage.setItem(LS_TOKEN, msg.token);
        } catch {
          // storage unavailable: guest account lives for this page load only
        }
        if (this.pingTimer === null) {
          this.pingTimer = window.setInterval(
            () => this.send({ t: "pong", ts: performance.now() }),
            CONFIG.PING_INTERVAL_MS
          );
        }
        break;
      }
      case "profile_update":
        app.profile = msg.profile;
        break;
      case "ping":
        app.pingMs = Math.max(0, Math.round(performance.now() - msg.ts));
        return; // internal only
      case "error":
        app.toast(msg.msg, "#e14141");
        break;
      // Global routing: these move you between screens no matter where you
      // are (reconnects, rematches, matchmaker launches, room joins).
      case "match_start":
        if (app.screenName !== "game") {
          app.go("game", { start: msg });
          return;
        }
        break;
      case "lobby_state":
        if (app.screenName !== "lobby") {
          app.go("lobby", { state: msg });
          return;
        }
        break;
      default:
        break;
    }
    app.current?.onMessage?.(msg);
  }
}
