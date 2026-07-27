/**
 * Wire validation. Nothing from a socket reaches game code without passing
 * through here first.
 *
 * Every message type has its own small validator, and every field is checked
 * for type, range and enum membership. A frame that fails is rejected with a
 * reason the client can show; it never throws and never half-applies.
 */

import {
  CONFIG,
  Dir,
  type AnimalId,
  type BotDifficulty,
  type ClientMessage,
  type CreateRoomOpts,
  type DirValue,
  type ErrorCode,
  type GameMode,
  type HatId,
} from '@splash/shared';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ErrorCode; reason: string };

/** A validator returns the parsed message, or a string explaining the refusal. */
type Validator = (body: Record<string, unknown>) => ClientMessage | string;

const ANIMALS = new Set<string>(CONFIG.ANIMALS.map((a) => a.id));
const HATS = new Set<string>(CONFIG.HATS.map((h) => h.id));
const THEMES = new Set<string>(CONFIG.THEMES.map((t) => t.id));
const MODES = new Set<string>(['duel', 'ffa']);
const DIFFICULTIES = new Set<string>(['easy', 'medium', 'hard']);
const DIRS = new Set<number>([Dir.NONE, Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT]);

/** Long enough for any legal field, short enough that garbage is cheap to reject. */
const MAX_FIELD_CHARS = 256;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_FIELD_CHARS ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** Inputs arrive 30 times a second, so they are clamped rather than refused. */
function clampCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function clampDir(value: unknown): DirValue {
  return typeof value === 'number' && DIRS.has(value) ? (value as DirValue) : Dir.NONE;
}

function mode(value: unknown): GameMode | null {
  return typeof value === 'string' && MODES.has(value) ? (value as GameMode) : null;
}

function createRoomOpts(value: unknown): CreateRoomOpts | string {
  if (!isObject(value)) return 'create_room needs an opts object.';

  const name = str(value.name);
  if (name === null) return 'Room name must be a string.';
  const size = intIn(value.size, 2, 4);
  if (size !== 2 && size !== 4) return 'Room size must be 2 or 4.';
  const isPublic = bool(value.isPublic);
  if (isPublic === null) return 'isPublic must be a boolean.';
  const theme = str(value.theme);
  if (theme === null || (theme !== 'random' && !THEMES.has(theme))) return 'Unknown theme.';
  const botFill = bool(value.botFill);
  if (botFill === null) return 'botFill must be a boolean.';

  const autoStart = value.autoStart === undefined ? false : bool(value.autoStart);
  if (autoStart === null) return 'autoStart must be a boolean.';
  const tutorial = value.tutorial === undefined ? false : bool(value.tutorial);
  if (tutorial === null) return 'tutorial must be a boolean.';

  // The create-room dialog only ever offers 2, 3 or 5. The tutorial is a single
  // scripted round rather than a match, so it is the one caller allowed to ask
  // for CONFIG.TUTORIAL_ROUNDS_TO_WIN, and it has to be read before this check.
  const roundsToWin = intIn(value.roundsToWin, 1, CONFIG.MAX_ROUNDS);
  const allowed =
    roundsToWin !== null &&
    (CONFIG.ROUNDS_TO_WIN_OPTIONS.includes(roundsToWin) ||
      (tutorial && roundsToWin === CONFIG.TUTORIAL_ROUNDS_TO_WIN));
  if (!allowed) return 'Rounds to win must be one of the offered options.';

  return {
    name,
    size,
    isPublic,
    theme: theme as CreateRoomOpts['theme'],
    roundsToWin,
    botFill,
    autoStart,
    tutorial,
  };
}

/**
 * Looked up by own key only, never by plain indexing: this object inherits
 * `Object.prototype`, so a frame claiming to be `{"t":"__proto__"}`,
 * `{"t":"valueOf"}` or `{"t":"constructor"}` would otherwise find a "validator"
 * that is not one of ours. Most of those throw when called; `constructor` would
 * wave an entirely unvalidated object through as a ClientMessage.
 */
