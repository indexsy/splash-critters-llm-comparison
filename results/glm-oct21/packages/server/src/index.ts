import express from 'express'
import { createServer, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, type C2S, type S2C } from '@splash/shared'
import { openDb, runMigrations } from './db/db'
import { PlayerStore } from './db/queries'
import { EloService } from './elo'
import {
  createRankedRoom,
  createRoom,
  findRoomByCode,
  roomInfo,
  personCanJoin,
  joinRoom,
  leaveRoom,
  memberConnected,
  memberDisconnected,
  setSlot,
  setReady,
  startMatch,
  handleInput,
  handleEmote,
  voteRematch,
  fillBotSlots,
  createPracticeRoom,
  roomTick,
  firstSlotOf,
  gcRooms
} from './rooms'
import type { Conn, Room, RoomHost, RosterIdentity } from './rooms'
import { Matchmaker, type QueueEntry } from './matchmaker'
import { allowMessage, pruneBuckets, validate } from './net'
import { startGameLoop } from './gameLoop'

interface Session {
  token: string
  profileId: string
  conn: WebSocketConn
  roomId: string | null
  queued: null | 'duel' | 'ffa'
  lastPing: number
}

class WebSocketConn implements Conn {
  sentBytes = 0
  constructor(
    private ws: WebSocket,
    public id: string
  ) {}

  send(msg: S2C): void {
    if (this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify(msg))
      } catch {
        /* socket gone */
      }
    }
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason)
  }

  get alive(): boolean {
    return this.ws.readyState === 1
  }
}

