import type {
  ClientMessage,
  Difficulty,
  GameMode,
  MatchPlayerInfo,
  PlayerProfile,
  ServerMessage,
} from "@splash/shared";
import { CONFIG, ANIMALS, HATS } from "@splash/shared";
import type { ClientConnection } from "./net.js";
import { NetServer } from "./net.js";
import { RoomManager } from "./rooms.js";
import { Matchmaker } from "./matchmaker.js";
import type { SplashDb } from "./db/index.js";
import {
  completeTutorial,
  createPlayer,
  findPlayerById,
  findPlayerByToken,
  getProfile,
  setCosmetics,
  updateNickname,
} from "./db/queries.js";
import {
  availableTag,
  guestIdentity,
  hashToken,
  newToken,
  tokenLooksValid,
  validateNickname,
} from "./identity.js";

interface Session {
  connection: ClientConnection;
  playerId: string;
  lastRtt: number;
}

export class Hub {
  readonly rooms: RoomManager;
  readonly matchmaker: Matchmaker;
  private readonly sessionsByConn = new Map<string, Session>();
  private readonly sessionsByPlayer = new Map<string, Session>();
  private readonly pending = new Map<string, ClientConnection>();
  private tickCounter = 0;
  private queueTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private net: NetServer | null = null;

  constructor(private readonly db: SplashDb) {
    const transport = {
      send: (playerId: string, message: ServerMessage) => this.sendToPlayer(playerId, message),
      isOnline: (playerId: string) => this.isOnline(playerId),
      roomListChanged: () => this.broadcastRoomList(),
      profileChanged: (_playerId: string) => undefined,
    };
    this.rooms = new RoomManager(db, transport);
    this.matchmaker = new Matchmaker(db, {
      send: (playerId, message) => this.sendToPlayer(playerId, message),
      isOnline: (playerId) => this.isOnline(playerId),
      onMatched: (mode, playerIds) => {
        for (const id of playerIds) {
          if (!this.isOnline(id) || this.rooms.findRoomForPlayer(id)) return false;
        }
        return this.rooms.createRanked(mode, playerIds);
      },
    });
  }

  attachNet(net: NetServer): void {
    this.net = net;
  }

