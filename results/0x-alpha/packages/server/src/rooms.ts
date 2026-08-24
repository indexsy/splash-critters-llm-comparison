import crypto from "node:crypto";
import {
  CONFIG,
  defaultMatchConfig,
  rngTheme,
  tierFor,
  type BotDifficulty,
  type GameMode,
  type LobbySlot,
  type LobbyStateMsg,
  type MapTheme,
  type MatchEndMsg,
  type PublicProfile,
  type RoomListMsg,
  type RoomSummary,
  type SimPlayerInput,
  type SlotKind,
} from "@sc/shared";
import type { Queries, PlayerRow } from "./db/queries";
import { publicProfile } from "./db/queries";
import type { GameLoop } from "./gameLoop";
import { createBot } from "./bots/bot";
import { applyDuelElo, applyFfaElo } from "@sc/shared";

export interface Conn {
  id: string;
  playerRow: PlayerRow | null;
  profile: PublicProfile | null;
  roomCode: string | null;
  send(msg: object): void;
}

export interface MatchEntity {
  id: string; // entity id in sim
  slot: number;
  playerId?: string;
  nickname: string;
  animal: string;
  hat: string | null;
  isBot: boolean;
  difficulty?: BotDifficulty;
  rating?: number;
  tier?: string;
  brain?: unknown;
}

export interface ActiveMatch {
  id: string;
  roomCode: string | null; // null for ranked
  ranked: boolean;
  mode: GameMode;
  config: ReturnType<typeof defaultMatchConfig>;
  entities: MatchEntity[];
  sim: import("@sc/shared").SimState | null;
  roundNo: number;
  scores: Record<string, number>;
  latestInputs: Map<string, SimPlayerInput>;
  roundSoaks: Array<{ entityId: string; byEntityId: string | null; revenge: boolean }>;
  biggestChain: { entityId: string | null; depth: number };
  betweenRounds: boolean;
  timer: NodeJS.Timeout | null;
  lastSoakTick: Map<string, number>;
  rematchVotes: Set<string>;
  createdAt: number;
  finished: boolean;
}

export interface Room {
  code: string;
  name: string;
  isPublic: boolean;
  mode: GameMode;
  theme: MapTheme | "random";
  roundsToWin: number;
  botFill: boolean;
  slots: Array<{ kind: SlotKind; playerId?: string; difficulty?: BotDifficulty; ready: boolean }>;
  hostSlot: number;
  match: ActiveMatch | null;
  lastActivity: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

const BOT_NAMES = ["Botsy", "Quacktron", "SplashBot", "Waddles", "Beaky", "Puddlebot"];

export class Rooms {
  private rooms = new Map<string, Room>();
  private connByPlayer = new Map<string, Conn>();
  /** playerId → active ranked match (for reconnect/forfeit) */
  private rankedByPlayer = new Map<string, ActiveMatch>();

  constructor(
    private q: Queries,
    private loop: GameLoop,
    private onRoomListDirty: () => void,
  ) {}

  // ---------- connection registry ----------

  registerConn(conn: Conn): void {
    if (conn.playerRow) this.connByPlayer.set(conn.playerRow.id, conn);
  }

  bindPlayer(conn: Conn, row: PlayerRow): void {
    conn.playerRow = row;
    conn.profile = publicProfile(row, this.q);
    this.connByPlayer.set(row.id, conn);
  }

  dropConn(conn: Conn): void {
    if (conn.playerRow && this.connByPlayer.get(conn.playerRow.id) === conn) {
      this.connByPlayer.delete(conn.playerRow.id);
    }
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (room) this.handleLeave(room, conn);
  }

  getConn(playerId: string): Conn | undefined {
    return this.connByPlayer.get(playerId);
  }

  activeRankedMatch(playerId: string): ActiveMatch | undefined {
    return this.rankedByPlayer.get(playerId);
  }

  rebindToMatch(match: ActiveMatch, playerId: string): void {
    this.rankedByPlayer.set(playerId, match);
  }

  clearRankedBinding(playerId: string): void {
    this.rankedByPlayer.delete(playerId);
  }

