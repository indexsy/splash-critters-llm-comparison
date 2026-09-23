import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CONFIG, Dir, type MsgOf, type S2C, type S2CType } from '@splash/shared';
import type { BotFactory } from '../src/match/types';
import { createGameServer, type GameServer } from '../src/net/gameServer';
import { DEFAULT_ROOM_CODE_LIMITS } from '../src/net/roomCodes';

const idleBots: BotFactory = (slot, difficulty) => ({
  slot,
  difficulty,
  nextInput: () => ({ seq: 0, dir: Dir.None, balloon: false }),
  reset: () => undefined,
});

/** A raw protocol client: buffers every message and lets tests await the next one of a type. */
class TestClient {
  readonly log: S2C[] = [];
  private readonly buffer: S2C[] = [];
  private readonly waiters: { type: S2CType; resolve: (m: S2C) => void }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as S2C;
      this.log.push(msg);
      const waiter = this.waiters.find((w) => w.type === msg.type);
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(msg);
      } else this.buffer.push(msg);
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }

  static open(port: number, headers?: Record<string, string>): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  next<T extends S2CType>(type: T, timeoutMs = 4000): Promise<MsgOf<S2C, T>> {
    const i = this.buffer.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.buffer.splice(i, 1)[0] as MsgOf<S2C, T>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as MsgOf<S2C, T>);
        },
      });
    });
  }

  types(): string[] {
    return this.log.map((m) => m.type).filter((t) => t !== 'ping' && t !== 'snapshot' && t !== 'event');
  }

  async hello(token?: string): Promise<MsgOf<S2C, 'welcome'>> {
    this.send({ type: 'hello', v: CONFIG.PROTOCOL_VERSION, ...(token ? { token } : {}) });
    return this.next('welcome');
  }

  close(): void {
    this.ws.close();
  }
}

let server: GameServer;
let port: number;
let clientDir: string;
const clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const c = await TestClient.open(port);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  clientDir = mkdtempSync(join(tmpdir(), 'splash-client-'));
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>Splash Critters</title>');
  server = createGameServer({ dataDir: ':memory:', clientDist: clientDir, lagMs: 0, createBot: idleBots });
  port = await server.listen(0, '127.0.0.1');
});

afterAll(async () => {
  for (const c of clients) c.ws.terminate();
  await server.close();
  rmSync(clientDir, { recursive: true, force: true });
});

const http = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);

