import {
  CONFIG,
  Dir,
  botAct,
  createBotMemory,
  createGameState,
  displayName,
  encodeGrid,
  simulateTick,
  type AnimalId,
  type BotMemory,
  type Difficulty,
  type GameState,
  type HatId,
  type LobbyState,
  type Mode,
  type PlacementRow,
  type Player,
  type PublicPlayer,
  type RoomOpts,
  type RoomSummary,
  type ServerMsg,
  type Theme,
  type ThemePick,
} from '@splash/shared';
import { settleMatch, tierFor } from './elo.js';
import { q, sendTo, session } from './wire.js';

const THEMES: Theme[] = ['backyard', 'beach', 'pool'];
const BOT_NAMES = ['Puddle Pal', 'Tide Pal', 'Foam Pal', 'Dew Pal'];
const BOT_ANIMALS: AnimalId[] = ['duck', 'frog', 'otter', 'penguin'];

export interface Slot {
  index: number;
  kind: 'open' | 'human' | 'bot';
  playerId?: string;
  name?: string;
  animal?: AnimalId;
  hat?: HatId | null;
  difficulty?: Difficulty;
  ready: boolean;
  connected: boolean;
  converted: boolean;
}

export interface Room {
  code: string;
  name: string;
  mode: Mode;
  isPublic: boolean;
  theme: ThemePick;
  roundsToWin: number;
  botFill: boolean;
  hostId: string;
  ranked: boolean;
  matchId: string;
  startedAt: number;
  phase: 'lobby' | 'intro' | 'playing' | 'round_end' | 'results';
  slots: Slot[];
  state: GameState | null;
  roundNo: number;
  seed: number;
  bots: Map<string, BotMemory>;
  botSeq: Map<string, number>;
  createdAt: number;
  lastActivity: number;
  introUntil: number;
  roundPauseUntil: number;
  voteUntil: number;
  votes: Map<string, boolean>;
  rematchReady: boolean;
  forfeited: boolean;
  pendingEnd: boolean;
  lastEnd: Extract<ServerMsg, { t: 'match_end' }> | null;
  ended: boolean;
}

export const rooms = new Map<string, Room>();

function maxSlots(mode: Mode): number {
  return mode === 'duel' ? 2 : 4;
}

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(c) ? code() : c;
}

function touch(room: Room) {
  room.lastActivity = Date.now();
}

export function lobbyOf(room: Room): LobbyState {
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    public: room.isPublic,
    theme: room.theme,
    roundsToWin: room.roundsToWin,
    botFill: room.botFill,
    hostId: room.hostId,
    ranked: room.ranked,
    phase: room.phase,
    slots: room.slots.map((s) => ({
      index: s.index,
      kind: s.kind,
      playerId: s.playerId,
      name: s.name,
      animal: s.animal,
      hat: s.hat ?? null,
      difficulty: s.difficulty,
      ready: s.ready,
      host: s.playerId === room.hostId,
      connected: s.connected,
    })),
  };
}

function broadcast(room: Room, msg: ServerMsg) {
  for (const s of room.slots) {
    if (s.playerId && s.kind === 'human') sendTo(s.playerId, msg);
  }
}

function broadcastLobby(room: Room) {
  broadcast(room, { t: 'lobby_state', room: lobbyOf(room) });
}

function emptySlots(mode: Mode): Slot[] {
  return Array.from({ length: maxSlots(mode) }, (_, i) => ({
    index: i,
    kind: 'open' as const,
    ready: false,
    connected: false,
    converted: false,
  }));
}

function profileBits(playerId: string) {
  const p = q.profile(playerId);
  return {
    name: p ? displayName(p.nickname, p.tag) : 'Critter',
    animal: (p?.animal ?? 'frog') as AnimalId,
    hat: p?.hat ?? null,
  };
}

