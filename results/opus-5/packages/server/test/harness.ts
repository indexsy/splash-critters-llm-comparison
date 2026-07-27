/**
 * End-to-end plumbing: the real server booted in-process, plus a small typed
 * WebSocket client to talk to it.
 *
 * Nothing here is a mock. The server under test is exactly what `npm start`
 * boots, listening on an ephemeral port with its own throwaway data directory,
 * and the client speaks the same JSON frames the browser client does.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { CONFIG, type ClientMessage, type ServerMessage } from '@splash/shared';
import { MatchRunner, type MatchSink, type MatchSlotResult } from '../src/match.js';
import type { PlayerService } from '../src/players.js';
import type { Room } from '../src/room.js';
import { startServer, type RunningServer } from '../src/server.js';

/** Generous enough for a loaded machine, finite enough that a hang fails loudly. */
export const DEFAULT_TIMEOUT_MS = 5000;

/** Snapshots arrive 15 times a second, so an unread backlog needs a ceiling. */
const MAX_INBOX = 4000;

export type MessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export interface CloseInfo {
  code: number;
  reason: string;
}

interface Waiter {
  matches(msg: ServerMessage): boolean;
  settle(msg: ServerMessage): void;
  fail(error: Error): void;
}

/** One connected client. Every wait is bounded; nothing here blocks forever. */
export class TestClient {
  readonly label: string;
  readonly socket: WebSocket;

  /** Messages nobody was waiting for when they arrived. */
  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];
  /** Distinct message types seen since the current wait started, for errors. */
  private seen: string[] = [];
  private closeInfo: CloseInfo | null = null;
  private readonly closeWaiters: ((info: CloseInfo) => void)[] = [];
  /** Pongs before hello would earn a not_authenticated error nobody asked for. */
  private helloSent = false;

  constructor(label: string, socket: WebSocket) {
    this.label = label;
    this.socket = socket;
    socket.on('message', (data) => this.receive(String(data)));
    socket.on('close', (code, reason) => this.onClose(code, String(reason)));
    // A socket error is always followed by close, so this only stops the throw.
    socket.on('error', () => {});
  }

  // ------------------------------------------------------------------ sending

  send(msg: ClientMessage): void {
    if (msg.t === 'hello') this.helloSent = true;
    this.sendRaw(JSON.stringify(msg));
  }

  /** Deliberately untyped, for hostile frames the protocol would never produce. */
  sendJson(value: unknown): void {
    this.sendRaw(JSON.stringify(value));
  }

  sendRaw(text: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.label}: socket is not open (readyState ${this.socket.readyState})`);
    }
    this.socket.send(text);
  }

  /** hello + welcome in one step, since nothing else is accepted before it. */
  async hello(token?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MessageOf<'welcome'>> {
    this.send(token === undefined ? { t: 'hello' } : { t: 'hello', token });
    return this.nextMessage('welcome', undefined, timeoutMs);
  }

  // ------------------------------------------------------------------ waiting

  /**
   * The next message of `type` that satisfies `predicate`, taken from the
   * backlog when it has already arrived. Rejects with what it did see when the
   * timeout expires, so a regression names itself.
   */
  nextMessage<T extends ServerMessage['t']>(
    type: T,
    predicate?: (msg: MessageOf<T>) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<MessageOf<T>> {
    const matches = (msg: ServerMessage): boolean =>
      msg.t === type && (predicate === undefined || predicate(msg as MessageOf<T>));

    const buffered = this.inbox.findIndex(matches);
    if (buffered >= 0) {
      const [msg] = this.inbox.splice(buffered, 1);
      return Promise.resolve(msg as MessageOf<T>);
    }
    if (this.closeInfo !== null) {
      return Promise.reject(
        new Error(`${this.label}: socket closed (${this.closeInfo.code}) before '${type}' arrived`),
      );
    }

    this.seen = [];
    return new Promise<MessageOf<T>>((resolve, reject) => {
      let waiter: Waiter | null = null;
      const timer = setTimeout(() => {
        if (waiter !== null) this.drop(waiter);
        const detail = predicate === undefined ? '' : ' matching the predicate';
        const saw = this.seen.length > 0 ? this.seen.join(', ') : 'nothing';
        reject(
          new Error(
            `${this.label}: timed out after ${timeoutMs}ms waiting for '${type}'${detail}; saw: ${saw}`,
          ),
        );
      }, timeoutMs);

      waiter = {
        matches,
        settle: (msg) => {
          clearTimeout(timer);
          resolve(msg as MessageOf<T>);
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
    });
  }

  /** Resolves with the close frame the server sent, or rejects on timeout. */
  waitForClose(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CloseInfo> {
    if (this.closeInfo !== null) return Promise.resolve(this.closeInfo);
    return new Promise<CloseInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${this.label}: socket was still open after ${timeoutMs}ms`));
      }, timeoutMs);
      this.closeWaiters.push((info) => {
        clearTimeout(timer);
        resolve(info);
      });
    });
  }

  /** Every message of `type` currently sitting unread in the backlog. */
  buffered<T extends ServerMessage['t']>(type: T): MessageOf<T>[] {
    return this.inbox.filter((msg): msg is MessageOf<T> => msg.t === type);
  }

  // ---------------------------------------------------------------- lifecycle

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'test over');
  }

  /** Hard stop, used by teardown so a test run never waits on a handshake. */
  dispose(): void {
    this.socket.removeAllListeners('message');
    this.socket.terminate();
    for (const waiter of this.waiters.splice(0)) {
      waiter.fail(new Error(`${this.label}: client disposed while waiting`));
    }
  }

  // ---------------------------------------------------------------- internals

  private receive(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (!this.seen.includes(msg.t)) this.seen.push(msg.t);

    // A real client answers the liveness ping; three missed pongs is a kill.
    if (msg.t === 'ping' && this.helloSent && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ t: 'pong', time: msg.time }));
    }

    const index = this.waiters.findIndex((waiter) => waiter.matches(msg));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      waiter.settle(msg);
      return;
    }
    this.inbox.push(msg);
    if (this.inbox.length > MAX_INBOX) this.inbox.shift();
  }

  private onClose(code: number, reason: string): void {
    this.closeInfo = { code, reason };
    for (const waiter of this.waiters.splice(0)) {
      waiter.fail(new Error(`${this.label}: socket closed (${code}) while waiting`));
    }
    for (const resolve of this.closeWaiters.splice(0)) resolve(this.closeInfo);
  }

  private drop(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
  }
}

