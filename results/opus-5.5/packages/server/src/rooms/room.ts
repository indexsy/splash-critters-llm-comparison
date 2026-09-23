// Room model: seats (human / bot / open / closed), host, phase and rematch votes. Pure state and
// queries; RoomManager and the rooms/* helpers orchestrate messaging and matches around it.
import type { AnimalId, Difficulty, HatId, Mode, RoomPhase, ThemeChoice } from '@splash/shared';
import type { MatchRunner } from '../gameLoop';
import type { MemberInfo, RoomKind } from '../match/types';
import type { TutorialController } from '../tutorial';

export interface HumanSeat {
  kind: 'human';
  member: MemberInfo;
  ready: boolean;
  connected: boolean;
  /** Reconnect deadline while disconnected mid-match (0 when connected). */
  graceUntil: number;
  /** Ranked: this player forfeited (the seat stays for the match record). */
  forfeited: boolean;
}

export interface BotSeat {
  kind: 'bot';
  difficulty: Difficulty;
  /** Seated by the room (bot fill or a take-over) rather than the host: reopens in the lobby. */
  auto: boolean;
  /** Took over a disconnected or departed human mid-match (the table shows a BOT chip). */
  replacedHuman: boolean;
  name: string;
  animal: AnimalId;
  hat: HatId;
}

export type Seat = HumanSeat | BotSeat | { kind: 'open' } | { kind: 'closed' };

export interface RoomSettings {
  code: string;
  kind: RoomKind;
  name: string;
  mode: Mode;
  size: 2 | 4;
  isPublic: boolean;
  theme: ThemeChoice;
  roundsToWin: 2 | 3 | 5;
  botFill: boolean;
}

export class Room {
  readonly code: string;
  readonly kind: RoomKind;
  readonly name: string;
  readonly mode: Mode;
  readonly size: 2 | 4;
  readonly isPublic: boolean;
  readonly theme: ThemeChoice;
  readonly roundsToWin: 2 | 3 | 5;
  readonly botFill: boolean;
  readonly createdAt: number;
  seats: Seat[];
  hostId: string | null = null;
  phase: RoomPhase = 'lobby';
  runner: MatchRunner | null = null;
  tutorial: TutorialController | null = null;
  /** Rematch ballots by slot (phase 'results'). */
  readonly votes = new Map<number, boolean>();
  rematchDeadline = 0;
  lastActivity: number;
  /** When the room last lost its final connected human (0 while someone is connected). */
  emptySince = 0;

  constructor(settings: RoomSettings, now: number) {
    this.code = settings.code;
    this.kind = settings.kind;
    this.name = settings.name;
    this.mode = settings.mode;
    this.size = settings.size;
    this.isPublic = settings.isPublic;
    this.theme = settings.theme;
    this.roundsToWin = settings.roundsToWin;
    this.botFill = settings.botFill;
    this.createdAt = now;
    this.lastActivity = now;
    this.seats = Array.from({ length: settings.size }, (): Seat => ({ kind: 'open' }));
  }

  /** Shown in the public browser: casual, public and someone is home. */
  get listed(): boolean {
    return this.kind === 'casual' && this.isPublic && this.humanSlots().length > 0;
  }

  touch(now: number): void {
    this.lastActivity = now;
  }

  human(slot: number): HumanSeat | null {
    const seat = this.seats[slot];
    return seat?.kind === 'human' ? seat : null;
  }

  slotOf(playerId: string): number {
    return this.seats.findIndex((s) => s.kind === 'human' && s.member.playerId === playerId);
  }

  /** Slots of humans still taking part (forfeited ranked seats excluded). */
  humanSlots(): number[] {
    const slots: number[] = [];
    this.seats.forEach((s, slot) => {
      if (s.kind === 'human' && !s.forfeited) slots.push(slot);
    });
    return slots;
  }

  connectedHumanSlots(): number[] {
    return this.humanSlots().filter((slot) => this.human(slot)!.connected);
  }

  /** Player ids of every seated human, connected or not (forfeited included). */
  memberIds(): string[] {
    return this.seats.flatMap((s) => (s.kind === 'human' ? [s.member.playerId] : []));
  }

  firstOpenSlot(): number {
    return this.seats.findIndex((s) => s.kind === 'open');
  }

  /** Humans + bots seated. */
  participantCount(): number {
    return this.seats.filter((s) => s.kind === 'human' || s.kind === 'bot').length;
  }

  closedCount(): number {
    return this.seats.filter((s) => s.kind === 'closed').length;
  }

  hostSlot(): number {
    return this.hostId ? this.slotOf(this.hostId) : -1;
  }

  seatHuman(member: MemberInfo, slot: number): void {
    this.seats[slot] = { kind: 'human', member, ready: false, connected: true, graceUntil: 0, forfeited: false };
    if (!this.hostId) this.hostId = member.playerId;
  }

  /** Frees a seat; the host role passes to the next human by slot order. */
  vacate(slot: number): void {
    const seat = this.seats[slot];
    this.seats[slot] = { kind: 'open' };
    this.votes.delete(slot);
    if (seat?.kind === 'human' && seat.member.playerId === this.hostId) this.reassignHost();
  }

  reassignHost(): void {
    const next = this.humanSlots().find((slot) => this.human(slot)!.connected) ?? this.humanSlots()[0];
    this.hostId = next === undefined ? null : this.human(next)!.member.playerId;
  }

  /** Every non-host human in the lobby pressed ready. */
  allGuestsReady(): boolean {
    return this.humanSlots().every((slot) => {
      const seat = this.human(slot)!;
      return seat.member.playerId === this.hostId || seat.ready;
    });
  }

  botNames(): Set<string> {
    return new Set(this.seats.flatMap((s) => (s.kind === 'bot' ? [s.name] : [])));
  }

  /** Back in the lobby: seats the room filled with bots on its own become open again. */
  reopenAutoSeats(): void {
    this.seats.forEach((seat, slot) => {
      if (seat.kind === 'bot' && seat.auto) this.seats[slot] = { kind: 'open' };
    });
  }

  clearReady(): void {
    for (const s of this.seats) if (s.kind === 'human') s.ready = false;
  }
}
