// Per-type validators for client messages. Each builds a fresh, fully typed message from an
// untrusted JSON object (extra fields are dropped) or returns null when any field is missing,
// mistyped or out of range.
import { ANIMAL_IDS, CONFIG, HAT_IDS } from '@splash/shared';
import type { C2S, C2SType, CreateRoomOpts, Difficulty, DirCode, EmoteId, Mode, MsgOf, ThemeChoice } from '@splash/shared';
import { bool, intIn, isRecord, numberIn, oneOf, rawString, text, type Fields } from './validate';

const MODES: readonly Mode[] = ['duel', 'ffa'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const THEME_CHOICES: readonly ThemeChoice[] = ['backyard', 'beach', 'pool', 'random'];
const SLOT_KINDS = ['open', 'bot', 'closed'] as const;
const ROOM_SIZES = [2, 4] as const;
const DIRS: readonly DirCode[] = [0, 1, 2, 3, 4];
const EMOTES: readonly EmoteId[] = [0, 1, 2, 3];
/** Largest seq / tick a client may send (int32, so it survives any arithmetic unchanged). */
const MAX_COUNTER = 2 ** 31 - 1;
const MAX_PROTOCOL_VERSION = 65535;
const TOKEN_MAX = 128;
/** Nicknames are length-checked again (3..NICK_MAX) with a friendly reason by claimNickname. */
const NICKNAME_FIELD_MAX = CONFIG.NICK_MAX * 2;
/** Codes are compared after upper-casing; anything that is not a live room answers not_found. */
const ROOM_CODE_FIELD_MAX = 16;
/** Largest server timestamp a pong may echo (year ~2286 in ms). */
const MAX_TIMESTAMP = 1e13;

type Validators = { [T in C2SType]: (m: Fields) => MsgOf<C2S, T> | null };

function createRoomOpts(value: unknown): CreateRoomOpts | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, CONFIG.ROOM_NAME_MAX);
  const size = oneOf(value.size, ROOM_SIZES);
  const isPublic = bool(value.isPublic);
  const theme = oneOf(value.theme, THEME_CHOICES);
  const roundsToWin = oneOf(value.roundsToWin, CONFIG.ROUNDS_TO_WIN_OPTIONS);
  const botFill = bool(value.botFill);
  if (name === null || size === null || isPublic === null || theme === null || roundsToWin === null || botFill === null) {
    return null;
  }
  const opts: CreateRoomOpts = { name, size, isPublic, theme, roundsToWin, botFill };
  if (value.practice !== undefined) {
    const practice = bool(value.practice);
    if (practice === null) return null;
    opts.practice = practice;
  }
  if (value.practiceDifficulty !== undefined) {
    const difficulty = oneOf(value.practiceDifficulty, DIFFICULTIES);
    if (difficulty === null) return null;
    opts.practiceDifficulty = difficulty;
  }
  return opts;
}

function hello(m: Fields): MsgOf<C2S, 'hello'> | null {
  const v = intIn(m.v, 0, MAX_PROTOCOL_VERSION);
  if (v === null) return null;
  if (m.token === undefined || m.token === null) return { type: 'hello', v };
  const token = rawString(m.token, TOKEN_MAX);
  return token === null ? null : { type: 'hello', token, v };
}

function setSlot(m: Fields): MsgOf<C2S, 'set_slot'> | null {
  const slot = intIn(m.slot, 0, 3);
  const kind = oneOf(m.kind, SLOT_KINDS);
  if (slot === null || kind === null) return null;
  if (m.difficulty === undefined) return { type: 'set_slot', slot, kind };
  const difficulty = oneOf(m.difficulty, DIFFICULTIES);
  return difficulty === null ? null : { type: 'set_slot', slot, kind, difficulty };
}

function input(m: Fields): MsgOf<C2S, 'input'> | null {
  const seq = intIn(m.seq, 0, MAX_COUNTER);
  const tick = intIn(m.tick, 0, MAX_COUNTER);
  const dir = oneOf(m.dir, DIRS);
  const balloonPressed = bool(m.balloonPressed);
  if (seq === null || tick === null || dir === null || balloonPressed === null) return null;
  return { type: 'input', seq, tick, dir, balloonPressed };
}

function roomListRequest(m: Fields): MsgOf<C2S, 'room_list_request'> | null {
  if (m.mode === undefined || m.mode === null) return { type: 'room_list_request' };
  const mode = oneOf(m.mode, MODES);
  return mode === null ? null : { type: 'room_list_request', mode };
}

/** Wraps a single-field reader: null field -> null message. */
function withField<T extends C2SType, V>(
  read: (m: Fields) => V | null,
  build: (value: V) => MsgOf<C2S, T>,
): (m: Fields) => MsgOf<C2S, T> | null {
  return (m) => {
    const value = read(m);
    return value === null ? null : build(value);
  };
}

export const VALIDATORS: Validators = {
  hello,
  set_nickname: withField((m) => text(m.nickname, NICKNAME_FIELD_MAX), (nickname) => ({ type: 'set_nickname', nickname })),
  set_cosmetics: (m) => {
    const animal = oneOf(m.animal, ANIMAL_IDS);
    const hat = oneOf(m.hat, HAT_IDS);
    return animal === null || hat === null ? null : { type: 'set_cosmetics', animal, hat };
  },
  tutorial_start: () => ({ type: 'tutorial_start' }),
  tutorial_skip: () => ({ type: 'tutorial_skip' }),
  queue_join: withField((m) => oneOf(m.mode, MODES), (mode) => ({ type: 'queue_join', mode })),
  queue_leave: () => ({ type: 'queue_leave' }),
  create_room: withField((m) => createRoomOpts(m.opts), (opts) => ({ type: 'create_room', opts })),
  join_room: withField(
    (m) => rawString(m.code, ROOM_CODE_FIELD_MAX),
    (code) => ({ type: 'join_room', code: code.toUpperCase() }),
  ),
  room_list_request: roomListRequest,
  room_list_watch: withField((m) => bool(m.on), (on) => ({ type: 'room_list_watch', on })),
  leave_room: () => ({ type: 'leave_room' }),
  set_slot: setSlot,
  set_ready: withField((m) => bool(m.ready), (ready) => ({ type: 'set_ready', ready })),
  start_match: () => ({ type: 'start_match' }),
  input,
  emote: withField((m) => oneOf(m.id, EMOTES), (id) => ({ type: 'emote', id })),
  rematch_vote: withField((m) => bool(m.yes), (yes) => ({ type: 'rematch_vote', yes })),
  pong: withField((m) => numberIn(m.t, 0, MAX_TIMESTAMP), (t) => ({ type: 'pong', t })),
};

export function isC2SType(type: string): type is C2SType {
  return Object.prototype.hasOwnProperty.call(VALIDATORS, type);
}