/** Every round running to its hard stop, every round played. Never reached. */
const TICK_BUDGET =
  CONFIG.MAX_ROUNDS * (CONFIG.ROUND_MAX_TICKS + CONFIG.ROUND_END_TICKS + CONFIG.COUNTDOWN_TICKS) +
  CONFIG.TICK_RATE;

export interface PlayedMatch {
  runner: MatchRunner;
  results: MatchSlotResult[];
  ticks: number;
}

/**
 * Plays a room's match out headlessly, exactly the way soak.ts does: no
 * sockets, no wall clock, every seat driven by a bot so a first-to-3 duel takes
 * about a second. The seats stay owned by whichever accounts are sitting in
 * them, so ratings and XP still land on real players.
 */
export function playMatchWithBots(room: Room, players: PlayerService): PlayedMatch {
  const sink: MatchSink = { send: () => {}, broadcast: () => {}, latency: () => 0 };
  const runner = new MatchRunner(room, players, sink);
  room.match = runner;
  room.phase = 'match';
  for (let slot = 0; slot < room.maxPlayers; slot++) runner.substituteBot(slot, 'hard');
  runner.begin();

  // A synthetic clock: bots only read it to pace their decisions.
  let clockMs = Date.now();
  let ticks = 0;
  while (!runner.finished && ticks < TICK_BUDGET) {
    clockMs += CONFIG.TICK_MS;
    runner.tick(clockMs);
    ticks++;
  }
  return { runner, results: runner.results(), ticks };
}

export interface TestHarness {
  server: RunningServer;
  dataDir: string;
  /** A fresh connected client. Teardown closes every one it handed out. */
  connect(label: string): Promise<TestClient>;
  stop(): Promise<void>;
}

/** Boots the real server on an ephemeral port over a fresh temp data directory. */
export async function bootTestHarness(): Promise<TestHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'splash-e2e-'));
  const server = await startServer({ port: 0, dataDir, silent: true });
  const clients: TestClient[] = [];

  return {
    server,
    dataDir,

    connect(label: string): Promise<TestClient> {
      return new Promise<TestClient>((resolve, reject) => {
        const socket = new WebSocket(server.wsUrl);
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error(`${label}: could not connect to ${server.wsUrl} within ${DEFAULT_TIMEOUT_MS}ms`));
        }, DEFAULT_TIMEOUT_MS);

        socket.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        socket.once('open', () => {
          clearTimeout(timer);
          const client = new TestClient(label, socket);
          clients.push(client);
          resolve(client);
        });
      });
    },

    async stop(): Promise<void> {
      for (const client of clients) client.dispose();
      clients.length = 0;
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