export function createRoom(hostId: string, opts: RoomOpts): Room {
  const room: Room = {
    code: code(),
    name: opts.name.slice(0, 24) || 'Splash Room',
    mode: opts.mode,
    isPublic: opts.public,
    theme: opts.theme,
    roundsToWin: opts.roundsToWin,
    botFill: opts.botFill,
    hostId,
    ranked: false,
    matchId: '',
    startedAt: 0,
    phase: 'lobby',
    slots: emptySlots(opts.mode),
    state: null,
    roundNo: 0,
    seed: 1,
    bots: new Map(),
    botSeq: new Map(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    introUntil: 0,
    roundPauseUntil: 0,
    voteUntil: 0,
    votes: new Map(),
    rematchReady: false,
    forfeited: false,
    pendingEnd: false,
    lastEnd: null,
    ended: false,
  };
  const bits = profileBits(hostId);
  room.slots[0] = {
    index: 0,
    kind: 'human',
    playerId: hostId,
    name: bits.name,
    animal: bits.animal,
    hat: bits.hat,
    ready: false,
    connected: true,
    converted: false,
  };
  rooms.set(room.code, room);
  const s = session(hostId);
  if (s) s.roomCode = room.code;
  return room;
}

export function listRooms(mode?: Mode | 'all'): RoomSummary[] {
  const out: RoomSummary[] = [];
  for (const room of rooms.values()) {
    if (room.ranked || !room.isPublic || room.phase !== 'lobby') continue;
    if (mode && mode !== 'all' && room.mode !== mode) continue;
    const n = room.slots.filter((s) => s.kind !== 'open').length;
    out.push({
      code: room.code,
      name: room.name,
      mode: room.mode,
      players: n,
      max: room.slots.length,
      theme: room.theme,
      host: room.slots.find((s) => s.playerId === room.hostId)?.name ?? 'Host',
      public: true,
    });
  }
  return out;
}

export function joinRoom(code: string, playerId: string): { ok: true; room: Room } | { ok: false; code: string; msg: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, code: 'room_not_found', msg: 'No room with that code.' };
  const existing = room.slots.find((s) => s.playerId === playerId);
  if (existing) {
    existing.connected = true;
    existing.kind = 'human';
    existing.converted = false;
    const sp = room.state?.players.find((p) => p.id === playerId);
    if (sp) sp.isBot = false;
    touch(room);
    return { ok: true, room };
  }
  if (room.phase !== 'lobby') return { ok: false, code: 'in_match', msg: 'That room already started.' };
  const open = room.slots.find((s) => s.kind === 'open');
  if (!open) return { ok: false, code: 'room_full', msg: 'Room is full.' };
  const bits = profileBits(playerId);
  open.kind = 'human';
  open.playerId = playerId;
  open.name = bits.name;
  open.animal = bits.animal;
  open.hat = bits.hat;
  open.ready = false;
  open.connected = true;
  open.converted = false;
  const s = session(playerId);
  if (s) s.roomCode = room.code;
  touch(room);
  return { ok: true, room };
}

export function leaveRoom(playerId: string, explicit: boolean) {
  const s = session(playerId);
  const code = s?.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!s) return;
  if (!room) {
    s.roomCode = null;
    return;
  }
  if (room.ranked && explicit && !room.ended && room.phase !== 'lobby' && room.phase !== 'results') {
    forfeit(room, playerId);
    s.roomCode = null;
    return;
  }
  const slot = room.slots.find((sl) => sl.playerId === playerId);
  if (!slot) {
    s.roomCode = null;
    return;
  }
  if (!room.ranked && (room.phase === 'playing' || room.phase === 'round_end' || room.phase === 'intro')) {
    convertToBot(room, playerId);
    s.roomCode = null;
    return;
  }
  slot.kind = 'open';
  slot.playerId = undefined;
  slot.name = undefined;
  slot.connected = false;
  slot.ready = false;
  s.roomCode = null;
  if (room.hostId === playerId) {
    const next = room.slots.find((sl) => sl.kind === 'human' && sl.playerId);
    if (next?.playerId) room.hostId = next.playerId;
  }
  const humans = room.slots.filter((sl) => sl.kind === 'human');
  if (!humans.length) {
    rooms.delete(room.code);
    return;
  }
  broadcastLobby(room);
}

function convertToBot(room: Room, playerId: string) {
  const slot = room.slots.find((s) => s.playerId === playerId);
  if (!slot) return;
  slot.kind = 'bot';
  slot.difficulty = 'medium';
  slot.connected = false;
  slot.converted = true;
  const sp = room.state?.players.find((p) => p.id === playerId);
  if (sp) {
    sp.isBot = true;
    sp.difficulty = 'medium';
  }
  if (!room.bots.has(playerId)) room.bots.set(playerId, createBotMemory((Date.now() ^ playerId.length * 17) >>> 0));
  broadcastLobby(room);
}

