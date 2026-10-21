import { CONFIG } from '@splash-critters/shared';
import type { ClientMessage, Mode } from '@splash-critters/shared';

const BLOCKED_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'faggot',
  'retard',
  'rape',
  'nazi',
];

export function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_WORDS.some((word) => lower.includes(word));
}

export function isValidNickname(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < CONFIG.NICKNAME_MIN || name.length > CONFIG.NICKNAME_MAX) return false;
  if (!/^[\w \-!?*]+$/.test(name)) return false;
  return !containsProfanity(name);
}

function isMode(value: unknown): value is Mode {
  return value === 'duel' || value === 'ffa';
}

function isDifficulty(value: unknown): value is 'easy' | 'medium' | 'hard' {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Strict validation of everything that arrives on the socket. Anything that
 * does not match the protocol is dropped, never trusted.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  const type = msg.t;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'hello': {
      const token = msg.token;
      if (token !== undefined && typeof token !== 'string') return null;
      if (typeof token === 'string' && token.length > 128) return null;
      return { t: 'hello', token: token as string | undefined };
    }
    case 'set_nickname': {
      if (typeof msg.nickname !== 'string') return null;
      return { t: 'set_nickname', nickname: msg.nickname };
    }
    case 'queue_join': {
      if (!isMode(msg.mode)) return null;
      return { t: 'queue_join', mode: msg.mode };
    }
    case 'queue_leave':
      return { t: 'queue_leave' };
    case 'create_room': {
      const opts = msg.opts as Record<string, unknown> | undefined;
      if (!opts || typeof opts !== 'object') return null;
      const maxPlayers = opts.maxPlayers === 4 ? 4 : 2;
      const theme =
        opts.theme === 'beach' || opts.theme === 'pool' || opts.theme === 'backyard' ||
        opts.theme === 'random'
          ? opts.theme
          : 'random';
      const roundsToWin =
        opts.roundsToWin === 2 || opts.roundsToWin === 5 ? opts.roundsToWin : 3;
      const name = typeof opts.name === 'string' ? opts.name.slice(0, 24) : 'Splash Room';
      return {
        t: 'create_room',
        opts: {
          name: name.length ? name : 'Splash Room',
          maxPlayers,
          isPublic: opts.isPublic !== false,
          theme,
          roundsToWin,
          botFill: opts.botFill === true,
          autoStart: opts.autoStart === true,
        },
      };
    }
    case 'join_room': {
      if (typeof msg.code !== 'string') return null;
      return { t: 'join_room', code: msg.code.toUpperCase().slice(0, 12) };
    }
    case 'room_list_request': {
      if (msg.mode !== undefined && !isMode(msg.mode)) return null;
      return { t: 'room_list_request', mode: msg.mode as Mode | undefined };
    }
    case 'leave_room':
      return { t: 'leave_room' };
    case 'set_slot': {
      const slot = num(msg.slot);
      if (slot === null || slot < 0 || slot > CONFIG.ROOM_MAX_PLAYERS - 1) return null;
      const kind = msg.kind;
      if (kind !== 'empty' && kind !== 'human' && kind !== 'bot') return null;
      const difficulty = isDifficulty(msg.difficulty) ? msg.difficulty : undefined;
      return { t: 'set_slot', slot, kind, difficulty };
    }
    case 'set_ready':
      return { t: 'set_ready', ready: msg.ready === true };
    case 'set_cosmetics': {
      if (typeof msg.animal !== 'string' || typeof msg.hat !== 'string') return null;
      return { t: 'set_cosmetics', animal: msg.animal as never, hat: msg.hat as never };
    }
    case 'start_match':
      return { t: 'start_match' };
    case 'input': {
      const seq = num(msg.seq);
      const tick = num(msg.tick);
      const dir = num(msg.dir);
      if (seq === null || tick === null || dir === null) return null;
      if (seq < 0 || seq > 1e9 || tick < 0 || tick > 1e9) return null;
      if (dir < 0 || dir > 15) return null;
      return { t: 'input', seq, tick, dir, balloon: msg.balloon === true };
    }
    case 'emote': {
      const id = num(msg.id);
      if (id === null || id < 0 || id > 3) return null;
      return { t: 'emote', id };
    }
    case 'rematch_vote':
      return { t: 'rematch_vote' };
    case 'pong': {
      const ts = num(msg.ts);
      if (ts === null) return null;
      return { t: 'pong', ts };
    }
    default:
      return null;
  }
}

/** Simple token bucket, 60 messages per second with a small burst allowance. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly perSecond = CONFIG.RATE_LIMIT_MSGS_PER_SEC,
    private readonly burst = CONFIG.RATE_LIMIT_BURST,
  ) {
    this.tokens = burst;
  }

  allow(now = Date.now()): boolean {
    const elapsed = now - this.last;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
