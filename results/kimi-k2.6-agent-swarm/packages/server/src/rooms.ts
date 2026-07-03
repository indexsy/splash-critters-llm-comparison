import { EventEmitter } from 'node:events';
import { CONFIG } from '@splash-critters/shared';
import type {
  PlayerId,
  RoomCode,
  GameMode,
  RoomVisibility,
  BotDifficulty,
  SlotState,
  LobbyState,
  RoomInfo,
  GameConfig,
} from '@splash-critters/shared';
import type { ConnectionManager } from './net.js';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRoomCode(): RoomCode {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export type RoomState = 'waiting' | 'playing' | 'rematch';

export class Room extends EventEmitter {
  code: RoomCode;
  name: string;
  hostId: PlayerId;
  mode: GameMode;
  visibility: RoomVisibility;
  theme: 'backyard' | 'beach' | 'pool' | 'random';
  roundsToWin: number;
  botFill: boolean;
  slots: SlotState[];
  humansPresent: number;
  state: RoomState;
  createdAt: number;
  lastActivity: number;

  private disconnectTimers = new Map<PlayerId, NodeJS.Timeout>();
  private rematchVotes = new Set<PlayerId>();
  private connManager: ConnectionManager | undefined;

  constructor(
    code: RoomCode,
    opts: {
      name: string;
      hostId: PlayerId;
      mode: GameMode;
      visibility: RoomVisibility;
      theme: 'backyard' | 'beach' | 'pool' | 'random';
      roundsToWin: number;
      botFill: boolean;
    },
    connManager?: ConnectionManager
  ) {
    super();
    this.code = code;
    this.name = opts.name;
    this.hostId = opts.hostId;
    this.mode = opts.mode;
    this.visibility = opts.visibility;
    this.theme = opts.theme;
    this.roundsToWin = opts.roundsToWin;
    this.botFill = opts.botFill;
    this.slots = Array.from({ length: opts.mode === 'duel' ? 2 : 4 }, () => ({
      kind: 'human' as const,
    }));
    this.humansPresent = 0;
    this.state = 'waiting';
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.connManager = connManager;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  getLobbyState(): LobbyState {
    return {
      roomCode: this.code,
      name: this.name,
      hostId: this.hostId,
      mode: this.mode,
      visibility: this.visibility,
      theme: this.theme,
      roundsToWin: this.roundsToWin,
      botFill: this.botFill,
      slots: this.slots,
      humansPresent: this.humansPresent,
      state: this.state === 'rematch' ? 'waiting' : this.state,
    };
  }

  private broadcast(msg: Parameters<ConnectionManager['broadcast']>[0]): void {
    if (!this.connManager) return;
    const playerIds: PlayerId[] = [];
    for (const slot of this.slots) {
      if (slot.kind === 'human' && slot.playerId) {
        playerIds.push(slot.playerId);
      }
    }
    this.connManager.broadcast(msg, playerIds);
  }

  join(playerId: PlayerId): boolean {
    if (this.state === 'playing') return false;
    const emptyIdx = this.slots.findIndex(
      (s) => s.kind === 'human' && !s.playerId
    );
    if (emptyIdx === -1) return false;
    this.slots[emptyIdx] = { kind: 'human', playerId, ready: false };
    this.humansPresent++;
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return true;
  }

  leave(playerId: PlayerId): boolean {
    const idx = this.slots.findIndex(
      (s) => s.kind === 'human' && s.playerId === playerId
    );
    if (idx === -1) return false;

    this.cancelDisconnectTimer(playerId);

    if (this.state === 'playing') {
      // Casual disconnect: convert to Medium bot after grace period
      const timer = setTimeout(() => {
        this.convertToBot(playerId);
      }, CONFIG.RECONNECT_GRACE_MS);
      this.disconnectTimers.set(playerId, timer);
      return true;
    }

    // Waiting state: remove immediately
    this.slots[idx] = { kind: 'human' };
    this.humansPresent--;
    if (this.hostId === playerId) {
      const newHost = this.slots.find(
        (s) => s.kind === 'human' && s.playerId
      );
      if (newHost) {
        this.hostId = newHost.playerId!;
      } else {
        this.emit('empty', this.code);
        return true;
      }
    }
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return true;
  }

  cancelDisconnectTimer(playerId: PlayerId): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }

  private convertToBot(playerId: PlayerId): void {
    const idx = this.slots.findIndex(
      (s) => s.kind === 'human' && s.playerId === playerId
    );
    if (idx === -1) return;
    this.slots[idx] = { kind: 'bot', difficulty: 'medium' };
    this.humansPresent--;
    this.disconnectTimers.delete(playerId);
    this.emit('player_became_bot', playerId, idx);
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
  }

  setSlot(
    slotIdx: number,
    kind: 'human' | 'bot',
    difficulty?: BotDifficulty
  ): boolean {
    if (slotIdx < 0 || slotIdx >= this.slots.length) return false;
    if (this.state !== 'waiting') return false;
    if (this.slots[slotIdx].kind === 'human' && this.slots[slotIdx].playerId) {
      return false; // Can't change a slot occupied by a human
    }
    if (kind === 'bot') {
      if (!difficulty) return false;
      this.slots[slotIdx] = { kind: 'bot', difficulty };
    } else {
      this.slots[slotIdx] = { kind: 'human' };
    }
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return true;
  }

  setReady(playerId: PlayerId, ready: boolean): boolean {
    const slot = this.slots.find(
      (s) => s.kind === 'human' && s.playerId === playerId
    );
    if (!slot) return false;
    slot.ready = ready;
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return true;
  }

  canStart(): boolean {
    if (this.state !== 'waiting') return false;
    const humanSlots = this.slots.filter(
      (s) => s.kind === 'human' && s.playerId
    );
    const allReady = humanSlots.every((s) => s.ready);
    if (!allReady) return false;
    if (this.botFill) {
      return humanSlots.length >= 1;
    }
    return this.slots.every(
      (s) => s.kind === 'bot' || (s.kind === 'human' && s.playerId)
    );
  }

  startMatch(): GameConfig | null {
    if (!this.canStart()) return null;
    if (this.botFill) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i].kind === 'human' && !this.slots[i].playerId) {
          this.slots[i] = { kind: 'bot', difficulty: 'medium' };
        }
      }
    }
    this.state = 'playing';
    this.rematchVotes.clear();
    this.touch();
    const config: GameConfig = {
      mode: this.mode,
      roundsToWin: this.roundsToWin,
      mapTheme: this.theme,
      enableKick: true,
      enableRevengeDucks: true,
      botFill: this.botFill,
    };
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return config;
  }

  endMatch(): void {
    this.state = 'rematch';
    this.rematchVotes.clear();
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
  }

  getGameConfig(): GameConfig {
    return {
      mode: this.mode,
      roundsToWin: this.roundsToWin,
      mapTheme: this.theme,
      enableKick: true,
      enableRevengeDucks: true,
      botFill: this.botFill,
    };
  }

  handleDisconnect(playerId: PlayerId): void {
    this.leave(playerId);
  }

  handleReconnectTimeout(playerId: PlayerId): void {
    this.convertToBot(playerId);
  }

  voteRematch(playerId: PlayerId, vote?: boolean): boolean {
    if (this.state !== 'rematch') return false;
    const slot = this.slots.find(
      (s) => s.kind === 'human' && s.playerId === playerId
    );
    if (!slot) return false;
    if (vote === false) {
      this.rematchVotes.delete(playerId);
    } else {
      this.rematchVotes.add(playerId);
    }
    const votesNeeded = Math.floor(this.humansPresent / 2) + 1;
    if (this.rematchVotes.size >= votesNeeded) {
      this.startRematch();
    }
    return true;
  }

  startRematch(): boolean {
    if (this.state !== 'rematch') return false;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].kind === 'bot') {
        this.slots[i] = { kind: 'human' };
      } else if (this.slots[i].kind === 'human' && this.slots[i].playerId) {
        this.slots[i].ready = false;
      }
    }
    this.state = 'waiting';
    this.rematchVotes.clear();
    this.touch();
    this.broadcast({ type: 'lobby_state', lobby: this.getLobbyState() });
    return true;
  }

  destroy(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.removeAllListeners();
  }

  getPlayerIds(): PlayerId[] {
    return this.slots
      .filter((s) => s.kind === 'human' && s.playerId)
      .map((s) => s.playerId!);
  }

  getBotSlots(): Array<{ slotIdx: number; difficulty: BotDifficulty }> {
    return this.slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === 'bot')
      .map(({ s, i }) => ({ slotIdx: i, difficulty: s.difficulty! }));
  }
}

