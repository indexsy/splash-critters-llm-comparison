// WebSocket client: device token + hello/welcome handshake, auto-reconnect with capped
// exponential backoff, typed message dispatch, ping/pong clock sync and the ?lag=N artificial
// latency switch (delays every inbound and outbound message by N ms, preserving order).
import { CONFIG, type C2S, type MsgOf, type S2C, type S2CType } from '@splash/shared';
import { acquireIdentitySlot } from './identity';
import { storage } from './storage';

export type NetStatus = 'connecting' | 'open' | 'closed';

type AnyHandler = (msg: S2C) => void;
type StatusHandler = (status: NetStatus) => void;

const TOKEN_KEY = 'splash.token';
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 5000;
const MAX_LAG_MS = 5000;
/** Clock-offset samples kept for the median filter. */
const CLOCK_WINDOW = 8;
/** Fraction of the gap to the filtered target applied per sample. */
const CLOCK_SMOOTHING = 0.25;
/** Gap beyond which the smoothed offset snaps instead of easing (e.g. after a resync). */
const CLOCK_SNAP_MS = 250;
/** A sample further than max(this, rtt) from the window median is an outlier. */
const CLOCK_OUTLIER_MIN_MS = 40;
/** This many consecutive outliers means the clock really moved: restart the window. */
const CLOCK_RESYNC_AFTER = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** FIFO that runs callbacks `delayMs` after they were queued, strictly in queue order. */
class DelayLine {
  private readonly queue: { due: number; run: () => void }[] = [];
  private timer = 0;

  constructor(private readonly delayMs: number) {}

  push(run: () => void): void {
    if (this.delayMs <= 0) {
      run();
      return;
    }
    this.queue.push({ due: performance.now() + this.delayMs, run });
    if (!this.timer) this.arm();
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head) return;
    this.timer = window.setTimeout(() => this.drain(), Math.max(0, head.due - performance.now()));
  }

  private drain(): void {
    this.timer = 0;
    const now = performance.now();
    while (this.queue.length > 0 && this.queue[0].due <= now) {
      const item = this.queue.shift()!;
      try {
        item.run();
      } catch (err) {
        console.error('[net] delayed task failed', err);
      }
    }
    this.arm();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Server-clock offset estimate: median-filtered samples, outlier rejection, eased updates. */
class ClockSync {
  offset = 0;
  private samples: number[] = [];
  private outliers = 0;

  add(sample: number, rtt: number): void {
    if (this.samples.length >= 3) {
      const tolerance = Math.max(CLOCK_OUTLIER_MIN_MS, rtt);
      if (Math.abs(sample - median(this.samples)) > tolerance) {
        this.outliers += 1;
        if (this.outliers < CLOCK_RESYNC_AFTER) return;
        this.samples = [];
      }
    }
    this.outliers = 0;
    const first = this.samples.length === 0;
    this.samples.push(sample);
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
    const target = median(this.samples);
    const gap = target - this.offset;
    this.offset = first || Math.abs(gap) > CLOCK_SNAP_MS ? target : this.offset + gap * CLOCK_SMOOTHING;
  }
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // crypto.randomUUID needs a secure context; plain-http LAN hosts fall back to RFC 4122 v4 by hand.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Storage key of this tab's identity slot (see identity.ts); slot 0 uses TOKEN_KEY. */
let tokenKey = TOKEN_KEY;
let identitySlot = 0;

/** The persisted device token, generated and saved on first visit (before any hello). */
function ensureToken(): string {
  const existing = storage.get(tokenKey);
  if (existing) return existing;
  const token = randomUuid();
  storage.set(tokenKey, token);
  return token;
}

function readLagMs(): number {
  const n = Number(new URLSearchParams(window.location.search).get('lag'));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_LAG_MS, Math.round(n)) : 0;
}

function socketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function parseMessage(data: unknown): S2C | null {
  if (typeof data !== 'string') return null;
  try {
    const msg = JSON.parse(data) as unknown;
    return msg && typeof msg === 'object' && typeof (msg as { type?: unknown }).type === 'string'
      ? (msg as S2C)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

const lagMs = readLagMs();
const inbound = new DelayLine(lagMs);
const outbound = new DelayLine(lagMs);
const clock = new ClockSync();
const typedHandlers = new Map<string, Set<AnyHandler>>();
const anyHandlers = new Set<AnyHandler>();
const statusHandlers = new Set<StatusHandler>();

let socket: WebSocket | null = null;
let status: NetStatus = 'closed';
let started = false;
let attempts = 0;
let reconnectTimer = 0;
let helloSentAt = 0;
let lastRtt = 0;
let playerId = '';
let outdated = false;

function setStatus(next: NetStatus): void {
  if (next === status) return;
  status = next;
  for (const fn of [...statusHandlers]) {
    try {
      fn(next);
    } catch (err) {
      console.error('[net] status handler failed', err);
    }
  }
}

function transmit(sock: WebSocket, msg: C2S): void {
  const data = JSON.stringify(msg);
  outbound.push(() => {
    if (sock.readyState === WebSocket.OPEN) sock.send(data);
  });
}

function sendHello(sock: WebSocket): void {
  helloSentAt = Date.now();
  transmit(sock, { type: 'hello', token: ensureToken(), v: CONFIG.PROTOCOL_VERSION });
}

function handleWelcome(msg: MsgOf<S2C, 'welcome'>): void {
  playerId = msg.playerId;
  storage.set(tokenKey, msg.token);
  attempts = 0;
  const handshakeRtt = Math.max(0, Date.now() - helloSentAt);
  if (lastRtt <= 0) lastRtt = handshakeRtt;
  clock.add(msg.serverTime + handshakeRtt / 2 - Date.now(), handshakeRtt);
}

function handlePing(msg: MsgOf<S2C, 'ping'>): void {
  if (socket) transmit(socket, { type: 'pong', t: msg.t });
  if (msg.rtt > 0) lastRtt = msg.rtt;
  clock.add(msg.t + lastRtt / 2 - Date.now(), lastRtt);
}

/** Built-in protocol handling that must run before any subscriber sees the message. */
function handleProtocol(msg: S2C): void {
  if (msg.type === 'welcome') handleWelcome(msg);
  else if (msg.type === 'ping') handlePing(msg);
  else if (msg.type === 'error' && msg.code === 'bad_version') outdated = true;
}

function dispatch(msg: S2C): void {
  handleProtocol(msg);
  const handlers = [...(typedHandlers.get(msg.type) ?? []), ...anyHandlers];
  for (const fn of handlers) {
    try {
      fn(msg);
    } catch (err) {
      console.error(`[net] handler for "${msg.type}" failed`, err);
    }
  }
}

function scheduleReconnect(): void {
  if (outdated || reconnectTimer) return;
  const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempts);
  const jittered = Math.min(BACKOFF_CAP_MS, backoff * (0.75 + Math.random() * 0.5));
  attempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0;
    openSocket();
  }, jittered);
}

