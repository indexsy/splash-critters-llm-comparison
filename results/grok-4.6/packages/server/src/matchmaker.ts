import { CONFIG, type Mode } from "@splash/shared";
import { createRankedRoom, send, startMatch, type Client } from "./rooms.js";
import type { DbApi } from "./dbApi.js";

interface QueueEntry {
  client: Client;
  mode: Mode;
  rating: number;
  joinedAt: number;
}

const queues: Record<Mode, QueueEntry[]> = { duel: [], ffa: [] };

export function enqueue(client: Client, mode: Mode, rating: number): void {
  leaveQueue(client);
  client.queuedMode = mode;
  client.queuedAt = Date.now();
  queues[mode].push({ client, mode, rating, joinedAt: Date.now() });
}

export function leaveQueue(client: Client): void {
  if (!client.queuedMode) return;
  queues[client.queuedMode] = queues[client.queuedMode].filter((e) => e.client !== client);
  client.queuedMode = null;
}

export function tickMatchmaker(db: DbApi): void {
  for (const mode of ["duel", "ffa"] as const) {
    const need = mode === "duel" ? 2 : 4;
    const q = queues[mode];
    const now = Date.now();
    for (const e of q) {
      const elapsed = now - e.joinedAt;
      const widenSteps = Math.floor(elapsed / CONFIG.MM_WIDEN_EVERY_MS);
      const range = Math.min(CONFIG.MM_RANGE_CAP, CONFIG.MM_INITIAL_RANGE + widenSteps * CONFIG.MM_WIDEN_BY);
      const eta = Math.max(0, 8 - Math.floor(elapsed / 1000));
      send(e.client, { type: "queue_status", eta, searchRange: range, elapsed: Math.floor(elapsed / 1000), mode });
    }

    const used = new Set<Client>();
    for (let i = 0; i < q.length; i++) {
      const a = q[i]!;
      if (used.has(a.client)) continue;
      const elapsed = now - a.joinedAt;
      const widenSteps = Math.floor(elapsed / CONFIG.MM_WIDEN_EVERY_MS);
      const range = Math.min(CONFIG.MM_RANGE_CAP, CONFIG.MM_INITIAL_RANGE + widenSteps * CONFIG.MM_WIDEN_BY);
      const group = [a];
      for (let j = 0; j < q.length && group.length < need; j++) {
        if (i === j) continue;
        const b = q[j]!;
        if (used.has(b.client)) continue;
        if (Math.abs(a.rating - b.rating) <= range) group.push(b);
      }
      if (group.length === need) {
        for (const g of group) used.add(g.client);
        const clients = group.map((g) => g.client);
        const room = createRankedRoom(clients, mode);
        for (const c of clients) {
          leaveQueue(c);
          send(c, { type: "match_found", roomCode: room.code, mode, ranked: true });
        }
        startMatch(room, db);
      }
    }
    queues[mode] = q.filter((e) => !used.has(e.client));
  }
}
