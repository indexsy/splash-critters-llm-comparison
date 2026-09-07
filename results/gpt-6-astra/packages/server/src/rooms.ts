import { randomInt, randomUUID } from "node:crypto";
import {
  CONFIG,
  Tile,
  createGame,
  type GameState,
  type LobbySlot,
  type LobbyState,
  type MatchConfig,
  type MatchResult,
  type Placement,
  type PlayerInput,
  type RoomOptions,
  type RoomSummary,
  type ServerMessage,
  type Theme,
} from "@splash/shared";
import { BotController } from "./bots/bot.js";
import type { Store } from "./db/queries.js";
import { makeResult } from "./elo.js";
import { send, type Peer } from "./net.js";

export interface RunningMatch {
  id: string;
  startedAt: number;
  roundNo: number;
  state: GameState;
  theme: Theme;
  countdown: number;
  nextRoundAt: number;
  bots: Map<string, BotController>;
  inputs: Map<string, { input: PlayerInput; received: number }>;
  totals: Map<string, Placement>;
  result: MatchResult | null;
  tutorialGoals: Set<string>;
}
export interface Room extends LobbyState {
  updatedAt: number;
  disconnected: Map<string, number>;
  match: RunningMatch | null;
}
export class Rooms {
  readonly rooms = new Map<string, Room>();
  constructor(
    public store: Store,
    public peers: Map<string, Peer>,
  ) {}
  broadcast(room: Room, message: ServerMessage): void {
    for (const slot of room.slots)
      if (slot.playerId) {
        const peer = this.peers.get(slot.playerId);
        if (peer?.roomCode === room.code) send(peer, message);
      }
  }
  lobby(room: Room): LobbyState {
    return {
      code: room.code,
      hostId: room.hostId,
      opts: room.opts,
      slots: room.slots,
      status: room.status,
      ranked: room.ranked,
      rematchVotes: room.rematchVotes,
    };
  }
  update(room: Room): void {
    room.updatedAt = Date.now();
    this.broadcast(room, { type: "lobby_state", lobby: this.lobby(room) });
    this.publishList();
  }
  list(mode?: "duel" | "ffa"): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(
        (r) =>
          !r.ranked &&
          r.opts.isPublic &&
          r.status === "lobby" &&
          r.slots.some((s) => s.kind === "open") &&
          (!mode || mode === r.opts.mode),
      )
      .map((r) => ({
        code: r.code,
        name: r.opts.name,
        mode: r.opts.mode,
        players: r.slots.filter((s) => s.kind === "human").length,
        max: r.slots.length,
        bots: r.slots.filter((s) => s.kind === "bot").length,
        theme: r.opts.theme,
        host: r.slots.find((s) => s.playerId === r.hostId)?.nickname ?? "Host",
      }));
  }
  publishList(): void {
    for (const peer of this.peers.values())
      if (peer.listSubscribed)
        send(peer, { type: "room_list", rooms: this.list(peer.listMode) });
  }
  create(peer: Peer, opts: RoomOptions, ranked = false): Room {
    if (peer.roomCode || (peer.queue && !ranked))
      throw new Error("Leave your current room or queue first.");
    if (this.rooms.size >= CONFIG.MAX_ROOMS)
      throw new Error("All pools are busy. Please try again shortly.");
    if (opts.tutorial)
      opts = {
        ...opts,
        mode: "duel",
        isPublic: false,
        practice: true,
        botFill: true,
        theme: "backyard",
        roundsToWin: 2,
      };
    if (opts.practice) opts = { ...opts, isPublic: false, botFill: true };
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from(
        { length: 6 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
    } while (this.rooms.has(code));
    const slots: LobbySlot[] = Array.from(
      { length: CONFIG.ARENAS[opts.mode].players },
      (_, slot) => ({
        slot,
        kind: "open",
        playerId: null,
        nickname: "Open slot",
        animal: CONFIG.ANIMALS[slot].id,
        hat: "none",
        ready: false,
        difficulty: "medium",
        connected: false,
        rating: 1000,
      }),
    );
    const room: Room = {
      code,
      hostId: peer.id!,
      opts,
      slots,
      ranked,
      status: "lobby",
      rematchVotes: [],
      updatedAt: Date.now(),
      disconnected: new Map(),
      match: null,
    };
    this.rooms.set(code, room);
    this.join(peer, code, true);
    send(peer, { type: "room_created", code });
    if (opts.practice) {
      for (let i = 1; i < slots.length; i++)
        this.botSlot(room, i, opts.tutorial ? "easy" : "hard");
      this.start(room);
    } else this.update(room);
    return room;
  }
  join(peer: Peer, code: string, internal = false): void {
    const room = this.rooms.get(code.toUpperCase());
    if (!room || (room.ranked && !internal))
      throw new Error("That room code was not found.");
    if (
      (peer.roomCode && peer.roomCode !== room.code) ||
      (peer.queue && !internal)
    )
      throw new Error("Leave your current room or queue first.");
    if (room.status !== "lobby")
      throw new Error("That match has already started.");
    const slot =
      room.slots.find((s) => s.playerId === peer.id) ??
      room.slots.find((s) => s.kind === "open");
    if (!slot) throw new Error("That room is full.");
    const p = this.store.profile(peer.id!)!;
    Object.assign(slot, {
      kind: "human",
      playerId: p.id,
      nickname: `${p.nickname}#${p.tag}`,
      animal: p.selectedAnimal,
      hat: p.selectedHat,
      ready: room.hostId === p.id,
      connected: true,
      rating: p.ratings.find((r) => r.mode === room.opts.mode)!.rating,
    });
    peer.roomCode = room.code;
    peer.queue = null;
    room.disconnected.delete(peer.id!);
    this.update(room);
  }
  botSlot(
    room: Room,
    index: number,
    difficulty: "easy" | "medium" | "hard",
  ): void {
    const slot = room.slots[index];
    if (!slot || slot.kind === "human")
      throw new Error("Only empty or bot slots can be changed.");
    Object.assign(slot, {
      kind: "bot",
      playerId: `bot-${room.code}-${index}`,
      nickname: `${["Puddle", "Waddles", "Sprout", "Nibbles"][index]} [${difficulty}]`,
      difficulty,
      ready: true,
      connected: true,
    });
  }
  leave(peer: Peer, disconnected = false): void {
    const room = this.rooms.get(peer.roomCode ?? "");
    if (!room) {
      if (!disconnected) send(peer, { type: "room_left" });
      peer.roomCode = null;
      return;
    }
    const slot = room.slots.find((s) => s.playerId === peer.id);
    if (!slot) return;
    if (room.status === "playing") {
      slot.connected = false;
      room.disconnected.set(
        peer.id!,
        disconnected ? Date.now() : Date.now() - CONFIG.RECONNECT_GRACE_MS,
      );
      room.match?.inputs.delete(peer.id!);
    } else {
      Object.assign(slot, {
        kind: "open",
        playerId: null,
        nickname: "Open slot",
        ready: false,
        connected: false,
      });
    }
    if (!disconnected) {
      peer.roomCode = null;
      send(peer, { type: "room_left" });
    }
    if (room.hostId === peer.id)
      room.hostId =
        room.slots.find((s) => s.kind === "human" && s.connected)?.playerId ??
        room.hostId;
    this.update(room);
  }
  reconnect(peer: Peer): void {
    const room = [...this.rooms.values()].find((r) =>
      r.slots.some((s) => s.playerId === peer.id && s.kind === "human"),
    );
    if (!room) return;
    peer.roomCode = room.code;
    room.disconnected.delete(peer.id!);
    const slot = room.slots.find((s) => s.playerId === peer.id)!;
    slot.connected = true;
    if (room.match?.totals.get(peer.id!)?.forfeited) {
      peer.roomCode = null;
      return;
    }
    this.update(room);
    if (room.match) {
      send(peer, { type: "match_start", config: this.config(room) });
      this.roundMessage(room, peer);
      this.snapshot(room, peer);
      if (room.match.result)
        send(peer, { type: "match_end", ...room.match.result });
    }
  }
  config(room: Room): MatchConfig {
    return {
      id: room.match!.id,
      code: room.code,
      mode: room.opts.mode,
      ranked: room.ranked,
      roundsToWin: room.opts.roundsToWin,
      players: room.slots,
      theme: room.match!.theme,
    };
  }
  start(room: Room): void {
    if (room.status === "playing")
      throw new Error("The match is already running.");
    if (room.opts.botFill && !room.ranked)
      for (const slot of room.slots)
        if (slot.kind === "open") this.botSlot(room, slot.slot, "medium");
    if (room.slots.some((s) => s.kind === "open"))
      throw new Error("Fill all slots, or enable bot fill.");
    if (
      room.slots.some((s) => s.kind === "human" && (!s.ready || !s.connected))
    )
      throw new Error("Every player must be connected and ready.");
    if (room.ranked && room.slots.some((s) => s.kind !== "human"))
      throw new Error("Ranked games are humans only.");
    room.status = "playing";
    room.rematchVotes = [];
    const totals = new Map(
      room.slots.map((s) => [
        s.playerId!,
        {
          playerId: s.playerId!,
          nickname: s.nickname,
          animal: s.animal,
          placement: 1,
          roundsWon: 0,
          soaks: 0,
          castlesWashed: 0,
          survivalTicks: 0,
          biggestChain: 0,
          forfeited: false,
        },
      ]),
    );
    room.match = {
      id: randomUUID(),
      startedAt: Date.now(),
      roundNo: 0,
      state: null as unknown as GameState,
      theme:
        room.opts.theme === "random"
          ? (["backyard", "beach", "pool"] as Theme[])[randomInt(3)]
          : room.opts.theme,
      countdown: 90,
      nextRoundAt: 0,
      bots: new Map(),
      inputs: new Map(),
      totals,
      result: null,
      tutorialGoals: new Set(),
    };
    this.broadcast(room, { type: "match_start", config: this.config(room) });
    this.newRound(room);
    this.update(room);
  }
  newRound(room: Room): void {
    const m = room.match!;
    m.roundNo++;
    m.countdown = CONFIG.ROUND_COUNTDOWN_TICKS;
    m.nextRoundAt = 0;
    m.inputs.clear();
    const arena = CONFIG.ARENAS[room.opts.mode];
    // Independent secret streams prevent revealed drops from disclosing later castle contents.
    const lootSeed = Array.from({ length: arena.width * arena.height }, () =>
      randomInt(0x100000000),
    );
    m.state = createGame({
      mode: room.opts.mode,
      seed: randomInt(0x7fffffff),
      lootSeed,
      ranked: room.ranked,
      revengeEnabled: !room.opts.tutorial,
      players: room.slots.map((s) => ({
        id: s.playerId!,
        nickname: s.nickname,
        animal: s.animal,
        hat: s.hat,
        roundsWon: m.totals.get(s.playerId!)!.roundsWon,
      })),
    });
    for (const p of m.state.players)
      if (m.totals.get(p.id)!.forfeited) p.alive = false;
    if (room.opts.tutorial) {
      // The training lane guarantees a pickup and enough capacity to teach a chain.
      m.state.tiles = m.state.tiles.map((t) =>
        t === Tile.Castle ? Tile.Floor : t,
      );
      m.state.hiddenPowerups = {};
      const i = 1 * m.state.width + 4;
      m.state.tiles[i] = Tile.Castle;
      m.state.hiddenPowerups[i] = "range";
      m.state.players[0].balloonCount = 3;
      for (const x of [5, 7, 9]) {
        m.state.tiles[3 * m.state.width + x] = Tile.Castle;
        m.state.hiddenPowerups[3 * m.state.width + x] = "balloon";
      }
    }
    m.bots.clear();
    for (const s of room.slots)
      if (s.kind === "bot")
        m.bots.set(
          s.playerId!,
          new BotController(s.playerId!, s.difficulty, randomInt(0x7fffffff)),
        );
    for (const s of room.slots) {
      const peer = this.peers.get(s.playerId!);
      if (peer) peer.lastSeq = -1;
    }
    this.roundMessage(room);
    this.snapshot(room);
  }
  roundMessage(room: Room, peer?: Peer): void {
    const m = room.match!;
    const s = m.state;
    const msg: ServerMessage = {
      type: "round_start",
      roundNo: m.roundNo,
      mapSeed: s.mapSeed,
      castleGrid: s.tiles,
      width: s.width,
      height: s.height,
      theme: m.theme,
    };
    if (peer) send(peer, msg);
    else this.broadcast(room, msg);
  }
  snapshot(room: Room, peer?: Peer): void {
    const m = room.match!;
    const s = m.state;
    const msg: ServerMessage = {
      type: "snapshot",
      state: {
        tick: s.tick,
        serverTime: Date.now(),
        roundNo: m.roundNo,
        players: s.players,
        balloons: s.balloons,
        splashes: s.splashes,
        powerups: s.powerups,
        tideRing: s.tideRing,
        roundOver: s.roundOver,
        countdown: m.countdown,
        ...(room.opts.tutorial ? { tutorialGoals: [...m.tutorialGoals] } : {}),
      },
    };
    if (peer) send(peer, msg);
    else this.broadcast(room, msg);
  }
  endRound(room: Room): void {
    const m = room.match!;
    if (m.state.winnerId) m.totals.get(m.state.winnerId)!.roundsWon++;
    for (const p of m.state.players) {
      const t = m.totals.get(p.id)!;
      t.soaks += p.soaks;
      t.castlesWashed += p.castlesWashed;
      t.survivalTicks += p.survivalTicks;
      t.biggestChain = Math.max(t.biggestChain, p.biggestChain);
      p.roundsWon = t.roundsWon;
    }
    this.broadcast(room, {
      type: "round_end",
      winnerId: m.state.winnerId,
      roundNo: m.roundNo,
      scores: Object.fromEntries(
        [...m.totals].map(([id, t]) => [id, t.roundsWon]),
      ),
    });
    this.snapshot(room);
    if (
      [...m.totals.values()].some((p) => p.roundsWon >= room.opts.roundsToWin)
    )
      this.finish(room);
    else m.nextRoundAt = Date.now() + CONFIG.ROUND_BREAK_MS;
  }
  finish(room: Room): void {
    const m = room.match!;
    if (m.result) return;
    const placements = [...m.totals.values()].sort(
      (a, b) =>
        +a.forfeited - +b.forfeited ||
        b.roundsWon - a.roundsWon ||
        b.soaks - a.soaks,
    );
    for (let i = 0; i < placements.length; i++) {
      const previous = placements[i - 1];
      const current = placements[i];
      current.placement = current.forfeited
        ? placements.length
        : previous &&
            previous.roundsWon === current.roundsWon &&
            previous.soaks === current.soaks &&
            previous.forfeited === current.forfeited
          ? previous.placement
          : i + 1;
    }
    m.result = makeResult(
      this.store,
      m.id,
      room.opts.mode,
      room.ranked,
      placements,
    );
    this.store.saveMatch(m.result, m.startedAt);
    room.status = "results";
    this.broadcast(room, { type: "match_end", ...m.result });
    for (const s of room.slots) {
      const p = this.peers.get(s.playerId!);
      if (p) {
        p.profile = this.store.profile(p.id!);
        send(p, { type: "profile_updated", profile: p.profile! });
      }
    }
    this.update(room);
  }
  forfeit(room: Room, id: string): void {
    const m = room.match!;
    const total = m.totals.get(id);
    if (!total || total.forfeited || m.result) return;
    total.forfeited = true;
    const player = m.state.players.find((p) => p.id === id)!;
    player.alive = false;
    this.broadcast(room, {
      type: "event",
      event: {
        type: "player_soaked",
        playerId: id,
        byId: null,
        revenge: false,
        x: player.x,
        y: player.y,
      },
    });
    const remaining = [...m.totals.values()].filter((p) => !p.forfeited);
    if (room.opts.mode === "duel" || remaining.length <= 1) {
      for (const p of remaining) p.roundsWon = room.opts.roundsToWin;
      if (!m.nextRoundAt)
        for (const p of m.state.players) {
          const t = m.totals.get(p.id)!;
          t.soaks += p.soaks;
          t.castlesWashed += p.castlesWashed;
          t.survivalTicks += p.survivalTicks;
        }
      this.finish(room);
    }
  }
}