export function setSlot(room: Room, hostId: string, slotIndex: number, kind: 'open' | 'bot', difficulty?: Difficulty) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return 'not_host';
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind === 'human') return 'invalid';
  if (kind === 'open') {
    slot.kind = 'open';
    slot.playerId = undefined;
    slot.name = undefined;
    slot.difficulty = undefined;
  } else {
    const diff = difficulty ?? 'medium';
    slot.kind = 'bot';
    slot.difficulty = diff;
    slot.playerId = `bot:${room.code}:${slotIndex}`;
    slot.name = `${BOT_NAMES[slotIndex % BOT_NAMES.length]}`;
    slot.animal = BOT_ANIMALS[slotIndex % BOT_ANIMALS.length];
    slot.hat = null;
    slot.connected = true;
    slot.ready = true;
  }
  touch(room);
  broadcastLobby(room);
  return null;
}

export function setReady(room: Room, playerId: string, ready: boolean) {
  const slot = room.slots.find((s) => s.playerId === playerId && s.kind === 'human');
  if (!slot) return;
  slot.ready = ready;
  broadcastLobby(room);
}

function fillBots(room: Room) {
  if (!room.botFill) return;
  for (const slot of room.slots) {
    if (slot.kind === 'open') setSlot(room, room.hostId, slot.index, 'bot', 'medium');
  }
}

function publicPlayers(room: Room): PublicPlayer[] {
  return room.slots
    .filter((s) => s.kind !== 'open' && s.playerId)
    .map((s) => {
      const prof = s.kind === 'human' && s.playerId ? q.profile(s.playerId) : null;
      const rating = room.ranked && prof ? prof.ratings[room.mode].rating : undefined;
      return {
        id: s.playerId!,
        name: s.name ?? 'Critter',
        animal: s.animal ?? 'frog',
        hat: s.hat ?? null,
        slot: s.index,
        rating,
        tier: rating != null ? tierFor(rating).name : undefined,
        isBot: s.kind === 'bot',
        difficulty: s.difficulty ?? null,
      };
    });
}

function beginIntro(room: Room) {
  room.phase = 'intro';
  room.introUntil = Date.now() + CONFIG.INTRO_MS;
  room.ended = false;
  room.forfeited = false;
  room.pendingEnd = false;
  room.roundNo = 0;
  room.state = null;
  if (!room.matchId) room.matchId = crypto.randomUUID();
  room.startedAt = Date.now();
  const players = publicPlayers(room);
  for (const s of room.slots) {
    if (s.kind === 'human' && s.playerId) {
      sendTo(s.playerId, { t: 'match_found', matchId: room.matchId, mode: room.mode, players });
      sendTo(s.playerId, {
        t: 'match_start',
        matchId: room.matchId,
        mode: room.mode,
        ranked: room.ranked,
        theme: room.theme === 'random' ? 'backyard' : room.theme,
        roundsToWin: room.roundsToWin,
        players,
        you: s.playerId,
      });
    }
  }
  broadcastLobby(room);
}

export function startMatch(room: Room, playerId: string): string | null {
  if (room.hostId !== playerId) return 'Only the host can start.';
  if (room.phase !== 'lobby') return 'Match already started.';
  fillBots(room);
  const filled = room.slots.filter((s) => s.kind !== 'open');
  if (filled.length < 2) return 'Need at least two critters.';
  room.matchId = crypto.randomUUID();
  beginIntro(room);
  return null;
}

export function startRanked(mode: Mode, playerIds: string[]): Room {
  const host = playerIds[0];
  const room = createRoom(host, {
    name: mode === 'duel' ? 'Ranked Duel' : 'Ranked Free-for-All',
    mode,
    public: false,
    theme: 'random',
    roundsToWin: 3,
    botFill: false,
  });
  room.ranked = true;
  room.isPublic = false;
  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i];
    const bits = profileBits(id);
    room.slots[i] = {
      index: i,
      kind: 'human',
      playerId: id,
      name: bits.name,
      animal: bits.animal,
      hat: bits.hat,
      ready: true,
      connected: !!session(id)?.ws,
      converted: false,
    };
    const s = session(id);
    if (s) s.roomCode = room.code;
  }
  room.matchId = crypto.randomUUID();
  beginIntro(room);
  return room;
}

