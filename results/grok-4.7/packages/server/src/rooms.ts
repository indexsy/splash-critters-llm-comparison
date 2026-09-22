import {
  CONFIG,
  arenaSize,
  type BotDiff,
  type LobbyState,
  type Mode,
  type Profile,
  type RoomOpts,
  type RoomSummary,
  type ServerMsg,
  type Theme,
} from '@splash/shared';
import { LiveMatch, type MatchPlayer, type MatchResult } from './gameLoop.js';
import { isClean } from './profanity.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Hub {
  send(playerId: string, msg: ServerMsg): void;
  profile(playerId: string): Profile | null;
  rating(playerId: string, mode: Mode): { rating: number; games: number };
  rtt(playerId: string): number;
  onMatchStart(match: LiveMatch): void;
  onMatchEnd(match: LiveMatch, result: MatchResult): void;
}

interface Slot {
  kind: 'open' | 'human' | 'bot';
  playerId?: string;
  difficulty: BotDiff;
  ready: boolean;
}

interface Room {
  code: string;
  name: string;
  mode: Mode;
  public: boolean;
  theme: Theme | 'random';
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
  hostId: string;
  hidden: boolean;
  kind: 'casual' | 'ranked' | 'tutorial' | 'practice';
  slots: Slot[];
  match: LiveMatch | null;
  votes: Map<string, boolean>;
  updated: number;
  emptySince: number | null;
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private byPlayer = new Map<string, string>();

  constructor(private hub: Hub) {}

  tick(): void {
    for (const room of this.rooms.values()) room.match?.tick();
    this.gc();
  }

  codeFor(playerId: string): string | undefined {
    return this.byPlayer.get(playerId);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.byPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  create(playerId: string, opts: RoomOpts): Room | { error: string } {
    if (!isClean(opts.name)) return { error: 'Pick a nicer room name.' };
    this.leave(playerId);
    const code = this.freshCode();
    const size = opts.mode === 'duel' ? 2 : 4;
    const slots: Slot[] = Array.from({ length: size }, () => ({ kind: 'open', difficulty: 'medium', ready: false }));
    slots[0] = { kind: 'human', playerId, difficulty: 'medium', ready: false };
    const room: Room = {
      code,
      name: opts.name.slice(0, CONFIG.ROOM_NAME_MAX),
      mode: opts.mode,
      public: opts.public,
      theme: opts.theme,
      roundsToWin: opts.roundsToWin,
      botFill: opts.botFill,
      hostId: playerId,
      hidden: false,
      kind: 'casual',
      slots,
      match: null,
      votes: new Map(),
      updated: Date.now(),
      emptySince: null,
    };
    this.rooms.set(code, room);
    this.byPlayer.set(playerId, code);
    this.hub.send(playerId, { t: 'room_created', code });
    this.pushLobby(room);
    return room;
  }

  createSpecial(opts: {
    hostId: string;
    mode: Mode;
    kind: Room['kind'];
    players: { id: string; bot: boolean; difficulty?: BotDiff }[];
    roundsToWin: number;
    theme: Theme;
    ranked: boolean;
    hidden: boolean;
    name: string;
  }): Room {
    for (const p of opts.players) if (!p.bot) this.leave(p.id);
    const code = this.freshCode();
    const slots: Slot[] = opts.players.map((p) => ({
      kind: p.bot ? 'bot' : 'human',
      playerId: p.bot ? undefined : p.id,
      difficulty: p.difficulty ?? 'medium',
      ready: true,
    }));
    const room: Room = {
      code,
      name: opts.name,
      mode: opts.mode,
      public: false,
      theme: opts.theme,
      roundsToWin: (opts.roundsToWin === 2 || opts.roundsToWin === 5 ? opts.roundsToWin : 3) as 2 | 3 | 5,
      botFill: false,
      hostId: opts.hostId,
      hidden: opts.hidden,
      kind: opts.kind,
      slots,
      match: null,
      votes: new Map(),
      updated: Date.now(),
      emptySince: null,
    };
    for (const p of opts.players) if (!p.bot) this.byPlayer.set(p.id, code);
    this.rooms.set(code, room);
    this.startRoom(room, opts.ranked);
    return room;
  }

  join(playerId: string, code: string): void {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.hidden) {
      this.hub.send(playerId, { t: 'error', code: 'not_found', msg: 'No room with that code.' });
      return;
    }
    if (room.match) {
      this.hub.send(playerId, { t: 'error', code: 'started', msg: 'That match already started.' });
      return;
    }
    if (this.byPlayer.get(playerId) === room.code) {
      this.pushLobby(room);
      return;
    }
    const slot = room.slots.find((s) => s.kind === 'open');
    if (!slot) {
      this.hub.send(playerId, { t: 'error', code: 'room_full', msg: 'That room is full.' });
      return;
    }
    this.leave(playerId);
    slot.kind = 'human';
    slot.playerId = playerId;
    slot.ready = false;
    this.byPlayer.set(playerId, room.code);
    room.updated = Date.now();
    room.emptySince = null;
    this.pushLobby(room);
  }

