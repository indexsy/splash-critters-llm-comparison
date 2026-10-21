import type { PlayerStore } from './db/queries'

export class EloService {
  constructor(private store: PlayerStore) {}

  ratingFor(playerId: string, mode: string) {
    return this.store.getRating(playerId, mode)
  }

  saveRating(playerId: string, mode: string, rating: number, games: number, wins: number, peak: number) {
    this.store.saveRating(playerId, mode, rating, games, wins, peak)
  }

  beginMatch(mode: string): number {
    return this.store.beginMatch(mode, true)
  }

  finishMatch(_matchId: number): void {
    // rows recorded by rooms.finishMatch already
  }
}
