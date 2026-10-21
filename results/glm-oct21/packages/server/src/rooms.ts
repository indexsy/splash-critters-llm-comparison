import {
  CONFIG,
  createSimState,
  duelDelta,
  rankedPlacementsNums,
  simulateTick,
  tierOf
} from '@splash/shared'
import type {
  BotDifficulty,
  CreateRoomOpts,
  GameMode,
  InputTick,
  LobbyPlayer,
  MapTheme,
  RoomInfo,
  S2C,
  SimEvent,
  SimState,
  Snapshot,
  EmoteId
} from '@splash/shared'
import { botDecide, createBotBrain } from './bots/bot'
import type { BotBrain } from './bots/bot'
import type { EloService } from './elo'

export interface Conn {
  send(msg: S2C): void
  close(code: number, reason: string): void
  alive: boolean
}

export interface RosterIdentity {
  profileId: string
  nickname: string
  animal: string
  hat: string
  level: number
  rating: number
  tier: string
}

export interface RoomMember extends RosterIdentity {
  kind: 'human' | 'bot' | 'empty'
  ready: boolean
  difficulty: BotDifficulty
  conn: Conn | null
  input: InputTick
  ping: number
  disconnectedAt: number | null
  botifiedFrom?: string
  forfeited?: boolean
}

export type RoomState = 'lobby' | 'rounds' | 'interlude' | 'results'

export interface RoomStat {
  lastDeathTick: number
  died: boolean
  biggestChain: number
}

export interface Room {
  id: string
  code: string
  name: string
  mode: GameMode
  ranked: boolean
  public: boolean
  theme: MapTheme | 'random'
  roundsToWin: number
  botFill: boolean
  hostSlot: number
  size: number
  state: RoomState
  members: RoomMember[]
  createdAt: number
  lastActivity: number
  roundNo: number
  sim: SimState | null
  brains: Map<number, BotBrain>
  roundEndedAt: number
  matchId: number | null
  matchSeedBase: number
  rematchVotes: Set<string>
  stats: Map<number, RoomStat>
  closed: boolean
  practice: boolean
  outroAt: number
}

export interface RoomHost {
  rooms: Map<string, Room>
  elolib: EloService
  players: {
    getById(profileId: string): { xp: number; level: number; animal: string; hat: string; nickname: string; tutorial_done?: number } | null
    addXp(profileId: string, amount: number): { total: number; level: number; leveledUp: boolean }
    setTutorialDone(profileId: string): boolean
    beginMatch(mode: string, ranked: boolean): number
    recordMatchPlayers(matchId: number, rows: Array<{ player_id: string; placement: number; soaks: number; rounds_won: number; rating_before: number | null; rating_after: number | null; xp_earned: number }>): void
  }
  sendTo: (profileId: string, msg: S2C) => void
  onUpdateLobby: () => void
}

let roomSeq = 0
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function makeRoomCode(): string {
  let out = ''
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]
  return out
}

const BOT_NAMES = ['RubberRex', 'SquirtVan', 'AquaAxel', 'DribbleDan', 'WetlandWally', 'DrizzleBoss']

function emptyMember(slot: number): RoomMember {
  return {
    kind: 'empty',
    profileId: '',
    nickname: '',
    animal: 'frog',
    hat: 'none',
    level: 0,
    rating: 0,
    tier: '',
    ready: false,
    difficulty: 'medium',
    conn: null,
    input: { seq: 0, dir: 'none', balloon: false },
    ping: 0,
    disconnectedAt: null
  }
}

function humanMember(id: RosterIdentity): RoomMember {
  return {
    kind: 'human',
    ...id,
    ready: false,
    difficulty: 'medium',
    conn: null,
    input: { seq: 0, dir: 'none', balloon: false },
    ping: 0,
    disconnectedAt: null
  }
}

function botMember(slot: number, difficulty: BotDifficulty): RoomMember {
  return {
    kind: 'bot',
    profileId: `bot-${roomSeq}-${slot}`,
    nickname: BOT_NAMES[slot % BOT_NAMES.length] ?? 'Bot',
    animal: 'raccoon',
    hat: 'bucket',
    level: 0,
    rating: 0,
    tier: '',
    ready: true,
    difficulty,
    conn: null,
    input: { seq: 0, dir: 'none', balloon: false },
    ping: 0,
    disconnectedAt: null
  }
}

