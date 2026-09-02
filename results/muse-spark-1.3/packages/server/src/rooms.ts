import { randomUUID } from 'node:crypto';
import { CONFIG, createInitialState, simulateTick, type AnimalId, type BotDifficulty, type GameMode, type GameState, type HatId, type MapTheme, type PlayerInput } from '@splash/shared';
import { botInput, resetBot } from './bots/bot.js';

export interface Slot {
  slot: number;
  kind: 'human' | 'bot' | 'empty';
  playerId?: string;
  nickname?: string;
  difficulty?: BotDifficulty;
  ready?: boolean;
  animal?: AnimalId;
  hat?: HatId;
  connected?: boolean;
}

export interface Room {
  code: string;
  name: string;
  maxPlayers: 2 | 4;
  mode: GameMode;
  isPublic: boolean;
  theme: MapTheme;
  roundsToWin: 2 | 3 | 5;
  hostId: string;
  slots: Slot[];
  status: 'lobby' | 'playing';
  createdAt: number;
  lastActive: number;
  game?: RoomGame;
  rematchVotes: Set<string>;
  ranked: boolean;
}

export interface RoomGame {
  state: GameState;
  roundNo: number;
  scores: Record<string, number>;
  totalSoaks: Record<string, number>;
  totalCastles: Record<string, number>;
  inputs: Record<string, PlayerInput>;
  botDifficulties: Record<string, BotDifficulty>;
  humanIds: string[];
  timer?: NodeJS.Timeout;
  tickCount: number;
  matchId: string;
  mode: GameMode;
  ranked: boolean;
  startedAt: number;
  roundEndAt?: number;
  themeResolved: MapTheme;
  onEvent: (room: Room, evs: import('@splash/shared').GameEvent[]) => void;
  onSnapshot: (room: Room) => void;
  onRoundEnd: (room: Room, winner: string | string[] | null) => void;
  onMatchEnd: (room: Room) => void;
}

function genCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function resolveTheme(t: MapTheme): MapTheme {
  if (t === 'random') {
    const opts: MapTheme[] = ['backyard', 'beach', 'pool'];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  return t;
}

export class RoomManager {
  rooms = new Map<string, Room>();

  createRoom(opts: { name: string; maxPlayers: 2 | 4; isPublic: boolean; theme: MapTheme; roundsToWin: 2 | 3 | 5; hostId: string; hostNick: string; animal: AnimalId; hat: HatId }): Room {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const slots: Slot[] = [];
    for (let i = 0; i < opts.maxPlayers; i++) {
      if (i === 0) slots.push({ slot: i, kind: 'human', playerId: opts.hostId, nickname: opts.hostNick, ready: true, animal: opts.animal, hat: opts.hat, connected: true });
      else slots.push({ slot: i, kind: 'empty' });
    }
    const room: Room = {
      code,
      name: opts.name.slice(0, 32) || 'Splash Room',
      maxPlayers: opts.maxPlayers,
      mode: opts.maxPlayers === 2 ? 'duel' : 'ffa',
      isPublic: opts.isPublic,
      theme: opts.theme,
      roundsToWin: opts.roundsToWin,
      hostId: opts.hostId,
      slots,
      status: 'lobby',
      createdAt: Date.now(),
      lastActive: Date.now(),
      rematchVotes: new Set(),
      ranked: false,
    };
    this.rooms.set(code, room);
    return room;
  }

  createRankedRoom(mode: GameMode, playerIds: { id: string; nickname: string; animal: AnimalId; hat: HatId }[]): Room {
    let code = 'R' + genCode().slice(1);
    while (this.rooms.has(code)) code = 'R' + genCode().slice(1);
    const maxPlayers = mode === 'duel' ? 2 : 4;
    const slots: Slot[] = playerIds.map((p, i) => ({ slot: i, kind: 'human' as const, playerId: p.id, nickname: p.nickname, ready: true, animal: p.animal, hat: p.hat, connected: true }));
    while (slots.length < maxPlayers) slots.push({ slot: slots.length, kind: 'empty' });
    const room: Room = {
      code,
      name: `Ranked ${mode}`,
      maxPlayers: maxPlayers as 2 | 4,
      mode,
      isPublic: false,
      theme: 'random',
      roundsToWin: 3,
      hostId: playerIds[0].id,
      slots,
      status: 'lobby',
      createdAt: Date.now(),
      lastActive: Date.now(),
      rematchVotes: new Set(),
      ranked: true,
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  listPublic(filter: 'all' | '2p' | '4p' = 'all'): Room[] {
    const out: Room[] = [];
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.ranked) continue;
      if (r.status === 'playing') continue;
      if (filter === '2p' && r.maxPlayers !== 2) continue;
      if (filter === '4p' && r.maxPlayers !== 4) continue;
      out.push(r);
    }
    return out.slice(0, 50);
  }

  joinRoom(code: string, playerId: string, nickname: string, animal: AnimalId, hat: HatId): { ok: boolean; msg?: string; slot?: number } {
    const room = this.get(code);
    if (!room) return { ok: false, msg: 'Room not found.' };
    if (room.status === 'playing') return { ok: false, msg: 'Match in progress.' };
    if (room.slots.some((s) => s.playerId === playerId)) {
      const sl = room.slots.find((s) => s.playerId === playerId)!;
      sl.connected = true;
      room.lastActive = Date.now();
      return { ok: true, slot: sl.slot };
    }
    const empty = room.slots.find((s) => s.kind === 'empty');
    if (!empty) return { ok: false, msg: 'Room full.' };
    empty.kind = 'human';
    empty.playerId = playerId;
    empty.nickname = nickname;
    empty.animal = animal;
    empty.hat = hat;
    empty.ready = false;
    empty.connected = true;
    room.lastActive = Date.now();
    return { ok: true, slot: empty.slot };
  }

  leaveRoom(code: string, playerId: string): void {
    const room = this.get(code);
    if (!room) return;
    const sl = room.slots.find((s) => s.playerId === playerId);
    if (sl) {
      if (room.status === 'playing' && room.game) {
        // mark disconnected; game loop handles bot substitution / forfeit
        sl.connected = false;
        const p = room.game.state.players.find((pp) => pp.id === playerId);
        if (p) p.disconnected = true;
      } else {
        // free slot in lobby
        const wasHost = room.hostId === playerId;
        Object.assign(sl, { kind: 'empty' as const, playerId: undefined, nickname: undefined, ready: undefined, connected: undefined });
        if (wasHost) {
          const next = room.slots.find((s) => s.kind === 'human');
          if (next?.playerId) room.hostId = next.playerId;
        }
      }
    }
    room.lastActive = Date.now();
    room.rematchVotes.delete(playerId);
  }

  setSlot(code: string, byHost: string, slot: number, botKind: 'empty' | 'bot' | 'closed', difficulty?: BotDifficulty): boolean {
    const room = this.get(code);
    if (!room || room.hostId !== byHost || room.status !== 'lobby') return false;
    const sl = room.slots.find((s) => s.slot === slot);
    if (!sl || sl.kind === 'human') return false;
    if (botKind === 'empty') Object.assign(sl, { kind: 'empty' as const, difficulty: undefined });
    else if (botKind === 'bot') Object.assign(sl, { kind: 'bot' as const, playerId: `bot-${code}-${slot}`, nickname: `Bot-${difficulty ?? 'medium'}`, difficulty: difficulty ?? 'medium' });
    else return false;
    room.lastActive = Date.now();
    return true;
  }

  startMatch(room: Room, hooks: Pick<RoomGame, 'onEvent' | 'onSnapshot' | 'onRoundEnd' | 'onMatchEnd'>): boolean {
    if (room.status === 'playing') return false;
    const humans = room.slots.filter((s) => s.kind === 'human');
    const bots = room.slots.filter((s) => s.kind === 'bot');
    if (humans.length < 1) return false;
    if (humans.length + bots.length < 2) return false;
    room.status = 'playing';
    room.rematchVotes.clear();
    const matchId = randomUUID();
    const game: RoomGame = {
      state: null as unknown as GameState,
      roundNo: 0,
      scores: {},
      totalSoaks: {},
      totalCastles: {},
      inputs: {},
      botDifficulties: {},
      humanIds: humans.map((h) => h.playerId!),
      tickCount: 0,
      matchId,
      mode: room.mode,
      ranked: room.ranked,
      startedAt: Date.now(),
      themeResolved: resolveTheme(room.theme),
      ...hooks,
    };
    for (const s of [...humans, ...bots]) {
      const pid = s.kind === 'human' ? s.playerId! : `bot-${room.code}-${s.slot}`;
      game.scores[pid] = 0;
      game.totalSoaks[pid] = 0;
      game.totalCastles[pid] = 0;
      if (s.kind === 'bot') game.botDifficulties[pid] = s.difficulty ?? 'medium';
      resetBot(pid);
    }
    room.game = game;
    this.startRound(room);
    // 30Hz loop
    game.timer = setInterval(() => this.tickRoom(room), 1000 / CONFIG.TICK_RATE);
    return true;
  }

  startRound(room: Room): void {
    const game = room.game!;
    game.roundNo++;
    game.roundEndAt = undefined;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const metas = room.slots
      .filter((s) => s.kind === 'human' || s.kind === 'bot')
      .map((s) => ({
        id: s.kind === 'human' ? s.playerId! : `bot-${room.code}-${s.slot}`,
        nickname: s.nickname ?? 'Critter',
        animal: (s.animal ?? 'frog') as AnimalId,
        hat: (s.hat ?? 'none') as HatId,
      }));
    const revenge = room.ranked ? false : CONFIG.ENABLE_REVENGE_DUCKS;
    // ranked override
    const revDucks = room.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS;
    void revenge;
    game.state = createInitialState(
      { mode: room.mode, mapSeed: seed, theme: game.themeResolved, roundsToWin: room.roundsToWin, revengeDucks: revDucks },
      metas,
    );
    // restore cumulative rounds won
    for (const p of game.state.players) p.roundsWon = game.scores[p.id] ?? 0;
    game.inputs = {};
    for (const p of game.state.players) {
      game.inputs[p.id] = { seq: 0, tick: 0, dx: 0, dy: 0, balloon: false };
    }
  }

  setInput(room: Room, playerId: string, inp: PlayerInput): void {
    const game = room.game;
    if (!game || !game.state) return;
    // validation: clamp dirs, rate-limit handled in net
    const dx = Math.max(-1, Math.min(1, Number(inp.dx) || 0));
    const dy = Math.max(-1, Math.min(1, Number(inp.dy) || 0));
    game.inputs[playerId] = { seq: inp.seq | 0, tick: game.state.tick, dx, dy, balloon: !!inp.balloon };
  }

  private tickRoom(room: Room): void {
    const game = room.game;
    if (!game || !game.state) return;
    const st = game.state;
    // bots decide
    for (const pid of Object.keys(game.botDifficulties)) {
      const me = st.players.find((p) => p.id === pid);
      if (!me || (!me.alive && !me.isDuck)) continue;
      try {
        game.inputs[pid] = botInput(st, me, game.botDifficulties[pid]);
      } catch {
        game.inputs[pid] = { seq: 0, tick: st.tick, dx: 0, dy: 0, balloon: false };
      }
    }
    // disconnected humans in casual become Medium bots after 15s — handled by timestamp map in net layer calling substituteBot()
    const evs = simulateTick(st, game.inputs);
    // reset balloon edge-trigger
    for (const k of Object.keys(game.inputs)) game.inputs[k].balloon = false;
    // accumulate stats
    for (const p of st.players) {
      game.totalSoaks[p.id] = Math.max(game.totalSoaks[p.id] ?? 0, (game.totalSoaks[p.id] ?? 0) + 0);
    }
    if (evs.length > 0) {
      try {
        game.onEvent(room, evs);
      } catch { /* ignore */ }
    }
    game.tickCount++;
    if (game.tickCount % 2 === 0) {
      try {
        game.onSnapshot(room);
      } catch { /* ignore */ }
    }
    if (st.roundOver && !game.roundEndAt) {
      game.roundEndAt = Date.now();
      // update scores
      const w = st.roundWinner;
      if (typeof w === 'string') game.scores[w] = (game.scores[w] ?? 0) + 1;
      for (const p of st.players) {
        game.totalSoaks[p.id] = (game.totalSoaks[p.id] ?? 0) + 0; // soaks counted live below
      }
      // sync soaks from state players (killer increments directly on player objects — need cumulative)
      // Instead accumulate at round end:
      setTimeout(() => {
        try {
          game.onRoundEnd(room, w);
        } catch { /* ignore */ }
        this.afterRound(room);
      }, 2600);
    }
  }

  /** Called by net layer when a casual disconnect exceeds grace. */
  substituteBot(room: Room, playerId: string): void {
    const game = room.game;
    const sl = room.slots.find((s) => s.playerId === playerId);
    if (!room || !game) return;
    if (room.ranked) return; // ranked: forfeit handled elsewhere
    if (sl) {
      sl.kind = 'bot';
      sl.difficulty = 'medium';
      sl.nickname = `Bot-medium`;
    }
    game.botDifficulties[playerId] = 'medium';
    resetBot(playerId);
  }

  private afterRound(room: Room): void {
    const game = room.game;
    if (!game) return;
    // accumulate soaks/castles from finished round state
    for (const p of game.state.players) {
      // p.soaks is per-round killer increments + own; track max diff approach:
      // simpler: add round soaks by reading events? We increment killers' totalSoaks live via onEvent in net layer.
      // Here accumulate castles:
      game.totalCastles[p.id] = (game.totalCastles[p.id] ?? 0) + p.castlesWashed;
    }
    // sync roundsWon display
    for (const p of game.state.players) game.scores[p.id] = p.roundsWon = game.scores[p.id] ?? 0;
    const winner = Object.entries(game.scores).find(([, v]) => v >= room.roundsToWin);
    if (winner) {
      this.endMatch(room);
    } else if (game.roundNo >= room.roundsToWin * 2 - 1 + 4) {
      // safety cap: most wins takes it
      this.endMatch(room);
    } else {
      this.startRound(room);
      // notify round_start via snapshot hook flag — net layer polls roundNo change
      game.onSnapshot(room);
    }
  }

  endMatch(room: Room): void {
    const game = room.game;
    if (!game) return;
    if (game.timer) clearInterval(game.timer);
    room.status = 'lobby';
    try {
      game.onMatchEnd(room);
    } catch { /* ignore */ }
    room.game = undefined;
    room.lastActive = Date.now();
  }

  destroy(code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return;
    if (room.game?.timer) clearInterval(room.game.timer);
    this.rooms.delete(code.toUpperCase());
  }

  gc(ttlMs: number = CONFIG.ROOM_TTL_S * 1000): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.ranked) continue;
      if (now - room.lastActive > ttlMs && room.status === 'lobby') this.destroy(code);
      else if (now - room.lastActive > ttlMs * 2) this.destroy(code);
    }
  }
}
