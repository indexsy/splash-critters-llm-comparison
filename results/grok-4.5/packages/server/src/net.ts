import type { WebSocket } from 'ws';
import type { C2S, S2C } from '@splash/shared';
import { CONFIG } from '@splash/shared';

export type Client = {
  ws: WebSocket;
  playerId: string | null;
  token: string | null;
  msgTimestamps: number[];
  lastPong: number;
  artificialLatency: number;
};

export function createClient(ws: WebSocket): Client {
  return {
    ws,
    playerId: null,
    token: null,
    msgTimestamps: [],
    lastPong: Date.now(),
    artificialLatency: 0,
  };
}

export function rateLimitOk(client: Client): boolean {
  const now = Date.now();
  client.msgTimestamps = client.msgTimestamps.filter((t) => now - t < 1000);
  if (client.msgTimestamps.length >= CONFIG.RATE_LIMIT_MSGS_PER_SEC) return false;
  client.msgTimestamps.push(now);
  return true;
}

export function send(client: Client, msg: S2C): void {
  if (client.ws.readyState !== 1) return;
  const data = JSON.stringify(msg);
  if (client.artificialLatency > 0) {
    setTimeout(() => {
      if (client.ws.readyState === 1) client.ws.send(data);
    }, client.artificialLatency);
  } else {
    client.ws.send(data);
  }
}

export function parseMessage(raw: string): C2S | null {
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.t !== 'string') return null;
    return msg as C2S;
  } catch {
    return null;
  }
}

export function validateInput(msg: Extract<C2S, { t: 'input' }>): boolean {
  const dirs = ['up', 'down', 'left', 'right', 'none'];
  if (!dirs.includes(msg.dir)) return false;
  if (typeof msg.seq !== 'number' || msg.seq < 0) return false;
  if (typeof msg.tick !== 'number') return false;
  if (typeof msg.balloonPressed !== 'boolean') return false;
  return true;
}
