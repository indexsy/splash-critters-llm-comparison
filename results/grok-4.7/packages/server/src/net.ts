import { CONFIG, type ClientMsg, type Dir, type Mode } from '@splash/shared';

const DIRS = new Set<Dir>(['none', 'up', 'down', 'left', 'right']);
const MODES = new Set<Mode>(['duel', 'ffa']);
const DIFFS = new Set(['easy', 'medium', 'hard']);

export class RateLimiter {
  private stamps: number[] = [];

  allow(now = Date.now()): boolean {
    this.stamps = this.stamps.filter((t) => now - t < 1000);
    if (this.stamps.length >= CONFIG.RATE_LIMIT_PER_SEC) return false;
    this.stamps.push(now);
    return true;
  }
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > 8000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const token = typeof m.token === 'string' ? m.token.slice(0, 80) : undefined;
      return token ? { t: 'hello', token } : { t: 'hello' };
    }
    case 'set_nickname': {
      const nickname = str(m.nickname, 24);
      if (!nickname) return null;
      return { t: 'set_nickname', nickname };
    }
    case 'queue_join':
      if (!MODES.has(m.mode as Mode)) return null;
      return { t: 'queue_join', mode: m.mode as Mode };
    case 'queue_leave':
      return { t: 'queue_leave' };
    case 'create_room': {
      const opts = m.opts as Record<string, unknown> | undefined;
      if (!opts || typeof opts !== 'object') return null;
      const name = str(opts.name, CONFIG.ROOM_NAME_MAX) ?? 'Puddle';
      if (!MODES.has(opts.mode as Mode)) return null;
      const theme = opts.theme;
      if (theme !== 'backyard' && theme !== 'beach' && theme !== 'pool' && theme !== 'random') return null;
      const rounds = opts.roundsToWin;
      if (rounds !== 2 && rounds !== 3 && rounds !== 5) return null;
      return {
        t: 'create_room',
        opts: {
          name,
          mode: opts.mode as Mode,
          public: Boolean(opts.public),
          theme,
          roundsToWin: rounds,
          botFill: Boolean(opts.botFill),
        },
      };
    }
    case 'join_room': {
      const code = str(m.code, 8);
      if (!code) return null;
      return { t: 'join_room', code: code.toUpperCase() };
    }
    case 'room_list_request': {
      const mode = m.mode === 'duel' || m.mode === 'ffa' || m.mode === 'any' ? m.mode : 'any';
      return { t: 'room_list_request', mode };
    }
    case 'leave_room':
      return { t: 'leave_room' };
    case 'set_slot': {
      if (typeof m.slot !== 'number' || m.slot < 0 || m.slot > 3) return null;
      if (m.kind !== 'open' && m.kind !== 'bot') return null;
      const difficulty = DIFFS.has(m.difficulty as string)
        ? (m.difficulty as 'easy' | 'medium' | 'hard')
        : 'medium';
      return { t: 'set_slot', slot: m.slot, kind: m.kind, difficulty };
    }
    case 'set_ready':
      return { t: 'set_ready', ready: Boolean(m.ready) };
    case 'start_match':
      return { t: 'start_match' };
    case 'input': {
      if (typeof m.seq !== 'number' || typeof m.tick !== 'number') return null;
      if (!DIRS.has(m.dir as Dir)) return null;
      return {
        t: 'input',
        seq: m.seq,
        tick: m.tick,
        dir: m.dir as Dir,
        balloonPressed: Boolean(m.balloonPressed),
      };
    }
    case 'emote': {
      if (typeof m.id !== 'number' || m.id < 1 || m.id > 4) return null;
      return { t: 'emote', id: Math.floor(m.id) };
    }
    case 'rematch_vote':
      return { t: 'rematch_vote', yes: Boolean(m.yes) };
    case 'pong':
      return {
        t: 'pong',
        clientTime: typeof m.clientTime === 'number' ? m.clientTime : 0,
        serverTime: typeof m.serverTime === 'number' ? m.serverTime : 0,
      };
    case 'tutorial_begin':
      return { t: 'tutorial_begin' };
    case 'tutorial_skip':
      return { t: 'tutorial_skip' };
    case 'practice_start':
      return { t: 'practice_start' };
    case 'select_cosmetic':
      return {
        t: 'select_cosmetic',
        animal: typeof m.animal === 'string' ? m.animal.slice(0, 24) : undefined,
        hat: typeof m.hat === 'string' ? m.hat.slice(0, 24) : undefined,
      };
    default:
      return null;
  }
}
