// What the room helper modules (presence, lobby operations) need from the RoomManager.
import type { S2C } from '@splash/shared';
import type { Room } from './room';

export type LeftReason = 'left' | 'kicked' | 'closed' | 'match_over';

export interface RoomHub {
  /** False once the room was dissolved (a finishing match can dissolve it mid-operation). */
  isOpen(room: Room): boolean;
  /** Sends every current member (connected, not forfeited) their own lobby_state. */
  pushLobby(room: Room): void;
  /** Sends a message to every current member. */
  broadcast(room: Room, msg: S2C): void;
  /** Sends a message to one player. */
  sendTo(playerId: string, msg: S2C): void;
  /** Detaches a player from the room (they are no longer a member); no message is sent. */
  release(room: Room, playerId: string): void;
  /** Removes the room; members get left_room {reason} (none when reason is null). */
  dissolve(room: Room, reason: LeftReason | null): void;
  /** Starts (or restarts) a match with the room's current seats. */
  startMatch(room: Room, now: number): void;
  /** The public room list may have changed. */
  listChanged(room: Room): void;
}