export class RoomManager extends EventEmitter {
  private rooms = new Map<RoomCode, Room>();
  private playerToRoom = new Map<PlayerId, RoomCode>();
  private connManager: ConnectionManager | undefined;

  constructor(connManager?: ConnectionManager) {
    super();
    this.connManager = connManager;
  }

  createRoom(opts: {
    name: string;
    hostId: PlayerId;
    mode: GameMode;
    visibility: RoomVisibility;
    theme: 'backyard' | 'beach' | 'pool' | 'random';
    roundsToWin: number;
    botFill: boolean;
  }): Room {
    let code: RoomCode;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code, opts, this.connManager);
    this.rooms.set(code, room);
    this.playerToRoom.set(opts.hostId, code);

    room.on('empty', (roomCode: RoomCode) => {
      this.destroyRoom(roomCode);
    });

    room.on('player_became_bot', (playerId: PlayerId, slotIdx: number) => {
      this.emit('player_became_bot', room.code, playerId, slotIdx);
    });

    return room;
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomByPlayer(playerId: PlayerId): Room | undefined {
    const code = this.playerToRoom.get(playerId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  joinRoom(code: RoomCode, playerId: PlayerId): Room | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    if (this.playerToRoom.has(playerId)) {
      this.leaveRoom(playerId);
    }
    const success = room.join(playerId);
    if (!success) return null;
    this.playerToRoom.set(playerId, code);
    return room;
  }

  leaveRoom(playerId: PlayerId): boolean {
    const code = this.playerToRoom.get(playerId);
    if (!code) return false;
    const room = this.rooms.get(code);
    if (!room) {
      this.playerToRoom.delete(playerId);
      return false;
    }
    room.leave(playerId);
    this.playerToRoom.delete(playerId);
    if (room.humansPresent === 0) {
      this.destroyRoom(code);
    }
    return true;
  }

  setSlot(
    code: RoomCode,
    slot: number,
    kind: 'human' | 'bot',
    difficulty?: BotDifficulty
  ): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    return room.setSlot(slot, kind, difficulty);
  }

