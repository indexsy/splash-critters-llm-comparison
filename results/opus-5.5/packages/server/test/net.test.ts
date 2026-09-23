import { describe, expect, it, vi } from 'vitest';
import { CONFIG, mulberry32, type C2S } from '@splash/shared';
import { DelayLine, parseLagMs } from '../src/lag';
import { RateLimiter, createSender, parseClientMessage, type SocketLike } from '../src/net';
import { VALIDATORS } from '../src/net/messages';

const VALID: C2S[] = [
  { type: 'hello', v: 1 },
  { type: 'hello', token: 'abcdefghijklmnop-1234', v: 1 },
  { type: 'set_nickname', nickname: 'Soggy Otter' },
  { type: 'set_cosmetics', animal: 'capybara', hat: 'crown' },
  { type: 'tutorial_start' },
  { type: 'tutorial_skip' },
  { type: 'queue_join', mode: 'ffa' },
  { type: 'queue_leave' },
  { type: 'create_room', opts: { name: 'Pool party', size: 4, isPublic: true, theme: 'random', roundsToWin: 5, botFill: true } },
  {
    type: 'create_room',
    opts: { name: '', size: 2, isPublic: false, theme: 'pool', roundsToWin: 2, botFill: false, practice: true, practiceDifficulty: 'hard' },
  },
  { type: 'join_room', code: 'ABC234' },
  { type: 'room_list_request' },
  { type: 'room_list_request', mode: 'duel' },
  { type: 'room_list_watch', on: true },
  { type: 'leave_room' },
  { type: 'set_slot', slot: 3, kind: 'bot', difficulty: 'easy' },
  { type: 'set_slot', slot: 1, kind: 'closed' },
  { type: 'set_ready', ready: false },
  { type: 'start_match' },
  { type: 'input', seq: 12, tick: 400, dir: 4, balloonPressed: true },
  { type: 'emote', id: 3 },
  { type: 'rematch_vote', yes: true },
  { type: 'pong', t: 1758560000123.5 },
];