function resetInput(playerId: string) {
  const s = session(playerId);
  if (!s) return;
  s.inputQueue = [];
  s.lastDir = 0;
  s.ackSeq = 0;
}

function startRound(room: Room) {
  room.roundNo += 1;
  room.seed = (Math.floor(Math.random() * 0x7fffffff) ^ (room.roundNo * 997)) >>> 0;
  const theme: Theme = room.theme === 'random' ? THEMES[room.seed % THEMES.length] : room.theme;
  const prev = room.state?.players;
  const players = room.slots
    .filter((s) => s.kind !== 'open' && s.playerId)
    .map((s) => ({
      id: s.playerId!,
      name: s.name ?? 'Critter',
      slot: s.index,
      animal: s.animal ?? 'frog',
      hat: s.hat ?? null,
      isBot: s.kind === 'bot',
      difficulty: s.kind === 'bot' ? s.difficulty ?? 'medium' : null,
    }));
  room.state = createGameState({
    mode: room.mode,
    seed: room.seed,
    theme,
    players,
    revenge: room.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
    roundsToWin: room.roundsToWin,
    carry: prev,
  });
  room.phase = 'playing';
  room.bots.clear();
  for (const s of room.slots) {
    if (s.playerId) resetInput(s.playerId);
    if (s.kind === 'bot' && s.playerId) room.bots.set(s.playerId, createBotMemory((room.seed + s.index * 101) >>> 0));
  }
  const st = room.state;
  broadcast(room, {
    t: 'round_start',
    roundNo: room.roundNo,
    mapSeed: room.seed,
    castleGrid: encodeGrid(st.tiles),
    theme: st.theme,
    width: st.width,
    height: st.height,
    spawns: st.players.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), id: p.id })),
  });
  broadcast(room, snap(room));
}

function snap(room: Room): ServerMsg {
  const st = room.state!;
  const acks: Record<string, number> = {};
  for (const s of room.slots) {
    if (s.kind === 'human' && s.playerId) acks[s.playerId] = session(s.playerId)?.ackSeq ?? 0;
  }
  return {
    t: 'snapshot',
    tick: st.tick,
    serverTime: Date.now(),
    acks,
    players: st.players.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      facing: p.facing,
      alive: p.alive,
      speed: p.speed,
      balloonCount: p.balloonCount,
      splashRange: p.splashRange,
      hasKick: p.hasKick,
      flippers: p.flippers,
      roundWins: p.roundWins,
      soaks: p.soaks,
      revengeSoaks: p.revengeSoaks,
      castles: p.castles,
      biggestChain: p.biggestChain,
      survivedTicks: p.survivedTicks,
      longestLife: p.longestLife,
      ducking: p.ducking,
      duckT: p.duckT,
      duckCooldown: p.duckCooldown,
      animal: p.animal,
      hat: p.hat,
      name: p.name,
      isBot: p.isBot,
      ping: session(p.id)?.rtt ?? 0,
    })),
    balloons: st.balloons.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      fuse: b.fuse,
      ownerId: b.ownerId,
      range: b.range,
      sliding: b.sliding,
      slideDir: b.slideDir,
      slideAcc: b.slideAcc,
      revenge: b.revenge,
    })),
    splashes: st.splashes.map((s) => ({ x: s.x, y: s.y, ttl: s.ttl, ownerId: s.ownerId, chain: s.chain })),
    powerups: st.powerups.map((u) => ({ x: u.x, y: u.y, kind: u.kind })),
    tideRing: st.tideRing,
    warmup: st.warmup,
    phase: st.phase,
    winnerId: st.winnerId,
    draw: st.draw,
    roundNo: room.roundNo,
  };
}

export function pushInput(playerId: string, input: { seq: number; tick: number; dir: number; balloon: boolean }) {
  const s = session(playerId);
  if (!s?.roomCode) return;
  const room = rooms.get(s.roomCode);
  if (!room || room.phase !== 'playing') return;
  if (!Number.isFinite(input.seq) || input.seq <= s.ackSeq) return;
  const dir = input.dir >= 0 && input.dir <= 4 ? (input.dir as Dir) : Dir.None;
  s.inputQueue.push({ seq: input.seq, tick: input.tick | 0, dir, balloon: !!input.balloon });
  if (s.inputQueue.length > 45) s.inputQueue.splice(0, s.inputQueue.length - 45);
}

