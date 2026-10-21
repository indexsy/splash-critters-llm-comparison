import type { PlayerStore } from './db/queries'

export interface RankedIdentity {
  profileId: string
  nickname: string
  animal: string
  hat: string
}

export interface QueueEntry {
  profileId: string
  nickname: string
  rating: number
  games: number
  joinedAt: number
  identity: RankedIdentity
  sendQueueStatus: (eta: number, range: number, waiting: number) => void
}

import { CONFIG, type GameMode } from '@splash/shared'

export function allowedRangeFor(entry: QueueEntry, now: number): number {
  const waited = now - entry.joinedAt
  const widen = Math.floor(waited / CONFIG.MM_WIDEN_EVERY_MS) * CONFIG.MM_WIDEN
  return Math.min(CONFIG.MM_MAX_RANGE, CONFIG.MM_START_RANGE + widen)
}

export function etaFor(entry: QueueEntry, waiting: number): number {
  const waited = (Date.now() - entry.joinedAt) / 1000
  return Math.max(1, Math.round(Math.max(2, 45 - waited * 3)) + (waiting - 1) * 0)
}

export class Matchmaker {
  private queues: Record<GameMode, QueueEntry[]> = { duel: [], ffa: [] }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private api: PlayerStore,
    private onMatch: (entries: QueueEntry[], mode: GameMode) => void
  ) {}

  join(entry: QueueEntry, mode: GameMode): void {
    this.leave(entry.profileId)
    this.queues[mode].push(entry)
  }

  leave(profileId: string): void {
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const q = this.queues[mode]
      const i = q.findIndex((e) => e.profileId === profileId)
      if (i >= 0) q.splice(i, 1)
    }
  }

  isQueued(profileId: string): boolean {
    return this.queues.duel.some((e) => e.profileId === profileId) || this.queues.ffa.some((e) => e.profileId === profileId)
  }

  queueInfo(profileId: string, mode: GameMode): { eta: number; range: number; playersWaiting: number } | null {
    const entry = this.queues[mode].find((e) => e.profileId === profileId)
    if (!entry) return null
    return {
      eta: etaFor(entry, this.queues[mode].length),
      range: allowedRangeFor(entry, Date.now()),
      playersWaiting: this.queues[mode].length
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), CONFIG.MM_TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  tick(): void {
    for (const mode of ['duel', 'ffa'] as GameMode[]) {
      const q = this.queues[mode]
      const need = mode === 'duel' ? 2 : 4
      if (q.length < need) {
        for (const e of q) {
          e.sendQueueStatus(etaFor(e, q.length), allowedRangeFor(e, Date.now()), q.length)
        }
        continue
      }
      const now = Date.now()
      const sorted = [...q].sort((a, b) => a.rating - b.rating)
      let matched: QueueEntry[] | null = null
      for (let i = 0; i + need <= sorted.length; i++) {
        const group = sorted.slice(i, i + need)
        const spread = group[need - 1]!.rating - group[0]!.rating
        const worstAllowed = Math.min(...group.map((g) => allowedRangeFor(g, now)))
        if (spread <= worstAllowed) {
          matched = group
          break
        }
      }
      if (matched) {
        for (const e of matched) {
          const j = q.indexOf(e)
          if (j >= 0) q.splice(j, 1)
        }
        this.onMatch(matched, mode)
      } else {
        for (const e of q) {
          e.sendQueueStatus(etaFor(e, q.length), allowedRangeFor(e, Date.now()), q.length)
        }
      }
    }
  }
}

export function ratingFor(api: PlayerStore, profileId: string, mode: GameMode): { rating: number; games: number; wins: number; peak: number } {
  return api.getRating(profileId, mode)
}
