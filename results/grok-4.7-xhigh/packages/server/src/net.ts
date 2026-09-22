import { createHash, randomUUID } from 'node:crypto';
import {
  CONFIG,
  type AnimalId,
  type ClientMsg,
  type Difficulty,
  type HatId,
  type Mode,
  type RoomOpts,
} from '@splash/shared';
import type { WebSocket } from 'ws';
import { joinQueue, leaveQueue } from './matchmaker.js';
import { cleanNick, guestName, itemIdAnimal, itemIdHat } from './names.js';
import {
  createRoom,
  emote,
  joinRoom,
  leaveRoom,
  listRooms,
  lobbyOf,
  pushInput,
  pushResume,
  roomOf,
  rooms,
  setReady,
  setSlot,
  startMatch,
  vote,
} from './rooms.js';
import { q, sendTo, session, sessions, type Session } from './wire.js';

const sockets = new WeakMap<WebSocket, { playerId: string | null; hits: number[] }>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function allow(ws: WebSocket): boolean {
  const meta = sockets.get(ws);
  if (!meta) return false;
  const now = Date.now();
  meta.hits = meta.hits.filter((t) => now - t < 1000);
  if (meta.hits.length >= CONFIG.RATE_LIMIT_PER_SEC) return false;
  meta.hits.push(now);
  return true;
}

function ensure(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = {
      playerId: id,
      ws: null,
      roomCode: null,
      queueMode: null,
      queueJoinedAt: 0,
      rtt: 0,
      lastEmote: 0,
      inputQueue: [],
      lastDir: 0,
      ackSeq: 0,
      disconnectedAt: null,
    };
    sessions.set(id, s);
  }
  return s;
}

function bind(ws: WebSocket, playerId: string, token: string) {
  const s = ensure(playerId);
  if (s.ws && s.ws !== ws) {
    try { s.ws.close(); } catch { /* ignore */ }
  }
  s.ws = ws;
  s.disconnectedAt = null;
  const meta = sockets.get(ws);
  if (meta) meta.playerId = playerId;
  const profile = q.profile(playerId);
  if (!profile) return;
  sendTo(playerId, { t: 'welcome', playerId, profile, token });
  if (s.roomCode && rooms.has(s.roomCode)) pushResume(playerId);
}

function hello(ws: WebSocket, token?: string) {
  if (token) {
    const row = q.byToken(hashToken(token));
    if (row) {
      bind(ws, row.id, token);
      return;
    }
  }
  const issued = randomUUID();
  const id = randomUUID();
  let tag = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  let nick = guestName(Math.random);
  for (let i = 0; i < 8 && q.nickTaken(nick, tag); i++) {
    tag = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    nick = guestName(Math.random);
  }
  q.createPlayer({ id, token_hash: hashToken(issued), nickname: nick, tag });
  bind(ws, id, issued);
}

function parse(raw: string): ClientMsg | null {
  if (raw.length > CONFIG.MAX_MSG_BYTES) return null;
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object' || typeof (msg as { t?: string }).t !== 'string') return null;
  return msg as ClientMsg;
}

function requireId(ws: WebSocket): string | null {
  return sockets.get(ws)?.playerId ?? null;
}

export function attachSocket(ws: WebSocket) {
  sockets.set(ws, { playerId: null, hits: [] });
  ws.on('message', (data) => {
    const text = typeof data === 'string' ? data : data.toString();
    const meta = sockets.get(ws);
    if (meta?.playerId && !allow(ws)) return;
    const msg = parse(text);
    if (!msg) return;
    if (msg.t === 'hello') {
      hello(ws, msg.token);
      return;
    }
    const id = requireId(ws);
    if (!id) {
      ws.send(JSON.stringify({ t: 'error', code: 'hello', msg: 'Say hello first.' }));
      return;
    }
    handle(id, msg);
  });
  ws.on('close', () => {
    const id = sockets.get(ws)?.playerId;
    if (!id) return;
    const s = session(id);
    if (s && s.ws === ws) {
      s.ws = null;
      s.disconnectedAt = Date.now();
      leaveQueue(id);
    }
  });
}