function onRoundEnd(room: Room) {
  const st = room.state;
  if (!st) return;
  if (st.winnerId) {
    const w = st.players.find((p) => p.id === st.winnerId);
    if (w) w.roundWins += 1;
  }
  for (const p of st.players) {
    if (p.alive) p.longestLife = Math.max(p.longestLife, p.roundAliveTicks);
  }
  room.phase = 'round_end';
  broadcast(room, {
    t: 'round_end',
    roundNo: room.roundNo,
    winnerId: st.winnerId,
    draw: st.draw,
    scores: st.players.map((p) => ({ id: p.id, name: p.name, roundWins: p.roundWins })),
  });
  broadcast(room, snap(room));
  const clinched = st.players.some((p) => p.roundWins >= room.roundsToWin);
  room.pendingEnd = clinched;
  room.roundPauseUntil = Date.now() + (clinched ? 1400 : CONFIG.ROUND_PAUSE_MS);
}

function finishMatch(room: Room, override?: Map<string, number>) {
  if (room.ended || !room.state) return;
  room.ended = true;
  const players = room.state.players.map((p) => ({
    id: p.id,
    isBot: p.id.startsWith('bot:'),
    roundWins: p.roundWins,
    soaks: p.soaks,
    name: p.name,
    animal: p.animal,
    hat: p.hat,
    castles: p.castles,
    revengeSoaks: p.revengeSoaks,
    survivedTicks: p.survivedTicks,
    longestLife: p.longestLife,
    biggestChain: p.biggestChain,
  }));
  const settled = settleMatch(q, {
    matchId: room.matchId,
    mode: room.mode,
    ranked: room.ranked,
    startedAt: room.startedAt,
    players,
    placementOverride: override,
  });
  const byId = new Map(settled.recorded.map((r) => [r.id, r]));
  const rows: PlacementRow[] = players
    .map((p) => {
      const rec = byId.get(p.id);
      const place = settled.placements.get(p.id) ?? players.length;
      const before = rec?.ratingBefore ?? null;
      const after = rec?.ratingAfter ?? null;
      return {
        playerId: p.id,
        name: p.name,
        animal: p.animal as AnimalId,
        hat: p.hat,
        placement: place,
        soaks: p.soaks,
        revengeSoaks: p.revengeSoaks,
        castles: p.castles,
        roundsWon: p.roundWins,
        survivedTicks: p.survivedTicks,
        longestLife: p.longestLife,
        biggestChain: p.biggestChain,
        xp: rec?.xp ?? 0,
        ratingBefore: before,
        ratingAfter: after,
        tierBefore: before != null ? tierFor(before).name : null,
        tierAfter: after != null ? tierFor(after).name : null,
        isBot: p.isBot,
      };
    })
    .sort((a, b) => a.placement - b.placement || b.soaks - a.soaks);
  const fun = {
    mostSoaks: pick(players, (p) => p.soaks),
    castleCrusher: pick(players, (p) => p.castles),
    longestSurvivor: pick(players, (p) => p.longestLife),
    biggestChain: pick(players, (p) => p.biggestChain),
  };
  const msg: Extract<ServerMsg, { t: 'match_end' }> = {
    t: 'match_end',
    matchId: room.matchId,
    mode: room.mode,
    ranked: room.ranked,
    placements: rows,
    fun,
    rematch: !room.ranked,
  };
  room.lastEnd = msg;
  room.phase = 'results';
  room.votes.clear();
  room.rematchReady = false;
  room.voteUntil = Date.now() + CONFIG.RESULTS_VOTE_MS;
  broadcast(room, msg);
  for (const s of room.slots) {
    if (s.kind === 'human' && s.playerId) {
      const prof = q.profile(s.playerId);
      if (prof) sendTo(s.playerId, { t: 'profile', profile: prof });
    }
  }
}

function pick(players: { id: string }[], score: (p: Player & { id: string }) => number): string {
  let best = players[0]?.id ?? '';
  let n = -1;
  for (const p of players) {
    const v = score(p as Player);
    if (v > n) {
      n = v;
      best = p.id;
    }
  }
  return best;
}

