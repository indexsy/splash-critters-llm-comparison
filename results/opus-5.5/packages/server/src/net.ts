// Wire layer: decoding + validating client messages, per-socket rate limiting and the outbound
// sender (JSON encoding plus optional DEV_LAG_MS delay that preserves message order).
import { CONFIG, type C2S, type S2C } from '@splash/shared';
import { DelayLine } from './lag';
import { VALIDATORS, isC2SType } from './net/messages';
import { isRecord } from './net/validate';

export { RateLimiter, type RateVerdict } from './net/rateLimit';

/** The slice of a `ws` WebSocket the server uses (lets tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  /** Bytes queued by send() that the peer has not taken yet. */
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

/** WebSocket.OPEN. */
export const SOCKET_OPEN = 1;
/** Snapshots are skipped while this much is unsent to the peer (the next one supersedes them). */
export const SNAPSHOT_SKIP_BUFFERED_BYTES = 256 * 1024;
/** A peer this far behind is not reading its socket at all: it is dropped. */
export const SLOW_PEER_BUFFERED_BYTES = 1024 * 1024;

/** Text payload of a ws message (string, Buffer, ArrayBuffer or fragment list), or null. */
function payloadText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) return Buffer.concat(raw).toString('utf8');
  return null;
}

/**
 * Decodes and validates one client message. Returns a fresh, fully typed C2S (unknown
 * fields dropped) or null for anything malformed: oversized payloads, invalid JSON, unknown
 * types, missing / mistyped / out-of-range fields. Never throws.
 */
export function parseClientMessage(raw: unknown): C2S | null {
  const payload = payloadText(raw);
  if (payload === null || Buffer.byteLength(payload, 'utf8') > CONFIG.MAX_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string' || !isC2SType(parsed.type)) return null;
  const validate = VALIDATORS[parsed.type] as (m: Record<string, unknown>) => C2S | null;
  return validate(parsed);
}

export interface Sender {
  send(msg: S2C): void;
  /** Closes the socket once every message queued before this call went out. */
  close(code: number, reason: string): void;
  /** Drops messages still waiting in the lag line (the peer is gone). */
  clear(): void;
}

/**
 * Writes one message unless the peer is falling behind: with a backlog, snapshots are skipped
 * (state catches up with the next one); a peer that stopped reading altogether is dropped
 * instead of the server buffering its traffic forever.
 */
function deliver(socket: SocketLike, data: string, droppable: boolean): void {
  if (socket.readyState !== SOCKET_OPEN) return;
  const backlog = socket.bufferedAmount;
  if (backlog > SLOW_PEER_BUFFERED_BYTES) {
    console.warn(`[ws] dropping a peer that stopped reading (${backlog} bytes unsent)`);
    socket.terminate();
    return;
  }
  if (droppable && backlog > SNAPSHOT_SKIP_BUFFERED_BYTES) return;
  socket.send(data);
}

/** JSON sender for one socket; with `lagMs` > 0 every message is delayed that long, in order. */
export function createSender(socket: SocketLike, lagMs: number): Sender {
  const line = new DelayLine(lagMs);
  return {
    send(msg: S2C): void {
      if (socket.readyState !== SOCKET_OPEN) return;
      const data = JSON.stringify(msg);
      const droppable = msg.type === 'snapshot';
      line.push(() => deliver(socket, data, droppable));
    },
    close(code: number, reason: string): void {
      line.push(() => {
        try {
          socket.close(code, reason);
        } catch {
          socket.terminate();
        }
      });
    },
    clear: () => line.clear(),
  };
}
