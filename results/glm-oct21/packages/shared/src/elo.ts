import { CONFIG } from './config'

export interface GlobalRating {
  player?: string
  rating: number
  games: number
  wins: number
  peak: number
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400))
}

export function kFactor(r: GlobalRating): number {
  return r.games < CONFIG.ELO.PROVISIONAL_GAMES ? CONFIG.ELO.K_PROVISIONAL : CONFIG.ELO.K
}

export function duelDelta(ra: GlobalRating, rb: GlobalRating, aWon: boolean): number {
  const S = aWon ? 1 : 0
  const E = expectedScore(ra.rating, rb.rating)
  return Math.round(kFactor(ra) * (S - E))
}

export interface FfaPlacement {
  id: string
  roundsWon: number
  soaks: number
}

export function rankedPlacementsNums(list: Array<{ id: number; roundsWon: number; soaks: number }>): Array<{ id: number; placement: number }> {
  const src = list.map((e) => ({ id: String(e.id), roundsWon: e.roundsWon, soaks: e.soaks }))
  const out = rankedPlacements(src)
  return out.map((r) => ({ id: Number(r.id), placement: r.placement }))
}

export function rankedPlacements(list: FfaPlacement[]): Array<{ id: string; placement: number }> {
  const sorted = [...list].sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks)
  const out: Array<{ id: string; placement: number }> = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (
      j + 1 < sorted.length &&
      sorted[j + 1]!.roundsWon === sorted[i]!.roundsWon &&
      sorted[j + 1]!.soaks === sorted[i]!.soaks
    )
      j++
    const placement = i + 1
    for (let k = i; k <= j; k++) out.push({ id: sorted[k]!.id, placement })
    i = j + 1
  }
  return out
}

export function ffaPairwiseDeltas(
  ratings: Map<string, GlobalRating>,
  placements: Array<{ id: string; roundsWon: number; soaks: number }>
): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const id of ratings.keys()) deltas.set(id, 0)
  const ranked = rankedPlacements(placements)
  const byId = new Map(ranked.map((r) => [r.id, r.placement]))
  for (const a of [...ratings.keys()].sort()) {
    for (const b of [...ratings.keys()].sort()) {
      if (a.localeCompare(b) >= 0) continue
      const pa = byId.get(a)!
      const pb = byId.get(b)!
      const ra = ratings.get(a)!
      const rb = ratings.get(b)!
      const sa = pa < pb ? 1 : pa > pb ? 0 : 0.5
      const sb = 1 - sa
      deltas.set(a, (deltas.get(a) ?? 0) + (kFactor(ra) / 3) * (sa - expectedScore(ra.rating, rb.rating)))
      deltas.set(b, (deltas.get(b) ?? 0) + (kFactor(rb) / 3) * (sb - expectedScore(rb.rating, ra.rating)))
    }
  }
  for (const [k, v] of deltas) deltas.set(k, Math.round(v))
  return deltas
}

export function tierOf(rating: number): string {
  let name: string = CONFIG.TIERS[0].name
  for (const tier of CONFIG.TIERS) if (rating >= tier.min) name = tier.name
  return name
}