  startTimers(): void {
    this.queueTimer = setInterval(() => {
      this.matchmaker.tick();
    }, CONFIG.MATCHMAKING.tickMs);
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      for (const session of this.sessionsByConn.values()) {
        session.connection.send({ t: "ping", sentAt: now, rtt: Math.round(session.lastRtt) });
      }
    }, 2000);
  }

  stop(): void {
    if (this.queueTimer) clearInterval(this.queueTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.queueTimer = null;
    this.pingTimer = null;
  }

  gameTick(): void {
    this.tickCounter += 1;
    this.rooms.tick();
  }

  connect(connection: ClientConnection): void {
    this.pending.set(connection.id, connection);
  }

  disconnect(connection: ClientConnection): void {
    this.pending.delete(connection.id);
    const session = this.sessionsByConn.get(connection.id);
    if (!session) return;
    this.sessionsByConn.delete(connection.id);
    if (this.sessionsByPlayer.get(session.playerId) === session) {
      this.sessionsByPlayer.delete(session.playerId);
      this.matchmaker.removePlayer(session.playerId);
      this.rooms.disconnect(session.playerId);
    }
  }

  private isOnline(playerId: string): boolean {
    return this.sessionsByPlayer.has(playerId);
  }

  private sendToPlayer(playerId: string, message: ServerMessage): void {
    this.sessionsByPlayer.get(playerId)?.connection.send(message);
  }

  private sendError(connection: ClientConnection, code: string, msg: string): void {
    connection.send({ t: "error", code, msg });
  }

  private profileOrThrow(playerId: string): PlayerProfile {
    return getProfile(this.db, playerId);
  }

  private authenticate(connection: ClientConnection, providedToken?: string): void {
    if (this.sessionsByConn.has(connection.id)) {
      this.sendError(connection, "ALREADY_HELLO", "Already authenticated.");
      return;
    }
    this.pending.delete(connection.id);
    let token = providedToken && tokenLooksValid(providedToken) ? providedToken : undefined;
    let row = token ? findPlayerByToken(this.db, hashToken(token)) : null;
    let created = false;
    if (!row) {
      const finalToken = token ?? newToken();
      const identity = guestIdentity(this.db);
      try {
        row = createPlayer(this.db, hashToken(finalToken), identity.nickname, identity.tag);
        created = true;
        token = finalToken;
      } catch {
        row = findPlayerByToken(this.db, hashToken(finalToken));
        token = finalToken;
      }
    }
    if (!row) {
      this.sendError(connection, "AUTH_FAILED", "Could not create a guest account.");
      return;
    }
    const oldSession = this.sessionsByPlayer.get(row.id);
    if (oldSession) {
      this.sessionsByConn.delete(oldSession.connection.id);
      oldSession.connection.close(4001, "connected elsewhere");
    }
    const session: Session = {
      connection,
      playerId: row.id,
      lastRtt: 0,
    };
    this.sessionsByConn.set(connection.id, session);
    this.sessionsByPlayer.set(row.id, session);
    const profile = this.profileOrThrow(row.id);
    connection.send({
      t: "welcome",
      playerId: row.id,
      profile,
      token: created ? token : undefined,
      serverTick: this.tickCounter,
    });
    if (this.rooms.findRoomForPlayer(row.id)) {
      this.rooms.resume(row.id);
    }
  }

  handleMessage(connection: ClientConnection, message: ClientMessage): void {
    const session = this.sessionsByConn.get(connection.id);
    if (message.t === "hello") {
      this.authenticate(connection, message.token);
      return;
    }
    if (!session) {
      this.sendError(connection, "NO_HELLO", "Send hello first.");
      return;
    }
    const playerId = session.playerId;
    switch (message.t) {
      case "set_nickname": {
        if (this.rooms.findRoomForPlayer(playerId)) {
          this.sendError(connection, "IN_ROOM", "Leave your room to change your nickname.");
          return;
        }
        const validation = validateNickname(message.nickname);
        if (!validation.ok) {
          this.sendError(connection, "BAD_NICKNAME", validation.msg);
          return;
        }
        const tag = availableTag(this.db, validation.nickname);
        updateNickname(this.db, playerId, validation.nickname, tag);
        const profile = this.profileOrThrow(playerId);
        connection.send({ t: "profile_update", profile });
        connection.send({ t: "notice", msg: "Nickname updated." });
        return;
      }
      case "queue_join": {
        if (this.matchmaker.isQueued(playerId)) {
          this.matchmaker.removePlayer(playerId);
        }
        if (this.rooms.findRoomForPlayer(playerId)) {
          this.sendError(connection, "IN_ROOM", "Leave your room before joining a queue.");
          return;
        }
        const profile = this.profileOrThrow(playerId);
        if (profile.needsNickname) {
          this.sendError(connection, "NEED_NICKNAME", "Set a nickname before playing ranked.");
          return;
        }
        const error = this.matchmaker.join(playerId, message.mode);
        if (error) this.sendError(connection, "QUEUE_ERROR", error);
        return;
      }
      case "queue_leave":
        this.matchmaker.leave(playerId);
        return;
      case "create_room": {
        this.matchmaker.removePlayer(playerId);
        if (this.rooms.findRoomForPlayer(playerId)) {
          this.sendError(connection, "IN_ROOM", "Leave your current room first.");
          return;
        }
        const result = this.rooms.createRoom(playerId, message.opts);
        if (!result.ok) this.sendError(connection, "CREATE_FAILED", result.error ?? "Could not create room.");
        return;
      }
      case "join_room": {
        this.matchmaker.removePlayer(playerId);
        const result = this.rooms.joinRoom(playerId, message.code);
        if (!result.ok) this.sendError(connection, "JOIN_FAILED", result.error ?? "Could not join room.");
        return;
      }
      case "room_list_request":
        connection.send({ t: "room_list", rooms: this.rooms.publicRooms() });
        return;
      case "leave_room":
        this.rooms.leaveRoom(playerId);
        return;
      case "set_slot":
        this.applyRoomResult(
          connection,
          this.rooms.setSlot(playerId, message.slot, message.kind, message.difficulty ?? "medium"),
        );
        return;
      case "set_ready":
        this.applyRoomResult(connection, this.rooms.setReady(playerId, message.ready));
        return;
      case "start_match":
        this.applyRoomResult(connection, this.rooms.startMatch(playerId));
        return;
      case "input":
        this.rooms.handleInput(playerId, {
          seq: message.seq,
          tick: message.tick,
          dir: message.dir,
          balloonPressed: message.balloonPressed,
        });
        return;
      case "emote":
        this.rooms.handleEmote(playerId, message.id);
        return;
      case "rematch_vote":
        this.rooms.voteRematch(playerId);
        return;
      case "pong":
        session.lastRtt = Math.max(0, Math.min(1000, Date.now() - message.sentAt));
        return;
      case "set_cosmetics": {
        if (this.rooms.findRoomForPlayer(playerId)) {
          this.sendError(connection, "IN_ROOM", "Leave your room to change cosmetics.");
          return;
        }
        try {
          setCosmetics(this.db, playerId, message.animal, message.hat);
          this.rooms.updateCosmetics(playerId, message.animal, message.hat);
          const profile = this.profileOrThrow(playerId);
          connection.send({ t: "profile_update", profile });
        } catch {
          this.sendError(connection, "LOCKED", "That cosmetic is locked.");
        }
        return;
      }
      case "tutorial_complete": {
        const result = completeTutorial(this.db, playerId, CONFIG.TUTORIAL_XP);
        connection.send({ t: "profile_update", profile: result.profile });
        if (result.awarded > 0) {
          connection.send({ t: "notice", msg: `Tutorial complete! +${result.awarded} XP` });
        }
        return;
      }
      default:
        return;
    }
  }

  private applyRoomResult(
    connection: ClientConnection,
    result: { ok: boolean; error?: string },
  ): void {
    if (!result.ok) {
      this.sendError(connection, "ROOM_ERROR", result.error ?? "Room action failed.");
    }
  }

  private broadcastRoomList(): void {
    const message: ServerMessage = { t: "room_list", rooms: this.rooms.publicRooms() };
    for (const session of this.sessionsByPlayer.values()) {
      if (!this.rooms.findRoomForPlayer(session.playerId)) {
        session.connection.send(message);
      }
    }
  }

  pingLatency(playerId: string): number {
    return Math.round(this.sessionsByPlayer.get(playerId)?.lastRtt ?? 0);
  }

  matchFoundPreview(mode: GameMode, players: MatchPlayerInfo[]): ServerMessage {
    return { t: "match_found", mode, ranked: true, players, roomCode: "" };
  }

  setDifficultyForTest(_difficulty: Difficulty): void {
    return;
  }

  closeNet(): void {
    this.stop();
    this.net?.close();
  }

  cosmeticCount(): number {
    return ANIMALS.length + HATS.length;
  }

  playerRowFor(playerId: string) {
    return findPlayerById(this.db, playerId);
  }
}