export function createRoom(host: RoomHost, opts: CreateRoomOpts, creator: RosterIdentity, ranked = false, practice = false): Room {
  const members: RoomMember[] = Array.from({ length: opts.size }, (_, i) => emptyMember(i))
  members[0] = { ...humanMember(creator), conn: null }
  const room: Room = {
    id: `r${Date.now().toString(36)}${(roomSeq++).toString(36)}`,
    code: makeRoomCode(),
    name: opts.name || `${creator.nickname}'s SplashZone`,
    mode: opts.size === 2 ? 'duel' : 'ffa',
    ranked,
    public: !!opts.public,
    theme: opts.theme ?? 'random',
    roundsToWin: (opts.roundsToWin ?? 3) as number,
    botFill: opts.botFill ?? false,
    hostSlot: 0,
    size: opts.size,
    state: 'lobby',
    members,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    roundNo: 0,
    sim: null,
    brains: new Map(),
    roundEndedAt: 0,
    matchId: null,
    matchSeedBase: Math.floor(Math.random() * 2147483647),
    rematchVotes: new Set(),
    stats: new Map(),
    closed: false,
    practice,
    outroAt: 0
  }
  if (practice) room.members[1] = botMember(1, 'easy')
  host.rooms.set(room.id, room)
  return room
}

export function createRankedRoom(host: RoomHost, players: RosterIdentity[], mode: GameMode): Room {
  const size = mode === 'duel' ? 2 : 4
  const room = createRoom(host, { size, public: false, name: 'Ranked Match', theme: 'random', roundsToWin: 3, botFill: false }, players[0]!, true)
  for (let i = 1; i < players.length; i++) room.members[i] = humanMember(players[i]!)
  return room
}

export function firstSlotOf(room: Room, profileId: string): number {
  return room.members.findIndex((m) => m.kind === 'human' && m.profileId === profileId)
}

export function firstEmptySlot(room: Room): number {
  return room.members.findIndex((m) => m.kind === 'empty')
}

export function findRoomByCode(host: RoomHost, code: string): Room | undefined {
  return [...host.rooms.values()].find((r) => !r.closed && r.code === code.toUpperCase())
}

export function roomInfo(room: Room): RoomInfo {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    mode: room.mode,
    size: room.size,
    playerCount: room.members.filter((m) => m.kind !== 'empty').length,
    public: room.public,
    theme: room.theme,
    roundsToWin: room.roundsToWin,
    botFill: room.botFill,
    hostSlot: room.hostSlot,
    inMatch: room.state === 'rounds' || room.state === 'interlude'
  }
}

export function lobbyPlayers(room: Room): LobbyPlayer[] {
  return room.members.map((m, i): LobbyPlayer => ({
    slot: i,
    kind: m.kind,
    playerId: m.kind === 'human' ? m.profileId : undefined,
    nickname: m.nickname || undefined,
    animal: m.animal,
    hat: m.hat,
    level: m.kind === 'human' ? m.level : undefined,
    ready: m.kind === 'human' ? m.ready : m.kind === 'bot' ? true : undefined,
    difficulty: m.kind === 'bot' ? m.difficulty : undefined,
    rating: m.rating || undefined,
    tier: m.tier || undefined
  }))
}

export function lobbyState(room: Room): S2C {
  return { t: 'lobby_state', room: roomInfo(room), players: lobbyPlayers(room) }
}

export function broadcastRoom(host: RoomHost, room: Room, msg: S2C): void {
  for (const m of room.members) {
    if (m.kind === 'human' && m.conn) {
      try {
        m.conn.send(msg)
      } catch {
        /* conn dying mid-broadcast */
      }
    }
  }
}

export function personCanJoin(room: Room): boolean {
  return !room.closed && room.state === 'lobby' && room.members.some((m) => m.kind === 'empty')
}

export function joinRoom(host: RoomHost, room: Room, who: RosterIdentity, conn: Conn): boolean {
  const slot = firstEmptySlot(room)
  if (slot < 0) return false
  room.members[slot] = { ...humanMember(who), conn }
  room.lastActivity = Date.now()
  broadcastRoom(host, room, lobbyState(room))
  host.onUpdateLobby()
  return true
}

