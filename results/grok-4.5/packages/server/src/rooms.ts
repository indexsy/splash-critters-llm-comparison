import { randomBytes } from 'node:crypto';
import {
  CONFIG,
  tierFromRating,
  type AnimalId,
  type BotDifficulty,
  type GameMode,
  type HatId,
  type MapTheme,
  type MatchConfig,
  type RoomInfo,
  type RoomOptions,
  dimensionsForMode,
} from '@splash/shared';
import type { Profile } from '@splash/shared';
import { GameMatch, type MatchCallbacks } from './gameLoop.js';

export type RoomSlotState = {
  kind: 'empty' | 'human' | 'bot';
  playerId?: string;
  nickname?: string;
  animal?: AnimalId;
  hat?: HatId;
  difficulty?: BotDifficulty;
  ready?: boolean;
  connected?: boolean;
};

export type Room = {
  code: string;
  opts: RoomOptions;
  hostId: string;
  slots: RoomSlotState[];
  match: GameMatch | null;
  lastActive: number;
  rematchVotes: Map<string, boolean>;
  hidden: boolean; // ranked
};

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) code += chars[bytes[i]! % chars.length];
  return code;
}

export class RoomManager {
  rooms = new Map<string, Room>();

  create(hostId: string, hostProfile: Profile, opts: RoomOptions, hidden = false): Room {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const slots: RoomSlotState[] = Array.from({ length: opts.size }, () => ({ kind: 'empty' as const }));
    slots[0] = {
      kind: 'human',
      playerId: hostId,
      nickname: `${hostProfile.nickname}#${hostProfile.tag}`,
      animal: hostProfile.selectedAnimal,
      hat: hostProfile.selectedHat,
      ready: false,
      connected: true,
    };
    const room: Room = {
      code,
      opts: { ...opts },
      hostId,
      slots,
      match: null,
      lastActive: Date.now(),
      rematchVotes: new Map(),
      hidden,
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  findByPlayer(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.slots.some((s) => s.playerId === playerId)) return room;
    }
    return undefined;
  }

  leave(playerId: string): Room | undefined {
    const room = this.findByPlayer(playerId);
    if (!room) return undefined;
    room.lastActive = Date.now();
    for (const slot of room.slots) {
      if (slot.playerId === playerId) {
        if (room.match) {
          room.match.setConnected(playerId, false);
          slot.connected = false;
        } else {
          slot.kind = 'empty';
          slot.playerId = undefined;
          slot.nickname = undefined;
          slot.animal = undefined;
          slot.hat = undefined;
          slot.ready = false;
          slot.connected = false;
        }
      }
    }
    // Reassign host if needed
    if (room.hostId === playerId && !room.match) {
      const next = room.slots.find((s) => s.kind === 'human' && s.playerId);
      if (next?.playerId) room.hostId = next.playerId;
    }
    // Empty room GC later
    if (!room.slots.some((s) => s.kind === 'human' && s.connected !== false && s.playerId) && !room.match) {
      this.rooms.delete(room.code);
      return undefined;
    }
    return room;
  }

