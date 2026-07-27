/**
 * The socket gateway.
 *
 * Everything a connection needs and nothing it does not: framing, size limits,
 * rate limiting, liveness pings and fan-out. What a message *means* lives in
 * handlers.ts; what the game does with it lives in the room and match domain.
 * The server never trusts a client for anything but its inputs.
 */

import { WebSocket, type RawData } from 'ws';
import { CONFIG, type ErrorCode, type ServerMessage } from '@splash/shared';
import { ENV } from './env.js';
import { GuestMintLimiter } from './guestLimit.js';
import { dispatch } from './handlers.js';
import { MatchRunner, type MatchSink } from './match.js';
import type { Matchmaker } from './matchmaker.js';
import type { PlayerService } from './players.js';
import { parseClientMessage } from './protocolGuards.js';
import type { Room } from './room.js';
import type { RoomManager } from './rooms.js';

export interface Client {
  socket: WebSocket;
  /** Remote address, for the guest-minting brake. Unknown sockets share a bucket. */
  address: string;
  /** Null until `hello` succeeds. Nothing else is accepted before then. */
  playerId: string | null;
  roomCode: string | null;
  /** Highest input sequence accepted, so a reordered straggler cannot rewind. */
  lastInputSeq: number;
  /** False between a ping going out and its pong coming back. */
  alive: boolean;
  missedPongs: number;
  latencyMs: number;
  // Rolling one-second rate window.
  windowStartMs: number;
  windowCount: number;
  violations: number;
  warnedThisWindow: boolean;
}

export interface HubDeps {
  players: PlayerService;
  rooms: RoomManager;
  matchmaker: Matchmaker;
  /** Defaults to the production limits; tests hand in tighter ones. */
  guestLimiter?: GuestMintLimiter;
}

/** Three unanswered pings at CONFIG.PING_INTERVAL_MS is a dead tab, not a hiccup. */
const MAX_MISSED_PONGS = 3;

/** Null means "refuse this frame": binary, or bigger than we agreed to read. */
function frameText(data: RawData, isBinary: boolean): string | null {
  if (isBinary) return null;
  let buffer: Buffer;
  if (Buffer.isBuffer(data)) buffer = data;
  else if (Array.isArray(data)) buffer = Buffer.concat(data);
  else buffer = Buffer.from(data);
  if (buffer.byteLength > CONFIG.MAX_MSG_BYTES) return null;
  return buffer.toString('utf8');
}

export class Hub {
  readonly players: PlayerService;
  readonly rooms: RoomManager;
  readonly matchmaker: Matchmaker;
  /** Brand new accounts are permanent, so one address cannot mint them freely. */
  readonly guestLimiter: GuestMintLimiter;

  private readonly clients = new Set<Client>();
  private readonly byPlayer = new Map<string, Client>();

  constructor(deps: HubDeps) {
    this.players = deps.players;
    this.rooms = deps.rooms;
    this.matchmaker = deps.matchmaker;
    this.guestLimiter = deps.guestLimiter ?? new GuestMintLimiter();
  }

  // --------------------------------------------------------------- lifecycle

  handleConnection(socket: WebSocket, address?: string): void {
    const client: Client = {
      socket,
      address: address ?? 'unknown',
      playerId: null,
      roomCode: null,
      lastInputSeq: 0,
      alive: true,
      missedPongs: 0,
      latencyMs: 0,
      windowStartMs: Date.now(),
      windowCount: 0,
      violations: 0,
      warnedThisWindow: false,
    };
    this.clients.add(client);

    socket.on('message', (data: RawData, isBinary: boolean) => {
      this.onMessage(client, data, isBinary);
    });
    socket.on('close', () => this.onClose(client));
    // A socket error is always followed by close, so this only stops the throw.
    socket.on('error', () => socket.terminate());
  }

  /** Binds an authenticated account to a socket, evicting any older tab. */
  bindPlayer(client: Client, playerId: string): void {
    const existing = this.byPlayer.get(playerId);
    if (existing !== undefined && existing !== client) {
      existing.playerId = null;
      existing.socket.close(4001, 'signed in elsewhere');
    }
    client.playerId = playerId;
    this.byPlayer.set(playerId, client);
  }

  private onMessage(client: Client, data: RawData, isBinary: boolean): void {
    // This runs inside the ws 'message' listener, so a throw escaping it is an
    // uncaught exception and the whole server with every live match on it. One
    // sick frame is worth exactly one error to the socket that sent it.
    try {
      this.handleMessage(client, data, isBinary);
    } catch (error) {
      console.error('[net] message handling failed:', error);
      this.sendError(client, 'server_error', 'Something went wrong handling that.');
    }
  }