export function leaveRoom(host: RoomHost, room: Room, profileId: string): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  if (room.state === 'rounds' || room.state === 'interlude') {
    memberDisconnected(host, room, profileId)
    if (room.ranked && room.members.some((m) => m.kind === 'human' && !m.forfeited)) {
      if (room.members.every((m) => m.kind !== 'human')) room.closed = true
      host.onUpdateLobby()
      return
    }
  }
  room.members[slot] = emptyMember(slot)
  if (room.hostSlot === slot) {
    const nextHost = room.members.findIndex((m) => m.kind === 'human')
    if (nextHost >= 0) room.hostSlot = nextHost
  }
  if (!room.members.some((m) => m.kind === 'human')) {
    room.closed = true
    host.rooms.delete(room.id)
  } else {
    broadcastRoom(host, room, lobbyState(room))
  }
  host.onUpdateLobby()
}

export function clearGrace(room: Room, profileId: string): void {
  const key = `${room.id}:${profileId}`
  const t = graceTimers.get(key)
  if (t) {
    clearTimeout(t)
    graceTimers.delete(key)
  }
}

const graceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function memberConnected(host: RoomHost, room: Room, profileId: string, conn: Conn, identity: RosterIdentity): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  const m = room.members[slot]!
  clearGrace(room, profileId)
  m.conn = conn
  m.disconnectedAt = null
  if (m.botifiedFrom) {
    m.kind = 'human'
    m.profileId = profileId
    m.nickname = identity.nickname
    m.animal = identity.animal
    m.hat = identity.hat
    m.botifiedFrom = undefined
    broadcastRoom(host, room, { t: 'ticker', msg: `${m.nickname} is back!` })
  }
  broadcastRoom(host, room, lobbyState(room))
}

export function memberDisconnected(host: RoomHost, room: Room, profileId: string): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  const m = room.members[slot]!
  m.conn = null
  room.lastActivity = Date.now()

  if (room.state !== 'rounds' && room.state !== 'interlude') {
    leaveRoom(host, room, profileId)
    return
  }

  broadcastRoom(host, room, { t: 'ticker', msg: `${m.nickname} lost connection…` })
  if (room.ranked) {
    broadcastRoom(host, room, { t: 'ticker', msg: `${m.nickname} has 15s to reconnect or forfeits.` })
    const key = `${room.id}:${profileId}`
    graceTimers.set(
      key,
      setTimeout(() => {
        graceTimers.delete(key)
        if (room.members[slot]?.profileId === profileId && !room.members[slot]?.conn) {
          forfeitLeaver(host, room, slot)
        }
      }, CONFIG.RECONNECT_GRACE_MS)
    )
  } else {
    const key = `${room.id}:${profileId}`
    graceTimers.set(
      key,
      setTimeout(() => {
        graceTimers.delete(key)
        const cur = room.members[slot]
        if (cur && cur.profileId === profileId && !cur.conn) {
          cur.botifiedFrom = profileId
          cur.kind = 'bot'
          cur.difficulty = 'medium'
          cur.conn = null
          broadcastRoom(host, room, { t: 'ticker', msg: `${cur.nickname} is now a bot!` })
          if (room.hostSlot === slot) {
            const nextHost = room.members.findIndex((mm) => mm.kind === 'human')
            if (nextHost >= 0) room.hostSlot = nextHost
          }
        }
      }, CONFIG.RECONNECT_GRACE_MS)
    )
  }
}

function forfeitLeaver(host: RoomHost, room: Room, slot: number): void {
  const m = room.members[slot]!
  if (m.forfeited) return
  m.forfeited = true
  m.conn = null
  broadcastRoom(host, room, { t: 'ticker', msg: `${m.nickname} forfeits the match!` })
  const sim = room.sim
  if (sim && room.state === 'rounds') {
    const p = sim.players[slot]
    if (p && p.alive) {
      p.alive = false
      broadcastRoom(host, room, { t: 'events', tick: sim.tick, events: [{ t: 'player_soaked', playerId: slot, by: -3 }] })
      room.stats.set(slot, { lastDeathTick: sim.tick, died: true, biggestChain: 0 })
    }
  }
  if (room.mode === 'duel') {
    finishMatch(host, room)
  }
  if (!room.members.some((m) => m.kind === 'human' && m.conn)) {
    room.closed = true
    host.rooms.delete(room.id)
    host.onUpdateLobby()
  }
}

