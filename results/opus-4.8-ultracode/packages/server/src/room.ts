/**
 * Room — a lobby that hosts one Match at a time. Manages slots (human/bot/closed),
 * readiness, host controls, disconnect grace (bot swap in casual, forfeit in ranked),
 * rematch voting, and the public room-browser projection.
 */

import {
  CONFIG,
  revengeDucksEnabled,
  type CreateRoomOpts,
  type Difficulty,
  type LobbyPhase,
  type LobbyState,
  type MatchConfig,
  type Mode,
  type RoomListItem,
  type RoundPlayerDTO,
  type ServerMsg,
  type SlotState,
} from '@splash/shared';
import { BotController } from './bots/bot';
import type { ServerContext } from './context';
import { Match } from './match';
import type { Client } from './net';
import type { Slot } from './roomTypes';
import { generateGuestName } from './util';

const BOT_ANIMALS = ['otter', 'penguin', 'raccoon', 'turtle', 'cat', 'capybara'] as const;

export class Room {
  readonly code: string;
  readonly ctx: ServerContext;
  opts: CreateRoomOpts;
  ranked: boolean;
  practice: boolean;
  hostId: string;
  slots: Slot[];
  phase: LobbyPhase = 'lobby';
  match: Match | null = null;
  rematchVotes = new Set<number>();
  lastActivityMs: number;
  private graceTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(code: string, ctx: ServerContext, opts: CreateRoomOpts, hostId: string, ranked = false, practice = false) {
    this.code = code;
    this.ctx = ctx;
    this.opts = opts;
    this.ranked = ranked;
    this.practice = practice;
    this.hostId = hostId;
    const count = CONFIG.ARENA[opts.mode].players;
    this.slots = Array.from({ length: count }, (_, i) => ({
      index: i,
      kind: 'empty' as const,
      ready: false,
      forfeited: false,
    }));
    this.lastActivityMs = ctx.wallClock();
  }

  get mode(): Mode {
    return this.opts.mode;
  }

  touch(): void {
    this.lastActivityMs = this.ctx.wallClock();
  }

  // ---- membership ----

  humanClients(): Client[] {
    const out: Client[] = [];
    for (const s of this.slots) if (s.client) out.push(s.client);
    return out;
  }

  playerCount(): number {
    return this.slots.filter((s) => s.kind === 'human' || s.kind === 'bot').length;
  }

  firstEmpty(): Slot | undefined {
    return this.slots.find((s) => s.kind === 'empty');
  }

  addClient(client: Client, asHost = false): boolean {
    const slot = this.firstEmpty();
    if (!slot) return false;
    slot.kind = 'human';
    slot.client = client;
    slot.ready = false;
    client.room = this;
    client.slot = slot.index;
    if (asHost) this.hostId = client.id;
    this.touch();
    this.broadcastLobby();
    return true;
  }

  removeClient(client: Client): void {
    const slot = this.slots.find((s) => s.client === client);
    if (!slot) return;
    this.clearGrace(slot.index);
    slot.kind = 'empty';
    slot.client = undefined;
    slot.ready = false;
    slot.bot = undefined;
    slot.forfeited = false;
    // clear captured identity so a returning player isn't re-attached to a room they left
    slot.playerId = undefined;
    slot.name = undefined;
    slot.animal = undefined;
    slot.hat = undefined;
    slot.isBot = false;
    slot.botDifficulty = undefined;
    client.room = null;
    client.slot = -1;
    // hand host to another human if needed
    if (this.hostId === client.id) {
      const next = this.humanClients()[0];
      if (next) this.hostId = next.id;
    }
    this.touch();
    this.broadcastLobby();
  }

  /** ws closed. In lobby -> free the slot. In match -> grace, then bot/forfeit. */
  handleDisconnect(client: Client): void {
    const slot = this.slots.find((s) => s.client === client);
    if (!slot) return;
    if (this.phase !== 'in_match') {
      this.removeClient(client);
      return;
    }
    client.connected = false;
    const pl = this.match?.state.players.find((p) => p.slot === slot.index);
    if (pl) pl.connected = false;
    this.clearGrace(slot.index);
    this.graceTimers.set(
      slot.index,
      setTimeout(() => {
        this.graceTimers.delete(slot.index);
        if (this.match && slot.client === client && !client.connected) {
          this.match.handleDrop(slot, this.ranked);
        }
      }, CONFIG.RECONNECT_GRACE_MS),
    );
  }

