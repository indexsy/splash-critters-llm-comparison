import { createHash, randomUUID, randomInt } from 'node:crypto'
import type { DB } from './db'
import { CONFIG, levelFromXp, xpForLevel } from '@splash/shared'
import type { PlayerProfile } from '@splash/shared'

const NICK_PETS = ['Soggy', 'Splashy', 'Dinky', 'Wobbly', 'Squirt', 'Puddles', 'Ducky', 'Otto', 'Froggo', 'Tidey', 'Bubbles', 'Drizzle']
const NICK_KIN = ['Otter', 'Duck', 'Frog', 'Cat', 'Turtle', 'Penguin', 'Raccoon', 'Capybara']

const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'cock', 'nigg', 'fag', 'damn', 'piss', 'wanker']

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isProfane(nick: string): boolean {
  const low = nick.toLowerCase()
  return PROFANITY.some((w) => low.includes(w))
}

function profileRow(row: any): PlayerProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    xp: row.xp,
    level: row.level,
    animal: row.selected_animal,
    hat: row.selected_hat,
    ratings: {}
  }
}

export class PlayerStore {
  constructor(private db: DB) {}

  private loadRatings(profile: PlayerProfile): void {
    const rows = this.db.prepare('SELECT * FROM ratings WHERE player_id = ?').all(profile.id) as any[]
    for (const r of rows) {
      profile.ratings[r.mode] = { rating: r.rating, games: r.games, wins: r.wins, peak: r.peak }
    }
  }

