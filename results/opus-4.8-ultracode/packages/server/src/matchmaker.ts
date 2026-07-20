/**
 * Ranked matchmaker. Separate queues per mode, humans only. Ticks every 2s,
 * matches within a rating window that widens with wait time, and spins up a
 * hidden ranked room when a full group forms.
 */

import { CONFIG, type Mode } from '@splash/shared';
import type { ServerContext } from './context';
import type { Client } from './net';
import { clamp } from './util';

interface QueueEntry {
  client: Client;
  rating: number;
  joinedAt: number;
}

export class Matchmaker {
  private ctx: ServerContext;
  private queues: Record<Mode, QueueEntry[]> = { duel: [], ffa: [] };

  constructor(ctx: ServerContext) {
    this.ctx = ctx;
  }

  private ratingFor(client: Client, mode: Mode): number {
    return client.profile?.ratings.find((r) => r.mode === mode)?.rating ?? CONFIG.ELO_START;
  }

  inQueue(client: Client): boolean {
    return (['duel', 'ffa'] as Mode[]).some((m) => this.queues[m].some((e) => e.client === client));
  }

  join(client: Client, mode: Mode): { ok: boolean; error?: string } {
    if (!client.profile?.nickname) return { ok: false, error: 'need_nickname' };
    if (client.room) return { ok: false, error: 'in_match' };
    if (this.inQueue(client)) return { ok: true };
    this.queues[mode].push({ client, rating: this.ratingFor(client, mode), joinedAt: Date.now() });
    return { ok: true };
  }

  leave(client: Client): void {
    for (const m of ['duel', 'ffa'] as Mode[]) {
      this.queues[m] = this.queues[m].filter((e) => e.client !== client);
    }
  }

  removeClient(client: Client): void {
    this.leave(client);
  }

  private searchRange(entry: QueueEntry, now: number): number {
    const steps = Math.floor((now - entry.joinedAt) / CONFIG.MM_WIDEN_INTERVAL_MS);
    return clamp(
      CONFIG.MM_BASE_RANGE + steps * CONFIG.MM_WIDEN_PER_INTERVAL,
      CONFIG.MM_BASE_RANGE,
      CONFIG.MM_MAX_RANGE,
    );
  }

  tick(now: number): void {
    for (const mode of ['duel', 'ffa'] as Mode[]) {
      this.matchMode(mode, now);
      this.pushStatus(mode, now);
    }
  }

  private matchMode(mode: Mode, now: number): void {
    const need = CONFIG.ARENA[mode].players;
    let q = this.queues[mode].slice().sort((a, b) => a.rating - b.rating);
    const used = new Set<Client>();

    for (let i = 0; i + need <= q.length; i++) {
      const window = q.slice(i, i + need);
      if (window.some((e) => used.has(e.client))) continue;
      const minRange = Math.min(...window.map((e) => this.searchRange(e, now)));
      const spread = window[window.length - 1].rating - window[0].rating;
      if (spread <= minRange) {
        for (const e of window) used.add(e.client);
        this.formMatch(mode, window.map((e) => e.client));
      }
    }

    if (used.size) {
      this.queues[mode] = this.queues[mode].filter((e) => !used.has(e.client));
    }
  }

  private formMatch(mode: Mode, clients: Client[]): void {
    const host = clients[0];
    const room = this.ctx.rooms.createRankedRoom(mode, host);
    for (const c of clients.slice(1)) {
      room.addClient(c);
    }
    for (const c of clients) {
      c.send({ type: 'match_found', code: room.code, mode, ranked: true });
    }
    room.startMatch();
  }

  private pushStatus(mode: Mode, now: number): void {
    const q = this.queues[mode];
    for (const e of q) {
      const range = this.searchRange(e, now);
      e.client.send({
        type: 'queue_status',
        mode,
        eta: Math.max(2, CONFIG.ARENA[mode].players * 3 - q.length),
        searchRange: range,
        elapsed: Math.round((now - e.joinedAt) / 1000),
        size: q.length,
      });
    }
  }
}