  leave(playerId: string): void {
    const code = this.byPlayer.get(playerId);
    if (!code) return;
    const room = this.rooms.get(code);
    this.byPlayer.delete(playerId);
    if (!room) return;
    if (room.match && room.match.phase !== 'ended') {
      room.match.setConnected(playerId, false);
      return;
    }
    const slot = room.slots.find((s) => s.playerId === playerId);
    if (slot) {
      slot.kind = 'open';
      slot.playerId = undefined;
      slot.ready = false;
    }
    if (room.hostId === playerId) {
      const next = room.slots.find((s) => s.kind === 'human' && s.playerId);
      room.hostId = next?.playerId ?? '';
    }
    room.updated = Date.now();
    if (!room.slots.some((s) => s.kind === 'human')) room.emptySince = Date.now();
    this.pushLobby(room);
  }

  disconnect(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    if (room.match && room.match.phase !== 'ended') {
      room.match.setConnected(playerId, false);
      return;
    }
    this.leave(playerId);
  }

  reconnect(playerId: string): boolean {
    const room = this.roomOf(playerId);
    if (!room?.match || room.match.phase === 'ended') return false;
    const p = room.match.players.find((x) => x.id === playerId);
    if (!p || p.bot) return false;
    room.match.setConnected(playerId, true);
    room.match.setPing(playerId, this.hub.rtt(playerId));
    return true;
  }

