// The one way server modules talk to players: messages are addressed by player id and silently
// dropped when that player has no live socket (the session registry implements this).
import type { S2C } from '@splash/shared';

export interface Outbox {
  send(playerId: string, msg: S2C): void;
  /** Last measured round-trip time in ms; -1 when unknown or offline. */
  rtt(playerId: string): number;
}
