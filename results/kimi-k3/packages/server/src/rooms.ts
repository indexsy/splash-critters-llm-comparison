import {
  AnimalId,
  BotDifficulty,
  CONFIG,
  GameEvent,
  GameMode,
  GameState,
  HatId,
  InputFrame,
  LobbyState,
  MatchConfigDto,
  Placement,
  RoomOptions,
  RoomSummary,
  ServerMessage,
  Snapshot,
  ThemeId,
  createGame,
  setEmote,
} from '@splash/shared';
import { WebSocket } from 'ws';
import { BotController, makeBot } from './bots/bot.js';
import * as db from './db/index.js';
import { profileDtoForSend } from './profile.js';

export interface ClientConn {
  ws: WebSocket;
  playerId: string;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  send(msg: ServerMessage): void;
}

export interface RoomSlotState {
  kind: 'human' | 'bot' | 'open';
  client: ClientConn | null;
  playerId: string | null;
  nickname: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  botDifficulty: BotDifficulty | null;
  bot: BotController | null;
  ready: boolean;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
  forcedLast: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

const THEMES: ThemeId[] = ['backyard', 'beach', 'pool'];

export class Room {
  code: string;
  opts: RoomOptions;
  ranked: boolean;
  mode: GameMode;
  slots: RoomSlotState[] = [];
  hostPlayerId: string;
  state: GameState | null = null;
  phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  theme: ThemeId = 'backyard';
  mapSeed = 0;
  inputs = new Map<number, InputFrame>();
  lastAppliedSeq = new Map<number, number>();
  lastBroadcastRound = 0;
  destroyedCastles: number[] = [];
  matchId: string | null = null;
  rematchVotes = new Set<string>();
  createdAt = Date.now();
  lastHumanActivity = Date.now();
  pendingInputs: { slot: number; input: InputFrame; applyAt: number }[] = [];
  latencyMs: number;

  constructor(code: string, opts: RoomOptions, ranked: boolean, host: ClientConn | null, latencyMs = 0) {
    this.code = code;
    this.opts = opts;
    this.ranked = ranked;
    this.mode = opts.size === 2 ? 'duel' : 'ffa';
    this.hostPlayerId = host?.playerId ?? '';
    this.latencyMs = latencyMs;
    for (let i = 0; i < opts.size; i++) {
      this.slots.push(emptySlot());
    }
    if (host) {
      this.fillSlot(0, host);
    }
  }

  humanCount(): number {
    return this.slots.filter((s) => s.kind === 'human' && s.connected).length;
  }

  sendAll(msg: ServerMessage): void {
    for (const s of this.slots) {
      if (s.kind === 'human' && s.client && s.connected) s.client.send(msg);
    }
  }

  fillSlot(i: number, client: ClientConn): void {
    const s = this.slots[i];
    if (!s) return;
    if (s.disconnectTimer) {
      clearTimeout(s.disconnectTimer);
      s.disconnectTimer = null;
    }
    s.kind = 'human';
    s.client = client;
    s.playerId = client.playerId;
    s.nickname = client.nickname;
    s.tag = client.tag;
    s.animal = client.animal;
    s.hat = client.hat;
    s.bot = null;
    s.botDifficulty = null;
    s.ready = false;
    s.connected = true;
    s.forcedLast = false;
    this.lastHumanActivity = Date.now();
  }

  setBotSlot(i: number, difficulty: BotDifficulty): void {
    const s = this.slots[i];
    if (!s) return;
    if (s.disconnectTimer) {
      clearTimeout(s.disconnectTimer);
      s.disconnectTimer = null;
    }
    const names: Record<BotDifficulty, string> = { easy: 'Sunny', medium: 'Splish', hard: 'Riptide' };
    s.kind = 'bot';
    s.client = null;
    s.playerId = null;
    s.nickname = `${names[difficulty]}Bot`;
    s.tag = 'BOT';
    s.animal = (['duck', 'frog', 'otter', 'turtle'] as AnimalId[])[i % 4]!;
    s.hat = 'none';
    s.botDifficulty = difficulty;
    s.bot = makeBot(difficulty, i);
    s.ready = true;
    s.connected = true;
    s.forcedLast = false;
  }

  clearSlot(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    this.slots[i] = emptySlot();
  }

