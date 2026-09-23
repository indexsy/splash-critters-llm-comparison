// Headless protocol client for the e2e flows: one real WebSocket to /ws, JSON in and out, a pong
// for every ping (like a browser tab) and "wait for the next message like this" helpers with
// timeouts. Messages nobody is waiting for are kept in an inbox (except the per-tick stream:
// snapshots, events, pings), so a flow can ask for something that already arrived.
import WebSocket from 'ws';
import { CONFIG, type C2S, type MsgOf, type S2C, type S2CType } from '@splash/shared';

export type Msg<T extends S2CType> = MsgOf<S2C, T>;
type Welcome = Msg<'welcome'>;

/** Stream messages are delivered to listeners and waiters but never buffered in the inbox. */
const STREAM_TYPES: ReadonlySet<S2CType> = new Set(['snapshot', 'event', 'ping']);
/** Default wait (wall ms) for a protocol answer: answers are immediate, whatever the clock speed. */
const DEFAULT_WAIT_MS = 5000;

interface Waiter {
  type: S2CType;
  match: (m: S2C) => boolean;
  resolve: (m: S2C) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

export class WsClient {
  /** Every message received, in order (stream messages excluded). */
  readonly log: S2C[] = [];
  readonly closed: Promise<CloseInfo>;
  closeInfo: CloseInfo | null = null;
  welcome: Welcome | null = null;
  private readonly inbox: S2C[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly listeners = new Set<(m: S2C) => void>();

  private constructor(
    readonly label: string,
    private readonly ws: WebSocket,
  ) {
    ws.on('message', (data) => this.receive(String(data)));
    this.closed = new Promise((resolve) => {
      ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        for (const w of this.waiters.splice(0)) {
          clearTimeout(w.timer);
          w.reject(new Error(`${this.label}: socket closed (${code}) while waiting for ${w.type}`));
        }
        resolve(this.closeInfo);
      });
    });
    ws.on('error', () => undefined);
  }

  static open(url: string, label: string): Promise<WsClient> {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new WsClient(label, ws)));
      ws.once('error', (err) => reject(new Error(`${label}: could not connect: ${err.message}`)));
    });
  }

  get playerId(): string {
    if (!this.welcome) throw new Error(`${this.label}: no welcome yet`);
    return this.welcome.playerId;
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** hello (optionally with a device token) -> welcome. */
  async hello(token?: string): Promise<Welcome> {
    this.send({ type: 'hello', v: CONFIG.PROTOCOL_VERSION, ...(token ? { token } : {}) });
    const reply = await this.take('welcome', undefined, DEFAULT_WAIT_MS);
    this.welcome = reply;
    return reply;
  }

  send(msg: C2S): void {
    this.sendRaw(JSON.stringify(msg));
  }

  /** Raw frame (malformed / oversized payloads for the robustness flow). */
  sendRaw(data: string): void {
    if (this.isOpen) this.ws.send(data);
  }

  /** Called with every message (stream included) as it arrives. Returns the unsubscribe. */
  onMessage(listener: (m: S2C) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The first buffered message of `type` matching `pred` (removed from the inbox), else the next
   * one to arrive. Rejects after `timeoutMs` with the recent traffic in the message.
   */
  take<T extends S2CType>(type: T, pred?: (m: Msg<T>) => boolean, timeoutMs = DEFAULT_WAIT_MS): Promise<Msg<T>> {
    const match = (m: S2C): boolean => m.type === type && (!pred || pred(m as Msg<T>));
    const i = this.inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Msg<T>);
    return this.upcoming(type, pred, timeoutMs);
  }

  /** The next message of `type` matching `pred` that arrives from now on (the inbox is ignored). */
  private upcoming<T extends S2CType>(type: T, pred?: (m: Msg<T>) => boolean, timeoutMs = DEFAULT_WAIT_MS): Promise<Msg<T>> {
    if (this.closeInfo) return Promise.reject(new Error(`${this.label}: socket already closed (${this.closeInfo.code})`));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        type,
        match: (m) => m.type === type && (!pred || pred(m as Msg<T>)),
        resolve: (m) => resolve(m as Msg<T>),
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`${this.label}: timed out after ${timeoutMs} ms waiting for ${type} (recent: ${this.recent()})`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** Buffered messages of a type (left in the inbox). */
  buffered<T extends S2CType>(type: T): Msg<T>[] {
    return this.inbox.filter((m): m is Msg<T> => m.type === type);
  }

  /** Every logged message of a type. */
  all<T extends S2CType>(type: T): Msg<T>[] {
    return this.log.filter((m): m is Msg<T> => m.type === type);
  }

  /** Clean close handshake. */
  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }

  /** Drops the TCP connection without a close handshake (a crashed tab / lost network). */
  terminate(): void {
    this.ws.terminate();
  }

  private recent(): string {
    return this.log
      .slice(-8)
      .map((m) => (m.type === 'error' ? `error:${m.code}` : m.type))
      .join(', ');
  }

  private receive(raw: string): void {
    const msg = JSON.parse(raw) as S2C;
    if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t });
    if (!STREAM_TYPES.has(msg.type)) this.log.push(msg);
    for (const listener of this.listeners) listener(msg);
    const waiter = this.waiters.find((w) => w.match(msg));
    if (waiter) {
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    } else if (!STREAM_TYPES.has(msg.type)) {
      this.inbox.push(msg);
    }
  }
}
