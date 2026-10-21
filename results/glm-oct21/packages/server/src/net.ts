import type { C2S, GameMode } from '@splash/shared'

export interface RawConnLike {
  id: string
  sendJson(msg: unknown): void
  close(code: number, reason: string): void
}

interface Bucket {
  windowStart: number
  count: number
}

const buckets = new Map<string, Bucket>()

export function allowMessage(profileId: string, limit = 60): boolean {
  const now = Date.now()
  const b = buckets.get(profileId)
  if (!b || now - b.windowStart >= 1000) {
    buckets.set(profileId, { windowStart: now, count: 1 })
    return true
  }
  b.count++
  return b.count <= limit
}

export function pruneBuckets(): void {
  const now = Date.now()
  for (const [k, b] of buckets) if (now - b.windowStart > 5000) buckets.delete(k)
}

const DIRS = ['up', 'down', 'left', 'right', 'none']
const MODES: GameMode[] = ['duel', 'ffa']

export interface Validation {
  ok: boolean
  msg?: unknown
}

export function validate(msg: unknown): { ok: true; msg: C2S } | { ok: false; code: string; msg: string } {
  if (typeof msg !== 'object' || msg === null) return { ok: false, code: 'bad_msg', msg: 'Malformed message' }
  const m = msg as Record<string, unknown>
  switch (m.t) {
    case 'hello':
      return { ok: true, msg: m as C2S }
    case 'set_nickname':
      if (typeof m.nickname !== 'string') return { ok: false, code: 'bad_nickname', msg: 'Bad nickname' }
      return { ok: true, msg: m as C2S }
    case 'set_cosmetics':
      if (typeof m.animal !== 'string' || typeof m.hat !== 'string')
        return { ok: false, code: 'bad_cosmetics', msg: 'Bad cosmetics' }
      return { ok: true, msg: m as C2S }
    case 'queue_join':
      if (typeof m.mode !== 'string' || !MODES.includes(m.mode as GameMode))
        return { ok: false, code: 'bad_mode', msg: 'Bad mode' }
      return { ok: true, msg: m as C2S }
    case 'queue_leave':
    case 'room_list_request':
    case 'leave_room':
    case 'set_ready':
    case 'start_match':
    case 'rematch_vote':
      return { ok: true, msg: m as C2S }
    case 'create_room': {
      const o = m.opts as Record<string, unknown> | undefined
      if (!o || (o.size !== 2 && o.size !== 4)) return { ok: false, code: 'bad_room', msg: 'Bad room size' }
      return { ok: true, msg: m as C2S }
    }
    case 'join_room':
      if (typeof m.code !== 'string' || m.code.length < 4 || m.code.length > 8)
        return { ok: false, code: 'bad_code', msg: 'Bad room code' }
      return { ok: true, msg: m as C2S }
    case 'set_slot':
      if (typeof m.slot !== 'number') return { ok: false, code: 'bad_slot', msg: 'Bad slot' }
      if (m.kind !== 'bot' && m.kind !== 'empty') return { ok: false, code: 'bad_slot', msg: 'Bad slot kind' }
      if (m.kind === 'bot' && !['easy', 'medium', 'hard'].includes(m.difficulty as string))
        return { ok: false, code: 'bad_slot', msg: 'Bad difficulty' }
      return { ok: true, msg: m as C2S }
    case 'input': {
      if (typeof m.seq !== 'number' || !DIRS.includes(m.dir as string) || typeof m.balloon !== 'boolean')
        return { ok: false, code: 'bad_input', msg: 'Bad input' }
      return { ok: true, msg: m as C2S }
    }
    case 'emote':
      if (typeof m.id !== 'number' || m.id < 0 || m.id > 3)
        return { ok: false, code: 'bad_emote', msg: 'Bad emote' }
      return { ok: true, msg: m as C2S }
    case 'pong':
      if (typeof m.t !== 'number') return { ok: false, code: 'bad_pong', msg: 'Bad pong' }
      return { ok: true, msg: m as C2S }
    default:
      return { ok: false, code: 'unknown_msg', msg: 'Unknown message type' }
  }
}