function statOf(room: Room, id: number): RoomStat {
  let st = room.stats.get(id)
  if (!st) {
    st = { lastDeathTick: 0, died: false, biggestChain: 0 }
    room.stats.set(id, st)
  }
  return st
}

export function setSlot(host: RoomHost, room: Room, slot: number, kind: 'bot' | 'empty', difficulty: BotDifficulty): void {
  if (room.state !== 'lobby') return
  const cur = room.members[slot]
  if (!cur || slot === 0) return
  if (cur.kind === 'human') return
  room.members[slot] = kind === 'bot' ? botMember(slot, difficulty) : emptyMember(slot)
  room.lastActivity = Date.now()
  broadcastRoom(host, room, lobbyState(room))
  host.onUpdateLobby()
}

export function setReady(host: RoomHost, room: Room, profileId: string, ready: boolean): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  room.members[slot]!.ready = ready
  broadcastRoom(host, room, lobbyState(room))
}

export function createPracticeRoom(
  host: RoomHost,
  creator: RosterIdentity,
  difficulty: BotDifficulty = 'easy'
): Room {
  const room = createRoom(
    host,
    { size: 2, public: false, name: `${creator.nickname} practice`, theme: 'backyard', roundsToWin: 3, botFill: false },
    creator,
    false,
    true
  )
  room.members[1] = botMember(1, difficulty)
  return room
}

export function canStart(room: Room): boolean {
  const filled = room.members.filter((m) => m.kind !== 'empty')
  if (filled.length < 2) return false
  if (filled.some((m) => m.kind === 'empty')) return false
  return true
}

export function fillBotSlots(room: Room, difficulty: BotDifficulty = 'medium'): void {
  if (room.state !== 'lobby') return
  for (let i = 1; i < room.members.length; i++) {
    if (room.members[i]!.kind === 'empty') room.members[i] = botMember(i, difficulty)
  }
}

export function handleInput(room: Room, profileId: string, input: InputTick): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  room.members[slot]!.input = input
}

const emoteCooldowns = new Map<string, number>()

export function handleEmote(host: RoomHost, room: Room, profileId: string, id: EmoteId): void {
  const slot = firstSlotOf(room, profileId)
  if (slot < 0) return
  const key = `${room.id}:${profileId}`
  const now = Date.now()
  const cd = emoteCooldowns.get(key) ?? 0
  if (now < cd) return
  emoteCooldowns.set(key, now + CONFIG.EMOTE_COOLDOWN_MS)
  broadcastRoom(host, room, { t: 'emote_b', playerId: slot, id })
}

export function voteRematch(host: RoomHost, room: Room, profileId: string): void {
  if (room.state !== 'results') return
  room.rematchVotes.add(profileId)
  const humans = room.members.filter((m) => m.kind === 'human' && m.conn)
  if (humans.length > 0 && room.rematchVotes.size >= Math.ceil(humans.length / 2)) {
    restartMatch(host, room)
  }
}

function restartMatch(host: RoomHost, room: Room): void {
  room.state = 'lobby'
  room.rematchVotes.clear()
  room.matchId = null
  room.sim = null
  for (const m of room.members) {
    if (m.kind === 'human') m.ready = false
  }
  broadcastRoom(host, room, lobbyState(room))
  startMatch(host, room, true)
}

export function startMatch(host: RoomHost, room: Room, skipHostCheck = false): void {
  if (room.state !== 'lobby' || room.closed) return
  if (!skipHostCheck && !canStart(room)) return
  if (room.botFill) fillBotSlots(room)
  if (room.members.filter((m) => m.kind !== 'empty').length < 2) return
  room.state = 'interlude'
  room.roundNo = 0
  room.matchId = host.players.beginMatch(room.mode, room.ranked)
  room.rematchVotes.clear()
  broadcastRoom(host, room, {
    t: 'match_start',
    config: {
      players: room.members.map((m, i) => ({
        playerId: m.kind === 'human' ? m.profileId : '',
        slot: i,
        nickname: m.nickname || '—',
        animal: m.animal,
        hat: m.hat,
        rating: m.rating || undefined,
        tier: m.tier || undefined,
        isBot: m.kind === 'bot'
      })),
      theme: resolveTheme(room.matchSeedBase, room.theme),
      roundsToWin: room.roundsToWin,
      ranked: room.ranked,
      mode: room.mode
    }
  })
  startRound(host, room, 1)
}

