/**
 * Shared server context — the single object wired through rooms, matchmaker,
 * matches and the request handlers. Fields are assigned in index.ts to break
 * the construction cycle (rooms/mm reference ctx and vice versa).
 */

import type { Client } from './net';
import type { Queries } from './db/queries';
import type { RoomManager } from './roomManager';
import type { Matchmaker } from './matchmaker';

export class ServerContext {
  q: Queries;
  clients = new Set<Client>();
  byId = new Map<string, Client>(); // playerId -> live client
  tick = 0; // global server tick counter (monotonic)
  rooms!: RoomManager;
  mm!: Matchmaker;

  constructor(q: Queries) {
    this.q = q;
  }

  wallClock(): number {
    return Date.now();
  }
}