  join(code: string, playerId: string, profile: Profile): Room | { error: string } {
    const room = this.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.match) return { error: 'Match already in progress' };
    // Already in?
    if (room.slots.some((s) => s.playerId === playerId)) return room;
    const empty = room.slots.findIndex((s) => s.kind === 'empty');
    if (empty < 0) return { error: 'Room full' };
    room.slots[empty] = {
      kind: 'human',
      playerId,
      nickname: `${profile.nickname}#${profile.tag}`,
      animal: profile.selectedAnimal,
      hat: profile.selectedHat,
      ready: false,
      connected: true,
    };
    room.lastActive = Date.now();
    return room;
  }

  setSlot(room: Room, hostId: string, slot: number, kind: 'empty' | 'bot', difficulty?: BotDifficulty): boolean {
    if (room.hostId !== hostId) return false;
    if (slot < 0 || slot >= room.slots.length) return false;
    if (room.slots[slot]?.kind === 'human' && room.slots[slot]?.playerId !== hostId) return false;
    if (kind === 'empty') {
      room.slots[slot] = { kind: 'empty' };
    } else {
      room.slots[slot] = {
        kind: 'bot',
        playerId: `bot-${difficulty ?? 'medium'}-${slot}`,
        nickname: `Bot${slot + 1}`,
        animal: (['frog', 'duck', 'otter', 'penguin'] as AnimalId[])[slot % 4],
        hat: 'none',
        difficulty: difficulty ?? 'medium',
        ready: true,
        connected: true,
      };
    }
    room.lastActive = Date.now();
    return true;
  }

  setReady(room: Room, playerId: string, ready: boolean): void {
    const slot = room.slots.find((s) => s.playerId === playerId);
    if (slot) slot.ready = ready;
    room.lastActive = Date.now();
  }

  canStart(room: Room): boolean {
    const filled = room.slots.filter((s) => s.kind !== 'empty');
    if (filled.length < 2) return false;
    for (const s of filled) {
      if (s.kind === 'human' && !s.ready) return false;
    }
    return true;
  }

  lobbyState(room: Room) {
    return {
      code: room.code,
      opts: room.opts,
      hostId: room.hostId,
      slots: room.slots.map((s, i) => ({
        slot: i,
        kind: s.kind,
        playerId: s.playerId,
        nickname: s.nickname,
        animal: s.animal,
        hat: s.hat,
        difficulty: s.difficulty,
        ready: s.ready,
        connected: s.connected,
        isHost: s.playerId === room.hostId,
      })),
    };
  }

  listPublic(): RoomInfo[] {
    const list: RoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.hidden || !room.opts.public || room.match) continue;
      const humans = room.slots.filter((s) => s.kind === 'human').length;
      const filled = room.slots.filter((s) => s.kind !== 'empty').length;
      const hostSlot = room.slots.find((s) => s.playerId === room.hostId);
      list.push({
        code: room.code,
        name: room.opts.name,
        mode: room.opts.mode,
        size: room.opts.size,
        players: filled,
        maxPlayers: room.opts.size,
        theme: room.opts.theme,
        host: hostSlot?.nickname ?? '?',
        public: true,
        inMatch: false,
      });
    }
    return list;
  }

  startMatch(room: Room, cbs: MatchCallbacks): MatchConfig | null {
    if (!this.canStart(room)) return null;
    const mode: GameMode = room.opts.size === 2 ? 'duel' : 'ffa';
    room.opts.mode = mode;
    const dims = dimensionsForMode(mode);
    let theme = room.opts.theme;
    if (theme === 'random') {
      theme = (['backyard', 'beach', 'pool'] as const)[Math.floor(Math.random() * 3)]!;
    }

    const players = room.slots
      .map((s, i) => {
        if (s.kind === 'empty') return null;
        return {
          id: s.playerId!,
          slot: i,
          nickname: s.nickname ?? 'Player',
          animal: s.animal ?? 'frog',
          hat: s.hat ?? 'none',
          isBot: s.kind === 'bot',
          rating: undefined as number | undefined,
          tier: undefined as string | undefined,
        };
      })
      .filter(Boolean) as MatchConfig['players'];

    // Compact slots
    players.forEach((p, i) => (p.slot = i));

    const config: MatchConfig = {
      matchId: randomBytes(8).toString('hex'),
      mode,
      kind: room.hidden ? 'ranked' : room.opts.name === 'Practice' ? 'practice' : 'casual',
      ranked: !!room.hidden && room.opts.name === 'Ranked',
      roundsToWin: room.opts.roundsToWin,
      theme,
      width: dims.width,
      height: dims.height,
      players,
    };

    const match = new GameMatch(config, cbs);
    // Apply bot difficulties from slots
    for (const s of room.slots) {
      if (s.kind === 'bot' && s.playerId) {
        const mp = match.players.find((p) => p.id === s.playerId);
        if (mp) mp.botDifficulty = s.difficulty ?? 'medium';
      }
    }
    room.match = match;
    room.rematchVotes.clear();
    match.start();
    return config;
  }

  createRankedMatch(
    players: Array<{ id: string; profile: Profile; rating: number }>,
    mode: GameMode,
    cbs: MatchCallbacks,
  ): { room: Room; config: MatchConfig } {
    const size = mode === 'duel' ? 2 : 4;
    const opts: RoomOptions = {
      name: 'Ranked',
      size: size as 2 | 4,
      public: false,
      theme: (['backyard', 'beach', 'pool'] as const)[Math.floor(Math.random() * 3)]!,
      roundsToWin: 3,
      botFill: false,
      mode,
    };
    const host = players[0]!;
    const room = this.create(host.id, host.profile, opts, true);
    // Fill slots
    room.slots = players.map((p, i) => ({
      kind: 'human' as const,
      playerId: p.id,
      nickname: `${p.profile.nickname}#${p.profile.tag}`,
      animal: p.profile.selectedAnimal,
      hat: p.profile.selectedHat,
      ready: true,
      connected: true,
    }));
    while (room.slots.length < size) room.slots.push({ kind: 'empty' });

    const dims = dimensionsForMode(mode);
    const config: MatchConfig = {
      matchId: randomBytes(8).toString('hex'),
      mode,
      kind: 'ranked',
      ranked: true,
      roundsToWin: 3,
      theme: opts.theme,
      width: dims.width,
      height: dims.height,
      players: players.map((p, i) => ({
        id: p.id,
        slot: i,
        nickname: `${p.profile.nickname}#${p.profile.tag}`,
        animal: p.profile.selectedAnimal,
        hat: p.profile.selectedHat,
        isBot: false,
        rating: p.rating,
        tier: tierFromRating(p.rating),
      })),
    };
    const match = new GameMatch(config, cbs);
    room.match = match;
    match.start();
    return { room, config };
  }

  createPractice(
    hostId: string,
    profile: Profile,
    size: 2 | 4,
    difficulty: BotDifficulty,
    cbs: MatchCallbacks,
  ): { room: Room; config: MatchConfig } {
    const opts: RoomOptions = {
      name: 'Practice',
      size,
      public: false,
      theme: 'backyard',
      roundsToWin: 2,
      botFill: true,
      mode: size === 2 ? 'duel' : 'ffa',
    };
    const room = this.create(hostId, profile, opts, true);
    for (let i = 1; i < size; i++) {
      room.slots[i] = {
        kind: 'bot',
        playerId: `bot-${difficulty}-${i}`,
        nickname: `Bot${i}`,
        animal: (['duck', 'otter', 'penguin', 'cat'] as AnimalId[])[i - 1]!,
        hat: 'none',
        difficulty,
        ready: true,
        connected: true,
      };
    }
    room.slots[0]!.ready = true;
    const config = this.startMatch(room, cbs)!;
    return { room, config };
  }

  gc(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.match) continue;
      if (now - room.lastActive > CONFIG.ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }
}