export function forfeit(room: Room, leaverId: string) {
  if (room.ended || room.forfeited || !room.ranked) return;
  room.forfeited = true;
  if (!room.state) {
    room.state = {
      tick: 0,
      phase: 'round_end',
      mode: room.mode,
      theme: 'backyard',
      width: 1,
      height: 1,
      tiles: [],
      hidden: [],
      players: room.slots
        .filter((s) => s.playerId && s.kind !== 'open')
        .map((s) => ({
          id: s.playerId!,
          name: s.name ?? 'Critter',
          slot: s.index,
          animal: s.animal ?? 'frog',
          hat: s.hat ?? null,
          x: 0,
          y: 0,
          facing: 0 as const,
          alive: s.playerId !== leaverId,
          speed: 4,
          balloonCount: 1,
          splashRange: 2,
          flippers: 0,
          hasKick: false,
          passBalloonId: '',
          roundWins: s.playerId === leaverId ? 0 : 1,
          soaks: 0,
          revengeSoaks: 0,
          castles: 0,
          biggestChain: 0,
          survivedTicks: 0,
          longestLife: 0,
          roundAliveTicks: 0,
          isBot: s.kind === 'bot',
          difficulty: s.difficulty ?? null,
          ducking: false,
          duckT: 0,
          duckDir: 1,
          duckCooldown: 0,
          soakedBy: '',
        })),
      balloons: [],
      splashes: [],
      powerups: [],
      tideRing: 0,
      warmup: 0,
      revenge: false,
      roundsToWin: room.roundsToWin,
      winnerId: null,
      draw: false,
      over: true,
      events: [],
    };
  }
  const ids = room.state.players.map((p) => p.id);
  const override = new Map<string, number>();
  if (room.mode === 'duel') {
    for (const id of ids) override.set(id, id === leaverId ? 2 : 1);
    const winner = room.state.players.find((p) => p.id !== leaverId);
    if (winner) winner.roundWins = Math.max(winner.roundWins, room.roundsToWin);
  } else {
    for (const id of ids) override.set(id, id === leaverId ? ids.length : 1);
  }
  const leaver = room.state.players.find((p) => p.id === leaverId);
  if (leaver) leaver.roundWins = 0;
  finishMatch(room, override);
}

export function vote(room: Room, playerId: string, yes: boolean) {
  if (room.phase !== 'results' || room.ranked) return;
  room.votes.set(playerId, yes);
  const humans = room.slots.filter((s) => s.kind === 'human' && s.connected && s.playerId);
  const yesCount = humans.filter((s) => room.votes.get(s.playerId!)).length;
  broadcast(room, { t: 'rematch_update', yes: yesCount, need: Math.floor(humans.length / 2) + 1, voters: [...room.votes.keys()] });
  if (humans.length && yesCount > humans.length / 2) {
    room.rematchReady = true;
    room.voteUntil = Date.now() + 600;
  }
}

function rematch(room: Room) {
  room.matchId = crypto.randomUUID();
  room.ended = false;
  room.pendingEnd = false;
  room.lastEnd = null;
  room.state = null;
  room.votes.clear();
  beginIntro(room);
}

export function emote(playerId: string, id: number) {
  const s = session(playerId);
  if (!s?.roomCode) return;
  const now = Date.now();
  if (now - s.lastEmote < CONFIG.EMOTE_COOLDOWN_MS) return;
  s.lastEmote = now;
  const room = rooms.get(s.roomCode);
  if (!room) return;
  const em = Math.max(1, Math.min(4, id | 0));
  broadcast(room, { t: 'emote', playerId, id: em });
}