describe('game server over real sockets', () => {
  it('hello -> welcome -> create_room -> room_created + lobby_state', async () => {
    const c = await connect();
    const welcome = await c.hello();
    expect(welcome.playerId).toMatch(/[0-9a-f-]{36}/);
    expect(welcome.token.length).toBeGreaterThanOrEqual(16);
    expect(welcome.profile.nickname).toBeTruthy();
    expect(Math.abs(welcome.serverTime - Date.now())).toBeLessThan(5000);
    c.send({ type: 'create_room', opts: { name: 'Smoke', size: 4, isPublic: true, theme: 'pool', roundsToWin: 2, botFill: true } });
    const created = await c.next('room_created');
    const { lobby } = await c.next('lobby_state');
    expect(lobby).toMatchObject({ code: created.code, name: 'Smoke', size: 4, phase: 'lobby', yourSlot: 0, hostSlot: 0 });
    const ping = await c.next('ping', 5000);
    expect(ping.t).toBeGreaterThan(0);
    c.send({ type: 'pong', t: ping.t });
    const health = await (await http('/health')).json();
    expect(health).toMatchObject({ ok: true, rooms: 1, players: 1, matches: 0 });
    c.send({ type: 'room_list_request', mode: 'ffa' });
    expect((await c.next('room_list')).rooms.map((r) => r.code)).toEqual([created.code]);
    c.send({ type: 'leave_room' });
    expect((await c.next('left_room')).reason).toBe('left');
  });

  it('rejects messages before hello, malformed messages and a wrong protocol version', async () => {
    const c = await connect();
    c.send({ type: 'leave_room' });
    expect((await c.next('error')).code).toBe('not_ready');
    c.send('{"type":"hello"');
    expect((await c.next('error')).code).toBe('bad_message');
    c.send({ type: 'hello', v: CONFIG.PROTOCOL_VERSION + 1 });
    expect((await c.next('error')).code).toBe('bad_version');
    expect((await c.closed).code).toBe(1008);
  });

  it('closes a flooding socket with 1008 after rate_limited errors', async () => {
    const c = await connect();
    await c.hello();
    for (let i = 0; i < 400; i++) c.send({ type: 'room_list_watch', on: false });
    expect((await c.next('error')).code).toBe('rate_limited');
    expect((await c.closed).code).toBe(1008);
  });

  it('lets a second socket with the same token take the session over', async () => {
    const a = await connect();
    const first = await a.hello();
    const b = await connect();
    const second = await b.hello(first.token);
    expect(second.playerId).toBe(first.playerId);
    expect((await a.closed).code).toBe(4000);
    b.send({ type: 'room_list_request' });
    await b.next('room_list');
  });

  it('requires a nickname for ranked, then matches two queued players into a ranked duel', async () => {
    const [a, b] = [await connect(), await connect()];
    await a.hello();
    await b.hello();
    a.send({ type: 'queue_join', mode: 'duel' });
    expect((await a.next('error')).code).toBe('nickname_required');
    a.send({ type: 'set_nickname', nickname: 'Dueler One' });
    expect((await a.next('profile')).profile).toMatchObject({ nickname: 'Dueler One', hasNickname: true });
    b.send({ type: 'set_nickname', nickname: 'Dueler Two' });
    await b.next('profile');
    a.send({ type: 'queue_join', mode: 'duel' });
    b.send({ type: 'queue_join', mode: 'duel' });
    expect(await a.next('queue_status')).toMatchObject({ mode: 'duel', searchRange: CONFIG.MM_BASE_RANGE });
    const found = await a.next('match_found', CONFIG.MM_TICK_MS + 3000);
    expect(found.players.map((p) => p.name).sort()).toEqual(['Dueler One', 'Dueler Two']);
    const start = await b.next('match_start');
    expect(start.config).toMatchObject({ ranked: true, mode: 'duel', roomCode: found.roomCode });
    a.send({ type: 'leave_room' });
    const end = await b.next('match_end');
    expect(end.ratingDeltas).toHaveLength(2);
    expect((await b.next('left_room')).reason).toBe('match_over');
    const board = (await (await http('/api/leaderboard?mode=duel')).json()) as { nickname: string; rank: number }[];
    expect(board.map((e) => e.nickname)).toEqual(['Dueler Two', 'Dueler One']);
  });

  it('re-attaches a reconnecting player mid-match with lobby_state, match_start and the live round', async () => {
    const a = await connect();
    const welcome = await a.hello();
    a.send({ type: 'create_room', opts: { name: '', size: 2, isPublic: false, theme: 'beach', roundsToWin: 3, botFill: false, practice: true } });
    await a.next('match_start');
    await a.next('round_start', CONFIG.MATCH_INTRO_MS + 2000);
    a.close();
    await a.closed;
    const b = await connect();
    await b.hello(welcome.token);
    const round = await b.next('round_start');
    expect(round.resumeTick).toBeGreaterThanOrEqual(0);
    expect(b.types().slice(0, 4)).toEqual(['welcome', 'lobby_state', 'match_start', 'round_start']);
    expect((await b.next('snapshot', 5000)).players).toHaveLength(2);
    b.send({ type: 'leave_room' });
    expect((await b.next('left_room')).reason).toBe('left');
  });

  it('starts the tutorial sandbox and skips it (no XP, left_room, profile)', async () => {
    const c = await connect();
    await c.hello();
    c.send({ type: 'tutorial_start' });
    expect((await c.next('match_start')).config).toMatchObject({ tutorial: true, w: 11, h: 9 });
    await c.next('round_start');
    expect(await c.next('tutorial_step')).toMatchObject({ step: 1, total: 5, done: false });
    c.send({ type: 'tutorial_skip' });
    expect((await c.next('left_room')).reason).toBe('left');
    const { profile } = await c.next('profile');
    expect(profile).toMatchObject({ tutorialDone: true, xp: 0 });
  });

  it('serves the REST API with no-store JSON and the client with an SPA fallback', async () => {
    const c = await connect();
    const welcome = await c.hello();
    const bad = await http('/api/leaderboard?mode=solo');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad_request' });
    const ok = await http('/api/leaderboard?mode=ffa');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual([]);
    const profile = await http(`/api/profile/${welcome.playerId}`);
    expect(await profile.json()).toMatchObject({ id: welcome.playerId, nickname: welcome.profile.nickname, recentMatches: [] });
    expect((await http('/api/profile/nobody')).status).toBe(404);
    expect((await http('/api/nothing')).status).toBe(404);
    const page = await http('/locker/deep/link');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Splash Critters');
    expect((await http('/index.html')).headers.get('cache-control')).toBe('no-cache');
    expect((await http('/assets/stale-1234.js')).status).toBe(404);
  });
});

