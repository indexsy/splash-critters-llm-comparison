// Session: one per WebSocket. Holds the player identity once `hello` succeeded, the outbound
// sender (with DEV_LAG_MS), rate limiting, ping / RTT bookkeeping and the emote cooldown.
import { CONFIG, type S2C } from '@splash/shared';
import { RateLimiter, createSender, type RateVerdict, type Sender, type SocketLike } from './net';

/** A socket that has not said hello within this long is closed. */
const HELLO_TIMEOUT_MS = 10_000;
/**
 * A player not heard from for this long (three missed pings plus slack, on top of any DEV_LAG_MS
 * delaying our pings) is considered gone: a half-open TCP connection never reports its close.
 */
const HEARTBEAT_TIMEOUT_MS = CONFIG.PING_INTERVAL_MS * 3 + 1_000;
/** Minimum spacing of rate_limited / bad_message errors sent back to one socket. */
const ERROR_NOTICE_INTERVAL_MS = 1000;
/** Close codes. */
export const CLOSE_POLICY = 1008;
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_TRY_AGAIN = 1013;
export const CLOSE_REPLACED = 4000;
export const CLOSE_TIMEOUT = 4001;

let nextSessionId = 1;

export class Session {
  readonly id = nextSessionId++;
  playerId: string | null = null;
  /** Set when a newer socket took over this player: closing this one must not touch rooms/queues. */
  superseded = false;
  rtt = -1;
  private readonly sender: Sender;
  private readonly limiter: RateLimiter;
  private readonly openedAt: number;
  private readonly silenceLimitMs: number;
  private lastHeardAt: number;
  /** Set when the socket was dropped for silence: the player was really gone since then. */
  private silentSince: number | null = null;
  private nextPingAt = 0;
  private emoteReadyAt = 0;
  private lastNoticeAt = -Infinity;

  constructor(
    private readonly socket: SocketLike,
    now: number,
    lagMs: number,
    /** Client address the per-address limits count against (null: not limited). */
    readonly address: string | null = null,
  ) {
    this.sender = createSender(socket, lagMs);
    this.limiter = new RateLimiter(now);
    this.openedAt = now;
    this.silenceLimitMs = HEARTBEAT_TIMEOUT_MS + lagMs;
    this.lastHeardAt = now;
  }

  /** When the player was last there: the last message of a socket dropped for silence, else `now`. */
  goneSince(now: number): number {
    return this.silentSince ?? now;
  }

  send(msg: S2C): void {
    this.sender.send(msg);
  }

  /** Closes after any (lag-delayed) messages already sent, so e.g. bad_version always arrives. */
  close(code: number, reason: string): void {
    this.sender.close(code, reason);
  }

  /** Marks the handshake done: pings start right away (fast first RTT). */
  identify(playerId: string, now: number): void {
    this.playerId = playerId;
    this.lastHeardAt = now;
    this.nextPingAt = now;
  }

  /** Accounts for one inbound message (rate limit) and marks the peer as alive. */
  admit(now: number): RateVerdict {
    this.lastHeardAt = now;
    return this.limiter.take(now);
  }

  /** True at most once per second: throttles error notices so a flood cannot amplify itself. */
  shouldNotify(now: number): boolean {
    if (now - this.lastNoticeAt < ERROR_NOTICE_INTERVAL_MS) return false;
    this.lastNoticeAt = now;
    return true;
  }

  /** Emote cooldown: true (and the cooldown restarts) when the player may emote now. */
  tryEmote(now: number): boolean {
    if (now < this.emoteReadyAt) return false;
    this.emoteReadyAt = now + CONFIG.EMOTE_COOLDOWN_MS;
    return true;
  }

  notePong(t: number, now: number): void {
    const rtt = now - t;
    if (rtt >= 0 && rtt <= this.silenceLimitMs) this.rtt = Math.round(rtt);
    this.lastHeardAt = now;
  }

  /** Sends a ping when due and reports sockets to drop: no hello in time, or silent (half-open). */
  keepAlive(now: number): 'ok' | 'no_hello' | 'silent' {
    if (!this.playerId) return now - this.openedAt < HELLO_TIMEOUT_MS ? 'ok' : 'no_hello';
    if (now - this.lastHeardAt > this.silenceLimitMs) return 'silent';
    if (now >= this.nextPingAt) {
      this.nextPingAt = now + CONFIG.PING_INTERVAL_MS;
      this.send({ type: 'ping', t: Math.round(now), rtt: Math.max(0, this.rtt) });
    }
    return 'ok';
  }

  /** Drops the connection at once (no close handshake): used for dead peers. */
  terminate(): void {
    this.sender.clear();
    this.socket.terminate();
  }

  /** Drops a peer that went silent; its disconnect dates back to when it was last heard. */
  dropSilent(): void {
    this.silentSince = this.lastHeardAt;
    this.terminate();
  }
}
