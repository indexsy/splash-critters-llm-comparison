import { randomBytes } from "node:crypto";
import { CONFIG, type Difficulty, type LobbySlot, type LobbyView, type Mode, type Profile, type RoomOptions, type RoomSummary, type Theme } from "@splash/shared";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const BOT_DIFFICULTY_DEFAULT: Difficulty = "medium";

export interface MatchParticipant {
  playerId: string;
  name: string;
  animal: string;
  hat: string;
  isBot: boolean;
  difficulty?: Difficulty;
  pendingInput?: import("@splash/shared").PlayerInput;
  lastSeq: number;
  nextDecisionTick: number;
  disconnectedAt?: number;
  forfeited?: boolean;
  connectionId?: string;
  placement?: number;
  roundsWonAtStart: number;
  roundSoaks: number;
  roundCastles: number;
  matchSoaks: number;
  matchCastles: number;
}

export interface MatchContext {
  mode: Mode;
  ranked: boolean;
  roundsToWin: number;
  theme: Theme;
  participants: MatchParticipant[];
  roundNo: number;
  mapSeed: number;
  scores: Map<string, number>;
  roundEndAt?: number;
  matchEndAt?: number;
  finished: boolean;
  startedAt: number;
  durationTicks: number;
}

export interface Room {
  code: string;
  opts: RoomOptions;
  hostId: string;
  slots: LobbySlot[];
  phase: "lobby" | "playing" | "results";
  rematchVotes: Set<string>;
  ranked: boolean;
  match?: MatchContext;
  createdAt: number;
  lastActivity: number;
  origin: "casual" | "ranked";
}

function generateCode(taken: Set<string>): string {
  while (true) {
    let code = "";
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET.charAt(bytes[i]! % ROOM_CODE_ALPHABET.length);
    if (!taken.has(code)) return code;
  }
}

function defaultOpts(): RoomOptions {
  return {
    name: "Casual Splash",
    size: 4,
    visibility: "public",
    theme: "random",
    roundsToWin: 3,
    botFill: true
  };
}

export class RoomStore {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();

  list(): Room[] {
    return [...this.rooms.values()];
  }

  summaries(mode?: Mode): RoomSummary[] {
    return this.list()
      .filter((r) => r.phase === "lobby")
      .filter((r) => r.opts.visibility === "public")
      .filter((r) => (mode ? modeForSize(r.opts.size) === mode : true))
      .filter((r) => occupiedHumans(r) < r.opts.size)
      .map((r) => ({
        code: r.code,
        name: r.opts.name,
        mode: modeForSize(r.opts.size),
        players: occupiedHumans(r),
        maxPlayers: r.opts.size,
        theme: r.opts.theme,
        host: r.slots.find((slot) => slot.playerId === r.hostId)?.name ?? r.hostId
      }));
  }

