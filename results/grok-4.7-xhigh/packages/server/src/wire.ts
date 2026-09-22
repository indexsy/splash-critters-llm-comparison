import type { Mode, PlayerInput, ServerMsg } from '@splash/shared';
import type { WebSocket } from 'ws';
import type { Queries } from './db/queries.js';

export interface Session {
  playerId: string;
  ws: WebSocket | null;
  roomCode: string | null;
  queueMode: Mode | null;
  queueJoinedAt: number;
  rtt: number;
  lastEmote: number;
  inputQueue: PlayerInput[];
  lastDir: number;
  ackSeq: number;
  disconnectedAt: number | null;
}

export const sessions = new Map<string, Session>();
export let q: Queries;

export function setQueries(queries: Queries) {
  q = queries;
}

export function sendTo(id: string, msg: ServerMsg) {
  const s = sessions.get(id);
  if (!s?.ws || s.ws.readyState !== 1) return;
  try {
    s.ws.send(JSON.stringify(msg));
  } catch {
    /* socket closing */
  }
}

export function session(id: string): Session | undefined {
  return sessions.get(id);
}