  createGuest(token: string): { profile: PlayerProfile; token: string } {
    const id = randomUUID()
    const tag = String(randomInt(1000, 10000))
    let nickname = `${NICK_PETS[Math.floor(Math.random() * NICK_PETS.length)]}${NICK_KIN[Math.floor(Math.random() * NICK_KIN.length)]}`
    for (let i = 0; i < 20; i++) {
      const exists = this.db.prepare('SELECT 1 FROM players WHERE nickname = ? AND tag = ?').get(nickname, tag)
      if (!exists) break
      nickname = `${NICK_PETS[Math.floor(Math.random() * NICK_PETS.length)]}${NICK_KIN[Math.floor(Math.random() * NICK_KIN.length)]}${i}`
    }
    this.db
      .prepare(
        'INSERT INTO players (id, token_hash, nickname, tag, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, hashToken(token), nickname, tag, Date.now())
    for (const mode of ['duel', 'ffa']) {
      this.db
        .prepare('INSERT OR IGNORE INTO ratings (player_id, mode) VALUES (?, ?)')
        .run(id, mode)
    }
    const profile = this.getByToken(token)!
    return { profile, token }
  }

  getByToken(token: string): PlayerProfile | null {
    const row = this.db.prepare('SELECT * FROM players WHERE token_hash = ?').get(hashToken(token)) as any
    if (!row) return null
    const profile = profileRow(row)
    this.loadRatings(profile)
    return profile
  }

  getById(id: string): PlayerProfile | null {
    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as any
    if (!row) return null
    const profile = profileRow(row)
    this.loadRatings(profile)
    return profile
  }

  getRawById(id: string): { tutorial_done?: number } | null {
    return this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as any
  }

  setNickname(profileId: string, nickname: string): { ok: boolean; error?: string } {
    const clean = nickname.trim().replace(/\s+/g, ' ')
    if (clean.length < 3 || clean.length > 16) return { ok: false, error: 'Nickname must be 3-16 characters' }
    if (isProfane(clean)) return { ok: false, error: 'Choose a kinder nickname' }
    const tag = String(randomInt(1000, 10000))
    const clash = this.db.prepare('SELECT 1 FROM players WHERE nickname = ? AND tag = ?').get(clean, tag)
    if (clash) return { ok: false, error: 'Name in use, try again' }
    this.db.prepare('UPDATE players SET nickname = ?, tag = ? WHERE id = ?').run(clean, tag, profileId)
    return { ok: true }
  }

  setCosmetics(profileId: string, animal: string, hat: string): void {
    this.db
      .prepare('UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?')
      .run(animal, hat, profileId)
  }

  addXp(profileId: string, amount: number): { total: number; level: number; leveledUp: boolean } {
    const row = this.db.prepare('SELECT xp, level FROM players WHERE id = ?').get(profileId) as any
    if (!row) return { total: 0, level: 1, leveledUp: false }
    const total = (row.xp as number) + amount
    const level = levelFromXp(total)
    this.db.prepare('UPDATE players SET xp = ?, level = ? WHERE id = ?').run(total, level, profileId)
    if (level > (row.level as number)) {
      this.autoUnlock(profileId, level)
    }
    return { total, level, leveledUp: level > row.level }
  }

  private autoUnlock(profileId: string, level: number): void {
    const ins = this.db.prepare('INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)')
    const now = Date.now()
    for (const a of CONFIG.ANIMALS) {
      if (level >= a.level && a.level > 1) ins.run(profileId, a.id, now)
    }
    for (const h of CONFIG.HATS) {
      if (level >= h.level && h.level > 1) ins.run(profileId, h.id, now)
    }
  }

  xpNeeded(level: number): number {
    return xpForLevel(level)
  }

  getRating(playerId: string, mode: string): { rating: number; games: number; wins: number; peak: number; ratingBefore?: number } {
    const row = this.db.prepare('SELECT * FROM ratings WHERE player_id = ? AND mode = ?').get(playerId, mode) as any
    return row ?? { rating: CONFIG.ELO.START, games: 0, wins: 0, peak: CONFIG.ELO.START }
  }

  saveRating(playerId: string, mode: string, rating: number, games: number, wins: number, peak: number): void {
    this.db
      .prepare(
        `INSERT INTO ratings (player_id, mode, rating, games, wins, peak) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id, mode) DO UPDATE SET rating = excluded.rating, games = excluded.games, wins = excluded.wins, peak = excluded.peak`
      )
      .run(playerId, mode, rating, games, wins, peak)
  }

  beginMatch(mode: string, ranked: boolean): number {
    const r = this.db.prepare('INSERT INTO matches (mode, ranked, started_at) VALUES (?, ?, ?)').run(mode, ranked ? 1 : 0, Date.now())
    return r.lastInsertRowid as number
  }

  recordMatchPlayers(
    matchId: number,
    rows: Array<{ player_id: string; placement: number; soaks: number; rounds_won: number; rating_before: number | null; rating_after: number | null; xp_earned: number }>
  ): void {
    const st = this.db.prepare(
      'INSERT OR REPLACE INTO match_players (match_id, player_id, placement, soaks, rounds_won, rating_before, rating_after, xp_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const r of rows) {
      st.run(matchId, r.player_id, r.placement, r.soaks, r.rounds_won, r.rating_before, r.rating_after, r.xp_earned)
    }
    this.db.prepare('UPDATE matches SET ended_at = ? WHERE id = ?').run(Date.now(), matchId)
  }

  leaderboard(mode: string): Array<any> {
    return this.db
      .prepare(
        `SELECT p.id, p.nickname, p.tag, r.rating, r.games, r.wins, r.peak
         FROM ratings r JOIN players p ON p.id = r.player_id
         WHERE r.mode = ? AND r.games > 0
         ORDER BY r.rating DESC LIMIT 100`
      )
      .all(mode)
  }

  recentMatches(playerId: string): Array<any> {
    return this.db
      .prepare(
        `SELECT m.id, m.mode, m.ranked, m.ended_at, mp.placement, mp.soaks, mp.rounds_won, mp.rating_before, mp.rating_after, mp.xp_earned
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10`
      )
      .all(playerId)
  }

  unlocksOf(playerId: string): string[] {
    const rows = this.db.prepare('SELECT item_id FROM unlocks WHERE player_id = ?').all(playerId) as any[]
    return rows.map((r) => r.item_id)
  }

  setTutorialDone(playerId: string): boolean {
    const row = this.db.prepare('SELECT tutorial_done, xp FROM players WHERE id = ?').get(playerId) as any
    if (!row) return false
    this.db.prepare('UPDATE players SET tutorial_done = 1 WHERE id = ?').run(playerId)
    return Number(row.tutorial_done) === 0
  }
}