  findClientSlot(playerId: string): number {
    return this.slots.findIndex((s) => s.playerId === playerId);
  }

  lobbyState(): LobbyState {
    return {
      code: this.code,
      name: this.opts.name,
      size: this.opts.size,
      isPublic: this.opts.isPublic,
      theme: this.opts.theme === 'random' ? this.theme : this.opts.theme,
      roundsToWin: this.opts.roundsToWin,
      botFill: this.opts.botFill,
      ranked: this.ranked,
      mode: this.mode,
      slots: this.slots.map((s, i) => ({
        slot: i,
        kind: s.kind,
        nickname: s.nickname,
        tag: s.tag,
        animal: s.animal,
        hat: s.hat,
        botDifficulty: s.botDifficulty,
        ready: s.ready || s.kind === 'bot',
        isHost: s.playerId !== null && s.playerId === this.hostPlayerId,
        playerId: s.playerId,
      })),
    };
  }

  broadcastLobby(): void {
    this.sendAll({ t: 'lobby_state', lobby: this.lobbyState() });
  }

  summary(): RoomSummary {
    const host = this.slots.find((s) => s.playerId === this.hostPlayerId);
    return {
      code: this.code,
      name: this.opts.name,
      size: this.opts.size,
      players: this.slots.filter((s) => s.kind !== 'open').length,
      maxPlayers: this.opts.size,
      theme: this.opts.theme === 'random' ? this.theme : this.opts.theme,
      host: host?.nickname ?? '???',
    };
  }

  participantCount(): number {
    return this.slots.filter((s) => s.kind !== 'open').length;
  }

