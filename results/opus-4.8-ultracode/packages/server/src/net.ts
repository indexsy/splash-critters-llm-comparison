/**
 * Per-connection Client: rate limiting, held-input tracking, and typed send.
 * Never trusts client-reported positions — only dir/balloon intent.
 */

import { CONFIG, type Dir, type ServerMsg } from '@splash/shared';
import type { WebSocket } from 'ws';
import type { ProfileDTO } from '@splash/shared';
import type { Room } from './room';

export class Client {
  ws: WebSocket;
  id = ''; // playerId, set on hello
  token = '';
  profile: ProfileDTO | null = null;
  room: Room | null = null;
  slot = -1;
  connected = true;

  // held input state (dir persists; balloon is a consumed edge)
  heldDir: Dir | null = null;
  pendingBalloon = false;
  lastInputSeq = -1;

  // rate limiter (token bucket, wall-clock refill)
  private tokens: number = CONFIG.MSG_RATE_BURST;
  private lastRefill = Date.now();
  private lastRateWarn = 0;

  // ping/pong clock
  lastPongMs = Date.now();
  rttMs = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  allow(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(CONFIG.MSG_RATE_BURST, this.tokens + elapsed * CONFIG.MSG_RATE_PER_SEC);
    if (this.tokens < 1) {
      if (now - this.lastRateWarn > 1000) {
        this.lastRateWarn = now;
        this.send({ type: 'error', code: 'rate_limit', msg: 'Slow down' });
      }
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  send(msg: ServerMsg): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed mid-send */
    }
  }

  /** Build the input the sim should use this tick, consuming the balloon edge. */
  consumeInput(): { seq: number; tick: number; dir: Dir | null; balloon: boolean } {
    const balloon = this.pendingBalloon;
    this.pendingBalloon = false;
    return { seq: this.lastInputSeq, tick: 0, dir: this.heldDir, balloon };
  }

  resetInput(): void {
    this.heldDir = null;
    this.pendingBalloon = false;
  }
}
