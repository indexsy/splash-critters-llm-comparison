import { encodeMsg, decodeMsg } from '@shared/protocol.js';
import type { ClientMsg, ServerMsg } from '@shared/protocol.js';

export class NetClient {
  private ws: WebSocket | null = null;
  private messageHandlers: ((msg: ServerMsg) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private token = '';
  private url = '';
  private _ping = 0;
  private _clockOffset = 0;
  private _connected = false;
  private reconnectAttempts = 0;
  private lastPingTime = 0;
  private pingHistory: number[] = [];

  ping = 0;
  clockOffset = 0;
  connected = false;

  connect(token: string): void {
    this.token = token;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${wsProtocol}//${window.location.host}/ws`;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.ws) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.send({ type: 'hello', token: this.token });
    };

    this.ws.onmessage = (event) => {
      const msg = decodeMsg(event.data);
      if (!msg) return;

      if (msg.type === 'welcome') {
        this._connected = true;
        this.connected = true;
        this.reconnectAttempts = 0;
      }

      if (msg.type === 'ping') {
        this.handlePing(msg.t);
      }

      // On client we only expect server messages
      for (const handler of this.messageHandlers) {
        handler(msg as ServerMsg);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this._connected = false;
      this.connected = false;
      for (const handler of this.closeHandlers) {
        handler();
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Connection error; onclose will fire next
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMsg(msg));
    }
  }

  onMessage(handler: (msg: ServerMsg) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  private handlePing(serverTime: number): void {
    const now = Date.now();
    this.send({ type: 'pong', t: serverTime });

    if (this.lastPingTime > 0) {
      const interval = now - this.lastPingTime;
      const excess = Math.max(0, interval - 2000);
      this.pingHistory.push(excess);
      if (this.pingHistory.length > 10) this.pingHistory.shift();
      this._ping = Math.round(
        this.pingHistory.reduce((a, b) => a + b, 0) / this.pingHistory.length
      );
      this.ping = this._ping;
    }
    this.lastPingTime = now;

    this._clockOffset = serverTime - now + this._ping / 2;
    this.clockOffset = this._clockOffset;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this._connected) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }
}