  startMatch(): { ok: boolean; error?: string } {
    if (this.phase === 'playing') return { ok: false, error: 'Match already running' };
    if (this.opts.botFill) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i]!.kind === 'open') this.setBotSlot(i, 'medium');
      }
    }
    const participants = this.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'open');
    if (participants.length < 2) return { ok: false, error: 'Need at least 2 players' };

    const compact: RoomSlotState[] = participants.map(({ s }) => s);
    this.slots = compact;
    const size = this.opts.size;
    while (this.slots.length < size) this.slots.push(emptySlot());

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (s.kind === 'bot') s.bot = makeBot(s.botDifficulty ?? 'medium', i);
    }

    this.theme = this.opts.theme === 'random' ? THEMES[Math.floor(Math.random() * THEMES.length)]! : this.opts.theme;
    this.mapSeed = (Math.random() * 0xffffffff) >>> 0;
    this.state = createGame({
      mode: this.mode,
      mapSeed: this.mapSeed,
      playerCount: participants.length,
      roundsToWin: this.opts.roundsToWin,
      enableRevengeDucks: this.ranked ? CONFIG.REVENGE_DUCKS_RANKED : CONFIG.ENABLE_REVENGE_DUCKS,
    });
    this.phase = 'playing';
    this.inputs.clear();
    this.lastAppliedSeq.clear();
    this.lastBroadcastRound = 1;
    this.destroyedCastles = [];
    this.rematchVotes.clear();
    if (this.ranked) {
      this.matchId = db.createMatch(this.mode, true);
    } else {
      this.matchId = db.createMatch(this.mode, false);
    }

    const config: MatchConfigDto = {
      mode: this.mode,
      ranked: this.ranked,
      theme: this.theme,
      roundsToWin: this.opts.roundsToWin,
      enableRevengeDucks: this.state.options.enableRevengeDucks,
      players: this.slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.kind !== 'open')
        .map(({ s, i }) => ({
          slot: i,
          playerId: s.playerId ?? `bot-${i}`,
          nickname: s.nickname,
          tag: s.tag,
          animal: s.animal,
          hat: s.hat,
          isBot: s.kind === 'bot',
          botDifficulty: s.botDifficulty,
          rating:
            this.ranked && s.playerId ? Math.round(db.getRating(s.playerId, this.mode).rating) : null,
        })),
    };
    this.sendAll({ t: 'match_start', config });
    this.sendAll({
      t: 'round_start',
      roundNo: 1,
      mapSeed: this.mapSeed,
      castleGrid: [...this.state.tiles],
      theme: this.theme,
    });
    return { ok: true };
  }

  queueInput(slot: number, input: InputFrame): void {
    if (this.latencyMs > 0) {
      this.pendingInputs.push({ slot, input, applyAt: Date.now() + this.latencyMs });
    } else {
      this.inputs.set(slot, input);
    }
  }

  buildSnapshot(): Snapshot {
    const s = this.state!;
    return {
      tick: s.tick,
      phase: s.phase,
      roundNo: s.roundNo,
      tideRing: s.tideRing,
      countdownUntilTick: s.countdownUntilTick,
      roundWinner: s.roundWinner,
      matchWinner: s.matchWinner,
      players: s.players.map((p) => ({
        slot: p.slot,
        x: Math.round(p.x * 1000) / 1000,
        y: Math.round(p.y * 1000) / 1000,
        alive: p.alive,
        dir: p.dir,
        speed: p.speed,
        balloonCount: p.balloonCount,
        splashRange: p.splashRange,
        hasBoots: p.hasBoots,
        roundWins: p.roundWins,
        soaks: p.soaks,
        castlesWashed: p.castlesWashed,
        isDuck: p.isDuck,
        duckPos: p.duckPos,
        lastInputSeq: this.lastAppliedSeq.get(p.slot) ?? 0,
        emoteId: p.emoteId,
        emoteUntilTick: p.emoteUntilTick,
      })),
      balloons: s.balloons.map((b) => ({
        id: b.id,
        ownerSlot: b.ownerSlot,
        tx: b.tx,
        ty: b.ty,
        fx: Math.round(b.fx * 1000) / 1000,
        fy: Math.round(b.fy * 1000) / 1000,
        slideDir: b.slideDir,
        burstTick: b.burstTick,
        range: b.range,
        flying: b.flying,
      })),
      splashes: s.splashes.map((sp) => ({ tiles: sp.tiles, untilTick: sp.untilTick })),
      powerups: s.exposedPowerUps.map((p) => ({ ...p })),
      destroyedCastles: [...this.destroyedCastles],
    };
  }

  handleEvents(events: GameEvent[]): void {
    if (events.length === 0) return;
    this.sendAll({ t: 'event', events });
    for (const e of events) {
      if (e.type === 'castle_washed') {
        this.destroyedCastles.push(e.ty * (this.state?.w ?? 0) + e.tx);
      } else if (e.type === 'round_end') {
        const wins = this.state!.players.map((p) => p.roundWins);
        this.sendAll({ t: 'round_end', roundNo: this.state!.roundNo, winnerSlot: e.winnerSlot, draw: e.draw, wins });
      } else if (e.type === 'match_end') {
        this.finishMatch(e.winnerSlot);
      }
    }
  }

  finishMatch(winnerSlot: number): void {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    const s = this.state!;
    const participants = this.slots
      .map((slotState, i) => ({ slotState, i, p: s.players[i] }))
      .filter(({ slotState, p }) => slotState.kind !== 'open' && p);

    const sorted = [...participants].sort((a, b) => {
      if (a.slotState.forcedLast !== b.slotState.forcedLast) return a.slotState.forcedLast ? 1 : -1;
      if (b.p!.roundWins !== a.p!.roundWins) return b.p!.roundWins - a.p!.roundWins;
      return b.p!.soaks - a.p!.soaks;
    });

    const placements: Placement[] = [];
    let currentPlacement = 1;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!;
      if (i > 0) {
        const prev = sorted[i - 1]!;
        const tied =
          !cur.slotState.forcedLast &&
          !prev.slotState.forcedLast &&
          cur.p!.roundWins === prev.p!.roundWins &&
          cur.p!.soaks === prev.p!.soaks;
        if (!tied) currentPlacement = i + 1;
      }
      placements.push({
        slot: cur.i,
        playerId: cur.slotState.playerId ?? `bot-${cur.i}`,
        nickname: cur.slotState.nickname,
        tag: cur.slotState.tag,
        animal: cur.slotState.animal,
        placement: currentPlacement,
        roundWins: cur.p!.roundWins,
        soaks: cur.p!.soaks,
        castlesWashed: cur.p!.castlesWashed,
        ratingBefore: null,
        ratingAfter: null,
        xpEarned: 0,
        isBot: cur.slotState.kind === 'bot',
      });
    }

    const xpMap: Record<string, number> = {};
    const ratingDeltas: Record<string, number> = {};
    const records: db.MatchPlayerRecord[] = [];

    if (this.ranked) {
      const humans = placements.filter((pl) => !pl.isBot);
      if (this.mode === 'duel' && humans.length === 2) {
        const [a, b] = humans;
        const ra = db.getRating(a!.playerId, this.mode);
        const rb = db.getRating(b!.playerId, this.mode);
        a!.ratingBefore = Math.round(ra.rating);
        b!.ratingBefore = Math.round(rb.rating);
        if (a!.placement === b!.placement) {
          a!.ratingAfter = Math.round(ra.rating);
          b!.ratingAfter = Math.round(rb.rating);
          ratingDeltas[a!.playerId] = 0;
          ratingDeltas[b!.playerId] = 0;
        } else {
          const aWon = a!.placement < b!.placement;
          const { duelDelta } = eloShared;
          const da = duelDelta(ra.rating, rb.rating, aWon, ra.games);
          const db2 = duelDelta(rb.rating, ra.rating, !aWon, rb.games);
          a!.ratingAfter = Math.round(ra.rating + da);
          b!.ratingAfter = Math.round(rb.rating + db2);
          ratingDeltas[a!.playerId] = Math.round(da);
          ratingDeltas[b!.playerId] = Math.round(db2);
          db.applyRatingChange(a!.playerId, this.mode, ra.rating + da, aWon);
          db.applyRatingChange(b!.playerId, this.mode, rb.rating + db2, !aWon);
        }
      } else if (this.mode === 'ffa') {
        const results = humans.map((pl) => {
          const r = db.getRating(pl.playerId, this.mode);
          pl.ratingBefore = Math.round(r.rating);
          return { playerId: pl.playerId, placement: pl.placement, rating: r.rating, games: r.games };
        });
        const deltas = eloShared.ffaDeltas(results);
        for (const pl of humans) {
          const d = deltas.get(pl.playerId) ?? 0;
          const r = db.getRating(pl.playerId, this.mode);
          pl.ratingAfter = Math.round(r.rating + d);
          ratingDeltas[pl.playerId] = Math.round(d);
          db.applyRatingChange(pl.playerId, this.mode, r.rating + d, pl.placement === 1);
        }
      }
    }

    for (const pl of placements) {
      if (pl.isBot) continue;
      const xp =
        CONFIG.XP.PARTICIPATION +
        (CONFIG.XP.PLACEMENT[pl.placement - 1] ?? 0) +
        pl.soaks * CONFIG.XP.PER_SOAK +
        pl.castlesWashed * CONFIG.XP.PER_CASTLE;
      pl.xpEarned = xp;
      xpMap[pl.playerId] = xp;
      db.addXp(pl.playerId, xp);
      records.push({
        playerId: pl.playerId,
        placement: pl.placement,
        soaks: pl.soaks,
        roundsWon: pl.roundWins,
        ratingBefore: pl.ratingBefore,
        ratingAfter: pl.ratingAfter,
        xpEarned: xp,
      });
    }

    if (this.matchId) db.finishMatch(this.matchId, records);

    for (const slotState of this.slots) {
      if (slotState.kind === 'human' && slotState.client && slotState.connected && slotState.playerId) {
        const prof = profileDtoForSend(slotState.playerId);
        if (prof) slotState.client.send({ t: 'profile', profile: prof });
      }
    }

    this.sendAll({ t: 'match_end', placements, xp: xpMap, ratingDeltas, rematch: !this.ranked });
    void winnerSlot;
  }

  convertToBot(slotIdx: number, difficulty: BotDifficulty): void {
    const s = this.slots[slotIdx];
    if (!s || s.kind !== 'human') return;
    const nickname = s.nickname;
    const animal = s.animal;
    this.setBotSlot(slotIdx, difficulty);
    s.nickname = nickname;
    s.animal = animal;
  }

  forfeit(slotIdx: number): void {
    const s = this.slots[slotIdx];
    if (!s || !this.state) return;
    if (this.mode === 'duel') {
      const other = this.state.players.find((p) => p.slot !== slotIdx);
      if (other) {
        other.roundWins = this.opts.roundsToWin;
        this.state.matchWinner = other.slot;
      }
      this.state.phase = 'matchEnd';
      this.state.events.push({ type: 'match_end', winnerSlot: other?.slot ?? 0 });
    } else {
      s.forcedLast = true;
      const p = this.state.players[slotIdx];
      if (p) {
        p.alive = false;
        p.isDuck = false;
      }
    }
  }
}

