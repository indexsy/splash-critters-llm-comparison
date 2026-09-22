import type { ClientMsg, ServerMsg } from '@splash/shared';
import { app, lagMs, toast } from './app.js';

type Handler = (msg: ServerMsg) => void;
const handlers = new Set<Handler>();
let ws: WebSocket | null = null;
let queue: ClientMsg[] = [];
let retry: number | null = null;

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function emit(msg: ServerMsg) {
  if (msg.t === 'welcome') {
    app.profile = msg.profile;
    app.connected = true;
    localStorage.setItem('splash_token', msg.token);
  } else if (msg.t === 'profile') app.profile = msg.profile;
  else if (msg.t === 'match_start') {
    app.match = msg;
    app.xpAtStart = app.profile?.xp ?? 0;
    app.round = null;
    app.result = null;
  } else if (msg.t === 'round_start') app.round = msg;
  else if (msg.t === 'snapshot') app.snap = msg;
  else if (msg.t === 'lobby_state') app.lobby = msg.room;
  else if (msg.t === 'room_created') app.lobby = msg.room;
  else if (msg.t === 'match_end') app.result = msg;
  else if (msg.t === 'ping') app.rtt = msg.rtt;
  else if (msg.t === 'error') toast(msg.msg);
  for (const fn of handlers) fn(msg);
}

export const net = {
  on(fn: Handler) {
    handlers.add(fn);
    return () => handlers.delete(fn);
  },
  send(msg: ClientMsg) {
    const lag = lagMs();
    const go = () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else queue.push(msg);
    };
    if (lag > 0) setTimeout(go, lag);
    else go();
  },
  connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(url());
    ws.onopen = () => {
      app.connected = true;
      const token = localStorage.getItem('splash_token') || undefined;
      ws?.send(JSON.stringify({ t: 'hello', token }));
      for (const m of queue) ws?.send(JSON.stringify(m));
      queue = [];
    };
    ws.onmessage = (ev) => {
      const deliver = () => {
        try { emit(JSON.parse(String(ev.data)) as ServerMsg); } catch { /* ignore */ }
      };
      const lag = lagMs();
      if (lag > 0) setTimeout(deliver, lag);
      else deliver();
    };
    ws.onclose = () => {
      app.connected = false;
      ws = null;
      if (retry) clearTimeout(retry);
      retry = window.setTimeout(() => net.connect(), 1000);
    };
  },
};
