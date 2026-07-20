/**
 * WebSocket message dispatch. Validates each ClientMsg and routes it to the
 * account layer, matchmaker, or the client's room. Never trusts positions.
 */

import {
  CONFIG,
  ERR,
  type ClientMsg,
  type CreateRoomOpts,
  type Difficulty,
  type Dir,
  type Mode,
} from '@splash/shared';
import type { ServerContext } from './context';
import type { Client } from './net';
import { isAnimal, isHat } from './progression';
import {
  generateGuestName,
  hashToken,
  newId,
  newToken,
  randomTag,
  validateNickname,
} from './util';

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const MODES: Mode[] = ['duel', 'ffa'];
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

function err(client: Client, code: string, msg: string): void {
  client.send({ type: 'error', code, msg });
}

export function handleMessage(ctx: ServerContext, client: Client, raw: string): void {
  if (!client.allow()) return;
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    return err(client, ERR.BAD_MSG, 'Malformed message');
  }
  if (!msg || typeof (msg as { type?: unknown }).type !== 'string') {
    return err(client, ERR.BAD_MSG, 'Missing type');
  }

  // hello must come first; everything else needs an id
  if (msg.type === 'hello') return onHello(ctx, client, msg);
  if (!client.id) return err(client, ERR.BAD_MSG, 'Say hello first');

  switch (msg.type) {
    case 'set_nickname':
      return onSetNickname(ctx, client, msg.name);
    case 'set_loadout':
      return onSetLoadout(ctx, client, msg.animal, msg.hat);
    case 'queue_join':
      return onQueueJoin(ctx, client, msg.mode);
    case 'queue_leave':
      ctx.mm.leave(client);
      return;
    case 'create_room':
      return onCreateRoom(ctx, client, msg.opts);
    case 'join_room':
      return onJoinRoom(ctx, client, msg.code);
    case 'room_list_request':
      return void client.send({ type: 'room_list', rooms: ctx.rooms.publicList(msg.mode ?? 'all') });
    case 'leave_room':
      return onLeaveRoom(ctx, client);
    case 'set_slot':
      if (typeof msg.slot === 'number' && ['open', 'bot', 'closed'].includes(msg.kind)) {
        client.room?.setSlot(client, msg.slot, msg.kind, resolveDiff(msg.difficulty));
      }
      return;
    case 'set_ready':
      client.room?.setReady(client, !!msg.ready);
      return;
    case 'start_match':
      client.room?.startMatch(client);
      return;
    case 'practice':
      return onPractice(ctx, client, msg.mode, msg.bots);
    case 'input':
      return onInput(client, msg.inputs);
    case 'emote':
      client.room?.match?.emote(client.id, Number(msg.id) | 0);
      return;
    case 'rematch_vote':
      client.room?.rematchVote(client, !!msg.vote);
      return;
    case 'tutorial_done':
      return onTutorialDone(ctx, client);
    case 'pong':
      client.lastPongMs = Date.now();
      if (typeof msg.t === 'number') client.rttMs = Math.max(0, Date.now() - msg.t);
      return;
    default:
      return err(client, ERR.BAD_MSG, 'Unknown message');
  }
}

function refreshProfile(ctx: ServerContext, client: Client): void {
  const prof = ctx.q.buildProfile(client.id);
  if (prof) {
    client.profile = prof;
    client.send({ type: 'profile', profile: prof });
  }
}

function onHello(ctx: ServerContext, client: Client, msg: Extract<ClientMsg, { type: 'hello' }>): void {
  let row = msg.token ? ctx.q.getByToken(hashToken(msg.token)) : undefined;
  let token = msg.token;
  if (!row) {
    const id = newId();
    token = newToken();
    const gn = generateGuestName();
    row = ctx.q.createGuest(id, hashToken(token), gn.nickname, gn.tag);
  }
  client.id = row.id;
  client.token = token!;
  client.connected = true;

  const existing = ctx.byId.get(row.id);
  if (existing && existing !== client) {
    try {
      existing.ws.close();
    } catch {
      /* already closing */
    }
  }
  ctx.byId.set(row.id, client);
  client.profile = ctx.q.buildProfile(row.id)!;
  client.send({ type: 'welcome', profile: client.profile, token: token! });

  // only rejoin a live match in progress (disconnect grace) — never a room the
  // player already finished/left, which would silently trap them "in a room".
  const room = ctx.rooms.findRoomForPlayer(row.id);
  if (room && room.phase === 'in_match' && !client.room) room.reattach(client);
}

function onSetNickname(ctx: ServerContext, client: Client, name: unknown): void {
  if (typeof name !== 'string') return err(client, ERR.BAD_NICK, 'Bad nickname');
  const v = validateNickname(name);
  if (!v.ok || !v.clean) return err(client, ERR.BAD_NICK, v.reason ?? 'Bad nickname');
  let tag = client.profile?.tag ?? randomTag();
  if (ctx.q.nicknameTaken(v.clean, tag, client.id)) {
    let tries = 0;
    do {
      tag = randomTag();
      tries++;
    } while (ctx.q.nicknameTaken(v.clean, tag, client.id) && tries < 25);
    if (ctx.q.nicknameTaken(v.clean, tag, client.id)) return err(client, ERR.NICK_TAKEN, 'Nickname taken');
  }
  ctx.q.setNickname(client.id, v.clean, tag);
  refreshProfile(ctx, client);
}