  list(mode?: Mode | 'any'): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.hidden || !room.public || room.match) continue;
      if (mode && mode !== 'any' && room.mode !== mode) continue;
      const players = room.slots.filter((s) => s.kind !== 'open').length;
      if (players >= room.slots.length) continue;
      const host = this.hub.profile(room.hostId);
      out.push({
        code: room.code,
        name: room.name,
        mode: room.mode,
        players,
        max: room.slots.length,
        theme: room.theme,
        host: host ? `${host.nickname}#${host.tag}` : 'Host',
      });
    }
    return out;
  }

  setSlot(playerId: string, slotIndex: number, kind: 'open' | 'bot', difficulty: BotDiff): void {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || room.match) return;
    const slot = room.slots[slotIndex];
    if (!slot || slot.playerId === playerId) return;
    if (slot.kind === 'human') return;
    slot.kind = kind;
    slot.difficulty = difficulty;
    slot.ready = kind === 'bot';
    slot.playerId = undefined;
    this.pushLobby(room);
  }

  setReady(playerId: string, ready: boolean): void {
    const room = this.roomOf(playerId);
    if (!room || room.match) return;
    const slot = room.slots.find((s) => s.playerId === playerId);
    if (!slot) return;
    slot.ready = ready;
    this.pushLobby(room);
  }

  start(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || room.match) return;
    if (room.botFill) {
      for (const slot of room.slots) {
        if (slot.kind === 'open') {
          slot.kind = 'bot';
          slot.difficulty = slot.difficulty || 'medium';
          slot.ready = true;
        }
      }
    }
    const humans = room.slots.filter((s) => s.kind === 'human');
    if (humans.some((s) => !s.ready)) {
      this.hub.send(playerId, { t: 'error', code: 'not_ready', msg: 'Waiting for everyone to ready up.' });
      return;
    }
    const filled = room.slots.filter((s) => s.kind !== 'open');
    if (filled.length < 2) {
      this.hub.send(playerId, { t: 'error', code: 'need_players', msg: 'Need at least two critters.' });
      return;
    }
    this.startRoom(room, false);
  }

  vote(playerId: string, yes: boolean): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.votes.set(playerId, yes);
    const humans = room.slots.filter((s) => s.kind === 'human' && s.playerId);
    const yesCount = humans.filter((s) => s.playerId && room.votes.get(s.playerId)).length;
    const need = Math.floor(humans.length / 2) + 1;
    const msg: ServerMsg = { t: 'rematch_status', yes: yesCount, need };
    for (const s of humans) if (s.playerId) this.hub.send(s.playerId, msg);
    if (yesCount >= need) this.rematch(room);
  }

  input(playerId: string, seq: number, dir: Parameters<LiveMatch['pushInput']>[2], balloon: boolean): void {
    this.roomOf(playerId)?.match?.pushInput(playerId, seq, dir, balloon);
  }

  emote(playerId: string, id: number): void {
    this.roomOf(playerId)?.match?.emote(playerId, id);
  }

  private rematch(room: Room): void {
    room.match = null;
    room.votes.clear();
    for (const slot of room.slots) if (slot.kind === 'human') slot.ready = true;
    this.startRoom(room, room.kind === 'ranked');
  }

  private startRoom(room: Room, ranked: boolean): void {
    const size = arenaSize(room.mode);
    const width = room.kind === 'tutorial' ? CONFIG.TUTORIAL_W : size.w;
    const height = room.kind === 'tutorial' ? CONFIG.TUTORIAL_H : size.h;
    const theme = room.theme === 'random' ? pickTheme() : room.theme;
    const players: MatchPlayer[] = [];
    room.slots.forEach((slot, i) => {
      if (slot.kind === 'open') return;
      if (slot.kind === 'human' && slot.playerId) {
        const profile = this.hub.profile(slot.playerId);
        if (!profile) return;
        const rating = this.hub.rating(slot.playerId, room.mode);
        players.push({
          id: profile.id,
          name: profile.nickname,
          tag: profile.tag,
          animal: profile.animal,
          hat: profile.hat,
          bot: false,
          rating: rating.rating,
          games: rating.games,
          roundWins: 0,
          soaks: 0,
          castles: 0,
          biggestChain: 0,
          survived: 0,
          connected: true,
          disconnectAt: null,
          human: true,
        });
      } else {
        players.push({
          id: `bot:${room.code}:${i}`,
          name: slot.difficulty === 'hard' ? 'Hard Critter' : slot.difficulty === 'easy' ? 'Easy Critter' : 'Critter Bot',
          tag: String(1000 + i),
          animal: ['duck', 'frog', 'otter', 'penguin'][i % 4]!,
          hat: 'none',
          bot: true,
          difficulty: slot.difficulty,
          rating: 1000,
          games: 10,
          roundWins: 0,
          soaks: 0,
          castles: 0,
          biggestChain: 0,
          survived: 0,
          connected: true,
          disconnectAt: null,
          human: false,
        });
      }
    });
    const match = new LiveMatch(
      {
        id: crypto.randomUUID(),
        mode: room.mode,
        ranked,
        kind: room.kind,
        theme,
        roundsToWin: room.kind === 'tutorial' ? 1 : room.roundsToWin,
        width,
        height,
        players,
        revenge: ranked ? CONFIG.REVENGE_DUCKS_RANKED : room.kind === 'tutorial' ? false : CONFIG.ENABLE_REVENGE_DUCKS,
      },
      {
        send: (id, msg) => this.hub.send(id, msg),
        onEnd: (result) => {
          room.updated = Date.now();
          this.hub.onMatchEnd(match, result);
          if (room.kind === 'ranked' || room.kind === 'tutorial' || room.kind === 'practice') {
            for (const p of players) if (p.human) this.byPlayer.delete(p.id);
          }
        },
      },
    );
    room.match = match;
    room.updated = Date.now();
    for (const p of players) if (p.human) match.setPing(p.id, this.hub.rtt(p.id));
    this.hub.onMatchStart(match);
    match.start();
    this.pushLobby(room);
  }

  private pushLobby(room: Room): void {
    if (room.hidden) return;
    const state = this.lobbyState(room);
    for (const slot of room.slots) {
      if (slot.kind === 'human' && slot.playerId) this.hub.send(slot.playerId, { t: 'lobby_state', room: state });
    }
  }

  private lobbyState(room: Room): LobbyState {
    return {
      code: room.code,
      name: room.name,
      mode: room.mode,
      public: room.public,
      theme: room.theme,
      roundsToWin: room.roundsToWin,
      botFill: room.botFill,
      hostId: room.hostId,
      phase: room.match ? (room.match.phase === 'ended' ? 'results' : 'playing') : 'lobby',
      slots: room.slots.map((s, index) => {
        const profile = s.playerId ? this.hub.profile(s.playerId) : null;
        return {
          index,
          kind: s.kind,
          playerId: s.playerId,
          name: profile?.nickname ?? (s.kind === 'bot' ? 'Bot' : undefined),
          tag: profile?.tag,
          animal: profile?.animal ?? (s.kind === 'bot' ? 'duck' : undefined),
          hat: profile?.hat ?? 'none',
          ready: s.ready,
          difficulty: s.kind === 'bot' ? s.difficulty : undefined,
          ping: s.playerId ? this.hub.rtt(s.playerId) : 0,
          connected: s.kind !== 'human' || Boolean(s.playerId && this.byPlayer.get(s.playerId) === room.code),
          host: s.playerId === room.hostId,
        };
      }),
    };
  }

  private gc(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const humans = room.slots.some((s) => s.kind === 'human' && s.playerId && this.byPlayer.get(s.playerId) === code);
      if (!humans && !room.emptySince) room.emptySince = now;
      if (humans) room.emptySince = null;
      const idle = room.emptySince && now - room.emptySince > (room.hidden ? 60_000 : CONFIG.ROOM_TTL_MS);
      const ended = room.match?.phase === 'ended' && now - room.updated > CONFIG.ROOM_TTL_MS;
      if (idle || ended) {
        for (const slot of room.slots) if (slot.playerId) this.byPlayer.delete(slot.playerId);
        this.rooms.delete(code);
      }
    }
  }

  private freshCode(): string {
    for (let n = 0; n < 20; n++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return crypto.randomUUID().slice(0, 6).toUpperCase();
  }
}

function pickTheme(): Theme {
  const themes: Theme[] = ['backyard', 'beach', 'pool'];
  return themes[Math.floor(Math.random() * themes.length)]!;
}