  create(hostId: string, opts: Partial<RoomOptions> = {}, origin: "casual" | "ranked" = "casual"): Room {
    const merged: RoomOptions = { ...defaultOpts(), ...opts };
    const taken = new Set(this.rooms.keys());
    const code = generateCode(taken);
    const size = merged.size;
    const slots: LobbySlot[] = [];
    for (let i = 0; i < size; i++) {
      slots.push(i === 0 ? { index: i, kind: "human", playerId: hostId, ready: false } : { index: i, kind: "empty" });
    }
    const room: Room = {
      code,
      opts: merged,
      hostId,
      slots,
      phase: "lobby",
      rematchVotes: new Set(),
      ranked: origin === "ranked",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      origin
    };
    this.rooms.set(code, room);
    this.playerRoom.set(hostId, code);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  findByPlayer(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    if (!code) return undefined;
    const room = this.rooms.get(code);
    if (!room) this.playerRoom.delete(playerId);
    return room;
  }

  setPlayerRoom(playerId: string, code: string | undefined): void {
    if (code === undefined) this.playerRoom.delete(playerId);
    else this.playerRoom.set(playerId, code);
  }

  join(room: Room, playerId: string): boolean {
    if (room.phase !== "lobby") return false;
    const existing = room.slots.find((s) => s.playerId === playerId);
    if (existing) return true;
    const empty = room.slots.find((s) => s.kind === "empty");
    if (!empty) return false;
    empty.kind = "human";
    empty.playerId = playerId;
    empty.ready = false;
    clearSlotOptionals(empty);
    this.playerRoom.set(playerId, room.code);
    room.lastActivity = Date.now();
    return true;
  }

  leave(room: Room, playerId: string): void {
    const slot = room.slots.find((s) => s.playerId === playerId);
    if (slot) {
      slot.kind = "empty";
      clearSlotOptionals(slot);
    }
    this.playerRoom.delete(playerId);
    room.rematchVotes.delete(playerId);
    if (room.hostId === playerId) {
      const nextHuman = room.slots.find((s) => s.kind === "human" && s.playerId);
      room.hostId = nextHuman?.playerId ?? "";
    }
    room.lastActivity = Date.now();
  }

  setSlot(room: Room, slotIndex: number, kind: "empty" | "bot", difficulty: Difficulty = BOT_DIFFICULTY_DEFAULT): boolean {
    const slot = room.slots[slotIndex];
    if (!slot) return false;
    if (room.phase !== "lobby") return false;
    if (slot.playerId === room.hostId) return false;
    if (kind === "empty") {
      slot.kind = "empty";
      clearSlotOptionals(slot);
    } else {
      clearSlotOptionals(slot);
      slot.kind = "bot";
      slot.ready = true;
      slot.difficulty = difficulty;
      slot.name = botName(slotIndex, difficulty);
    }
    room.lastActivity = Date.now();
    return true;
  }

  setReady(room: Room, playerId: string, ready: boolean): boolean {
    const slot = room.slots.find((s) => s.playerId === playerId);
    if (!slot || room.phase !== "lobby") return false;
    slot.ready = ready;
    room.lastActivity = Date.now();
    return true;
  }

  startMatch(room: Room, profiles: Map<string, Profile>): MatchContext | null {
    if (room.phase !== "lobby") return null;
    const humans = room.slots.filter((s) => s.kind === "human");
    if (humans.length === 0) return null;
    if (!humans.every((s) => s.ready)) return null;
    if (room.opts.botFill) {
      for (const slot of room.slots) {
        if (slot.kind === "empty") {
          slot.kind = "bot";
          slot.ready = true;
          slot.difficulty = BOT_DIFFICULTY_DEFAULT;
          slot.name = botName(slot.index, BOT_DIFFICULTY_DEFAULT);
        }
      }
    }
    const activeSlots = room.slots.filter((s) => s.kind === "human" || s.kind === "bot");
    if (activeSlots.length < 2) return null;
    const mode: Mode = room.opts.size === 2 ? "duel" : "ffa";
    const theme: Theme = resolveTheme(room.opts.theme);
    const participants: MatchParticipant[] = activeSlots.map((slot) => {
      if (slot.kind === "bot") {
        return {
          playerId: `bot_${room.code}_${slot.index}`,
          name: slot.name ?? botName(slot.index, slot.difficulty ?? BOT_DIFFICULTY_DEFAULT),
          animal: "frog",
          hat: "none",
          isBot: true,
          difficulty: slot.difficulty ?? BOT_DIFFICULTY_DEFAULT,
          lastSeq: 0,
          nextDecisionTick: 0,
          roundsWonAtStart: 0,
          roundSoaks: 0,
          roundCastles: 0,
          matchSoaks: 0,
          matchCastles: 0
        };
      }
      const profile = slot.playerId ? profiles.get(slot.playerId) : undefined;
      return {
        playerId: slot.playerId!,
        name: profile?.nickname ?? "Player",
        animal: profile?.selectedAnimal ?? "frog",
        hat: profile?.selectedHat ?? "none",
        isBot: false,
        lastSeq: 0,
        nextDecisionTick: 0,
        roundsWonAtStart: 0,
        roundSoaks: 0,
        roundCastles: 0,
        matchSoaks: 0,
        matchCastles: 0
      };
    });
    const ctx: MatchContext = {
      mode,
      ranked: room.ranked,
      roundsToWin: room.opts.roundsToWin,
      theme,
      participants,
      roundNo: 0,
      mapSeed: randomSeed(),
      scores: new Map(participants.map((p) => [p.playerId, 0])),
      finished: false,
      startedAt: Date.now(),
      durationTicks: 0
    };
    room.phase = "playing";
    room.match = ctx;
    room.rematchVotes.clear();
    room.lastActivity = Date.now();
    return ctx;
  }

  voteRematch(room: Room, playerId: string): boolean {
    if (room.phase !== "results" || !room.match) return false;
    room.rematchVotes.add(playerId);
    room.lastActivity = Date.now();
    return true;
  }

  resetToLobby(room: Room): void {
    room.phase = "lobby";
    delete room.match;
    room.rematchVotes.clear();
    for (const slot of room.slots) {
      if (slot.kind === "human") slot.ready = false;
    }
    room.lastActivity = Date.now();
  }

  close(room: Room): void {
    for (const slot of room.slots) {
      if (slot.kind === "human" && slot.playerId) this.playerRoom.delete(slot.playerId);
    }
    this.rooms.delete(room.code);
  }

  gc(now: number, ttl = CONFIG.ROOM_TTL_MS): string[] {
    const closed: string[] = [];
    for (const room of this.list()) {
      if (room.phase === "playing") continue;
      if (now - room.lastActivity > ttl) {
        this.close(room);
        closed.push(room.code);
      }
    }
    return closed;
  }
}

export function modeForSize(size: 2 | 4): Mode {
  return size === 2 ? "duel" : "ffa";
}

export function lobbyView(room: Room): LobbyView {
  return {
    code: room.code,
    opts: room.opts,
    hostId: room.hostId,
    slots: room.slots.map((s) => ({ ...s })),
    phase: room.phase,
    rematchVotes: room.rematchVotes.size
  };
}

export function occupiedHumans(room: Room): number {
  return room.slots.filter((s) => s.kind === "human" && s.playerId).length;
}

export function resolveTheme(theme: Theme | "random"): Theme {
  if (theme === "random") {
    const themes: Theme[] = ["backyard", "beach", "pool"];
    return themes[Math.floor(Math.random() * themes.length)]!;
  }
  return theme;
}

export function botName(slot: number, difficulty: Difficulty): string {
  const names = ["Splashy", "Bubbles", "Puddles", "Marina", "Gusher", "Sprinkles", "Tadpole", "Coral"];
  const base = names[slot % names.length] ?? "Splashy";
  return `${base} [${difficulty}]`;
}

export function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

function clearSlotOptionals(slot: LobbySlot): void {
  delete slot.playerId;
  delete slot.ready;
  delete slot.animal;
  delete slot.name;
  delete slot.difficulty;
}