export function resolveTheme(seedBase: number, theme: MapTheme | 'random'): MapTheme {
  if (theme !== 'random') return theme
  let x = (seedBase ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = (x ^ (x >>> 16)) >>> 0
  return CONFIG.THEMES[x % CONFIG.THEMES.length] as MapTheme
}

export function startRound(host: RoomHost, room: Room, roundNo: number): void {
  room.roundNo = roundNo
  room.state = 'rounds'
  room.brains.clear()
  const seed = mixSeed2(room.matchSeedBase, roundNo)
  const sim = createSimState(room.mode, seed, {
    ducks: !room.ranked && CONFIG.ENABLE_REVENGE_DUCKS,
    kick: CONFIG.ENABLE_KICK
  })
  room.sim = sim
  room.stats.clear()
  for (let i = 0; i < room.members.length; i++) {
    const m = room.members[i]!
    if (m.kind === 'bot') room.brains.set(i, createBotBrain(i, m.difficulty))
  }
  broadcastRoom(host, room, {
    t: 'round_start',
    roundNo,
    mapSeed: seed,
    W: sim.W,
    H: sim.H,
    castleGridB64: Buffer.from(sim.grid).toString('base64'),
    spawns:
      room.mode === 'duel'
        ? ([
            [1, 1],
            [sim.W - 2, sim.H - 2]
          ] as Array<[number, number]>)
        : ([
            [1, 1],
            [sim.W - 2, 1],
            [1, sim.H - 2],
            [sim.W - 2, sim.H - 2]
          ] as Array<[number, number]>),
    theme: resolveTheme(room.matchSeedBase, room.theme)
  })
}

function mixSeed2(a: number, b: number): number {
  let x = (a + b * 7919) >>> 0
  x = Math.imul(x ^ (x >>> 14), 0x68e31da4)
  x = Math.imul(x ^ (x >>> 13), 0x1f7f3f8d)
  return ((x ^ (x >>> 16)) >>> 0) | 1
}

function snapshotOf(room: Room): Snapshot {
  const sim = room.sim!
  const seq = perimeterSeq(sim.W, sim.H)
  return {
    t: Date.now(),
    tick: sim.tick,
    players: sim.players.map((p, i) => ({
      id: p.id,
      x: r2(p.x),
      y: r2(p.y),
      facing: p.facing,
      alive: p.alive,
      animal: room.members[i]?.animal ?? 'frog',
      hat: room.members[i]?.hat ?? 'none',
      nickname: room.members[i]?.nickname ?? 'Bot',
      stats: [r2(p.stats.speed), p.stats.balloonCount, p.stats.splashRange, p.stats.boots ? 1 : 0],
      roundsWon: p.roundsWon,
      soaks: p.soaks
    })),
    balloons: sim.balloons.map((b) => ({
      id: b.id,
      x: b.tx,
      y: b.ty,
      fuse: Math.max(0, b.fuse),
      fuseMax: CONFIG.FUSE_TICKS,
      owner: b.ownerId,
      slide: b.slide
    })),
    splashes: sim.splashes.map((sp) => ({ id: sp.id, born: sp.born, until: sp.until, cells: sp.cells.slice(), owner: sp.owner })),
    powerups: [...sim.powerups.entries()].map(([c, type]) => ({ x: c % sim.W, y: Math.floor(c / sim.W), type })),
    tide: sim.tideRing,
    ducks: sim.ducks.map((d) => {
      const a = seq[d.stepInt % seq.length]!
      const b = seq[(d.stepInt + 1) % seq.length]!
      return {
        playerId: d.playerId,
        x: r2(a[0] + (b[0] - a[0]) * d.frac + 0.5),
        y: r2(a[1] + (b[1] - a[1]) * d.frac + 0.5)
      }
    })
  }
}

function r2(n: number): number {
  return Math.round(n * 500) / 500
}

function perimeterSeq(W: number, H: number): Array<[number, number]> {
  const tiles: Array<[number, number]> = []
  for (let x = 1; x <= W - 2; x++) tiles.push([x, 1])
  for (let y = 2; y <= H - 2; y++) tiles.push([W - 2, y])
  for (let x = W - 3; x >= 1; x--) tiles.push([x, H - 2])
  for (let y = H - 3; y >= 2; y--) tiles.push([1, y])
  return tiles
}

export function roomTick(host: RoomHost, room: Room): void {
  if (room.state === 'rounds') {
    const sim = room.sim
    if (!sim) return
    if (!sim.over) {
      const inputs = new Map<number, InputTick>()
      for (let i = 0; i < room.members.length; i++) {
        const m = room.members[i]!
        if (m.kind === 'bot') {
          const brain = room.brains.get(i) ?? createBotBrain(i, m.difficulty)
          room.brains.set(i, brain)
          inputs.set(i, botDecide(sim, brain))
        } else if (m.kind === 'human') {
          inputs.set(i, m.input)
        }
      }
      const evs = simulateTick(sim, inputs)
      for (const e of evs) {
        if (e.t === 'player_soaked') {
          const st = statOf(room, e.playerId)
          st.lastDeathTick = sim.tick
          st.died = true
        } else if (e.t === 'chain_burst' && e.owner >= 0) {
          const st = statOf(room, e.owner)
          st.biggestChain = Math.max(st.biggestChain, e.depth)
        }
      }
      if (evs.length) broadcastRoom(host, room, { t: 'events', tick: sim.tick, events: evs })
      if (sim.tick % CONFIG.SNAPSHOT_EVERY === 0) broadcastRoom(host, room, { t: 'snapshot', snap: snapshotOf(room) })
      if (sim.over) {
        const winners = sim.winnerIds
        if (!sim.draw && winners.length === 1) sim.players[winners[0]!]!.roundsWon++
        broadcastRoom(host, room, {
          t: 'round_end',
          roundNo: room.roundNo,
          winnerIds: sim.winnerIds,
          draw: sim.draw,
          scores: sim.players.map((p) => ({ id: p.id, roundsWon: p.roundsWon, soaks: p.soaks }))
        })
        room.state = 'interlude'
        room.roundEndedAt = Date.now()
      }
    }
  } else if (room.state === 'interlude') {
    if (Date.now() - room.roundEndedAt < 3400) return
    const sim = room.sim!
    const champion = sim.players.find((p) => p.roundsWon >= room.roundsToWin)
    if (champion) {
      finishMatch(host, room)
    } else {
      startRound(host, room, room.roundNo + 1)
    }
  } else if (room.state === 'results') {
    if (room.ranked) {
      if (Date.now() - room.outroAt > 40000) {
        room.closed = true
        host.rooms.delete(room.id)
        host.onUpdateLobby()
      }
    } else if (Date.now() - room.outroAt > 180000) {
      room.state = 'lobby'
      room.rematchVotes.clear()
      broadcastRoom(host, room, lobbyState(room))
    }
  }
}

interface Entry {
  id: number
  roundsWon: number
  soaks: number
  castlesWashed: number
  lastDeathTick: number
  alive: boolean
}

function xpFor(entry: Entry, placement: number): number {
  return (
    CONFIG.XP.PARTICIPATION +
    entry.roundsWon * CONFIG.XP.PER_ROUND_WIN +
    entry.soaks * CONFIG.XP.PER_SOAK +
    entry.castlesWashed * CONFIG.XP.PER_CASTLE +
    (placement === 1 ? CONFIG.XP.WIN_BONUS : 0)
  )
}

function awardFor(entries: Entry[], slotId: number): string | undefined {
  const e = entries[slotId]!
  const mostSoaks = Math.max(...entries.map((x) => x.soaks))
  const crusher = Math.max(...entries.map((x) => x.castlesWashed))
  const survivor = Math.max(...entries.filter((x) => !x.alive).map((x) => x.lastDeathTick), -1)
  if (e.alive) return undefined
  if (e.soaks === mostSoaks && mostSoaks > 0 && entries.filter((x) => x.soaks === mostSoaks).length === 1) return 'Most Soaks'
  if (e.castlesWashed === crusher && crusher > 0 && entries.filter((x) => x.castlesWashed === crusher).length === 1) return 'Castle Crusher'
  if (survivor >= 0 && e.lastDeathTick === survivor && entries.filter((x) => x.lastDeathTick === survivor && !x.alive).length === 1) return 'Longest Survivor'
  return undefined
}

export function finishMatch(host: RoomHost, room: Room): void {
  const sim = room.sim!
  room.state = 'results'
  room.outroAt = Date.now()
  room.rematchVotes.clear()

  const entries: Entry[] = sim.players.map((p, i) => ({
    id: i,
    roundsWon: p.roundsWon,
    soaks: p.soaks,
    castlesWashed: p.castlesWashed,
    lastDeathTick: statOf(room, i).lastDeathTick,
    alive: p.alive
  }))

  let placements: Array<{ id: number; placement: number }>
  if (room.mode === 'duel') {
    const sorted = [...entries].sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks)
    placements = sorted.map((e, i) => ({ id: e.id, placement: i + 1 }))
  } else {
    placements = rankedPlacementsNums(entries)
  }
  const placed = new Map(placements.map((p) => [p.id, p.placement]))

  const chainMax = Math.max(...[...room.stats.values()].map((st: RoomStat) => st.biggestChain), 0)

  const xpRows: Array<{ player_id: string; placement: number; soaks: number; rounds_won: number; rating_before: number | null; rating_after: number | null; xp_earned: number }> = []
  const xpGains = new Map<string, number>()
  const ratingOut = new Map<string, S2C & { t: 'match_end' }>()

  if (room.ranked) {
    const humans = room.members.map((m, i) => ({ m, i })).filter((e) => e.m.kind === 'human')
    const ratingsBefore = new Map(humans.map((e) => [e.i, host.elolib.ratingFor(e.m.profileId, room.mode)]))
    const ffaList = room.members.map((m, i) => ({
      profileId: m.kind === 'human' ? m.profileId : `bot-${i}`,
      roundsWon: entries[i]!.roundsWon,
      soaks: entries[i]!.soaks,
      placement: placed.get(i) ?? room.members.length,
      isBot: m.kind === 'bot'
    }))
    let deltas
    if (room.mode === 'duel') {
      const duelOrder = ffaList.slice().sort((a, b) => a.placement - b.placement)
      deltas = new Map<string, number>()
      const a = duelOrder[0]!
      const b = duelOrder[1]!
      const ra = a.isBot ? null : ratingsBefore.get(firstSlotOf(room, a.profileId))!
      const rb = b.isBot ? null : ratingsBefore.get(firstSlotOf(room, b.profileId))!
      if (ra && rb) {
        deltas.set(a.profileId, duelDelta(ra, rb, true))
        deltas.set(b.profileId, duelDelta(rb, ra, false))
      } else {
        if (ra) deltas.set(a.profileId, Math.round(ra.games < CONFIG.ELO.PROVISIONAL_GAMES ? CONFIG.ELO.K_PROVISIONAL / 2 : CONFIG.ELO.K / 2))
        if (rb) deltas.set(b.profileId, -(deltas.get(a.profileId!) ?? 0))
      }
    } else {
      deltas = ffaPairwiseHot(ratingsBefore, ffaList)
    }

    for (let i = 0; i < room.members.length; i++) {
      const m = room.members[i]!
      if (m.kind !== 'human') continue
      const before = ratingsBefore.get(i)!
      const delta = deltas.get(m.profileId) ?? 0
      const after = Math.max(100, before.rating + delta)
      const games = before.games + 1
      const wins = before.wins + ((placed.get(i) ?? 99) === 1 ? 1 : 0)
      const peak = Math.max(before.peak, after)
      host.elolib.saveRating(m.profileId, room.mode, after, games, wins, peak)
      xpRows.push({
        player_id: m.profileId,
        placement: placed.get(i) ?? 99,
        soaks: entries[i]!.soaks,
        rounds_won: entries[i]!.roundsWon,
        rating_before: before.rating,
        rating_after: after,
        xp_earned: 0
      })
      const dest = before.rating
      ratingOut.set(m.profileId, {
        t: 'match_end',
        placements: [],
        xp: { gained: 0, total: 0, leveledUp: false },
        matchId: undefined,
        rating: { before: dest, after, delta: after - dest, tier: tierOf(after), peak }
      } as never)
      void dest
    }
  }

  for (let i = 0; i < room.members.length; i++) {
    const m = room.members[i]!
    if (m.kind !== 'human') continue
    const placement = placed.get(i) ?? room.members.length
    let gained = xpFor(entries[i]!, placement)
    if (room.practice && placement === 1) {
      const granted = host.players.setTutorialDone(m.profileId)
      if (granted) {
        gained += CONFIG.XP.TUTORIAL
      }
    }
    const prog = host.players.addXp(m.profileId, gained)
    xpGains.set(m.profileId, gained)
    if (room.matchId !== null) {
      xpRows.push({
        player_id: m.profileId,
        placement,
        soaks: entries[i]!.soaks,
        rounds_won: entries[i]!.roundsWon,
        rating_before: null,
        rating_after: null,
        xp_earned: gained
      })
    }
    void prog
  }

  if (room.matchId !== null && xpRows.length) {
    host.players.recordMatchPlayers(room.matchId, xpRows)
  }

  for (let i = 0; i < room.members.length; i++) {
    const m = room.members[i]!
    if (m.kind !== 'human' || !m.conn) continue
    const gained = xpGains.get(m.profileId) ?? 0
    const prof = host.players.getById(m.profileId)
    const base = ratingOut.get(m.profileId) as S2C & { t: 'match_end' } | undefined
    m.conn.send({
      t: 'match_end',
      placements: room.members.map((mm, j) => ({
        id: j,
        nickname: mm.nickname,
        placement: placed.get(j) ?? 999,
        roundsWon: entries[j]!.roundsWon,
        soaks: entries[j]!.soaks,
        castlesWashed: entries[j]!.castlesWashed,
        isBot: mm.kind === 'bot',
        award: awardFor(entries, j)
      })),
      xp: { gained, total: prof?.xp ?? 0, leveledUp: (prof?.level ?? 1) > m.level },
      rating: base?.rating,
      matchId: room.matchId !== null ? String(room.matchId) : undefined
    })
  }
}

