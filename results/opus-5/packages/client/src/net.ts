/**
 * WebSocket transport: one socket for the whole session, typed send, typed
 * subscribe, automatic reconnect with the stored device token, and a running
 * estimate of the server's current tick for prediction and interpolation.
 */

import { CONFIG, type ClientMessage, type ServerMessage } from '@splash/shared';
import { getDeviceToken, setDeviceToken } from './settings';
import { pushToast, setState } from './store';

type Handler<T extends ServerMessage['t']> = (msg: Extract<ServerMessage, { t: T }>) => void;

const handlers = new Map<string, Set<(msg: ServerMessage) => void>>();

let socket: WebSocket | null = null;
let reconnectDelay = 500;
let reconnectTimer = 0;
let closedByUs = false;

/** Server tick carried by the most recent snapshot, and when it arrived. */
let lastServerTick = 0;
let lastServerTickAt = 0;
let latencyMs = 0;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  closedByUs = false;
  const next = new WebSocket(wsUrl());
  socket = next;

  next.addEventListener('open', () => {
    reconnectDelay = 500;
    setState({ connected: true });
    send({ t: 'hello', token: getDeviceToken(), version: __APP_VERSION__ });
  });

  next.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return;
    }
    dispatch(msg);
  });

  next.addEventListener('close', () => {
    if (socket === next) socket = null;
    setState({ connected: false, ready: false });
    if (closedByUs) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });

  next.addEventListener('error', () => {
    // `close` always follows, which is where reconnection is handled.
  });
}

export function disconnect(): void {
  closedByUs = true;
  window.clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

export function send(msg: ClientMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(msg));
}

export function isOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

/** Subscribe to one message type. Returns an unsubscribe function. */
export function on<T extends ServerMessage['t']>(type: T, handler: Handler<T>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const wrapped = handler as (msg: ServerMessage) => void;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
  };
}

function dispatch(msg: ServerMessage): void {
  // A few messages are session-wide, so they are handled here rather than in a
  // screen that may not be mounted when they arrive.
  switch (msg.t) {
    case 'welcome':
      setDeviceToken(msg.token);
      setState({ ready: true, playerId: msg.playerId, profile: msg.profile });
      break;
    case 'profile_update':
      setState({ profile: msg.profile });
      break;
    case 'ping':
      send({ t: 'pong', time: msg.time });
      if (typeof msg.rtt === 'number') {
        latencyMs = msg.rtt;
        setState({ ping: Math.round(msg.rtt) });
      }
      break;
    case 'snapshot':
      lastServerTick = msg.tick;
      lastServerTickAt = performance.now();
      break;
    case 'error':
      pushToast('error', msg.msg);
      break;
    case 'notice':
      pushToast(msg.kind === 'forfeit' ? 'error' : 'info', msg.msg);
      break;
    default:
      break;
  }

  const set = handlers.get(msg.t);
  if (!set) return;
  for (const handler of [...set]) handler(msg);
}

/** Called by the game screen at round start so tick estimates do not lag. */
export function seedServerTick(tick: number): void {
  lastServerTick = tick;
  lastServerTickAt = performance.now();
}

/** Best guess at the tick the server is simulating right now. */
export function estimatedServerTick(): number {
  if (lastServerTickAt === 0) return 0;
  const elapsed = performance.now() - lastServerTickAt;
  return lastServerTick + elapsed / CONFIG.TICK_MS;
}

/**
 * The tick our inputs should be stamped with: far enough ahead that they land
 * at the server just before it needs them.
 */
export function inputTick(): number {
  const lead = Math.ceil(latencyMs / 2 / CONFIG.TICK_MS) + 1;
  return Math.round(estimatedServerTick()) + lead;
}

/** Tick the world should be drawn at, held back for smooth interpolation. */
export function renderTick(): number {
  return estimatedServerTick() - CONFIG.INTERP_DELAY_MS / CONFIG.TICK_MS;
}

export function getLatency(): number {
  return latencyMs;
}