function onSetLoadout(ctx: ServerContext, client: Client, animal: unknown, hat: unknown): void {
  if (typeof animal !== 'string' || typeof hat !== 'string' || !isAnimal(animal) || !isHat(hat)) {
    return err(client, ERR.BAD_MSG, 'Bad loadout');
  }
  const unlocks = client.profile?.unlocks ?? [];
  if (!unlocks.includes(animal) || !unlocks.includes(hat)) {
    return err(client, ERR.BAD_MSG, 'Item not unlocked');
  }
  ctx.q.setLoadout(client.id, animal, hat);
  refreshProfile(ctx, client);
}

function onQueueJoin(ctx: ServerContext, client: Client, mode: unknown): void {
  if (typeof mode !== 'string' || !MODES.includes(mode as Mode)) return;
  if (client.room) return err(client, ERR.IN_MATCH, 'Leave your room first');
  const res = ctx.mm.join(client, mode as Mode);
  if (!res.ok) err(client, res.error ?? ERR.BAD_MSG, 'Cannot queue');
}

function resolveDiff(d: unknown): Difficulty | undefined {
  return typeof d === 'string' && DIFFS.includes(d as Difficulty) ? (d as Difficulty) : undefined;
}

function sanitizeOpts(raw: CreateRoomOpts): CreateRoomOpts | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!MODES.includes(raw.mode)) return null;
  const rounds = (CONFIG.ALLOWED_ROUNDS_TO_WIN as readonly number[]).includes(raw.roundsToWin)
    ? raw.roundsToWin
    : CONFIG.DEFAULT_ROUNDS_TO_WIN;
  const theme = ['backyard', 'beach', 'pool', 'random'].includes(raw.theme) ? raw.theme : 'random';
  const name = (typeof raw.name === 'string' ? raw.name : '').trim().slice(0, 24) || 'Splash Room';
  return {
    name,
    mode: raw.mode,
    isPublic: !!raw.isPublic,
    theme,
    roundsToWin: rounds,
    botFill: !!raw.botFill,
  };
}

function onCreateRoom(ctx: ServerContext, client: Client, rawOpts: CreateRoomOpts): void {
  if (client.room) return err(client, ERR.IN_MATCH, 'Leave your room first');
  ctx.mm.leave(client);
  const opts = sanitizeOpts(rawOpts);
  if (!opts) return err(client, ERR.BAD_MSG, 'Bad room options');
  const room = ctx.rooms.create(opts, client);
  client.send({ type: 'room_created', code: room.code });
}

function onJoinRoom(ctx: ServerContext, client: Client, code: unknown): void {
  if (typeof code !== 'string' || code.length < 4) return err(client, ERR.NO_ROOM, 'Bad code');
  if (client.room) return err(client, ERR.IN_MATCH, 'Leave your room first');
  ctx.mm.leave(client);
  const res = ctx.rooms.join(client, code.trim());
  if (!res.ok) err(client, res.error ?? ERR.NO_ROOM, 'Cannot join room');
}

function onLeaveRoom(ctx: ServerContext, client: Client): void {
  ctx.mm.leave(client);
  const room = client.room;
  if (!room) return;
  room.removeClient(client);
  if (room.humanClients().length === 0 && room.phase !== 'in_match') ctx.rooms.remove(room.code);
}

function onPractice(ctx: ServerContext, client: Client, mode: unknown, bots: unknown): void {
  if (client.room) return err(client, ERR.IN_MATCH, 'Leave your room first');
  if (typeof mode !== 'string' || !MODES.includes(mode as Mode)) return;
  const botList = Array.isArray(bots)
    ? bots.filter((b): b is Difficulty => DIFFS.includes(b as Difficulty))
    : [];
  ctx.mm.leave(client);
  const opts: CreateRoomOpts = {
    name: 'Practice',
    mode: mode as Mode,
    isPublic: false,
    theme: 'random',
    roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
    botFill: false,
  };
  const room = ctx.rooms.create(opts, client, false, true);
  botList.slice(0, CONFIG.ARENA[mode as Mode].players - 1).forEach((diff, i) => {
    room.setSlot(client, i + 1, 'bot', diff);
  });
  room.startMatch(client);
}

function onInput(client: Client, inputs: unknown): void {
  if (!client.room || client.room.phase !== 'in_match' || !Array.isArray(inputs)) return;
  for (const inp of inputs) {
    if (!inp || typeof inp.seq !== 'number') continue;
    if (inp.seq <= client.lastInputSeq) continue;
    client.lastInputSeq = inp.seq;
    client.heldDir = DIRS.includes(inp.dir) ? inp.dir : null;
    if (inp.balloon === true) client.pendingBalloon = true;
  }
}

function onTutorialDone(ctx: ServerContext, client: Client): void {
  ctx.q.addXp(client.id, 30);
  refreshProfile(ctx, client);
}
