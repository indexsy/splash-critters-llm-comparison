import type { ClientMessage, ServerMessage } from '@splash-critters/shared';

type Handler = (message: ServerMessage) => void;

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** Thin websocket wrapper with automatic reconnection and message routing. */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pending: ClientMessage[] = [];
  private reconnectTimer: number | null = null;
  private closedByUser = false;

  status: ConnectionStatus = 'offline';
  latency = 0;
  token: string | null = null;
  onStatusChange: ((status: ConnectionStatus) => void) | null = null;

  connect(token: string | null, latency = 0): void {
    this.token = token;
    this.latency = latency;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws?latency=${this.latency}`;
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.setStatus('offline');
      return;
    }
    this.ws.onopen = () => {
      this.setStatus('online');
      this.send({ t: 'hello', token: this.token ?? undefined });
      for (const msg of this.pending.splice(0)) this.send(msg);
    };
    this.ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      this.dispatch(message);
    };
    this.ws.onclose = () => {
      this.setStatus('offline');
      if (!this.closedByUser) this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      /* the close handler takes care of the reconnect */
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 1500);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }

  private dispatch(message: ServerMessage): void {
    const set = this.handlers.get(message.t);
    if (set) for (const fn of set) fn(message);
    const all = this.handlers.get('*');
    if (all) for (const fn of all) fn(message);
  }

  on(type: ServerMessage['t'] | '*', handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (message.t !== 'hello') this.pending.push(message);
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.setStatus('offline');
  }
}
