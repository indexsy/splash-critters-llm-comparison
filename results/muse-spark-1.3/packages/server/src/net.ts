import type { WebSocket } from 'ws';
import { CONFIG, tierFor, type AnimalId, type BotDifficulty, type ClientMsg, type GameEvent, type HatId, type ServerMsg } from '@splash/shared';
import { RoomManager, type Room } from './rooms.js';
import { Matchmaker } from './matchmaker.js';
import { finalizeMatch } from './eloApply.js';
import { createGuest, getPlayerByTokenHash, getPlayerById, hashToken, setNickname as dbSetNickname, setCosmetics, getRatings } from './db/db.js';

interface Conn {
  ws: WebSocket;
  playerId: string;
  token: string;
  roomCode?: string;
  msgTimes: number[];
  emoteLast: number;
  nickSet: boolean;
  lastPong: number;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  } catch { /* ignore */ }
}

export class GameServer {
  rooms = new RoomManager();
  mm = new Matchmaker();
  conns = new Map<string, Conn>(); // playerId -> conn
  wsToPlayer = new Map<WebSocket, string>();
  disconnectTimers = new Map<string, NodeJS.Timeout>();
  soaksLive = new Map<string, Record<string, number>>(); // roomCode -> pid -> soaks
  lastRoundSent = new Map<string, number>();

  constructor() {
    this.mm.onMatch = (mode, players) => {
      const room = this.rooms.createRankedRoom(
        mode,
        players.map((p) => ({ id: p.playerId, nickname: p.nickname, animal: p.animal as AnimalId, hat: p.hat as HatId })),
      );
      for (const p of players) {
        const c = this.conns.get(p.playerId);
        if (c) {
          c.roomCode = room.code;
          send(c.ws, { kind: 'match_found', code: room.code });
        }
      }
      this.startRoomGame(room);
    };
    setInterval(() => this.mm.tick(), CONFIG.MM_TICK_MS);
    setInterval(() => this.rooms.gc(), 60_000);
    setInterval(() => this.broadcastQueueStatus(), 1000);
    setInterval(() => {
      // ping all
      for (const c of this.conns.values()) send(c.ws, { kind: 'ping', t: Date.now() });
    }, 2000);
  }