  /** A returning player reclaims their slot (within grace or in lobby). */
  reattach(client: Client): boolean {
    const slot = this.slots.find((s) => s.playerId === client.id || (s.client && s.client.id === client.id));
    if (!slot) return false;
    this.clearGrace(slot.index);
    slot.client = client;
    slot.kind = 'human';
    slot.bot = undefined;
    client.room = this;
    client.slot = slot.index;
    client.connected = true;
    const pl = this.match?.state.players.find((p) => p.slot === slot.index);
    if (pl) pl.connected = true;
    if (this.phase === 'in_match' && this.match) {
      client.send({ type: 'match_start', config: this.match.config });
      client.send({
        type: 'round_start',
        roundNo: this.match.roundNo,
        mapSeed: this.match.state.mapSeed,
        theme: this.match.theme,
        startAtTick: 0,
        players: this.match.config.players,
      });
    } else {
      this.broadcastLobby();
    }
    return true;
  }

  private clearGrace(slotIndex: number): void {
    const t = this.graceTimers.get(slotIndex);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(slotIndex);
    }
  }

  // ---- host controls ----

  setSlot(client: Client, index: number, kind: 'open' | 'bot' | 'closed', difficulty?: Difficulty): void {
    if (client.id !== this.hostId || this.phase !== 'lobby') return;
    const slot = this.slots[index];
    if (!slot || slot.kind === 'human') return; // don't overwrite a human
    if (kind === 'bot') {
      slot.kind = 'bot';
      slot.botDifficulty = difficulty ?? 'medium';
      slot.isBot = true;
      slot.playerId = `bot-${this.code}-${index}`;
      const gn = generateGuestName();
      slot.name = `CPU ${gn.nickname}`;
      slot.animal = BOT_ANIMALS[index % BOT_ANIMALS.length];
      slot.hat = 'none';
    } else if (kind === 'closed') {
      slot.kind = 'closed';
    } else {
      slot.kind = 'empty';
      slot.botDifficulty = undefined;
      slot.isBot = false;
      slot.playerId = undefined;
    }
    this.touch();
    this.broadcastLobby();
  }

  setReady(client: Client, ready: boolean): void {
    const slot = this.slots.find((s) => s.client === client);
    if (!slot) return;
    slot.ready = ready;
    this.touch();
    this.broadcastLobby();
  }

  canStart(): boolean {
    const active = this.slots.filter((s) => s.kind === 'human' || s.kind === 'bot');
    const humans = active.filter((s) => s.kind === 'human');
    if (active.length < 2) return false;
    return humans.every((s) => s.ready || s.client?.id === this.hostId);
  }

  startMatch(byClient?: Client): void {
    if (this.phase === 'in_match') return;
    if (byClient && byClient.id !== this.hostId) return;
    // resolve empty slots
    for (const slot of this.slots) {
      if (slot.kind !== 'empty') continue;
      if (this.opts.botFill) {
        slot.kind = 'bot';
        slot.botDifficulty = 'medium';
        slot.isBot = true;
        slot.playerId = `bot-${this.code}-${slot.index}`;
        const gn = generateGuestName();
        slot.name = `CPU ${gn.nickname}`;
        slot.animal = BOT_ANIMALS[slot.index % BOT_ANIMALS.length];
        slot.hat = 'none';
      } else {
        slot.kind = 'closed';
      }
    }
    if (this.playerCount() < 2) {
      this.broadcastLobby();
      return;
    }

    const players: RoundPlayerDTO[] = [];
    for (const slot of this.slots) {
      slot.forfeited = false;
      slot.bot = undefined;
      if (slot.kind === 'human' && slot.client) {
        const prof = slot.client.profile;
        slot.playerId = slot.client.id;
        slot.name = prof?.displayName ?? 'Player';
        slot.animal = prof?.selectedAnimal ?? 'frog';
        slot.hat = prof?.selectedHat ?? 'none';
        const rating = prof?.ratings.find((r) => r.mode === this.mode)?.rating ?? CONFIG.ELO_START;
        slot.rating = rating;
        slot.level = prof?.level ?? 1;
        players.push({
          id: slot.client.id,
          slot: slot.index,
          name: slot.name,
          animal: slot.animal,
          hat: slot.hat,
          isBot: false,
          rating,
          level: slot.level,
        });
      } else if (slot.kind === 'bot' && slot.playerId) {
        players.push({
          id: slot.playerId,
          slot: slot.index,
          name: slot.name ?? 'CPU',
          animal: slot.animal ?? 'frog',
          hat: slot.hat ?? 'none',
          isBot: true,
          botDifficulty: slot.botDifficulty,
        });
        slot.bot = new BotController(slot.playerId, slot.botDifficulty ?? 'medium');
      }
    }

    const config: MatchConfig = {
      mode: this.mode,
      ranked: this.ranked,
      roundsToWin: this.opts.roundsToWin,
      theme: this.match?.theme ?? (this.opts.theme === 'random' ? 'backyard' : this.opts.theme),
      revengeEnabled: revengeDucksEnabled(this.ranked),
      players,
    };

    this.phase = 'in_match';
    this.rematchVotes.clear();
    this.match = new Match(this, this.ctx, config);
    // attach bot controllers created above (BotControllerLazy is a plain BotController)
    this.match.begin();
    this.broadcastLobby();
  }

  rematchVote(client: Client, vote: boolean): void {
    if (this.phase !== 'results') return;
    const slot = this.slots.find((s) => s.client === client);
    if (!slot) return;
    if (vote) this.rematchVotes.add(slot.index);
    else this.rematchVotes.delete(slot.index);
    this.broadcastLobby();
    const humans = this.humanClients().length;
    if (this.rematchVotes.size >= Math.ceil(humans / 2) && humans > 0) {
      this.startMatch();
    }
  }

  onMatchEnded(): void {
    this.phase = 'results';
    this.rematchVotes.clear();
    this.broadcastLobby();
  }

  // ---- loop ----

  tick(globalTick: number, wallMs: number): void {
    if (this.phase === 'in_match' && this.match) {
      this.match.tick(globalTick, wallMs);
      this.touch();
    }
  }

  isIdle(nowMs: number): boolean {
    if (this.phase === 'in_match') return false;
    if (this.humanClients().length > 0) return false;
    return nowMs - this.lastActivityMs > CONFIG.ROOM_IDLE_TTL_MS;
  }

  dispose(): void {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }

  // ---- projections ----

  broadcast(msg: ServerMsg): void {
    for (const c of this.humanClients()) c.send(msg);
  }

  broadcastLobby(): void {
    const lobby = this.lobbyState();
    for (const c of this.humanClients()) c.send({ type: 'lobby_state', lobby });
  }

  lobbyState(): LobbyState {
    const humans = this.humanClients().length;
    return {
      code: this.code,
      name: this.opts.name,
      mode: this.mode,
      theme: this.opts.theme,
      roundsToWin: this.opts.roundsToWin,
      isPublic: this.opts.isPublic,
      botFill: this.opts.botFill,
      ranked: this.ranked,
      practice: this.practice,
      hostId: this.hostId,
      phase: this.phase,
      slots: this.slots.map<SlotState>((s) => ({
        index: s.index,
        kind: s.kind,
        playerId: s.client?.id ?? (s.kind === 'bot' ? s.playerId : undefined),
        name: s.client?.profile?.displayName ?? s.name,
        animal: s.client?.profile?.selectedAnimal ?? s.animal,
        hat: s.client?.profile?.selectedHat ?? s.hat,
        ready: s.ready,
        isHost: s.client?.id === this.hostId,
        difficulty: s.botDifficulty,
        connected: s.client?.connected ?? s.kind === 'bot',
      })),
      rematchVotes: this.rematchVotes.size,
      rematchNeeded: Math.ceil(humans / 2),
    };
  }

  listItem(): RoomListItem {
    return {
      code: this.code,
      name: this.opts.name,
      mode: this.mode,
      players: this.playerCount(),
      max: this.slots.length,
      theme: this.opts.theme,
      host: this.slots.find((s) => s.client?.id === this.hostId)?.client?.profile?.displayName ?? 'Host',
      inProgress: this.phase === 'in_match',
    };
  }
}
