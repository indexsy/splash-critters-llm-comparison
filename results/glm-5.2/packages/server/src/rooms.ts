// rooms.ts — casual room + match lifecycle (spec §3). Hosts a MatchRun per room;
// the match runs its own 30Hz sim loop, mixing humans and bots.
//
// A Room holds lobby state (slots); once started it spawns a MatchRun that owns
// the authoritative MatchState. The match emits snapshots to subscribers.

import {
  newMatchState,
  simulateTick,
  SNAPSHOT_EVERY_TICKS,
  TICK_HZ,
  TICK_MS,
  RECONNECT_GRACE_MS,
  ROOM_IDLE_TTL_MS,
  type Animal,
  type Difficulty,
  type GameMode,
  type Hat,
  type MatchState,
  type Snapshot,
  type Input,
  type Theme,
} from "@splash/shared";
import type {
  ClientMsg,
  RoomVisibility,
  ServerMsg,
  SlotView,
} from "@splash/shared";
import { newBot, botInput, type BotHandle } from "./bots/bot.js";
import { randomBytes } from "node:crypto";

export interface RoomSlot {
  kind: "open" | "bot" | "human";
  difficulty?: Difficulty;
  playerId?: string;
  nickname?: string;
  animal?: Animal;
  hat?: Hat;
  ready?: boolean;
  connectionId?: string;
}

export interface RoomOpts {
  name: string;
  size: 2 | 4;
  visibility: RoomVisibility;
  theme: Theme;
  roundsToWin: number;
  botFill: boolean;
}

export class Room {
  code: string;
  opts: RoomOpts;
  hostSlot: number;
  slots: RoomSlot[];
  lastActivity: number;
  match: MatchRun | null = null;
  rematchVotes = new Set<number>();
  createdAt = Date.now();

  constructor(code: string, opts: RoomOpts, hostPlayerId: string, hostNick: string, hostAnimal: Animal, hostHat: Hat) {
    this.code = code;
    this.opts = opts;
    this.hostSlot = 0;
    this.slots = [];
    for (let i = 0; i < opts.size; i++) this.slots.push({ kind: "open" });
    this.slots[0] = { kind: "human", playerId: hostPlayerId, nickname: hostNick, animal: hostAnimal, hat: hostHat, ready: false };
    this.lastActivity = Date.now();
  }

  get isFull(): boolean {
    return this.slots.every((s) => s.kind !== "open");
  }
  get humanCount(): number {
    return this.slots.filter((s) => s.kind === "human").length;
  }
  touch() {
    this.lastActivity = Date.now();
  }
}

export class MatchRun {
  state: MatchState;
  mode: GameMode;
  theme: Theme;
  roundsToWin: number;
  ranked: boolean;
  seed: number;
  // slot -> player id (string for humans, "bot-easy-0" etc for bots)
  slotPlayers: string[];
  slotToPlayerIndex = new Map<number, number>(); // slot -> state.players index
  bots = new Map<number, BotHandle>(); // playerIndex -> bot
  // per-slot connectionId of connected humans
  humanConn = new Map<number, string>();
  humanSlot = new Map<string, number>(); // connectionId -> slot
  // input buffers per slot
  inputs = new Map<number, Input[]>();
  startTime = Date.now();
  currentRound = 0;
  placements: { slot: number; placement: number; soaks: number; roundsWon: number }[] = [];
  ended = false;
  // emit callback set by Rooms
  onSnapshot?: (snapshot: Snapshot) => void;
  onRoundEnd?: (roundNo: number, winnerSlot: number, scores: number[]) => void;
  onMatchEnd?: () => void;
  roundTimer: ReturnType<typeof setInterval> | null = null;
  betweenRounds = false;

  constructor(opts: {
    mode: GameMode;
    theme: Theme;
    roundsToWin: number;
    ranked: boolean;
    seed: number;
    slots: RoomSlot[];
  }) {
    this.mode = opts.mode;
    this.theme = opts.theme;
    this.roundsToWin = opts.roundsToWin;
    this.ranked = opts.ranked;
    this.seed = opts.seed;
    const numPlayers = opts.mode === "duel" ? 2 : 4;
    const { state } = newMatchState(opts.seed, opts.mode, numPlayers);
    this.state = state;
    this.slotPlayers = new Array(opts.slots.length).fill("");

    let pi = 0;
    for (let slot = 0; slot < opts.slots.length; slot++) {
      const s = opts.slots[slot];
      if (s.kind === "open") continue;
      this.slotPlayers[slot] = s.kind === "human" ? s.playerId! : `bot:${slot}`;
      this.slotToPlayerIndex.set(slot, pi);
      if (s.kind === "bot") {
        this.bots.set(pi, newBot(pi, s.difficulty ?? "medium"));
      } else if (s.connectionId) {
        this.humanConn.set(pi, s.connectionId);
        this.humanSlot.set(s.connectionId, slot);
      }
      pi++;
    }
    this.startRound(1);
  }