import * as eloShared from '@splash/shared';

function emptySlot(): RoomSlotState {
  return {
    kind: 'open',
    client: null,
    playerId: null,
    nickname: '',
    tag: '',
    animal: 'frog',
    hat: 'none',
    botDifficulty: null,
    bot: null,
    ready: false,
    connected: false,
    disconnectTimer: null,
    forcedLast: false,
  };
}

export class RoomManager {
  rooms = new Map<string, Room>();
  latencyMs: number;

  constructor(latencyMs = 0) {
    this.latencyMs = latencyMs;
  }

  createRoom(client: ClientConn, opts: RoomOptions): Room {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room(code, opts, false, client, this.latencyMs);
    this.rooms.set(code, room);
    return room;
  }

  createRankedRoom(mode: GameMode, clients: ClientConn[]): Room {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const size = mode === 'duel' ? 2 : 4;
    const room = new Room(
      code,
      { name: 'Ranked', size: size as 2 | 4, isPublic: false, theme: 'random', roundsToWin: 3, botFill: false },
      true,
      null,
      this.latencyMs,
    );
    clients.forEach((c, i) => room.fillSlot(i, c));
    room.hostPlayerId = clients[0]?.playerId ?? '';
    this.rooms.set(code, room);
    room.startMatch();
    return room;
  }