  handleWs(ws: WebSocket): void {
    ws.on('message', (raw) => this.onMessage(ws, raw.toString()));
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => {});
  }

  private connOf(ws: WebSocket): Conn | undefined {
    const pid = this.wsToPlayer.get(ws);
    return pid ? this.conns.get(pid) : undefined;
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      send(ws, { kind: 'error', code: 'bad_json', msg: 'Invalid message.' });
      return;
    }
    // hello is unauthenticated
    if (msg.kind === 'hello') {
      this.handleHello(ws, msg.token);
      return;
    }
    const conn = this.connOf(ws);
    if (!conn) {
      send(ws, { kind: 'error', code: 'no_auth', msg: 'Send hello first.' });
      return;
    }
    // rate limit 60/s
    const now = Date.now();
    conn.msgTimes = conn.msgTimes.filter((t) => now - t < 1000);
    conn.msgTimes.push(now);
    if (conn.msgTimes.length > CONFIG.RATE_LIMIT_PER_SEC) {
      send(ws, { kind: 'error', code: 'rate_limit', msg: 'Too many messages.' });
      return;
    }
    // validation dispatch
    try {
      switch (msg.kind) {
        case 'set_nickname': {
          const r = dbSetNickname(conn.playerId, msg.nickname);
          if (!r.ok) send(ws, { kind: 'error', code: 'bad_nick', msg: r.msg! });
          else {
            conn.nickSet = true;
            this.sendWelcome(ws, conn.playerId, conn.token);
            // refresh lobby nick
            if (conn.roomCode) this.broadcastLobby(conn.roomCode);
          }
          break;
        }
        case 'set_cosmetics': {
          const animals = ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara'];
          const hats = ['none', 'bucket', 'snorkel', 'crown', 'bandana', 'propeller'];
          if (!animals.includes(msg.animal) || !hats.includes(msg.hat)) {
            send(ws, { kind: 'error', code: 'bad_cosmetic', msg: 'Invalid cosmetic.' });
            break;
          }
          setCosmetics(conn.playerId, msg.animal, msg.hat);
          if (conn.roomCode) {
            const room = this.rooms.get(conn.roomCode);
            const sl = room?.slots.find((s) => s.playerId === conn.playerId);
            if (sl) {
              sl.animal = msg.animal;
              sl.hat = msg.hat;
              this.broadcastLobby(room!.code);
            }
          }
          this.sendWelcome(ws, conn.playerId, conn.token);
          break;
        }
        case 'queue_join': {
          if (!conn.nickSet) {
            // allow if nickname was explicitly customized before (persist check: none) — require it now
            send(ws, { kind: 'error', code: 'need_nick', msg: 'Set a nickname before ranked.' });
            break;
          }
          if (msg.mode !== 'duel' && msg.mode !== 'ffa') break;
          const p = getPlayerById(conn.playerId);
          const ratings = getRatings(conn.playerId);
          this.mm.join(msg.mode, {
            playerId: conn.playerId,
            nickname: p?.nickname ?? 'Critter',
            animal: p?.selected_animal ?? 'frog',
            hat: p?.selected_hat ?? 'none',
            rating: ratings[msg.mode].rating,
            joinedAt: Date.now(),
          });
          break;
        }
        case 'queue_leave':
          this.mm.leave(conn.playerId);
          break;
        case 'create_room': {
          const maxPlayers = msg.maxPlayers === 2 ? 2 : 4;
          const theme = ['backyard', 'beach', 'pool', 'random'].includes(msg.theme) ? msg.theme : 'random';
          const roundsToWin = [2, 3, 5].includes(msg.roundsToWin) ? msg.roundsToWin : 3;
          const p = getPlayerById(conn.playerId);
          if (conn.roomCode) this.leaveRoom(conn);
          const room = this.rooms.createRoom({
            name: String(msg.name ?? 'Splash Room'),
            maxPlayers,
            isPublic: !!msg.isPublic,
            theme,
            roundsToWin: roundsToWin as 2 | 3 | 5,
            hostId: conn.playerId,
            hostNick: p?.nickname ?? 'Host',
            animal: (p?.selected_animal ?? 'frog') as AnimalId,
            hat: (p?.selected_hat ?? 'none') as HatId,
          });
          conn.roomCode = room.code;
          send(ws, { kind: 'room_created', code: room.code });
          this.broadcastLobby(room.code);
          break;
        }
        case 'join_room': {
          const code = String(msg.code ?? '').toUpperCase();
          if (conn.roomCode) this.leaveRoom(conn);
          const p = getPlayerById(conn.playerId);
          const r = this.rooms.joinRoom(code, conn.playerId, p?.nickname ?? 'Critter', (p?.selected_animal ?? 'frog') as AnimalId, (p?.selected_hat ?? 'none') as HatId);
          if (!r.ok) send(ws, { kind: 'error', code: 'join_fail', msg: r.msg! });
          else {
            conn.roomCode = code;
            // cancel forfeit timer (reconnect)
            const t = this.disconnectTimers.get(conn.playerId);
            if (t) {
              clearTimeout(t);
              this.disconnectTimers.delete(conn.playerId);
              // reattach sim player
              const room = this.rooms.get(code);
              const pl = room?.game?.state.players.find((pp) => pp.id === conn.playerId);
              if (pl) pl.disconnected = false;
              const sl = room?.slots.find((s) => s.playerId === conn.playerId);
              if (sl) sl.connected = true;
            }
            this.broadcastLobby(code);
          }
          break;
        }
        case 'room_list_request': {
          const filter = msg.mode === '2p' ? '2p' : msg.mode === '4p' ? '4p' : 'all';
          const rooms = this.rooms.listPublic(filter).map((r) => ({
            code: r.code,
            name: r.name,
            mode: r.maxPlayers === 2 ? '2p' : '4p',
            players: r.slots.filter((s) => s.kind !== 'empty').length,
            maxPlayers: r.maxPlayers,
            theme: r.theme,
            host: r.slots.find((s) => s.playerId === r.hostId)?.nickname ?? '?',
          }));
          send(ws, { kind: 'room_list', rooms });
          break;
        }
        case 'leave_room':
          if (conn.roomCode) {
            const code = conn.roomCode;
            this.leaveRoom(conn);
            void code;
          }
          break;
        case 'set_slot': {
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          if (!room) break;
          const ok = this.rooms.setSlot(room.code, conn.playerId, msg.slot, msg.botKind, msg.difficulty as BotDifficulty);
          if (!ok) send(ws, { kind: 'error', code: 'slot_fail', msg: 'Cannot change slot.' });
          else this.broadcastLobby(room.code);
          break;
        }
        case 'set_ready': {
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          const sl = room?.slots.find((s) => s.playerId === conn.playerId);
          if (sl) {
            sl.ready = !!msg.ready;
            this.broadcastLobby(room!.code);
          }
          break;
        }
        case 'start_match': {
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          if (!room || room.hostId !== conn.playerId) {
            send(ws, { kind: 'error', code: 'not_host', msg: 'Only host can start.' });
            break;
          }
          this.startRoomGame(room);
          break;
        }
        case 'input': {
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          if (!room?.game) break;
          if (typeof msg.dx !== 'number' || typeof msg.dy !== 'number') break;
          if (Math.abs(msg.dx) > 1 || Math.abs(msg.dy) > 1) break; // ignore impossible
          this.rooms.setInput(room, conn.playerId, { seq: msg.seq | 0, tick: 0, dx: msg.dx, dy: msg.dy, balloon: !!msg.balloon });
          break;
        }
        case 'emote': {
          const id = msg.id | 0;
          if (id < 1 || id > 4) break;
          if (now - conn.emoteLast < 1500) break;
          conn.emoteLast = now;
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          if (room) this.broadcastRoom(room, { kind: 'emote_broadcast', from: conn.playerId, id });
          break;
        }
        case 'rematch_vote': {
          const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
          if (!room || room.ranked) break;
          if (msg.yes) room.rematchVotes.add(conn.playerId);
          else room.rematchVotes.delete(conn.playerId);
          const voters = room.slots.filter((s) => s.kind === 'human').length;
          this.broadcastLobby(room.code);
          if (room.status === 'lobby' && room.rematchVotes.size > 0 && room.rematchVotes.size > voters / 2) {
            room.rematchVotes.clear();
            this.startRoomGame(room);
          }
          break;
        }
        case 'pong':
          conn.lastPong = Date.now();
          break;
      }
    } catch (err) {
      send(ws, { kind: 'error', code: 'server_error', msg: 'Server error.' });
    }
  }

  private handleHello(ws: WebSocket, token?: string): void {
    let playerId: string;
    let rawToken: string;
    if (token) {
      const existing = getPlayerByTokenHash(hashToken(token));
      if (existing) {
        playerId = existing.id;
        rawToken = token;
      } else {
        const g = createGuest(token);
        playerId = g.player.id;
        rawToken = g.rawToken;
      }
    } else {
      const g = createGuest('');
      playerId = g.player.id;
      rawToken = g.rawToken;
    }
    // close old conn for same player
    const old = this.conns.get(playerId);
    if (old && old.ws !== ws) {
      try {
        old.ws.close();
      } catch { /* ignore */ }
      this.wsToPlayer.delete(old.ws);
    }
    const conn: Conn = { ws, playerId, token: rawToken, msgTimes: [], emoteLast: 0, nickSet: false, lastPong: Date.now() };
    this.conns.set(playerId, conn);
    this.wsToPlayer.set(ws, playerId);
    // cancel disconnect timer (reconnect)
    const t = this.disconnectTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      this.disconnectTimers.delete(playerId);
      // reattach
      if (conn.roomCode) {
        const room = this.rooms.get(conn.roomCode);
        const pl = room?.game?.state.players.find((p) => p.id === playerId);
        if (pl) pl.disconnected = false;
      }
    }
    // restore room membership
    for (const room of this.rooms.rooms.values()) {
      if (room.slots.some((s) => s.playerId === playerId)) {
        conn.roomCode = room.code;
        const sl = room.slots.find((s) => s.playerId === playerId);
        if (sl) sl.connected = true;
        const pl = room.game?.state.players.find((p) => p.id === playerId);
        if (pl) pl.disconnected = false;
        break;
      }
    }
    this.sendWelcome(ws, playerId, rawToken);
  }

  private sendWelcome(ws: WebSocket, playerId: string, token: string): void {
    const p = getPlayerById(playerId);
    if (!p) return;
    send(ws, {
      kind: 'welcome',
      playerId,
      token,
      nickname: p.nickname,
      tag: p.tag,
      level: p.level,
      xp: p.xp,
      animal: (p.selected_animal ?? 'frog') as AnimalId,
      hat: (p.selected_hat ?? 'none') as HatId,
    });
  }

  private onClose(ws: WebSocket): void {
    const pid = this.wsToPlayer.get(ws);
    if (!pid) return;
    this.wsToPlayer.delete(ws);
    const conn = this.conns.get(pid);
    if (!conn || conn.ws !== ws) return;
    this.mm.leave(pid);
    const roomCode = conn.roomCode;
    this.conns.delete(pid);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const sl = room.slots.find((s) => s.playerId === pid);
    if (sl) sl.connected = false;
    const pl = room.game?.state.players.find((p) => p.id === pid);
    if (pl) pl.disconnected = true;
    // grace timers
    if (room.status === 'playing') {
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(pid);
        const r = this.rooms.get(roomCode);
        if (!r) return;
        const stillGone = !this.conns.has(pid);
        if (!stillGone) return;
        if (r.ranked) {
          this.forfeitRanked(r, pid);
        } else {
          this.rooms.substituteBot(r, pid);
          this.broadcastLobby(r.code);
        }
      }, CONFIG.RECONNECT_GRACE_S * 1000);
      this.disconnectTimers.set(pid, timer);
    } else {
      // in lobby: leave after short delay? keep slot for 60s then free
      const timer = setTimeout(() => {
        this.disconnectTimers.delete(pid);
        if (this.conns.has(pid)) return;
        this.rooms.leaveRoom(roomCode, pid);
        this.broadcastLobby(roomCode);
      }, 60_000);
      this.disconnectTimers.set(pid, timer);
    }
  }

  private leaveRoom(conn: Conn): void {
    const code = conn.roomCode;
    if (!code) return;
    conn.roomCode = undefined;
    this.rooms.leaveRoom(code, conn.playerId);
    this.broadcastLobby(code);
  }

  roomConns(room: Room): Conn[] {
    const out: Conn[] = [];
    for (const sl of room.slots) {
      if (sl.kind !== 'human' || !sl.playerId) continue;
      const c = this.conns.get(sl.playerId);
      if (c) out.push(c);
    }
    return out;
  }

  private broadcastRoom(room: Room, msg: ServerMsg): void {
    for (const c of this.roomConns(room)) send(c.ws, msg);
  }

  broadcastLobby(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const state = {
      code: room.code,
      name: room.name,
      maxPlayers: room.maxPlayers,
      isPublic: room.isPublic,
      theme: room.theme,
      roundsToWin: room.roundsToWin,
      slots: room.slots.map((s) => ({ ...s })),
      status: room.status,
      hostId: room.hostId,
    };
    this.broadcastRoom(room, { kind: 'lobby_state', room: state });
  }

  private broadcastQueueStatus(): void {
    for (const mode of ['duel', 'ffa'] as const) {
      for (const e of this.mm.queues[mode]) {
        const c = this.conns.get(e.playerId);
        if (!c) continue;
        const st = this.mm.status(e.playerId);
        if (!st) continue;
        send(c.ws, { kind: 'queue_status', mode, elapsedS: Math.round(st.elapsedS), searchRange: st.searchRange, etaS: Math.max(2, 12 - Math.round(st.elapsedS)) });
      }
    }
  }

  startRoomGame(room: Room): void {
    const ok = this.rooms.startMatch(room, {
      onEvent: (r, evs) => this.handleGameEvents(r, evs),
      onSnapshot: (r) => this.sendSnapshots(r),
      onRoundEnd: (r, winner) => this.handleRoundEnd(r, winner),
      onMatchEnd: (r) => this.handleMatchEnd(r),
    });
    if (!ok) {
      for (const c of this.roomConns(room)) send(c.ws, { kind: 'error', code: 'start_fail', msg: 'Need at least 2 players/bots.' });
      return;
    }
    const game = room.game!;
    this.soaksLive.set(room.code, {});
    this.lastRoundSent.set(room.code, 0);
    // match_start
    this.broadcastRoom(room, { kind: 'match_start', code: room.code, mode: room.mode, theme: game.themeResolved, roundsToWin: room.roundsToWin });
    this.sendRoundStart(room);
    this.broadcastLobby(room.code);
  }

  private sendRoundStart(room: Room): void {
    const game = room.game;
    if (!game) return;
    this.lastRoundSent.set(room.code, game.roundNo);
    this.broadcastRoom(room, {
      kind: 'round_start',
      roundNo: game.roundNo,
      mapSeed: game.state.seed,
      theme: game.themeResolved,
      w: game.state.width,
      h: game.state.height,
      castles: game.state.tiles.map((row) => [...row]),
      tideRing: 0,
    });
  }

  private sendSnapshots(room: Room): void {
    const game = room.game;
    if (!game) return;
    // new round? send round_start
    if (this.lastRoundSent.get(room.code) !== game.roundNo) this.sendRoundStart(room);
    const st = game.state;
    const snap = {
      kind: 'snapshot' as const,
      tick: st.tick,
      players: st.players.map((p) => ({
        id: p.id,
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        alive: p.alive,
        isDuck: p.isDuck,
        speed: p.speed,
        balloons: p.balloonCount,
        range: p.splashRange,
        boots: p.hasBoots,
        roundsWon: game.scores[p.id] ?? 0,
        animal: p.animal,
        hat: p.hat,
        nick: p.nickname,
      })),
      balloons: st.balloons.map((b) => ({ id: b.id, x: b.tx, y: b.ty, fuse: b.fuse, range: b.range, owner: b.ownerId })),
      splashes: st.splashes.map((s) => ({ x: s.tx, y: s.ty, ttl: s.ttl })),
      powerups: st.powerups.map((p) => ({ x: p.tx, y: p.ty, kind: p.kind })),
      tideRing: st.tideRing,
      serverTick: st.tick,
    };
    this.broadcastRoom(room, snap);
  }

  private handleGameEvents(room: Room, evs: GameEvent[]): void {
    // track soaks live for placements + stats
    let live = this.soaksLive.get(room.code);
    if (!live) {
      live = {};
      this.soaksLive.set(room.code, live);
    }
    for (const e of evs) {
      if (e.t === 'player_soaked' && e.b) live[e.b] = (live[e.b] ?? 0) + 1;
      const g = room.game as unknown as { soaksLive?: Record<string, number> } | undefined;
      if (g) g.soaksLive = live;
      this.broadcastRoom(room, { kind: 'event', ev: e.t, a: e.a, b: e.b, tx: e.tx, ty: e.ty, ekind: e.kind, count: e.count, text: e.text, tick: e.tick });
    }
  }

  private handleRoundEnd(room: Room, winner: string | string[] | null): void {
    const game = room.game;
    if (!game) return;
    const scores = Object.entries(game.scores).map(([id, roundsWon]) => ({ id, roundsWon }));
    this.broadcastRoom(room, { kind: 'round_end', roundNo: game.roundNo, winner, scores });
  }

  private handleMatchEnd(room: Room): void {
    const result = finalizeMatch(room);
    const xp: Record<string, number> = {};
    for (const p of result.placements) xp[p.playerId] = p.xpEarned;
    this.broadcastRoom(room, {
      kind: 'match_end',
      placements: result.placements.map((p) => ({ playerId: p.playerId, nickname: p.nickname, placement: p.placement, soaks: p.soaks, roundsWon: p.roundsWon, ratingBefore: p.ratingBefore, ratingAfter: p.ratingAfter, xpEarned: p.xpEarned })),
      ratingDeltas: result.ratingDeltas,
      xp,
    });
    this.broadcastLobby(room.code);
    this.soaksLive.delete(room.code);
    // GC ranked rooms after match
    if (room.ranked) {
      setTimeout(() => this.rooms.destroy(room.code), 30_000);
    }
  }

  private forfeitRanked(room: Room, leaverId: string): void {
    const game = room.game;
    if (!game) return;
    // leaver takes last place: set their score to -1, end match
    game.scores[leaverId] = -1;
    // mark disconnected permanently
    const pl = game.state.players.find((p) => p.id === leaverId);
    if (pl) {
      pl.alive = false;
      pl.isDuck = false;
    }
    // if 1v1, opponent wins immediately
    this.rooms.endMatch(room);
    // finalizeMatch uses scores; ensure leaver last by construction
    void tierFor;
  }
}
