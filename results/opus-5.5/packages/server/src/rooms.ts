// RoomManager: every room on the server (casual, practice, hidden ranked, tutorial sandboxes),
// player -> room membership, lobby_state pushes, the public room list, match start / end and
// housekeeping (grace timers, rematch deadlines, idle + empty-room GC), all driven by tick(now).
import { randomInt, randomUUID } from 'node:crypto';
import { CONFIG } from '@splash/shared';
import type { CreateRoomOpts, Difficulty, EmoteId, Mode, PlayerInput, RoomSummary, S2C } from '@splash/shared';
import { getRating, type Db } from './db';
import { MatchRunner } from './gameLoop';
import { playerInfo } from './match/config';
import type { BotFactory, MemberInfo } from './match/types';
import { ClientError } from './net/errors';
import type { Outbox } from './net/outbox';
import { makeBotSeat } from './rooms/bots';
import { roomLink, uniqueRoomCode } from './rooms/codes';
import type { LeftReason, RoomHub } from './rooms/hub';
import { backToLobby, enterResults, requestStart, setReady, setSlot, voteRematch } from './rooms/lobbyOps';
import { planRoom } from './rooms/options';
import { expireGrace, leaveRunningMatch, markDisconnected, markReconnected, removeFromLobby } from './rooms/presence';
import { Room } from './rooms/room';
import { RoomListFeed } from './rooms/roomList';
import { arenaOf, lobbyStateFor, participantsOf, roomSummary } from './rooms/views';
import { TutorialController } from './tutorial';

export interface RoomDeps {
  db: Db;
  outbox: Outbox;
  createBot: BotFactory;
}

/** A finished tutorial sandbox stays up this long unless the player leaves first. */
export const TUTORIAL_LINGER_MS = 60_000;

