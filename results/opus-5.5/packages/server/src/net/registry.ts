// Live sessions: every open socket (for pings / timeouts) and the current session of each player
// (the Outbox the rest of the server sends through).
import type { S2C } from '@splash/shared';
import { CLOSE_TIMEOUT, type Session } from '../session';
import type { Outbox } from './outbox';

export class SessionRegistry implements Outbox {
  private readonly sockets = new Set<Session>();
  private readonly byPlayer = new Map<string, Session>();

  /** Players with a live, identified session. */
  get playerCount(): number {
    return this.byPlayer.size;
  }

  add(session: Session): void {
    this.sockets.add(session);
  }

  /**
   * Forgets a closed socket. Returns true when it was its player's current session (so the
   * player really went offline), false for superseded or anonymous sessions.
   */
  remove(session: Session): boolean {
    this.sockets.delete(session);
    if (!session.playerId || this.byPlayer.get(session.playerId) !== session) return false;
    this.byPlayer.delete(session.playerId);
    return true;
  }

  sessionOf(playerId: string): Session | undefined {
    return this.byPlayer.get(playerId);
  }

  /** Makes `session` the player's current session; returns the one it replaces, if any. */
  bind(playerId: string, session: Session): Session | undefined {
    const previous = this.byPlayer.get(playerId);
    this.byPlayer.set(playerId, session);
    return previous === session ? undefined : previous;
  }

  send(playerId: string, msg: S2C): void {
    this.byPlayer.get(playerId)?.send(msg);
  }

  rtt(playerId: string): number {
    return this.byPlayer.get(playerId)?.rtt ?? -1;
  }

  /** Pings every identified socket when due; drops silent ones and sockets that never said hello. */
  tick(now: number): void {
    for (const session of this.sockets) {
      const verdict = session.keepAlive(now);
      if (verdict === 'no_hello') session.close(CLOSE_TIMEOUT, 'No hello received');
      else if (verdict === 'silent') session.dropSilent();
    }
  }

  closeAll(code: number, reason: string): void {
    for (const session of this.sockets) session.close(code, reason);
  }
}