describe('parseClientMessage', () => {
  it('accepts every well-formed message type unchanged', () => {
    for (const msg of VALID) expect(parseClientMessage(JSON.stringify(msg))).toEqual(msg);
    expect(new Set(VALID.map((m) => m.type))).toEqual(new Set(Object.keys(VALIDATORS)));
  });

  it('accepts Buffer, ArrayBuffer and fragmented payloads', () => {
    const text = JSON.stringify({ type: 'emote', id: 1 });
    const buf = Buffer.from(text);
    expect(parseClientMessage(buf)).toEqual({ type: 'emote', id: 1 });
    expect(parseClientMessage(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))).toEqual({ type: 'emote', id: 1 });
    expect(parseClientMessage([buf.subarray(0, 5), buf.subarray(5)])).toEqual({ type: 'emote', id: 1 });
  });

  it('drops unknown fields and normalizes strings', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'set_ready', ready: true, extra: 'x', __proto__: { evil: 1 } }))).toEqual({
      type: 'set_ready',
      ready: true,
    });
    expect(parseClientMessage(JSON.stringify({ type: 'join_room', code: '  abc234 ' }))).toEqual({ type: 'join_room', code: 'ABC234' });
    const nick = parseClientMessage(JSON.stringify({ type: 'set_nickname', nickname: '  Big \n\t Frog  ' }));
    expect(nick).toEqual({ type: 'set_nickname', nickname: 'Big Frog' });
    const room = parseClientMessage(
      JSON.stringify({ type: 'create_room', opts: { name: ' My\u0000 room\u202e ', size: 2, isPublic: true, theme: 'beach', roundsToWin: 3, botFill: false } }),
    );
    expect(room).toMatchObject({ opts: { name: 'My room' } });
  });

  it('reads the input balloon flag under its spec name `balloonPressed` only', () => {
    const input = { type: 'input', seq: 3, tick: 90, dir: 1 };
    expect(parseClientMessage(JSON.stringify({ ...input, balloonPressed: true }))).toEqual({ ...input, balloonPressed: true });
    expect(parseClientMessage(JSON.stringify({ ...input, balloon: true }))).toBeNull();
    expect(parseClientMessage(JSON.stringify(input))).toBeNull();
  });

  it.each([
    ['not json', '{type:'],
    ['array', '[]'],
    ['null', 'null'],
    ['no type', '{}'],
    ['unknown type', '{"type":"teleport"}'],
    ['prototype key', '{"type":"__proto__"}'],
    ['inherited key', '{"type":"toString"}'],
    ['hello without version', '{"type":"hello"}'],
    ['hello float version', '{"type":"hello","v":1.5}'],
    ['hello numeric token', '{"type":"hello","v":1,"token":123}'],
    ['hello huge token', JSON.stringify({ type: 'hello', v: 1, token: 'x'.repeat(200) })],
    ['nickname too long', JSON.stringify({ type: 'set_nickname', nickname: 'x'.repeat(40) })],
    ['unknown animal', '{"type":"set_cosmetics","animal":"dragon","hat":"none"}'],
    ['bad mode', '{"type":"queue_join","mode":"solo"}'],
    ['room size 3', '{"type":"create_room","opts":{"name":"","size":3,"isPublic":true,"theme":"beach","roundsToWin":3,"botFill":false}}'],
    ['room name too long', JSON.stringify({ type: 'create_room', opts: { name: 'n'.repeat(30), size: 2, isPublic: true, theme: 'beach', roundsToWin: 3, botFill: false } })],
    ['room missing botFill', '{"type":"create_room","opts":{"name":"","size":2,"isPublic":true,"theme":"beach","roundsToWin":3}}'],
    ['bad practice difficulty', '{"type":"create_room","opts":{"name":"","size":2,"isPublic":true,"theme":"beach","roundsToWin":3,"botFill":false,"practiceDifficulty":"insane"}}'],
    ['rounds 4', '{"type":"create_room","opts":{"name":"","size":2,"isPublic":true,"theme":"beach","roundsToWin":4,"botFill":false}}'],
    ['code not a string', '{"type":"join_room","code":123456}'],
    ['slot 4', '{"type":"set_slot","slot":4,"kind":"open"}'],
    ['slot kind human', '{"type":"set_slot","slot":1,"kind":"human"}'],
    ['ready as string', '{"type":"set_ready","ready":"true"}'],
    ['dir 5', '{"type":"input","seq":1,"tick":1,"dir":5,"balloonPressed":false}'],
    ['negative seq', '{"type":"input","seq":-1,"tick":1,"dir":1,"balloonPressed":false}'],
    ['huge seq', '{"type":"input","seq":9007199254740993,"tick":1,"dir":1,"balloonPressed":false}'],
    ['balloonPressed as 1', '{"type":"input","seq":1,"tick":1,"dir":1,"balloonPressed":1}'],
    ['balloonPressed null beside a valid balloon', '{"type":"input","seq":1,"tick":1,"dir":1,"balloonPressed":null,"balloon":true}'],
    ['legacy balloon as 1', '{"type":"input","seq":1,"tick":1,"dir":1,"balloon":1}'],
    ['emote 4', '{"type":"emote","id":4}'],
    ['pong NaN', '{"type":"pong","t":"NaN"}'],
    ['pong negative', '{"type":"pong","t":-1}'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it('rejects oversized and non-text payloads', () => {
    const big = JSON.stringify({ type: 'set_nickname', nickname: 'a', pad: 'x'.repeat(CONFIG.MAX_MESSAGE_BYTES) });
    expect(parseClientMessage(big)).toBeNull();
    expect(parseClientMessage(42)).toBeNull();
    expect(parseClientMessage(undefined)).toBeNull();
    expect(parseClientMessage({ type: 'leave_room' })).toBeNull();
  });

  it('never throws on random garbage or mutated valid messages', () => {
    const rng = mulberry32(0xfeed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const junk: unknown[] = [null, true, false, 0, -1, 1e308, -0, '', 'x', [], {}, [1, 2], { a: 1 }, 'ABC234', 99999999999];
    for (let i = 0; i < 5000; i++) {
      const base = structuredClone(pick(VALID)) as unknown as Record<string, unknown>;
      const keys = [...Object.keys(base), 'opts', 'v', 'seq', 'type', 'mode', 'code'];
      for (let m = 0; m < 1 + Math.floor(rng() * 3); m++) base[pick(keys)] = pick(junk);
      const text = JSON.stringify(base);
      const variants = [text, text.slice(0, Math.floor(rng() * text.length)), text.replace(/[:,]/, pick(['', '::', '"'])), String.fromCharCode(...Array.from({ length: 40 }, () => Math.floor(rng() * 256)))];
      for (const v of variants) {
        const out = parseClientMessage(v);
        if (out !== null) expect(typeof out.type).toBe('string');
      }
    }
  });
});

describe('RateLimiter', () => {
  it('allows the sustained rate plus a burst, then limits', () => {
    const limiter = new RateLimiter(0);
    let ok = 0;
    for (let i = 0; i < 200; i++) if (limiter.take(0) === 'ok') ok++;
    expect(ok).toBe(CONFIG.RATE_LIMIT_PER_SEC * 2);
    expect(limiter.take(0)).toBe('limited');
  });

  it('never limits a client sending exactly the allowed rate', () => {
    const limiter = new RateLimiter(0);
    const period = 1000 / CONFIG.RATE_LIMIT_PER_SEC;
    for (let i = 0; i < 60 * 30; i++) expect(limiter.take(i * period)).toBe('ok');
  });

  it('reports abuse for a sustained flood but forgives a brief one', () => {
    const brief = new RateLimiter(0);
    for (let i = 0; i < 150; i++) brief.take(0);
    expect(brief.take(10_000)).toBe('ok');

    const flood = new RateLimiter(0);
    let verdict = 'ok';
    let t = 0;
    for (; t < 10_000 && verdict !== 'abuse'; t += 1000 / (CONFIG.RATE_LIMIT_PER_SEC * 3)) verdict = flood.take(t);
    expect(verdict).toBe('abuse');
    expect(t).toBeGreaterThan(1000);
  });
});

describe('DEV_LAG_MS delay line', () => {
  it('parses the env value safely', () => {
    expect(parseLagMs(undefined)).toBe(0);
    expect(parseLagMs('abc')).toBe(0);
    expect(parseLagMs('-5')).toBe(0);
    expect(parseLagMs('150')).toBe(150);
    expect(parseLagMs('99999')).toBe(5000);
  });

  it('runs synchronously without lag and in order after the delay with lag', () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const seen: number[] = [];
      new DelayLine(0).push(() => seen.push(0));
      expect(seen).toEqual([0]);
      const line = new DelayLine(150, () => clock);
      for (let i = 1; i <= 3; i++) line.push(() => seen.push(i));
      clock = 100;
      vi.advanceTimersByTime(100);
      expect(seen).toEqual([0]);
      clock = 150;
      vi.advanceTimersByTime(50);
      expect(seen).toEqual([0, 1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sender closes only after the messages queued before the close (with lag)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const events: string[] = [];
      const socket: SocketLike = {
        readyState: 1,
        bufferedAmount: 0,
        send: (d) => events.push(d),
        close: (code) => events.push(`close ${code}`),
        terminate: () => events.push('terminate'),
      };
      const sender = createSender(socket, 100);
      sender.send({ type: 'error', code: 'bad_version', msg: 'reload' });
      sender.close(1008, 'version');
      expect(events).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(events).toEqual(['{"type":"error","code":"bad_version","msg":"reload"}', 'close 1008']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sender serializes JSON and stops sending once the socket closed', () => {
    const sent: string[] = [];
    const socket: SocketLike & { readyState: number } = {
      readyState: 1,
      bufferedAmount: 0,
      send: (d) => sent.push(d),
      close: () => undefined,
      terminate: () => undefined,
    };
    const sender = createSender(socket, 0);
    sender.send({ type: 'queue_left' });
    socket.readyState = 3;
    sender.send({ type: 'queue_left' });
    expect(sent).toEqual(['{"type":"queue_left"}']);
  });
});