function handle(id: string, msg: ClientMsg) {
  const s = session(id);
  if (!s) return;
  if (msg.t === 'pong') {
    if (typeof msg.serverTime === 'number') s.rtt = Math.max(0, Date.now() - msg.serverTime);
    return;
  }
  if (msg.t === 'set_nickname') {
    const cleaned = cleanNick(msg.nickname ?? '');
    if (!cleaned.ok) {
      sendTo(id, { t: 'error', code: cleaned.code, msg: cleaned.msg });
      return;
    }
    let tag = q.byId(id)?.tag ?? '0000';
    if (q.nickTaken(cleaned.nick, tag, id)) {
      for (let i = 0; i < 20; i++) {
        tag = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        if (!q.nickTaken(cleaned.nick, tag, id)) break;
      }
    }
    q.setNickname(id, cleaned.nick, tag);
    const profile = q.profile(id);
    if (profile) sendTo(id, { t: 'profile', profile });
    const room = roomOf(id);
    if (room) {
      const slot = room.slots.find((sl) => sl.playerId === id);
      if (slot && profile) slot.name = `${profile.nickname}#${profile.tag}`;
      for (const sl of room.slots) {
        if (sl.kind === 'human' && sl.playerId) sendTo(sl.playerId, { t: 'lobby_state', room: lobbyOf(room) });
      }
    }
    return;
  }
  if (msg.t === 'set_cosmetic') {
    const prof = q.profile(id);
    if (!prof) return;
    let animal = prof.animal;
    let hat = prof.hat;
    if (msg.animal) {
      if (!q.hasUnlock(id, itemIdAnimal(msg.animal as AnimalId))) {
        sendTo(id, { t: 'error', code: 'locked', msg: 'That critter is still locked.' });
        return;
      }
      animal = msg.animal;
    }
    if (msg.hat === null) hat = null;
    else if (msg.hat) {
      if (!q.hasUnlock(id, itemIdHat(msg.hat as HatId))) {
        sendTo(id, { t: 'error', code: 'locked', msg: 'That hat is still locked.' });
        return;
      }
      hat = msg.hat;
    }
    q.setCosmetic(id, animal, hat);
    const profile = q.profile(id);
    if (profile) sendTo(id, { t: 'profile', profile });
    return;
  }
  if (msg.t === 'tutorial_complete') {
    const row = q.byId(id);
    if (row && !row.tutorial_done && !msg.skipped) q.addXp(id, CONFIG.XP_TUTORIAL);
    if (row) q.setTutorial(id);
    const profile = q.profile(id);
    if (profile) sendTo(id, { t: 'profile', profile });
    return;
  }
  if (msg.t === 'delete_account') {
    leaveQueue(id);
    leaveRoom(id, true);
    q.deletePlayer(id);
    sessions.delete(id);
    s.ws?.close();
    return;
  }
  if (msg.t === 'queue_join') {
    const err = joinQueue(id, msg.mode);
    if (err) sendTo(id, { t: 'error', code: 'need_nickname', msg: err });
    else {
      sendTo(id, { t: 'queue_status', eta: 20, searchRange: CONFIG.MM_BASE_RANGE, elapsed: 0, mode: msg.mode });
    }
    return;
  }
  if (msg.t === 'queue_leave') {
    leaveQueue(id);
    return;
  }
  if (msg.t === 'create_room') {
    if (s.roomCode) {
      sendTo(id, { t: 'error', code: 'in_match', msg: 'Leave your current room first.' });
      return;
    }
    leaveQueue(id);
    const opts = sanitizeOpts(msg.opts);
    const room = createRoom(id, opts);
    sendTo(id, { t: 'room_created', code: room.code, room: lobbyOf(room) });
    sendTo(id, { t: 'lobby_state', room: lobbyOf(room) });
    return;
  }
  if (msg.t === 'join_room') {
    leaveQueue(id);
    if (s.roomCode && s.roomCode !== msg.code?.toUpperCase()) leaveRoom(id, false);
    const res = joinRoom(msg.code ?? '', id);
    if (!res.ok) {
      sendTo(id, { t: 'error', code: res.code, msg: res.msg });
      return;
    }
    s.roomCode = res.room.code;
    for (const sl of res.room.slots) {
      if (sl.kind === 'human' && sl.playerId) sendTo(sl.playerId, { t: 'lobby_state', room: lobbyOf(res.room) });
    }
    pushResume(id);
    return;
  }
  if (msg.t === 'room_list_request') {
    sendTo(id, { t: 'room_list', rooms: listRooms(msg.mode) });
    return;
  }
  if (msg.t === 'leave_room') {
    leaveRoom(id, true);
    return;
  }
  if (msg.t === 'set_slot') {
    const room = roomOf(id);
    if (!room) return;
    const err = setSlot(room, id, msg.slot | 0, msg.kind, msg.difficulty as Difficulty | undefined);
    if (err) sendTo(id, { t: 'error', code: err, msg: 'Could not change that slot.' });
    return;
  }
  if (msg.t === 'set_ready') {
    const room = roomOf(id);
    if (room) setReady(room, id, !!msg.ready);
    return;
  }
  if (msg.t === 'start_match') {
    const room = roomOf(id);
    if (!room) return;
    const err = startMatch(room, id);
    if (err) sendTo(id, { t: 'error', code: 'invalid', msg: err });
    return;
  }
  if (msg.t === 'input') {
    pushInput(id, msg);
    return;
  }
  if (msg.t === 'emote') {
    emote(id, msg.id | 0);
    return;
  }
  if (msg.t === 'rematch_vote') {
    const room = roomOf(id);
    if (room) vote(room, id, !!msg.yes);
    return;
  }
}

function sanitizeOpts(opts: RoomOpts | undefined): RoomOpts {
  const mode: Mode = opts?.mode === 'ffa' ? 'ffa' : 'duel';
  const rounds = opts?.roundsToWin === 2 || opts?.roundsToWin === 5 ? opts.roundsToWin : 3;
  const theme = opts?.theme === 'beach' || opts?.theme === 'pool' || opts?.theme === 'random' ? opts.theme : 'backyard';
  const name = (opts?.name ?? 'Splash Room').toString().replace(/[^\w\s'-]/g, '').trim().slice(0, 24) || 'Splash Room';
  return { name, mode, public: !!opts?.public, theme, roundsToWin: rounds, botFill: !!opts?.botFill };
}