  listPublic(): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.opts.isPublic && room.phase === 'lobby' && !room.ranked) out.push(room.summary());
    }
    return out.sort((a, b) => b.players - a.players);
  }

  findRoomForPlayer(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.slots.some((s) => s.playerId === playerId)) return room;
    }
    return undefined;
  }

  joinRoom(client: ClientConn, code: string): { ok: boolean; error?: string; room?: Room } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.phase !== 'lobby') return { ok: false, error: 'Match already in progress' };
    const open = room.slots.findIndex((s) => s.kind === 'open');
    if (open < 0) return { ok: false, error: 'Room is full' };
    room.fillSlot(open, client);
    room.lastHumanActivity = Date.now();
    return { ok: true, room };
  }

  leaveRoom(client: ClientConn): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room) return;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return;
    const slot = room.slots[idx]!;
    if (room.phase === 'playing') {
      slot.connected = false;
      slot.client = null;
      return;
    }
    room.clearSlot(idx);
    if (room.hostPlayerId === client.playerId) {
      const nextHuman = room.slots.find((s) => s.kind === 'human' && s.connected);
      room.hostPlayerId = nextHuman?.playerId ?? '';
    }
    if (room.humanCount() === 0) {
      this.destroy(room.code);
      return;
    }
    room.broadcastLobby();
  }

  onDisconnect(client: ClientConn): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room) return;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return;
    const slot = room.slots[idx]!;
    slot.connected = false;
    slot.client = null;

    if (room.phase === 'playing') {
      slot.disconnectTimer = setTimeout(() => {
        if (slot.connected) return;
        if (room.ranked) {
          room.forfeit(idx);
          room.sendAll({ t: 'error', code: 'forfeit', msg: `${slot.nickname} forfeited (disconnect)` });
        } else {
          room.convertToBot(idx, 'medium');
          room.sendAll({ t: 'error', code: 'bot_replace', msg: `${slot.nickname} was replaced by a bot` });
        }
      }, CONFIG.RECONNECT_GRACE_MS);
    } else {
      room.clearSlot(idx);
      if (room.hostPlayerId === client.playerId) {
        const nextHuman = room.slots.find((s) => s.kind === 'human' && s.connected);
        room.hostPlayerId = nextHuman?.playerId ?? '';
      }
      if (room.humanCount() === 0) this.destroy(room.code);
      else room.broadcastLobby();
    }
  }

  reattach(client: ClientConn): Room | null {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'playing') return null;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return null;
    const slot = room.slots[idx]!;
    if (slot.connected) return null;
    slot.kind = 'human';
    slot.client = client;
    slot.connected = true;
    if (slot.disconnectTimer) {
      clearTimeout(slot.disconnectTimer);
      slot.disconnectTimer = null;
    }
    if (slot.bot) {
      slot.bot = null;
      slot.botDifficulty = null;
    }
    const s = room.state!;
    client.send({
      t: 'match_start',
      config: {
        mode: room.mode,
        ranked: room.ranked,
        theme: room.theme,
        roundsToWin: room.opts.roundsToWin,
        enableRevengeDucks: s.options.enableRevengeDucks,
        players: room.slots
          .map((ss, i) => ({ ss, i }))
          .filter(({ ss }) => ss.kind !== 'open')
          .map(({ ss, i }) => ({
            slot: i,
            playerId: ss.playerId ?? `bot-${i}`,
            nickname: ss.nickname,
            tag: ss.tag,
            animal: ss.animal,
            hat: ss.hat,
            isBot: ss.kind === 'bot',
            botDifficulty: ss.botDifficulty,
            rating: room.ranked && ss.playerId ? Math.round(db.getRating(ss.playerId, room.mode).rating) : null,
          })),
      },
    });
    client.send({ t: 'round_start', roundNo: s.roundNo, mapSeed: room.mapSeed, castleGrid: [...s.tiles], theme: room.theme });
    return room;
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const s of room.slots) {
      if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    }
    this.rooms.delete(code);
  }

  gc(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.humanCount() === 0 && now - room.lastHumanActivity > CONFIG.ROOM_IDLE_TTL_MS) {
        this.destroy(room.code);
      }
    }
  }

  setSlot(client: ClientConn, slotIdx: number, kind: 'bot' | 'open', difficulty?: BotDifficulty): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'lobby' || room.ranked) return;
    if (room.hostPlayerId !== client.playerId) return;
    const slot = room.slots[slotIdx];
    if (!slot || slot.kind === 'human') return;
    if (kind === 'bot') room.setBotSlot(slotIdx, difficulty ?? 'medium');
    else room.clearSlot(slotIdx);
    room.broadcastLobby();
  }

  setReady(client: ClientConn, ready: boolean): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'lobby') return;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return;
    room.slots[idx]!.ready = ready;
    room.broadcastLobby();
  }

  startMatch(client: ClientConn): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'lobby') return;
    if (room.hostPlayerId !== client.playerId) {
      client.send({ t: 'error', code: 'not_host', msg: 'Only the host can start' });
      return;
    }
    const res = room.startMatch();
    if (!res.ok) client.send({ t: 'error', code: 'start_failed', msg: res.error ?? 'Cannot start' });
  }

  handleInput(client: ClientConn, seq: number, dir: 0 | 1 | 2 | 3 | 4, balloon: boolean): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'playing') return;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return;
    const slot = room.slots[idx]!;
    if (slot.kind !== 'human' || !slot.connected) return;
    room.queueInput(idx, { seq, dir, balloon });
  }

  handleEmote(client: ClientConn, id: number): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'playing' || !room.state) return;
    const idx = room.findClientSlot(client.playerId);
    if (idx < 0) return;
    setEmote(room.state, idx, id);
  }

  rematchVote(client: ClientConn): void {
    const room = this.findRoomForPlayer(client.playerId);
    if (!room || room.phase !== 'ended' || room.ranked) return;
    room.rematchVotes.add(client.playerId);
    const humans = room.slots.filter((s) => s.kind === 'human' && s.connected).length;
    const needed = Math.floor(humans / 2) + 1;
    room.sendAll({ t: 'rematch_status', votes: room.rematchVotes.size, needed });
    if (room.rematchVotes.size >= needed) {
      for (let i = 0; i < room.slots.length; i++) {
        const s = room.slots[i]!;
        if (s.kind === 'human' && !s.connected) room.clearSlot(i);
      }
      room.startMatch();
    }
  }


  tickAll(simulate: (room: Room, inputs: Map<number, InputFrame>) => void): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing' || !room.state) continue;
      if (room.latencyMs > 0 && room.pendingInputs.length > 0) {
        const due = room.pendingInputs.filter((p) => p.applyAt <= now);
        room.pendingInputs = room.pendingInputs.filter((p) => p.applyAt > now);
        for (const p of due) room.inputs.set(p.slot, p.input);
      }
      simulate(room, room.inputs);
    }
  }
}