export class RoomManager implements RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly memberRoom = new Map<string, string>();
  private readonly feed: RoomListFeed;

  constructor(private readonly deps: RoomDeps) {
    this.feed = new RoomListFeed(deps.outbox, () => this.list());
  }

  // ---- queries -----------------------------------------------------------------------------

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Rooms with a match currently running. */
  get matchCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) if (room.runner && room.runner.phase !== 'ended') n++;
    return n;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.memberRoom.get(playerId);
    return code === undefined ? undefined : this.rooms.get(code);
  }

  /** Public casual rooms (optionally one mode), joinable first, newest first. */
  list(mode?: Mode): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.listed && (!mode || room.mode === mode))
      .sort((a, b) => Number(b.phase === 'lobby') - Number(a.phase === 'lobby') || b.createdAt - a.createdAt)
      .map(roomSummary);
  }

  // ---- room lifecycle ------------------------------------------------------------------------

  create(member: MemberInfo, opts: CreateRoomOpts, now: number): Room {
    this.requireFree(member.playerId);
    const plan = planRoom(opts, member);
    const room = new Room({ code: this.newCode(), ...plan.settings }, now);
    room.seatHuman(member, 0);
    if (plan.practiceDifficulty) {
      for (let slot = 1; slot < room.size; slot++) room.seats[slot] = makeBotSeat(plan.practiceDifficulty, room.botNames());
    }
    this.register(room);
    this.deps.outbox.send(member.playerId, { type: 'room_created', code: room.code, link: roomLink(room.code) });
    if (room.kind === 'practice') this.startMatch(room, now);
    else this.pushLobby(room);
    this.listChanged(room);
    return room;
  }

  join(member: MemberInfo, code: string, now: number): Room {
    const current = this.roomOf(member.playerId);
    if (current?.code === code && current.kind === 'casual') {
      this.sendLobbyTo(current, member.playerId);
      return current;
    }
    this.requireFree(member.playerId);
    const room = this.rooms.get(code);
    if (!room || room.kind !== 'casual') throw new ClientError('not_found', 'No room with that code.');
    if (room.phase !== 'lobby') throw new ClientError('room_in_match', 'That room is in a match. Try again when it ends.');
    const slot = room.firstOpenSlot();
    if (slot < 0) throw new ClientError('room_full', 'That room is full.');
    room.seatHuman(member, slot);
    room.touch(now);
    this.memberRoom.set(member.playerId, room.code);
    this.pushLobby(room);
    this.listChanged(room);
    return room;
  }

  /**
   * Explicit leave. Mid-match: casual -> bot takes over, ranked -> forfeit, solo rooms close;
   * once the match result is settled the player just goes and their result stands.
   */
  leave(playerId: string, now: number): void {
    const room = this.roomOf(playerId);
    if (room) this.leaveRoom(room, playerId, now);
    this.deps.outbox.send(playerId, { type: 'left_room', reason: 'left' });
  }

  createRankedMatch(mode: Mode, members: MemberInfo[], now: number): Room {
    const room = new Room(
      {
        code: this.newCode(),
        kind: 'ranked',
        name: mode === 'duel' ? 'Ranked Duel' : 'Ranked Free-for-All',
        mode,
        size: CONFIG.MODES[mode].maxPlayers as 2 | 4,
        isPublic: false,
        theme: 'random',
        roundsToWin: CONFIG.ROUNDS_TO_WIN_DEFAULT,
        botFill: false,
      },
      now,
    );
    members.forEach((member, slot) => room.seatHuman(member, slot));
    this.register(room);
    const players = participantsOf(room, (id) => this.ratingOf(id, mode)).map(playerInfo);
    for (const member of members) this.deps.outbox.send(member.playerId, { type: 'match_found', mode, roomCode: room.code, players });
    this.startMatch(room, now);
    return room;
  }

  startTutorial(member: MemberInfo, now: number): Room {
    this.requireFree(member.playerId);
    const room = new Room(
      { code: this.newCode(), kind: 'tutorial', name: 'Tutorial', mode: 'duel', size: 2, isPublic: false, theme: 'backyard', roundsToWin: 2, botFill: false },
      now,
    );
    room.seatHuman(member, 0);
    this.register(room);
    const tutorial = new TutorialController(member, room.code, this.deps);
    room.tutorial = tutorial;
    room.runner = tutorial.runner;
    room.phase = 'in_match';
    tutorial.start(now);
    return room;
  }

  /** Tears down the player's tutorial sandbox (skip / abandon). Returns false if there was none. */
  endTutorial(playerId: string, reason: LeftReason): boolean {
    const room = this.roomOf(playerId);
    if (room?.kind !== 'tutorial') return false;
    this.dissolve(room, reason);
    return true;
  }

  /** Before another activity: a tutorial sandbox (finished or abandoned) is closed first. */
  releaseSandbox(playerId: string): void {
    const room = this.roomOf(playerId);
    if (room?.kind === 'tutorial') this.dissolve(room, room.tutorial?.completedAt ? 'match_over' : 'left');
  }

  // ---- member commands -----------------------------------------------------------------------

  setSlot(playerId: string, cmd: { slot: number; kind: 'open' | 'bot' | 'closed'; difficulty?: Difficulty }, now: number): void {
    setSlot(this, this.requireRoom(playerId), playerId, cmd, now);
  }

  setReady(playerId: string, ready: boolean, now: number): void {
    setReady(this, this.requireRoom(playerId), playerId, ready, now);
  }

  start(playerId: string, now: number): void {
    requestStart(this, this.requireRoom(playerId), playerId, now);
  }

  rematchVote(playerId: string, yes: boolean, now: number): void {
    voteRematch(this, this.requireRoom(playerId), playerId, yes, now);
  }

  pushInput(playerId: string, input: PlayerInput, now: number): void {
    const room = this.roomOf(playerId);
    const slot = room ? room.slotOf(playerId) : -1;
    if (room?.runner && slot >= 0 && room.human(slot)?.connected) room.runner.pushInput(slot, input, now);
  }

  /** Broadcasts an emote from the player's slot to the whole room; false when not seated. */
  emote(playerId: string, id: EmoteId, now: number): boolean {
    const room = this.roomOf(playerId);
    const slot = room ? room.slotOf(playerId) : -1;
    if (!room || slot < 0) return false;
    room.touch(now);
    this.broadcast(room, { type: 'emote', slot, id });
    return true;
  }

  /** Nickname / cosmetics changed: seats show the new look (from the next match on, mid-match). */
  refreshMember(member: MemberInfo): void {
    const room = this.roomOf(member.playerId);
    const seat = room?.human(room.slotOf(member.playerId));
    if (!room || !seat) return;
    seat.member = member;
    if (room.phase !== 'in_match') {
      this.pushLobby(room);
      this.listChanged(room);
    }
  }

  // ---- presence ------------------------------------------------------------------------------

  /** The player's socket is gone; `since` is when they were last heard (grace counts from it). */
  disconnected(playerId: string, now: number, since: number = now): void {
    this.feed.unwatch(playerId);
    const room = this.roomOf(playerId);
    const slot = room ? room.slotOf(playerId) : -1;
    if (!room || slot < 0) return;
    if (room.phase === 'in_match') markDisconnected(this, room, slot, Math.min(since, now));
    else removeFromLobby(this, room, slot, now);
  }

  /** Re-attaches a returning player to their running match: lobby_state, match_start, round_start. */
  reattach(playerId: string, now: number): boolean {
    const room = this.roomOf(playerId);
    const slot = room ? room.slotOf(playerId) : -1;
    const seat = room?.human(slot);
    if (!room || !seat || seat.forfeited || room.phase !== 'in_match' || !room.runner) return false;
    room.touch(now);
    markReconnected(this, room, slot);
    return true;
  }

  watchList(playerId: string, on: boolean): void {
    this.feed.watch(playerId, on);
  }

  // ---- loop --------------------------------------------------------------------------------

  tick(now: number): void {
    for (const room of [...this.rooms.values()]) {
      try {
        this.tickRoom(room, now);
      } catch (err) {
        console.error(`[rooms] room ${room.code} crashed; closing it`, err);
        this.dissolve(room, 'closed');
      }
    }
    this.feed.tick(now);
  }

  /** Server shutdown: stop every match and forget all rooms (sockets are closed by the caller). */
  closeAll(): void {
    for (const room of this.rooms.values()) room.runner?.stop();
    this.rooms.clear();
    this.memberRoom.clear();
  }

  // ---- RoomHub -------------------------------------------------------------------------------

  pushLobby(room: Room): void {
    if (room.kind === 'tutorial') return;
    for (const playerId of this.membersOf(room)) this.sendLobbyTo(room, playerId);
  }

  sendTo(playerId: string, msg: S2C): void {
    this.deps.outbox.send(playerId, msg);
  }

  broadcast(room: Room, msg: S2C): void {
    for (const playerId of this.membersOf(room)) this.deps.outbox.send(playerId, msg);
  }

  release(room: Room, playerId: string): void {
    if (this.memberRoom.get(playerId) === room.code) this.memberRoom.delete(playerId);
  }

  dissolve(room: Room, reason: LeftReason | null): void {
    if (!this.isOpen(room)) return;
    this.rooms.delete(room.code);
    room.runner?.stop();
    for (const playerId of room.memberIds()) {
      if (this.memberRoom.get(playerId) !== room.code) continue;
      this.memberRoom.delete(playerId);
      if (reason) this.deps.outbox.send(playerId, { type: 'left_room', reason });
    }
    this.listChanged(room);
  }

  startMatch(room: Room, now: number): void {
    const { w, h } = arenaOf(room);
    const ranked = room.kind === 'ranked';
    const runner = new MatchRunner(
      {
        matchId: randomUUID(),
        roomCode: room.code,
        kind: room.kind,
        mode: room.mode,
        size: room.size,
        w,
        h,
        roundsToWin: room.roundsToWin,
        theme: room.theme,
        participants: participantsOf(room, ranked ? (id) => this.ratingOf(id, room.mode) : undefined),
        seed: randomInt(2 ** 32),
      },
      this.deps,
      { onFinished: (_end, at) => this.onMatchFinished(room, at) },
    );
    room.runner = runner;
    room.phase = 'in_match';
    room.votes.clear();
    room.rematchDeadline = 0;
    room.clearReady();
    room.touch(now);
    this.pushLobby(room);
    runner.start(now);
    this.listChanged(room);
  }

  listChanged(room: Room): void {
    if (room.kind === 'casual' && room.isPublic) this.feed.changed();
  }

  // ---- internals -----------------------------------------------------------------------------

  private register(room: Room): void {
    this.rooms.set(room.code, room);
    for (const playerId of room.memberIds()) this.memberRoom.set(playerId, room.code);
  }

  private newCode(): string {
    return uniqueRoomCode((code) => this.rooms.has(code));
  }

  private ratingOf(playerId: string, mode: Mode): number {
    return getRating(this.deps.db, playerId, mode).rating;
  }

  /** Members that should receive room traffic: mapped to this room and connected. */
  private membersOf(room: Room): string[] {
    return room.humanSlots().flatMap((slot) => {
      const seat = room.human(slot)!;
      const id = seat.member.playerId;
      return seat.connected && this.memberRoom.get(id) === room.code ? [id] : [];
    });
  }

  private sendLobbyTo(room: Room, playerId: string): void {
    this.deps.outbox.send(playerId, { type: 'lobby_state', lobby: lobbyStateFor(room, room.slotOf(playerId)) });
  }

  private requireFree(playerId: string): void {
    if (this.roomOf(playerId)) throw new ClientError('already_in_room', 'Leave your current room first.');
  }

  private requireRoom(playerId: string): Room {
    const room = this.roomOf(playerId);
    if (!room) throw new ClientError('not_in_room', 'You are not in a room.');
    return room;
  }

  private leaveRoom(room: Room, playerId: string, now: number): void {
    const slot = room.slotOf(playerId);
    this.release(room, playerId);
    if (room.phase === 'in_match') leaveRunningMatch(this, room, slot, now, null);
    else if (room.kind === 'casual') removeFromLobby(this, room, slot, now);
    else this.dissolve(room, null);
    if (this.isOpen(room) && room.humanSlots().length === 0) this.dissolve(room, 'closed');
  }

  /** Casual rooms move on to the rematch vote (or close when every human is gone); others dissolve. */
  private onMatchFinished(room: Room, now: number): void {
    if (room.kind === 'tutorial') return;
    if (room.kind !== 'casual') {
      this.dissolve(room, 'match_over');
      return;
    }
    enterResults(this, room, now);
    if (room.humanSlots().length === 0) this.dissolve(room, 'closed');
  }

  isOpen(room: Room): boolean {
    return this.rooms.get(room.code) === room;
  }

  /** One room's slice of the server tick: match, grace timers, rematch deadline, teardown, GC. */
  private tickRoom(room: Room, now: number): void {
    if (room.runner && room.phase === 'in_match') {
      room.runner.tick(now);
      room.touch(now);
    }
    if (this.isOpen(room)) expireGrace(this, room, now);
    if (!this.isOpen(room)) return;
    if (room.phase === 'in_match' && room.humanSlots().length === 0) this.dissolve(room, 'closed');
    else if (room.tutorial?.completedAt && now - room.tutorial.completedAt >= TUTORIAL_LINGER_MS) this.dissolve(room, 'match_over');
    else {
      if (room.phase === 'results' && now >= room.rematchDeadline) backToLobby(this, room, now);
      this.collectIfAbandoned(room, now);
    }
  }

  /** Rooms without a connected human die after ROOM_EMPTY_TTL_MS; any room idle ROOM_IDLE_TTL_MS too. */
  private collectIfAbandoned(room: Room, now: number): void {
    if (room.connectedHumanSlots().length > 0) room.emptySince = 0;
    else if (room.emptySince === 0) room.emptySince = now;
    const empty = room.emptySince > 0 && now - room.emptySince >= CONFIG.ROOM_EMPTY_TTL_MS;
    if (empty || now - room.lastActivity >= CONFIG.ROOM_IDLE_TTL_MS) this.dissolve(room, 'closed');
  }
}