  setReady(playerId: PlayerId, ready: boolean): boolean {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return false;
    return room.setReady(playerId, ready);
  }

  startMatch(hostId: PlayerId): { room: Room; config: GameConfig } | null {
    const room = this.getRoomByPlayer(hostId);
    if (!room || room.hostId !== hostId) return null;
    const config = room.startMatch();
    if (!config) return null;
    return { room, config };
  }

  getPublicRooms(filter?: GameMode): RoomInfo[] {
    const rooms: RoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public') continue;
      if (room.state !== 'waiting') continue;
      if (filter && room.mode !== filter) continue;
      rooms.push({
        code: room.code,
        name: room.name,
        mode: room.mode,
        players: room.humansPresent,
        maxPlayers: room.mode === 'duel' ? 2 : 4,
        theme: room.theme,
        host: room.hostId,
      });
    }
    return rooms;
  }

  destroyRoom(code: RoomCode): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.destroy();
    for (const [pid, rc] of this.playerToRoom) {
      if (rc === code) this.playerToRoom.delete(pid);
    }
    this.rooms.delete(code);
    this.emit('room_destroyed', code);
    return true;
  }

  gcIdleRooms(): number {
    const now = Date.now();
    let count = 0;
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > CONFIG.ROOM_TTL_MS) {
        this.destroyRoom(code);
        count++;
      }
    }
    return count;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }
}