export function pushResume(playerId: string) {
  const s = session(playerId);
  if (!s?.roomCode) return;
  const room = rooms.get(s.roomCode);
  if (!room) {
    s.roomCode = null;
    return;
  }
  const slot = room.slots.find((sl) => sl.playerId === playerId);
  if (slot) {
    slot.connected = true;
    if (slot.converted) {
      slot.kind = 'human';
      slot.converted = false;
      const sp = room.state?.players.find((p) => p.id === playerId);
      if (sp) {
        sp.isBot = false;
        sp.difficulty = null;
      }
    }
  }
  s.disconnectedAt = null;
  sendTo(playerId, { t: 'lobby_state', room: lobbyOf(room) });
  if (room.phase !== 'lobby') {
    const players = publicPlayers(room);
    sendTo(playerId, {
      t: 'match_start',
      matchId: room.matchId,
      mode: room.mode,
      ranked: room.ranked,
      theme: room.state?.theme ?? (room.theme === 'random' ? 'backyard' : room.theme),
      roundsToWin: room.roundsToWin,
      players,
      you: playerId,
    });
    if (room.state) {
      sendTo(playerId, {
        t: 'round_start',
        roundNo: room.roundNo,
        mapSeed: room.seed,
        castleGrid: encodeGrid(room.state.tiles),
        theme: room.state.theme,
        width: room.state.width,
        height: room.state.height,
        spawns: room.state.players.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), id: p.id })),
      });
      sendTo(playerId, snap(room));
    }
  }
  if (room.lastEnd && room.phase === 'results') sendTo(playerId, room.lastEnd);
}

export function tickRooms(now: number) {
  for (const room of [...rooms.values()]) {
    if (room.phase === 'intro' && now >= room.introUntil) startRound(room);
    if (room.phase === 'round_end' && now >= room.roundPauseUntil) {
      if (room.pendingEnd) finishMatch(room);
      else startRound(room);
    }
    if (room.phase === 'results' && now >= room.voteUntil) {
      if (room.rematchReady && !room.ranked) rematch(room);
      else if (!room.ranked) {
        room.phase = 'lobby';
        room.ended = false;
        room.state = null;
        room.matchId = '';
        broadcastLobby(room);
      }
    }
    if (room.phase === 'playing' && room.state) step(room);
    for (const slot of room.slots) {
      if (slot.kind !== 'human' || !slot.playerId) continue;
      const s = session(slot.playerId);
      if (!s || s.ws) continue;
      if (!s.disconnectedAt) s.disconnectedAt = now;
      if (now - s.disconnectedAt < CONFIG.RECONNECT_GRACE_MS) continue;
      s.disconnectedAt = null;
      if (room.ranked && !room.ended && room.phase !== 'lobby' && room.phase !== 'results') forfeit(room, slot.playerId);
      else if (!room.ranked && (room.phase === 'playing' || room.phase === 'intro' || room.phase === 'round_end')) convertToBot(room, slot.playerId);
      else if (room.phase === 'lobby') leaveRoom(slot.playerId, false);
    }
    const humans = room.slots.some((s) => s.kind === 'human' && s.connected);
    if (humans) room.lastActivity = now;
    else if (now - room.lastActivity > CONFIG.ROOM_TTL_MS) rooms.delete(room.code);
  }
}

function step(room: Room) {
  const st = room.state;
  if (!st || st.over) {
    if (st?.over && room.phase === 'playing') onRoundEnd(room);
    return;
  }
  const inputs: Record<string, { seq: number; tick: number; dir: Dir; balloon: boolean }> = {};
  for (const slot of room.slots) {
    if (!slot.playerId) continue;
    if (slot.kind === 'human') {
      const s = session(slot.playerId);
      if (!s) continue;
      const inp = s.inputQueue.shift();
      if (inp) {
        s.lastDir = inp.dir;
        s.ackSeq = inp.seq;
        inputs[slot.playerId] = inp;
      } else {
        inputs[slot.playerId] = { seq: s.ackSeq, tick: st.tick, dir: Dir.None, balloon: false };
      }
    } else if (slot.kind === 'bot') {
      let mem = room.bots.get(slot.playerId);
      if (!mem) {
        mem = createBotMemory((room.seed + slot.index * 13) >>> 0);
        room.bots.set(slot.playerId, mem);
      }
      const inp = botAct(st, slot.playerId, mem);
      const seq = (room.botSeq.get(slot.playerId) ?? 0) + 1;
      room.botSeq.set(slot.playerId, seq);
      inp.seq = seq;
      inputs[slot.playerId] = inp;
    }
  }
  simulateTick(st, inputs);
  for (const ev of st.events) broadcast(room, { t: 'event', event: ev });
  if (st.tick % 2 === 0 || st.over) broadcast(room, snap(room));
  if (st.over && room.phase === 'playing') onRoundEnd(room);
}

export function roomOf(playerId: string): Room | undefined {
  const code = session(playerId)?.roomCode;
  return code ? rooms.get(code) : undefined;
}
