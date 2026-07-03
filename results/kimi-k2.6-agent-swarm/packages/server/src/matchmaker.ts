import { EventEmitter } from 'node:events';
import { CONFIG } from '@splash-critters/shared';
import type { PlayerId, QueueMode, GameMode } from '@splash-critters/shared';
import type { RoomManager } from './rooms.js';

interface QueuedPlayer {
  playerId: PlayerId;
  rating: number;
  joinedAt: number;
}

export class Matchmaker extends EventEmitter {
  private duelQueue = new Map<PlayerId, QueuedPlayer>();
  private ffaQueue = new Map<PlayerId, QueuedPlayer>();
  private roomManager: RoomManager;

  constructor(roomManager: RoomManager) {
    super();
    this.roomManager = roomManager;
  }

  queueJoin(playerId: PlayerId, mode: QueueMode, rating: number): void {
    const queue = mode === 'duel' ? this.duelQueue : this.ffaQueue;
    queue.set(playerId, { playerId, rating, joinedAt: Date.now() });
  }

  queueLeave(playerId: PlayerId): void {
    this.duelQueue.delete(playerId);
    this.ffaQueue.delete(playerId);
  }

  tick(): void {
    this.matchMode('duel');
    this.matchMode('ffa');
  }

  private matchMode(mode: QueueMode): void {
    const queue = mode === 'duel' ? this.duelQueue : this.ffaQueue;
    const players = Array.from(queue.values());
    if (players.length < 2) return;

    players.sort((a, b) => a.joinedAt - b.joinedAt);
    const required = mode === 'duel' ? 2 : 4;
    const matched = new Set<PlayerId>();

    for (let i = 0; i < players.length; i++) {
      if (matched.has(players[i].playerId)) continue;

      const group: QueuedPlayer[] = [players[i]];
      const range = this.getSearchRange(players[i]);

      for (
        let j = i + 1;
        j < players.length && group.length < required;
        j++
      ) {
        if (matched.has(players[j].playerId)) continue;
        const ratingDiff = Math.abs(players[i].rating - players[j].rating);
        if (ratingDiff <= range) {
          group.push(players[j]);
        }
      }

      if (group.length === required) {
        for (const p of group) {
          matched.add(p.playerId);
          queue.delete(p.playerId);
        }
        this.createMatch(group, mode);
      } else if (
        mode === 'ffa' &&
        group.length >= 2 &&
        this.getSearchRange(players[i]) >= CONFIG.MATCHMAKER_MAX_RANGE
      ) {
        const waitTime = Date.now() - players[i].joinedAt;
        if (waitTime >= 30000) {
          for (const p of group) {
            matched.add(p.playerId);
            queue.delete(p.playerId);
          }
          this.createMatch(group, mode);
        }
      }
    }

    for (const id of matched) {
      queue.delete(id);
    }
  }

  private getSearchRange(player: QueuedPlayer): number {
    const elapsedMs = Date.now() - player.joinedAt;
    const intervals = Math.floor(elapsedMs / CONFIG.MATCHMAKER_WIDEN_INTERVAL_MS);
    const range =
      CONFIG.MATCHMAKER_BASE_RANGE + intervals * CONFIG.MATCHMAKER_WIDENING;
    return Math.min(range, CONFIG.MATCHMAKER_MAX_RANGE);
  }

  getQueueStatus(playerId: PlayerId): { eta: number; searchRange: number } | null {
    const duel = this.duelQueue.get(playerId);
    if (duel) {
      return {
        eta: Math.max(0, Math.ceil((Date.now() - duel.joinedAt) / 1000)),
        searchRange: this.getSearchRange(duel),
      };
    }
    const ffa = this.ffaQueue.get(playerId);
    if (ffa) {
      return {
        eta: Math.max(0, Math.ceil((Date.now() - ffa.joinedAt) / 1000)),
        searchRange: this.getSearchRange(ffa),
      };
    }
    return null;
  }

  private createMatch(players: QueuedPlayer[], mode: GameMode): void {
    // Create a hidden room for the ranked match
    const room = this.roomManager.createRoom({
      name: `Ranked ${mode.toUpperCase()}`,
      hostId: players[0].playerId,
      mode,
      visibility: 'private',
      theme: 'random',
      roundsToWin: CONFIG.MATCH_ROUNDS_TO_WIN,
      botFill: false,
    });

    for (const p of players.slice(1)) {
      this.roomManager.joinRoom(room.code, p.playerId);
    }

    for (const p of players) {
      room.setReady(p.playerId, true);
    }

    this.emit('match_found', {
      matchId: room.code,
      mode,
      players: players.map((p) => ({
        playerId: p.playerId,
        nickname: '',
        animal: 'frog' as const,
        rating: p.rating,
      })),
    });
  }
}