  // ---------- room management ----------

  createRoom(
    conn: Conn,
    opts: { name: string; mode: GameMode; isPublic: boolean; theme: MapTheme | "random"; roundsToWin: number; botFill: boolean },
  ): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const maxPlayers = opts.mode === "duel" ? 2 : 4;
    const room: Room = {
      code,
      name: opts.name.slice(0, 32),
      isPublic: opts.isPublic,
      mode: opts.mode,
      theme: opts.theme,
      roundsToWin: opts.roundsToWin,
      botFill: opts.botFill,
      slots: Array.from({ length: maxPlayers }, () => ({ kind: "open" as SlotKind, ready: false })),
      hostSlot: 0,
      match: null,
      lastActivity: Date.now(),
      disconnectTimers: new Map(),
    };
    room.slots[0] = { kind: "human", playerId: conn.playerRow!.id, ready: false };
    this.rooms.set(code, room);
    conn.roomCode = code;
    this.sendLobby(room);
    this.onRoomListDirty();
    return room;
  }

  joinRoom(conn: Conn, code: string): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.match) return null;
    const idx = room.slots.findIndex((s) => s.kind === "open");
    if (idx === -1) return null;
    room.slots[idx] = { kind: "human", playerId: conn.playerRow!.id, ready: false };
    conn.roomCode = room.code;
    room.lastActivity = Date.now();
    this.sendLobby(room);
    this.onRoomListDirty();
    return room;
  }

  joinOrCreatePractice(conn: Conn, difficulty: BotDifficulty): Room {
    const room = this.createRoom(conn, {
      name: `Practice (${difficulty})`,
      mode: "duel",
      isPublic: false,
      theme: "random",
      roundsToWin: CONFIG.roundsToWinDefault,
      botFill: false,
    });
    room.slots[1] = { kind: "bot", difficulty, ready: true };
    this.sendLobby(room);
    return room;
  }

  leaveRoom(conn: Conn): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (room) this.handleLeave(room, conn);
    conn.roomCode = null;
  }

  private handleLeave(room: Room, conn: Conn): void {
    const activeMatch = room.match && !room.match.finished;
    if (activeMatch) {
      // leaving mid-match converts to a Medium bot after grace
      this.scheduleBotReplacement(room, conn.playerRow!.id);
      return;
    }
    if (room.match) {
      // post-match leave
      const slotIdx = room.slots.findIndex((s) => s.kind === "human" && s.playerId === conn.playerRow?.id);
      if (slotIdx !== -1) room.slots[slotIdx] = { kind: "open", ready: false };
      if (!room.slots.some((s) => s.kind === "human")) {
        this.destroyRoom(room.code);
      } else {
        this.sendLobby(room);
      }
      return;
    }
    const idx = room.slots.findIndex((s) => s.kind === "human" && s.playerId === conn.playerRow?.id);
    if (idx === -1) return;
    room.slots[idx] = { kind: "open", ready: false };
    if (room.hostSlot === idx) {
      const nextHuman = room.slots.findIndex((s) => s.kind === "human");
      room.hostSlot = nextHuman >= 0 ? nextHuman : 0;
      if (nextHuman === -1) {
        this.destroyRoom(room.code);
        return;
      }
    }
    this.sendLobby(room);
    this.onRoomListDirty();
  }

  private destroyRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.match) this.loop.remove(room.match);
    for (const t of room.disconnectTimers.values()) clearTimeout(t);
    this.rooms.delete(code);
    this.onRoomListDirty();
  }

  setSlot(conn: Conn, slotIdx: number, kind: SlotKind, difficulty: BotDifficulty): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (!room || room.match) return;
    if (conn.playerRow!.id !== room.slots[room.hostSlot]?.playerId) return; // host only
    const slot = room.slots[slotIdx];
    if (!slot || slot.kind === "human") return;
    if (kind === "open") room.slots[slotIdx] = { kind: "open", ready: false };
    else room.slots[slotIdx] = { kind: "bot", difficulty, ready: true };
    room.lastActivity = Date.now();
    this.sendLobby(room);
  }

  setReady(conn: Conn, ready: boolean): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (!room || room.match) return;
    const slot = room.slots.find((s) => s.kind === "human" && s.playerId === conn.playerRow?.id);
    if (slot) slot.ready = ready;
    this.sendLobby(room);
  }

  startMatch(conn: Conn): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (!room || room.match) return;
    if (conn.playerRow!.id !== room.slots[room.hostSlot]?.playerId) return;
    const humans = room.slots.filter((s) => s.kind === "human").length;
    if (humans < 1) return;
    if (room.botFill) {
      for (let i = 0; i < room.slots.length; i++) {
        if (room.slots[i]!.kind === "open") room.slots[i] = { kind: "bot", difficulty: "medium", ready: true };
      }
    } else if (room.slots.some((s) => s.kind === "open")) {
      // require full lobby unless bot fill
      return;
    }
    this.launchRoomMatch(room);
  }

  launchRoomMatch(room: Room): void {
    const theme: MapTheme = room.theme === "random" ? rngTheme() : room.theme;
    const config = defaultMatchConfig(room.mode, {
      theme,
      roundsToWin: room.roundsToWin,
      ranked: false,
      enableRevengeDucks: CONFIG.enableRevengeDucksCasual,
    });
    const entities: MatchEntity[] = room.slots.map((slot, i) => {
      if (slot.kind === "human") {
        const row = this.q.playerById(slot.playerId!)!;
        return {
          id: `e${i}`,
          slot: i,
          playerId: row.id,
          nickname: `${row.nickname}#${row.tag}`,
          animal: row.selected_animal,
          hat: row.selected_hat,
          isBot: false,
        };
      }
      const diff = slot.difficulty ?? "medium";
      return {
        id: `e${i}`,
        slot: i,
        nickname: BOT_NAMES[i % BOT_NAMES.length]!,
        animal: ["duck", "frog", "penguin", "turtle"][i % 4]!,
        hat: null,
        isBot: true,
        difficulty: diff,
      };
    });
    const match = this.buildMatch(config, entities, room.code, false);
    room.match = match;
    room.lastActivity = Date.now();
    this.loop.add(match);
  }

  /** Used by the matchmaker for ranked matches. */
  launchRankedMatch(mode: GameMode, entrants: Array<{ conn: Conn; rating: number }>): ActiveMatch {
    const config = defaultMatchConfig(mode, { ranked: true, enableRevengeDucks: CONFIG.enableRevengeDucksRanked });
    const entities: MatchEntity[] = entrants.map(({ conn, rating }, i) => {
      const row = conn.playerRow!;
      return {
        id: `e${i}`,
        slot: i,
        playerId: row.id,
        nickname: `${row.nickname}#${row.tag}`,
        animal: row.selected_animal,
        hat: row.selected_hat,
        isBot: false,
        rating,
        tier: tierFor(rating),
      };
    });
    const match = this.buildMatch(config, entities, null, true);
    for (const e of entities) if (e.playerId) this.rankedByPlayer.set(e.playerId, match);
    this.loop.add(match);
    return match;
  }

  private buildMatch(
    config: ReturnType<typeof defaultMatchConfig>,
    entities: MatchEntity[],
    roomCode: string | null,
    ranked: boolean,
  ): ActiveMatch {
    for (const e of entities) {
      if (e.isBot) e.brain = createBot(e.id, e.difficulty ?? "medium");
    }
    return {
      id: crypto.randomUUID(),
      roomCode,
      ranked,
      mode: config.mode,
      config,
      entities,
      sim: null,
      roundNo: 0,
      scores: {},
      latestInputs: new Map(),
      roundSoaks: [],
      biggestChain: { entityId: null, depth: 0 },
      betweenRounds: false,
      timer: null,
      lastSoakTick: new Map(),
      rematchVotes: new Set(),
      createdAt: Date.now(),
      finished: false,
    };
  }

  // ---------- mid-match events ----------

  scheduleBotReplacement(room: Room, playerId: string): void {
    if (room.disconnectTimers.has(playerId)) return;
    const timer = setTimeout(() => {
      room.disconnectTimers.delete(playerId);
      const match = room.match;
      const entity = match?.entities.find((e) => e.playerId === playerId);
      if (match && entity && !match.finished) {
        entity.isBot = true;
        entity.difficulty = "medium";
        entity.brain = createBot(entity.id, "medium");
        entity.nickname = `Ex-${entity.nickname.split("#")[0]}`;
      }
      // remove from slots if still listed
      const slot = room.slots.find((s) => s.kind === "human" && s.playerId === playerId);
      if (slot) slot.kind = "open";
      // destroy room if no humans left and no match running
      const humansLeft = room.slots.filter((s) => s.kind === "human").length;
      if (humansLeft === 0 && !match) this.destroyRoom(room.code);
    }, CONFIG.reconnectGraceMs);
    room.disconnectTimers.set(playerId, timer);
  }

  cancelBotReplacement(room: Room, playerId: string): void {
    const t = room.disconnectTimers.get(playerId);
    if (t) {
      clearTimeout(t);
      room.disconnectTimers.delete(playerId);
    }
  }

  voteRematch(conn: Conn): void {
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (!room || !room.match || !room.match.finished) return;
    const match = room.match;
    match.rematchVotes.add(conn.playerRow!.id);
    const humans = match.entities.filter((e) => !e.isBot);
    const needed = Math.ceil(humans.length / 2);
    for (const e of humans) {
      const c = e.playerId ? this.connByPlayer.get(e.playerId) : undefined;
      c?.send({ t: "rematch_state", votes: [...match.rematchVotes], needed } as never);
    }
    if (match.rematchVotes.size >= needed) {
      room.match = null;
      this.launchRoomMatch(room);
    }
  }

  gcRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > CONFIG.roomTtlMs && !room.match) this.destroyRoom(code);
    }
  }

  // ---------- messaging ----------

  broadcastMatch(match: ActiveMatch, msg: object): void {
    for (const e of match.entities) {
      if (e.isBot || !e.playerId) continue;
      const conn = this.connByPlayer.get(e.playerId);
      conn?.send(msg);
    }
  }

  sendToEntity(match: ActiveMatch, entityId: string, msg: object): void {
    const e = match.entities.find((x) => x.id === entityId);
    if (!e?.playerId) return;
    this.connByPlayer.get(e.playerId)?.send(msg);
  }

  sendLobby(room: Room): void {
    const msg = this.lobbyState(room);
    for (const slot of room.slots) {
      if (slot.kind !== "human" || !slot.playerId) continue;
      const conn = this.connByPlayer.get(slot.playerId);
      conn?.send(msg);
    }
  }

  lobbyState(room: Room): LobbyStateMsg {
    const slots: LobbySlot[] = room.slots.map((s, i) => {
      if (s.kind === "human" && s.playerId) {
        const row = this.q.playerById(s.playerId)!;
        return {
          index: i,
          kind: "human",
          playerId: s.playerId,
          nickname: `${row.nickname}#${row.tag}`,
          animal: row.selected_animal,
          ready: s.ready,
        };
      }
      if (s.kind === "bot") return { index: i, kind: "bot", difficulty: s.difficulty ?? "medium" };
      return { index: i, kind: "open" };
    });
    return {
      t: "lobby_state",
      code: room.code,
      name: room.name,
      mode: room.mode,
      isPublic: room.isPublic,
      theme: room.theme,
      roundsToWin: room.roundsToWin,
      slots,
      hostSlot: room.hostSlot,
    };
  }

  roomList(): RoomListMsg {
    const rooms: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.match) continue;
      const players = room.slots.filter((s) => s.kind !== "open").length;
      const host = this.q.playerById(room.slots[room.hostSlot]?.playerId ?? "");
      rooms.push({
        code: room.code,
        name: room.name,
        mode: room.mode,
        players,
        maxPlayers: room.slots.length,
        theme: room.theme,
        hostNickname: host ? `${host.nickname}#${host.tag}` : "?",
      });
    }
    return { t: "room_list", rooms };
  }

  allRooms(): IterableIterator<[string, Room]> {
    return this.rooms.entries();
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  // called by gameLoop when a match finishes
  finalizeMatch(match: ActiveMatch, end: MatchEndMsg): void {
    match.finished = true;
    const matchId = this.q.createMatch(match.mode, match.ranked);
    const statsByEntity = new Map(end.placements.map((p) => [p.entityId, p]));

    // Elo for ranked
    if (match.ranked) {
      const humans = match.entities.filter((e) => e.playerId);
      const ratings = humans.map((e) => ({
        games: this.q.rating(e.playerId!, match.mode).games,
        rating: this.q.rating(e.playerId!, match.mode).rating,
        placement: statsByEntity.get(e.id)?.placement ?? humans.length,
      }));
      const results =
        match.mode === "duel"
          ? applyDuelElo(
              ratings.map((r) => ({ games: r.games, rating: r.rating })),
              ratings.map((r) => (r.placement === 1 ? 1 : 0)),
            )
          : applyFfaElo(ratings);
      humans.forEach((e, i) => {
        const res = results[i]!;
        this.q.applyRating(e.playerId!, match.mode, res.before, res.after, res.delta > 0);
        end.ratingDeltas[e.playerId!] = { before: res.before, after: res.after, tier: tierFor(res.after) };
        this.q.recordMatchPlayer(
          matchId,
          e.playerId!,
          statsByEntity.get(e.id)?.placement ?? humans.length,
          statsByEntity.get(e.id)?.soaks ?? 0,
          statsByEntity.get(e.id)?.roundsWon ?? 0,
          res.before,
          res.after,
          end.xp[e.id] ?? 0,
        );
        this.clearRankedBinding(e.playerId!);
      });
    } else {
      for (const e of match.entities) {
        if (!e.playerId) continue;
        this.q.recordMatchPlayer(
          matchId,
          e.playerId,
          statsByEntity.get(e.id)?.placement ?? match.entities.length,
          statsByEntity.get(e.id)?.soaks ?? 0,
          statsByEntity.get(e.id)?.roundsWon ?? 0,
          null,
          null,
          end.xp[e.id] ?? 0,
        );
      }
    }

    // XP + level unlocks for humans
    for (const e of match.entities) {
      if (!e.playerId) continue;
      const gained = end.xp[e.id] ?? 0;
      const beforeLevel = this.q.playerById(e.playerId)!.level;
      const { leveledTo } = this.q.addXp(e.playerId, gained);
      if (leveledTo > beforeLevel) {
        end.levelUps[e.playerId] = { from: beforeLevel, to: leveledTo };
        const unlockables = this.q.unlockablesForLevel(leveledTo);
        const newAnimals: string[] = [];
        const newHats: string[] = [];
        for (const a of unlockables.animals) if (this.q.grantUnlock(e.playerId, "animal", a)) newAnimals.push(a);
        for (const h of unlockables.hats) if (this.q.grantUnlock(e.playerId, "hat", h)) newHats.push(h);
        end.unlocks[e.playerId] = { animals: newAnimals, hats: newHats };
      }
    }
    this.q.endMatch(matchId);

    // refresh profiles & send personalized copies
    for (const e of match.entities) {
      if (e.isBot || !e.playerId) continue;
      const conn = this.connByPlayer.get(e.playerId);
      if (conn) {
        conn.profile = publicProfile(this.q.playerById(e.playerId)!, this.q);
        const personal: MatchEndMsg = {
          ...end,
          xp: { ...end.xp, [e.id]: end.xp[e.id] ?? 0 },
        };
        conn.send(personal);
      }
    }

    // casual room stays alive with the finished match attached for rematch voting
    if (match.roomCode) {
      const room = this.rooms.get(match.roomCode);
      if (room) {
        room.lastActivity = Date.now();
        if (!room.slots.some((s) => s.kind === "human")) this.destroyRoom(room.code);
      }
    }
  }
}