export function buildServerContext(dataDir?: string) {
  const db = openDb(dataDir)
  const applied = runMigrations(db)
  if (applied > 0) console.log(`[db] applied ${applied} migration(s)`)
  const players = new PlayerStore(db)
  const elolib = new EloService(players)
  const rooms = new Map<string, Room>()
  const sessions = new Set<Session>()
  const sessionsByProfile = new Map<string, Set<Session>>()

  const host: RoomHost = {
    rooms,
    elolib,
    players,
    sendTo: (profileId, msg) => {
      for (const m of roomMembersWith(profileId)) m.m.conn?.send(msg)
    },
    onUpdateLobby: () => {
      const list = [...rooms.values()]
        .filter((r) => !r.closed && !r.ranked && r.public)
        .map(roomInfo)
      sendAll({ t: 'room_list', rooms: list })
    },
  }

  const mm = new Matchmaker(players, (entries, mode) => {
    const roster: RosterIdentity[] = entries.map((e) => ({
      profileId: e.profileId,
      nickname: e.identity.nickname,
      animal: e.identity.animal,
      hat: e.identity.hat,
      level: players.getById(e.profileId)?.level ?? 1,
      rating: e.rating,
      tier: ''
    }))
    const room = createRankedRoom(host, roster, mode)
    room.matchId = players.beginMatch(mode, true)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const sess = [...sessionsByProfile.get(entry.profileId) ?? []].find((s) => s.conn.alive)
      if (sess) {
        sess.roomId = room.id
        memberConnected(host, room, entry.profileId, sess.conn, roster[i]!)
        sess.conn.send({ t: 'match_found', roomId: room.id })
      }
    }
    startMatch(host, room, true)
  })

  function sendAll(msg: S2C): void {
    for (const s of sessions) if (s.conn.alive) s.conn.send(msg)
  }

  function roomMembersWith(profileId: string): Array<{ m: { conn: import('./rooms').Conn | null; profileId: string }; room: Room }> {
    const out: Array<{ m: { conn: import('./rooms').Conn | null; profileId: string }; room: Room }> = []
    for (const r of rooms.values()) {
      for (const m of r.members) {
        if (m.kind === 'human' && m.profileId === profileId) out.push({ m, room: r })
      }
    }
    return out
  }

  const app = express()
  app.disable('x-powered-by')
  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, players: sessions.size, tick: roomTick.name })
  })
  app.get('/api/leaderboard', (req, res) => {
    const mode = String(req.query.mode ?? 'duel')
    if (mode !== 'duel' && mode !== 'ffa') {
      res.status(400).json({ error: 'mode must be duel|ffa' })
      return
    }
    const rows = players.leaderboard(mode)
    res.json({
      entries: rows.map((r: any, i: number) => ({
        rank: i + 1,
        nickname: `${r.nickname}#${r.tag}`,
        rating: r.rating,
        tier: tierOfPub(r.rating),
        games: r.games,
        winrate: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0
      }))
    })
  })
  app.get('/api/profile/:id', (req, res) => {
    const prof = players.getById(req.params.id)
    if (!prof) {
      res.status(404).json({ error: 'not found' })
      return
    }
    const matches = players.recentMatches(req.params.id)
    const unlocks = players.unlocksOf(req.params.id)
    const room = [...rooms.values()].find((r) => r.members.some((m) => m.profileId === prof.id && m.kind === 'human'))
    res.json({ profile: prof, matches, unlocks, online: !!room })
  })

  function tierOfPub(rating: number): string {
    let nm: string = CONFIG.TIERS[0]!.name
    for (const t of CONFIG.TIERS) if (rating >= t.min) nm = t.name
    return nm
  }

  const server = createServer(app)
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    const conn = new WebSocketConn(ws, `c${Math.random().toString(36).slice(2)}`)
    let sess: Session | null = null

    ws.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(data))
      } catch {
        return
      }
      const v = validate(parsed)
      if (!v.ok) {
        conn.send({ t: 'error', code: v.code, msg: v.msg })
        return
      }
      if (!allowMessage(sess?.profileId ?? conn.id)) return
      const wire = v.msg as C2S
      if (wire.t === 'hello') {
        sess = registerHello(wire, conn)
        return
      }
      if (!sess) {
        conn.send({ t: 'error', code: 'not_ready', msg: 'Say hello first' })
        return
      }
      onMessage(wire, sess, conn)
    })

    ws.on('close', () => {
      if (sess) {
        mm.leave(sess.profileId)
        if (sess.roomId) {
          const room = rooms.get(sess.roomId)
          if (room) memberDisconnected(host, room, sess.profileId)
        }
        sessions.delete(sess)
        const set = sessionsByProfile.get(sess.profileId)
        if (set) {
          set.delete(sess)
          if (!set.size) sessionsByProfile.delete(sess.profileId)
        }
      }
    })
  })

  function registerHello(msg: Extract<C2S, { t: 'hello' }>, conn: WebSocketConn): Session {
    const token = typeof msg.token === 'string' && msg.token.length >= 8 ? msg.token : `tk_${Math.random().toString(36).slice(2)}${Date.now()}`
    const prof = players.getByToken(token) ?? players.createGuest(token).profile
    const s: Session = { token, profileId: prof.id, conn, roomId: null, queued: null, lastPing: 0 }
    sessions.add(s)
    const set = sessionsByProfile.get(prof.id) ?? new Set()
    set.add(s)
    sessionsByProfile.set(prof.id, set)
    conn.send({ t: 'welcome', playerId: prof.id, profile: prof, token })
    return s
  }

  function onMessage(msg: C2S, sess: Session, conn: WebSocketConn): void {
    const profile = players.getById(sess.profileId)

    switch (msg.t) {
      case 'set_nickname': {
        const r = players.setNickname(sess.profileId, msg.nickname)
        if (!r.ok) {
          sess.conn.send({ t: 'error', code: 'nickname', msg: r.error ?? 'Bad nickname' })
          return
        }
        sess.conn.send({ t: 'welcome', playerId: sess.profileId, profile: players.getById(sess.profileId)!, token: sess.token })
        return
      }
      case 'set_cosmetics': {
        players.setCosmetics(sess.profileId, msg.animal, msg.hat)
        return
      }
      case 'queue_join': {
        if (!profile || (profile.nickname.length < 3 && !profile.nickname)) break
        if (sess.roomId) break
        mm.leave(sess.profileId)
        sess.queued = msg.mode
        mm.join(
          {
            profileId: sess.profileId,
            nickname: profile.nickname,
            rating: players.getRating(sess.profileId, msg.mode).rating,
            games: players.getRating(sess.profileId, msg.mode).games,
            joinedAt: Date.now(),
            identity: { nickname: profile.nickname, profileId: sess.profileId, animal: profile.animal, hat: profile.hat },
            sendQueueStatus: (eta, range, waiting) => {
              if (sess.queued === msg.mode) sess.conn.send({ t: 'queue_status', mode: msg.mode, eta, searchRange: range, playersWaiting: waiting })
            }
          },
          msg.mode
        )
        return
      }
      case 'queue_leave': {
        mm.leave(sess.profileId)
        sess.queued = null
        return
      }
      case 'create_room': {
        if (!profile) break
        if (sess.roomId) break
        const rating = players.getRating(sess.profileId, 'duel').rating
        const room = createRoom(
          host,
          { size: msg.opts.size, public: msg.opts.public, theme: msg.opts.theme, roundsToWin: msg.opts.roundsToWin, botFill: msg.opts.botFill, name: (msg.opts.name ?? '').slice(0, 24) },
          {
            profileId: sess.profileId,
            nickname: profile.nickname,
            animal: profile.animal,
            hat: profile.hat,
            level: profile.level,
            rating,
            tier: ''
          }
        )
        sess.roomId = room.id
        conn.send({ t: 'room_created', room: roomInfo(room) })
        host.onUpdateLobby()
        return
      }
      case 'join_room': {
        if (!profile) break
        if (sess.roomId) leaveCurrent(sess)
        const room = findRoomByCode(host, msg.code)
        if (!room || !personCanJoin(room) || !joinRoom(host, room, {
          profileId: sess.profileId,
          nickname: profile.nickname,
          animal: profile.animal,
          hat: profile.hat,
          level: profile.level,
          rating: players.getRating(sess.profileId, room.mode).rating,
          tier: ''
        }, conn)) {
          conn.send({ t: 'error', code: 'room_unavailable', msg: 'Room is full or unavailable' })
          return
        }
        sess.roomId = room.id
        conn.send({
          t: 'lobby_state',
          room: roomInfo(room),
          players: room.members.map((m, i) => ({ slot: i, kind: m.kind, playerId: m.kind === 'human' ? m.profileId : undefined, nickname: m.nickname, animal: m.animal, hat: m.hat, level: m.level, ready: m.kind === 'human' ? m.ready : boardReady(m), difficulty: m.kind === 'bot' ? m.difficulty : undefined, rating: m.rating || undefined, tier: m.tier || undefined }))
        })
        return
      }
      case 'room_list_request': {
        host.onUpdateLobby()
        return
      }
      case 'leave_room':
        leaveCurrent(sess)
        return
      case 'set_slot': {
        const room = rooms.get(sess.roomId ?? '')
        if (room && firstSlotOf(room, sess.profileId) === room.hostSlot) {
          setSlot(host, room, msg.slot, msg.kind, msg.difficulty)
        }
        return
      }
      case 'set_ready': {
        const room = rooms.get(sess.roomId ?? '')
        if (room) setReady(host, room, sess.profileId, msg.ready)
        return
      }
      case 'start_match': {
        const room = rooms.get(sess.roomId ?? '')
        if (room && firstSlotOf(room, sess.profileId) === room.hostSlot) {
          startMatch(host, room)
        }
        return
      }
      case 'input': {
        const room = rooms.get(sess.roomId ?? '')
        if (room) handleInput(room, sess.profileId, { seq: msg.seq, dir: msg.dir, balloon: msg.balloon })
        return
      }
      case 'emote': {
        const room = rooms.get(sess.roomId ?? '')
        if (room) handleEmote(host, room, sess.profileId, msg.id)
        return
      }
      case 'rematch_vote': {
        const room = rooms.get(sess.roomId ?? '')
        if (room) voteRematch(host, room, sess.profileId)
        return
      }
      case 'pong': {
        sess.lastPing = Date.now()
        if (pingSentAt.has(msg.at)) {
          const rtt = Date.now() - pingSentAt.get(msg.at)!
          const room = rooms.get(sess.roomId ?? '')
          for (const m of room?.members ?? []) {
            if (m.kind === 'human' && m.profileId === sess.profileId) m.ping = rtt
          }
        }
        return
      }
      default:
        return
    }

    function boardReady(m: { kind: string; ready: boolean }): boolean | undefined {
      return m.kind === 'bot' ? true : undefined
    }
  }

  function leaveCurrent(sess: Session): void {
    if (!sess.roomId) return
    const room = rooms.get(sess.roomId)
    // rejoin free
    if (room) {
      leaveRoom(host, room, sess.profileId)
      const emptyNow = rooms.get(sess.roomId)
      if (!emptyNow) {
        sess.roomId = null
        return
      }
      void emptyNow
    }
    sess.roomId = null
  }

  const pingSentAt = new Map<number, number>()
  const pingIv = setInterval(() => {
    const t = Date.now()
    pingSentAt.delete(t - 5000)
    pingSentAt.set(t, t)
    for (const s of sessions) if (s.conn.alive) s.conn.send({ t: 'ping', at: t })
    pruneBuckets()
  }, CONFIG.PING_EVERY_MS)

  const stopLoop = startGameLoop({ host, mm, offline: false })

  function stop(): void {
    clearInterval(pingIv)
    stopLoop()
    mm.stop()
    for (const s of sessions) s.conn.close(1001, 'server shutting down')
    server.close()
    wss.close()
    db.close()
  }

  return { app, server, host, rooms, sessions, players, mm, games: { gcRooms, roomTick }, stop, gc: gcRooms }
}

export function startServer(port: number, dataDir?: string, staticDir?: string): { server: Server; ctx: ReturnType<typeof buildServerContext> } {
  const ctx = buildServerContext(dataDir)
  if (staticDir && existsSync(staticDir)) {
    ctx.app.use(express.static(staticDir))
    ctx.app.get(/^(?!\/(api|health|ws)).*/, (_req, res) => {
      res.sendFile(join(staticDir, 'index.html'))
    })
  }
  const PORT = process.env.PORT ? Number(process.env.PORT) : port
  ctx.server.listen(PORT, () => {
    console.log(`splash-critters master on :${PORT} (tick ${CONFIG.TICK_RATE}Hz)`)
  })
  return { server: ctx.server, ctx }
}

process.on('uncaughtException', (err) => {
  console.error('uncaught', err)
})

const ENTRY = process.argv[1] ?? ''
if (ENTRY.endsWith('index.ts') || ENTRY.endsWith('index.js')) {
  startServer(Number(process.env.PORT ?? 3000))
}