  private startRound(roundNo: number) {
    this.currentRound = roundNo;
    this.betweenRounds = false;
    const { state } = newMatchState(this.seed + roundNo * 7919, this.mode, this.state.players.length);
    this.state = state;
    // begin tick loop
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    if (this.ended || this.betweenRounds) return;
    // gather inputs: humans + bots
    const inputs = new Map<number, Input[]>();
    for (const [pi] of this.state.players.entries()) {
      inputs.set(pi, this.inputs.get(pi) ?? []);
    }
    this.inputs.clear();

    // bot inputs
    for (const [pi, bot] of this.bots) {
      const bi = botInput(this.state, bot);
      if (bi) inputs.get(pi)!.push(bi);
    }

    simulateTick(this.state, inputs);

    if (this.state.tick % SNAPSHOT_EVERY_TICKS === 0) {
      this.onSnapshot?.(toSnapshot(this.state));
    }
    if (this.state.roundOver) {
      this.endRound();
    }
  }

  private endRound() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundTimer = null;
    this.betweenRounds = true;

    // determine winner slot
    const aliveIdx = this.state.players.findIndex((p) => p.alive);
    const winnerSlot = aliveIdx >= 0 ? this.slotForPlayerIndex(aliveIdx) : -1;

    // bump roundsWon
    if (aliveIdx >= 0) {
      // already bumped in sim
    }
    const scores = this.state.players.map((p) => p.roundsWon);
    this.onRoundEnd?.(this.currentRound, winnerSlot, scores);

    // check match winner
    const winnerIdx = this.state.players.findIndex((p) => p.roundsWon >= this.roundsToWin);
    if (winnerIdx >= 0) {
      this.finishMatch(winnerIdx);
      return;
    }
    // next round after 2.5s
    setTimeout(() => this.startRound(this.currentRound + 1), 2500);
  }

  private finishMatch(winnerIdx: number) {
    if (this.ended) return;
    this.ended = true;
    if (this.roundTimer) clearInterval(this.roundTimer);
    // compute placements: sort by roundsWon desc, then soaks desc
    const order = this.state.players
      .map((p, idx) => ({ idx, roundsWon: p.roundsWon, soaks: p.soaks }))
      .sort((a, b) => b.roundsWon - a.roundsWon || b.soaks - a.soaks);
    this.placements = order.map((o, i) => ({
      slot: this.slotForPlayerIndex(o.idx),
      placement: i + 1,
      soaks: o.soaks,
      roundsWon: o.roundsWon,
    }));
    this.onMatchEnd?.();
  }

  slotForPlayerIndex(pi: number): number {
    for (const [slot, idx] of this.slotToPlayerIndex) if (idx === pi) return slot;
    return -1;
  }
  playerIndexForSlot(slot: number): number {
    return this.slotToPlayerIndex.get(slot) ?? -1;
  }

  /** Feed a human input (called by net handler). */
  submitInput(slot: number, input: Input) {
    const pi = this.playerIndexForSlot(slot);
    if (pi < 0) return;
    if (!this.inputs.has(pi)) this.inputs.set(pi, []);
    this.inputs.get(pi)!.push(input);
  }

  close() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.ended = true;
  }
}

export function toSnapshot(state: MatchState): Snapshot {
  return {
    tick: state.tick,
    players: state.players.map((p) => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, moving: p.moving, alive: p.alive,
      revenge: p.revenge, revengeX: p.revengeX, revengeY: p.revengeY,
      soaks: p.soaks, roundsWon: p.roundsWon, speed: p.speed, balloonCount: p.balloonCount,
      splashRange: p.splashRange, hasKick: p.hasKick, animTime: p.animTime,
    })),
    balloons: [...state.balloons.values()].map((b) => ({
      id: b.id, x: b.x, y: b.y, ownerId: b.ownerId, fuse: b.fuse, range: b.range,
      sliding: (b.sliding ?? -1) as -1 | 0 | 1 | 2 | 3,
    })),
    splashes: [...state.splashes.values()].map((s) => ({
      id: s.id, cx: s.cx, cy: s.cy, up: s.up, down: s.down, left: s.left, right: s.right, ownerId: s.ownerId,
    })),
    exposedPowerUps: [...state.exposedPowerUps.values()].map((p) => ({
      id: p.id, kind: p.kind, x: p.x, y: p.y,
    })),
    tideRing: state.tideRing,
    tideActive: state.tideActive,
    events: state.events,
  };
}

export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