  private handleMessage(client: Client, data: RawData, isBinary: boolean): void {
    if (!this.allow(client)) return;

    const text = frameText(data, isBinary);
    if (text === null) {
      this.sendError(client, 'bad_message', 'Frame rejected: binary or oversized.');
      return;
    }

    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      this.sendError(client, parsed.code, parsed.reason);
      return;
    }
    if (client.playerId === null && parsed.message.t !== 'hello') {
      this.sendError(client, 'not_authenticated', 'Say hello first.');
      return;
    }

    dispatch(this, client, parsed.message);
  }

  private onClose(client: Client): void {
    this.clients.delete(client);
    const playerId = client.playerId;
    if (playerId === null) return;
    // A replaced tab must not evict the connection that replaced it.
    if (this.byPlayer.get(playerId) === client) this.byPlayer.delete(playerId);
    this.matchmaker.leave(playerId);

    const room = this.rooms.roomOfPlayer(playerId);
    if (room === undefined) return;
    const slot = room.slotOfPlayer(playerId);
    if (slot < 0) return;

    const occupant = room.slots[slot];
    if (occupant.kind !== 'human') return;
    // The grace period is time-based, so GameLoop decides what happens next.
    occupant.connected = false;
    occupant.disconnectedAt = Date.now();

    const record = this.players.getById(playerId);
    this.broadcastRoom(room, {
      t: 'notice',
      kind: 'disconnect',
      msg: `${record?.nickname ?? 'A critter'} lost connection.`,
    });
    this.broadcastLobby(room);
  }

  // -------------------------------------------------------------- rate limit

  private allow(client: Client): boolean {
    const now = Date.now();
    if (now - client.windowStartMs >= 1000) {
      client.windowStartMs = now;
      client.windowCount = 0;
      client.warnedThisWindow = false;
    }
    client.windowCount++;
    if (client.windowCount <= CONFIG.MAX_MSGS_PER_SEC) return true;

    client.violations++;
    // One warning per window: telling a flooder off once per message is a flood.
    if (!client.warnedThisWindow) {
      client.warnedThisWindow = true;
      this.sendError(client, 'rate_limited', 'Slow down.');
    }
    if (client.violations > CONFIG.MAX_RATE_VIOLATIONS) {
      client.socket.close(4029, 'rate limited');
    }
    return false;
  }

  // ------------------------------------------------------------------ output

  send(playerId: string, msg: ServerMessage): void {
    const client = this.byPlayer.get(playerId);
    if (client !== undefined) this.sendToSocketClient(client, msg);
  }

  sendToSocketClient(client: Client, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    if (ENV.artificialLatencyMs > 0) {
      setTimeout(() => write(client, data), ENV.artificialLatencyMs);
      return;
    }
    write(client, data);
  }

  sendError(client: Client, code: ErrorCode, msg: string): void {
    this.sendToSocketClient(client, { t: 'error', code, msg });
  }

  broadcastRoom(room: Room, msg: ServerMessage): void {
    for (const playerId of room.humanIds()) this.send(playerId, msg);
  }

  broadcastLobby(room: Room): void {
    this.broadcastRoom(room, { t: 'lobby_state', lobby: room.toLobbyState(this.players) });
  }

  clientFor(playerId: string): Client | undefined {
    return this.byPlayer.get(playerId);
  }

  connectionCount(): number {
    return this.clients.size;
  }

  /** Called by GameLoop each ping interval. */
  pingAll(nowMs: number): void {
    for (const client of this.clients) {
      if (!client.alive) client.missedPongs++;
      if (client.missedPongs >= MAX_MISSED_PONGS) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      this.sendToSocketClient(client, { t: 'ping', time: nowMs, rtt: client.latencyMs });
    }
  }

  // ------------------------------------------------------------------ matches

  /**
   * Seats any bots the room is owed and blows the whistle. Returns false when
   * the room cannot start, so callers can answer the client honestly.
   */
  startMatch(room: Room): boolean {
    if (room.phase === 'match') return false;
    if (room.botFill || room.autoStart) room.fillWithBots();
    if (!room.canStart()) return false;

    const sink: MatchSink = {
      // Membership is checked here rather than in the match: a critter who
      // walked out of the room should stop receiving its snapshots at once,
      // even though the match keeps their seat and their stats.
      send: (playerId, msg) => {
        if (room.slotOfPlayer(playerId) >= 0) this.send(playerId, msg);
      },
      broadcast: (msg) => this.broadcastRoom(room, msg),
      latency: (playerId) => this.clientFor(playerId)?.latencyMs ?? 0,
    };
    room.match = new MatchRunner(room, this.players, sink);
    room.phase = 'match';
    room.ready.clear();
    room.rematchVotes.clear();
    room.touch(Date.now());
    // A new match means a new input stream, so yesterday's sequence cannot
    // silently swallow today's first inputs.
    for (const playerId of room.humanIds()) {
      const client = this.byPlayer.get(playerId);
      if (client !== undefined) client.lastInputSeq = 0;
    }

    this.broadcastLobby(room);
    room.match.begin();
    return true;
  }
}

function write(client: Client, data: string): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  client.socket.send(data);
}
