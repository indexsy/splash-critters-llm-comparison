/**
 * WebSocket client: connects, says hello, dispatches ServerMsg into the store +
 * screen navigation, and forwards live match messages to the active game screen.
 */

import type {
  ClientMsg,
  MatchConfig,
  MatchResult,
  ServerMsg,
  Snapshot,
  SimEvent,
} from '@splash/shared';
import { store, type ScreenName } from './store';

export interface MatchHandlers {
  onMatchStart?(config: MatchConfig): void;
  onRoundStart?(msg: Extract<ServerMsg, { type: 'round_start' }>): void;
  onSnapshot?(snap: Snapshot): void;
  onEvent?(tick: number, events: SimEvent[]): void;
  onRoundEnd?(msg: Extract<ServerMsg, { type: 'round_end' }>): void;
  onMatchEnd?(result: MatchResult): void;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 500;
  // dev-only artificial latency: add ?lag=150 to the URL to delay each hop by 150ms
  private lag = Math.max(0, Number(new URLSearchParams(location.search).get('lag')) || 0);

  navigate: (s: ScreenName) => void = () => {};
  toast: (msg: string, bad?: boolean) => void = () => {};
  handlers: MatchHandlers = {};

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      store.connected = true;
      this.send({ type: 'hello', token: store.token ?? undefined });
    };
    ws.onmessage = (ev) => {
      const handle = () => {
        try {
          this.dispatch(JSON.parse(ev.data as string) as ServerMsg);
        } catch {
          /* ignore malformed */
        }
      };
      if (this.lag) setTimeout(handle, this.lag);
      else handle();
    };
    ws.onclose = () => {
      store.connected = false;
      store.notify();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 1.6, 6000);
      this.connect();
    }, this.backoff);
  }

  send(msg: ClientMsg): void {
    const raw = JSON.stringify(msg);
    const flush = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    };
    if (this.lag) setTimeout(flush, this.lag);
    else flush();
  }

  private dispatch(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        store.profile = msg.profile;
        store.saveToken(msg.token);
        store.connected = true;
        if (store.screen === 'boot') this.navigate('title');
        store.notify();
        break;
      case 'profile':
        store.profile = msg.profile;
        store.notify();
        break;
      case 'error':
        this.toast(msg.msg, true);
        store.notify();
        break;
      case 'room_list':
        store.roomList = msg.rooms;
        store.notify();
        break;
      case 'room_created':
        this.toast(`Room ${msg.code} created`);
        break;
      case 'lobby_state':
        store.lobby = msg.lobby;
        store.queue = null;
        // Only auto-jump to the lobby for a fresh/waiting room. After a match the
        // room reports phase 'results' — stay on the results screen (it has its own
        // "Back to Lobby" button) so results aren't skipped.
        if (msg.lobby.phase === 'lobby' && store.screen !== 'game' && store.screen !== 'results') {
          this.navigate('lobby');
        }
        store.notify();
        break;
      case 'queue_status':
        store.queue = {
          mode: msg.mode,
          elapsed: msg.elapsed,
          searchRange: msg.searchRange,
          size: msg.size,
        };
        if (store.screen !== 'game' && store.screen !== 'queue') this.navigate('queue');
        store.notify();
        break;
      case 'match_found':
        this.toast('Match found!');
        break;
      case 'match_start':
        store.matchConfig = msg.config;
        store.result = null;
        store.lastXp = null;
        this.navigate('game');
        this.handlers.onMatchStart?.(msg.config);
        break;
      case 'round_start':
        store.matchTheme = msg.theme;
        this.handlers.onRoundStart?.(msg);
        break;
      case 'snapshot':
        this.handlers.onSnapshot?.(msg.snap);
        break;
      case 'event':
        this.handlers.onEvent?.(msg.tick, msg.events);
        break;
      case 'round_end':
        this.handlers.onRoundEnd?.(msg);
        break;
      case 'match_end':
        store.result = msg.result;
        this.handlers.onMatchEnd?.(msg.result);
        this.navigate('results');
        store.notify();
        break;
      case 'xp_award':
        store.lastXp = { xp: msg.xp, level: msg.level, leveledUp: msg.leveledUp, unlocked: msg.unlocked };
        store.notify();
        break;
      case 'ping':
        this.send({ type: 'pong', t: msg.t });
        break;
    }
  }
}

export const net = new NetClient();

export async function fetchLeaderboard(mode: string): Promise<void> {
  try {
    const res = await fetch(`/api/leaderboard?mode=${mode}`);
    const data = await res.json();
    store.leaderboard = data;
    store.notify();
  } catch {
    /* offline */
  }
}