function handleClosed(sock: WebSocket): void {
  if (socket !== sock) return;
  socket = null;
  setStatus('closed');
  scheduleReconnect();
}

function openSocket(): void {
  setStatus('connecting');
  let sock: WebSocket;
  try {
    sock = new WebSocket(socketUrl());
  } catch (err) {
    console.error('[net] cannot open socket', err);
    setStatus('closed');
    scheduleReconnect();
    return;
  }
  socket = sock;
  // Socket events travel through the inbound delay line too, so ?lag keeps them in order.
  sock.onopen = () =>
    inbound.push(() => {
      if (socket !== sock) return;
      setStatus('open');
      sendHello(sock);
    });
  sock.onmessage = (ev: MessageEvent) =>
    inbound.push(() => {
      if (socket !== sock) return;
      const msg = parseMessage(ev.data);
      if (msg) dispatch(msg);
    });
  sock.onclose = () => inbound.push(() => handleClosed(sock));
}

/** Skip the backoff wait when the browser reports the network is back. */
function reconnectNow(): void {
  if (!started || outdated || status !== 'closed') return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = 0;
  attempts = 0;
  openSocket();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const net = {
  /** Open the connection (idempotent). Reconnects automatically until the page unloads. */
  connect(): void {
    if (started) return;
    started = true;
    setStatus('connecting');
    void acquireIdentitySlot().then((identity) => {
      tokenKey = identity.storageKey;
      identitySlot = identity.slot;
      ensureToken();
      window.addEventListener('online', reconnectNow);
      openSocket();
    });
  },

  /** This tab's identity slot: 0 = the browser's main account, 1+ = extra simultaneous tabs. */
  get identitySlot(): number {
    return identitySlot;
  },

  /** Queue a message for the server. Returns false (and drops it) while the socket is not open. */
  send(msg: C2S): boolean {
    const sock = socket;
    if (!sock || status !== 'open' || sock.readyState !== WebSocket.OPEN) return false;
    transmit(sock, msg);
    return true;
  },

  on<T extends S2CType>(type: T, handler: (msg: MsgOf<S2C, T>) => void): () => void {
    let set = typedHandlers.get(type);
    if (!set) {
      set = new Set();
      typedHandlers.set(type, set);
    }
    const fn = handler as AnyHandler;
    set.add(fn);
    return () => set.delete(fn);
  },

  onAny(handler: AnyHandler): () => void {
    anyHandlers.add(handler);
    return () => anyHandlers.delete(handler);
  },

  onStatus(fn: StatusHandler): () => void {
    statusHandlers.add(fn);
    return () => statusHandlers.delete(fn);
  },

  get status(): NetStatus {
    return status;
  },

  /** Estimated server clock (ms): Date.now() + smoothed offset. */
  serverNow(): number {
    return Date.now() + clock.offset;
  },

  /** Latest round-trip time in ms (server-measured when available, else the handshake). */
  get rtt(): number {
    return lastRtt;
  },

  /** Player id from the last welcome ('' before the first one). */
  get playerId(): string {
    return playerId;
  },

  /** True after the server rejected our protocol version: a reload is required, no reconnects. */
  get outdated(): boolean {
    return outdated;
  },

  /** Artificial latency per direction from ?lag=N (0 when off). */
  get lagMs(): number {
    return lagMs;
  },
};