const VALIDATORS: Record<string, Validator> = {
  hello: (body) => {
    if (body.token !== undefined && str(body.token) === null) return 'Token must be a string.';
    if (body.version !== undefined && str(body.version) === null) return 'Version must be a string.';
    const token = body.token === undefined ? undefined : String(body.token);
    const version = body.version === undefined ? undefined : String(body.version);
    return { t: 'hello', token, version };
  },

  set_nickname: (body) => {
    const nickname = str(body.nickname);
    if (nickname === null) return 'Nickname must be a string.';
    return { t: 'set_nickname', nickname };
  },

  set_cosmetics: (body) => {
    const animal = str(body.animal);
    const hat = str(body.hat);
    if (animal === null || !ANIMALS.has(animal)) return 'Unknown animal.';
    if (hat === null || !HATS.has(hat)) return 'Unknown hat.';
    return { t: 'set_cosmetics', animal: animal as AnimalId, hat: hat as HatId };
  },

  set_tutorial_done: () => ({ t: 'set_tutorial_done' }),

  queue_join: (body) => {
    const value = mode(body.mode);
    if (value === null) return 'Mode must be duel or ffa.';
    return { t: 'queue_join', mode: value };
  },

  queue_leave: () => ({ t: 'queue_leave' }),

  create_room: (body) => {
    const opts = createRoomOpts(body.opts);
    return typeof opts === 'string' ? opts : { t: 'create_room', opts };
  },

  join_room: (body) => {
    const code = str(body.code);
    if (code === null) return 'Room code must be a string.';
    const trimmed = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) return 'That is not a room code.';
    return { t: 'join_room', code: trimmed };
  },

  room_list_request: (body) => {
    if (body.mode === undefined) return { t: 'room_list_request' };
    const value = mode(body.mode);
    if (value === null) return 'Mode must be duel or ffa.';
    return { t: 'room_list_request', mode: value };
  },

  leave_room: () => ({ t: 'leave_room' }),

  set_slot: (body) => {
    const slot = intIn(body.slot, 0, 3);
    if (slot === null) return 'Slot out of range.';
    const kind = str(body.kind);
    if (kind !== 'open' && kind !== 'bot') return 'Slot kind must be open or bot.';
    if (body.difficulty === undefined) return { t: 'set_slot', slot, kind };
    const difficulty = str(body.difficulty);
    if (difficulty === null || !DIFFICULTIES.has(difficulty)) return 'Unknown bot difficulty.';
    return { t: 'set_slot', slot, kind, difficulty: difficulty as BotDifficulty };
  },

  set_ready: (body) => {
    const ready = bool(body.ready);
    if (ready === null) return 'Ready must be a boolean.';
    return { t: 'set_ready', ready };
  },

  start_match: () => ({ t: 'start_match' }),

  input: (body) => ({
    t: 'input',
    seq: clampCounter(body.seq),
    tick: clampCounter(body.tick),
    dir: clampDir(body.dir),
    balloonPressed: body.balloonPressed === true,
  }),

  emote: (body) => {
    const id = intIn(body.id, 0, CONFIG.EMOTE_COUNT - 1);
    if (id === null) return 'Unknown emote.';
    return { t: 'emote', id };
  },

  rematch_vote: (body) => {
    const vote = bool(body.vote);
    if (vote === null) return 'Vote must be a boolean.';
    return { t: 'rematch_vote', vote };
  },

  pong: (body) => {
    if (typeof body.time !== 'number' || !Number.isFinite(body.time)) return 'Bad pong time.';
    return { t: 'pong', time: body.time };
  },
};

/** Parses one frame. Oversized, malformed and unknown frames all land here. */
export function parseClientMessage(raw: string): ParseResult {
  if (raw.length > CONFIG.MAX_MSG_BYTES) {
    return { ok: false, code: 'bad_message', reason: 'Message too large.' };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_message', reason: 'Message was not JSON.' };
  }

  if (!isObject(body) || typeof body.t !== 'string') {
    return { ok: false, code: 'bad_message', reason: 'Message needs a type.' };
  }

  const known = Object.prototype.hasOwnProperty.call(VALIDATORS, body.t);
  const validator = known ? VALIDATORS[body.t] : undefined;
  if (validator === undefined) {
    return { ok: false, code: 'bad_message', reason: `Unknown message type: ${body.t}` };
  }

  const result = validator(body);
  if (typeof result === 'string') return { ok: false, code: 'bad_message', reason: result };
  return { ok: true, message: result };
}