describe('per-address admission over real sockets (behind a proxy on loopback)', () => {
  let limited: GameServer;
  let limitedPort: number;
  const from = async (ip: string) => {
    const c = await TestClient.open(limitedPort, { 'X-Forwarded-For': `198.51.100.1, ${ip}` });
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    const admissionLimits = { maxSocketsPerAddress: 2, guestBurst: 1, guestsPerHour: 1 };
    limited = createGameServer({ dataDir: ':memory:', clientDist: clientDir, lagMs: 0, createBot: idleBots, admissionLimits });
    limitedPort = await limited.listen(0, '127.0.0.1');
  });

  afterAll(() => limited.close());

  it('caps sockets and new guests per client address; known tokens and other addresses still get in', async () => {
    const [a1, a2, a3] = [await from('203.0.113.9'), await from('203.0.113.9'), await from('203.0.113.9')];
    expect((await a3.next('error')).code).toBe('rate_limited');
    expect((await a3.closed).code).toBe(1013);
    const first = await a1.hello();
    a2.send({ type: 'hello', v: CONFIG.PROTOCOL_VERSION });
    expect((await a2.next('error')).code).toBe('rate_limited');
    expect((await a2.closed).code).toBe(1013);
    expect((await (await from('203.0.113.77')).hello()).playerId).not.toBe(first.playerId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const back = await from('203.0.113.9');
    expect((await back.hello(first.token)).playerId).toBe(first.playerId);
    const local = await TestClient.open(limitedPort);
    clients.push(local);
    await local.hello();
  });
});

describe('wrong room codes over real sockets (behind a proxy on loopback)', () => {
  const from = async (ip: string) => {
    const c = await TestClient.open(port, { 'X-Forwarded-For': ip });
    clients.push(c);
    await c.hello();
    return c;
  };

  it('stops code lookups for an address that named too many wrong codes, then drops a player who keeps trying', async () => {
    const host = await connect();
    await host.hello();
    host.send({ type: 'create_room', opts: { name: 'Hideout', size: 4, isPublic: false, theme: 'beach', roundsToWin: 3, botFill: false } });
    const { code } = await host.next('room_created');
    const guesser = await from('203.0.113.40');
    const alt = await from('203.0.113.40');
    // Five characters: never a real room code.
    for (let i = 0; i < DEFAULT_ROOM_CODE_LIMITS.missBurst; i++) {
      guesser.send({ type: 'join_room', code: `NOPE${i}` });
      expect((await guesser.next('error')).code).toBe('not_found');
    }
    // Out of budget, even the right code is refused unseen, for every account on the address.
    guesser.send({ type: 'join_room', code });
    expect((await guesser.next('error')).code).toBe('rate_limited');
    alt.send({ type: 'join_room', code });
    expect((await alt.next('error')).code).toBe('rate_limited');
    const friend = await from('198.51.100.41');
    friend.send({ type: 'join_room', code });
    expect((await friend.next('lobby_state')).lobby.code).toBe(code);
    expect([...guesser.types(), ...alt.types()]).not.toContain('lobby_state');
    // Hammering on while refused gets the socket closed.
    for (let i = 1; i < DEFAULT_ROOM_CODE_LIMITS.refusalsBeforeClose; i++) guesser.send({ type: 'join_room', code: `NOPE${i}` });
    expect((await guesser.closed).code).toBe(1008);
  });
});

describe('ranked matchmaking with RANKED_SEPARATE_ADDRESSES on (behind a proxy on loopback)', () => {
  let proxied: GameServer;
  let proxiedPort: number;
  const from = async (ip: string, nickname: string) => {
    const c = await TestClient.open(proxiedPort, { 'X-Forwarded-For': ip });
    clients.push(c);
    await c.hello();
    c.send({ type: 'set_nickname', nickname });
    await c.next('profile');
    return c;
  };

  beforeAll(async () => {
    proxied = createGameServer({ dataDir: ':memory:', clientDist: clientDir, lagMs: 0, createBot: idleBots, rankedSeparateAddresses: true });
    proxiedPort = await proxied.listen(0, '127.0.0.1');
  });

  afterAll(() => proxied.close());

  it('never matches two accounts queued from one address, but matches each with someone else', async () => {
    const main = await from('203.0.113.50', 'Main Account');
    const alt = await from('203.0.113.50', 'Second Account');
    main.send({ type: 'queue_join', mode: 'duel' });
    alt.send({ type: 'queue_join', mode: 'duel' });
    // A status listing both entries comes from a matchmaking pass that ran with both queued.
    let status = await main.next('queue_status');
    while (status.inQueue < 2) status = await main.next('queue_status', CONFIG.MM_TICK_MS + 3000);
    expect(main.types()).not.toContain('match_found');
    expect(alt.types()).not.toContain('match_found');

    const rival = await from('198.51.100.60', 'Rival Account');
    rival.send({ type: 'queue_join', mode: 'duel' });
    const found = await rival.next('match_found', CONFIG.MM_TICK_MS + 3000);
    expect(found.players.map((p) => p.name).sort()).toEqual(['Main Account', 'Rival Account']);
    expect((await main.next('match_found')).roomCode).toBe(found.roomCode);
    expect(alt.types()).not.toContain('match_found');
  });
});