function ffaPairwiseHot(
  ratingsBefore: Map<number, { rating: number; games: number; wins: number; peak: number }>,
  list: Array<{ profileId: string; roundsWon: number; soaks: number; placement: number; isBot: boolean }>
): Map<string, number> {
  const deltas = new Map<string, number>()
  const ratings = new Map<string, { rating: number; games: number; wins: number; peak: number }>()
  for (const [slot, r] of ratingsBefore) {
    const entry = list[slot]
    if (!entry) continue
    deltas.set(entry.profileId, 0)
    ratings.set(entry.profileId, r)
  }
  const participants = list.filter((e) => !e.isBot)
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i]!
      const b = participants[j]!
      const ra = ratings.get(a.profileId)!
      const rb = ratings.get(b.profileId)!
      const sa = a.placement < b.placement ? 1 : a.placement > b.placement ? 0 : 0.5
      const ea = 1 / (1 + 10 ** ((rb.rating - ra.rating) / 400))
      const ka = ra.games < CONFIG.ELO.PROVISIONAL_GAMES ? CONFIG.ELO.K_PROVISIONAL / 3 : CONFIG.ELO.K / 3
      deltas.set(a.profileId, (deltas.get(a.profileId) ?? 0) + ka * (sa - ea))
      const eb = 1 - ea
      deltas.set(b.profileId, (deltas.get(b.profileId) ?? 0) + ka * (1 - sa - eb))
    }
  }
  for (const [k, v] of deltas) deltas.set(k, Math.round(v))
  return deltas
}

export function gcRooms(host: RoomHost): void {
  const now = Date.now()
  for (const [id, room] of host.rooms) {
    if (room.closed) {
      host.rooms.delete(id)
      continue
    }
    if (now - room.lastActivity > CONFIG.ROOM_TTL_MS && room.state !== 'rounds') {
      room.closed = true
      host.rooms.delete(id)
    }
  }
  host.onUpdateLobby()
}
