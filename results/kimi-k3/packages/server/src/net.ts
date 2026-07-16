import { AnimalId, ClientMessage, CONFIG, HatId, RoomOptions, ServerMessage } from '@splash/shared';
import { WebSocket, WebSocketServer } from 'ws';
import * as db from './db/index.js';
import { Matchmaker } from './matchmaker.js';
import { profileDtoForSend } from './profile.js';
import { ClientConn, RoomManager } from './rooms.js';

interface Session {
  ws: WebSocket;
  client: ClientConn | null;
  msgTimes: number[];
  lastEmoteAt: number;
  lastPongRtt: number;
}

export function profileDto(playerId: string) {
  return profileDtoForSend(playerId);
}

export function setupNet(wss: WebSocketServer, rooms: RoomManager, matchmaker: Matchmaker): void {
  const sessions = new Set<Session>();

  setInterval(() => {
    for (const s of sessions) {
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(JSON.stringify({ t: 'ping', t0: Date.now() } satisfies ServerMessage));
      }
    }
  }, CONFIG.PING_INTERVAL_MS);

  wss.on('connection', (ws) => {
    const session: Session = { ws, client: null, msgTimes: [], lastEmoteAt: 0, lastPongRtt: 0 };
    sessions.add(session);

    ws.on('message', (data) => {
      const now = Date.now();
      session.msgTimes = session.msgTimes.filter((t) => now - t < 1000);
      session.msgTimes.push(now);
      if (session.msgTimes.length > CONFIG.RATE_LIMIT_MSGS_PER_SEC) return;
      const raw = String(data);
      if (raw.length > 4096) return;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw) as ClientMessage;
      } catch {
        return;
      }
      try {
        handleMessage(session, msg, rooms, matchmaker);
      } catch (err) {
        console.error('message error', err);
      }
    });

    ws.on('close', () => {
      sessions.delete(session);
      if (session.client) {
        matchmaker.leave(session.client);
        rooms.onDisconnect(session.client);
      }
    });
  });
}

function send(session: Session, msg: ServerMessage): void {
  if (session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(msg));
  }
}

function handleMessage(session: Session, msg: ClientMessage, rooms: RoomManager, matchmaker: Matchmaker): void {
  if (msg.t === 'hello') {
    let token = msg.token;
    let player = token ? db.getPlayerByToken(token) : undefined;
    if (!player) {
      const guest = db.createGuest();
      player = guest.player;
      token = guest.token;
    }
    const client: ClientConn = {
      ws: session.ws,
      playerId: player.id,
      nickname: player.nickname,
      tag: player.tag,
      animal: player.selected_animal as AnimalId,
      hat: player.selected_hat as HatId,
      send: (m) => send(session, m),
    };
    session.client = client;
    const profile = profileDto(player.id)!;
    send(session, { t: 'welcome', playerId: player.id, token: token!, profile });
    const room = rooms.reattach(client);
    if (room) {
      client.send({ t: 'snapshot', s: room.buildSnapshot() });
    }
    return;
  }

  const client = session.client;
  if (!client) {
    send(session, { t: 'error', code: 'not_authed', msg: 'Say hello first' });
    return;
  }

  switch (msg.t) {
    case 'set_nickname': {
      const res = db.setNickname(client.playerId, msg.nickname.trim());
      if (!res.ok) {
        send(session, { t: 'error', code: 'nickname', msg: res.error ?? 'Invalid nickname' });
        return;
      }
      const p = db.getPlayer(client.playerId)!;
      client.nickname = p.nickname;
      client.tag = p.tag;
      send(session, { t: 'profile', profile: profileDto(client.playerId)! });
      const room = rooms.findRoomForPlayer(client.playerId);
      if (room && room.phase === 'lobby') {
        const idx = room.findClientSlot(client.playerId);
        if (idx >= 0) {
          room.slots[idx]!.nickname = p.nickname;
          room.slots[idx]!.tag = p.tag;
          room.broadcastLobby();
        }
      }
      break;
    }
    case 'queue_join': {
      const res = matchmaker.join(client, msg.mode);
      if (!res.ok) send(session, { t: 'error', code: 'queue', msg: res.error ?? 'Cannot queue' });
      else {
        const rating = db.getRating(client.playerId, msg.mode);
        send(session, { t: 'queue_status', mode: msg.mode, eta: 15, searchRange: CONFIG.MATCHMAKING.BASE_RANGE, inQueue: 1 });
        void rating;
      }
      break;
    }
    case 'queue_leave':
      matchmaker.leave(client);
      break;
    case 'create_room': {
      const opts = sanitizeRoomOptions(msg.opts);
      if (!opts) {
        send(session, { t: 'error', code: 'room_opts', msg: 'Invalid room options' });
        return;
      }
      if (rooms.findRoomForPlayer(client.playerId)) rooms.leaveRoom(client);
      const room = rooms.createRoom(client, opts);
      send(session, { t: 'room_created', code: room.code });
      room.broadcastLobby();
      break;
    }
    case 'join_room': {
      if (rooms.findRoomForPlayer(client.playerId)) rooms.leaveRoom(client);
      const res = rooms.joinRoom(client, msg.code);
      if (!res.ok) {
        send(session, { t: 'error', code: 'join', msg: res.error ?? 'Cannot join' });
        return;
      }
      res.room!.broadcastLobby();
      break;
    }
    case 'room_list_request':
      send(session, { t: 'room_list', rooms: rooms.listPublic() });
      break;
    case 'leave_room':
      rooms.leaveRoom(client);
      break;
    case 'set_slot':
      rooms.setSlot(client, msg.slot, msg.kind, msg.difficulty);
      break;
    case 'set_ready':
      rooms.setReady(client, msg.ready);
      break;
    case 'start_match':
      rooms.startMatch(client);
      break;
    case 'input': {
      const dir = msg.dir;
      if (dir < 0 || dir > 4) return;
      rooms.handleInput(client, msg.seq, dir as 0 | 1 | 2 | 3 | 4, !!msg.balloon);
      break;
    }
    case 'emote': {
      const now = Date.now();
      if (now - session.lastEmoteAt < CONFIG.EMOTE_COOLDOWN_MS) return;
      session.lastEmoteAt = now;
      if (msg.id < 0 || msg.id >= CONFIG.EMOTES.length) return;
      rooms.handleEmote(client, msg.id);
      break;
    }
    case 'rematch_vote':
      rooms.rematchVote(client);
      break;
    case 'set_cosmetics': {
      const unlocks = db.getUnlocks(client.playerId);
      const animalOk = (CONFIG.ANIMALS as readonly string[]).includes(msg.animal) && unlocks.includes(`animal:${msg.animal}`);
      const hatOk = (CONFIG.HATS as readonly string[]).includes(msg.hat) && unlocks.includes(`hat:${msg.hat}`);
      if (animalOk && hatOk) {
        db.setCosmetics(client.playerId, msg.animal, msg.hat);
        client.animal = msg.animal;
        client.hat = msg.hat;
        send(session, { t: 'profile', profile: profileDto(client.playerId)! });
      } else {
        send(session, { t: 'error', code: 'locked', msg: 'Cosmetic not unlocked' });
      }
      break;
    }
    case 'tutorial_complete': {
      const p = db.getPlayer(client.playerId);
      if (p && p.tutorial_done !== 1) {
        db.markTutorialDone(client.playerId);
        db.addXp(client.playerId, CONFIG.XP.TUTORIAL_BONUS);
      }
      send(session, { t: 'profile', profile: profileDto(client.playerId)! });
      break;
    }
    case 'pong':
      session.lastPongRtt = Date.now() - msg.t0;
      break;
  }
}

function sanitizeRoomOptions(opts: RoomOptions): RoomOptions | null {
  if (!opts || typeof opts !== 'object') return null;
  const name = String(opts.name ?? '').trim().slice(0, CONFIG.MAX_ROOM_NAME_LEN) || 'Splash Room';
  if (opts.size !== 2 && opts.size !== 4) return null;
  const rounds = opts.roundsToWin;
  if (rounds !== 2 && rounds !== 3 && rounds !== 5) return null;
  const theme = opts.theme === 'random' ? 'random' : (['backyard', 'beach', 'pool'] as const).includes(opts.theme as never) ? opts.theme : null;
  if (!theme) return null;
  return {
    name,
    size: opts.size,
    isPublic: !!opts.isPublic,
    theme,
    roundsToWin: rounds,
    botFill: !!opts.botFill,
  };
}
