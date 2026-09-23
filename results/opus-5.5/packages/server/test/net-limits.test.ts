// Connection-level limits: client address resolution behind a proxy, per-address socket and
// guest-account caps, the wrong-room-code budget, outbound backpressure, and the heartbeat that
// detects half-open sockets.
import { describe, expect, it } from 'vitest';
import { CONFIG, type SnapshotMsg } from '@splash/shared';
import { SLOW_PEER_BUFFERED_BYTES, SNAPSHOT_SKIP_BUFFERED_BYTES, createSender, type SocketLike } from '../src/net';
import { addressKey, clientAddress, isInternalAddress, parseProxyHops } from '../src/net/address';
import { Admission } from '../src/net/admission';
import { RoomCodeGuard } from '../src/net/roomCodes';
import { Session } from '../src/session';

const req = (remoteAddress: string, forwardedFor?: string) => ({
  socket: { remoteAddress },
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
});

describe('clientAddress', () => {
  it('uses a public peer as is and ignores forwarded headers it could forge', () => {
    expect(clientAddress(req('203.0.113.7'))).toBe('203.0.113.7');
    expect(clientAddress(req('::ffff:203.0.113.7', '198.51.100.1'))).toBe('203.0.113.7');
  });

  it('behind a proxy on an internal address, takes the entry the proxy appended', () => {
    expect(clientAddress(req('10.0.3.4', '198.51.100.1, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(req('100.64.0.2', '203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(req('fdaa:0:1::3', '2001:db8:aa:bb:1:2:3:4'))).toBe('2001:db8:aa:bb::/64');
  });

  it('with PROXY_HOPS = 2 (a CDN in front of the platform proxy) skips the CDN edge entry', () => {
    expect(clientAddress(req('10.0.3.4', '6.6.6.6, 203.0.113.9, 198.51.100.200'), 2)).toBe('203.0.113.9');
    expect(clientAddress(req('10.0.3.4', '198.51.100.200'), 2)).toBeNull();
    expect([undefined, 'x', '0', '2', '9'].map(parseProxyHops)).toEqual([1, 1, 1, 2, 1]);
  });

  it('never limits clients it cannot tell apart (local development, LAN, no forwarded client)', () => {
    expect(clientAddress(req('127.0.0.1'))).toBeNull();
    expect(clientAddress(req('::1'))).toBeNull();
    expect(clientAddress(req('192.168.1.20'))).toBeNull();
    expect(clientAddress(req('10.0.0.1', 'garbage'))).toBeNull();
    expect(clientAddress(req('10.0.0.1', '203.0.113.9, 172.16.0.8'))).toBeNull();
  });

  it('classifies internal addresses and keys IPv6 by /64', () => {
    for (const ip of ['10.1.2.3', '172.31.0.1', '192.168.0.1', '127.0.0.1', '169.254.1.1', '100.100.0.1', '::1', 'fd00::1', 'fe80::1']) {
      expect(isInternalAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1', '::ffff:1.1.1.1']) expect(isInternalAddress(ip)).toBe(false);
    expect(addressKey('2001:db8::1')).toBe(addressKey('2001:db8:0:0:ffff:1:2:3'));
    expect(addressKey('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('Admission', () => {
  it('caps open sockets per address and frees the slot when one closes', () => {
    const adm = new Admission({ maxSocketsPerAddress: 2, guestBurst: 1, guestsPerHour: 1 });
    expect(adm.openSocket('a')).toBe(true);
    expect(adm.openSocket('a')).toBe(true);
    expect(adm.openSocket('a')).toBe(false);
    expect(adm.openSocket('b')).toBe(true);
    adm.closeSocket('a');
    expect(adm.openSocket('a')).toBe(true);
    for (let i = 0; i < 100; i++) expect(adm.openSocket(null)).toBe(true);
  });

  it('allows a burst of new guests per address, then refills at the hourly rate', () => {
    const adm = new Admission({ maxSocketsPerAddress: 5, guestBurst: 3, guestsPerHour: 6 });
    const t0 = 1_000_000;
    expect([1, 2, 3, 4].map(() => adm.allowGuest('a', t0))).toEqual([true, true, true, false]);
    expect(adm.allowGuest('b', t0)).toBe(true);
    expect(adm.allowGuest('a', t0 + 5 * 60_000)).toBe(false);
    expect(adm.allowGuest('a', t0 + 11 * 60_000)).toBe(true);
    expect(adm.allowGuest('a', t0 + 11 * 60_000)).toBe(false);
    expect(adm.allowGuest(null, t0)).toBe(true);
  });
});

describe('RoomCodeGuard', () => {
  const t0 = 1_000_000;

  it('spends one budget per player and one per address; either spent refuses, then it refills', () => {
    const guard = new RoomCodeGuard({ missBurst: 3, missesPerMinute: 6, refusalsBeforeClose: 10 });
    for (let i = 0; i < 3; i++) {
      expect(guard.admit('p1', 'a', t0)).toBe('ok');
      guard.miss('p1', 'a', t0);
    }
    expect(guard.admit('p1', 'a', t0)).toBe('limited');
    // Another account on the same address shares the address budget; the player budget follows
    // the player to another address or to a client without one.
    expect(guard.admit('p2', 'a', t0)).toBe('limited');
    expect(guard.admit('p1', 'b', t0)).toBe('limited');
    expect(guard.admit('p1', null, t0)).toBe('limited');
    expect(guard.admit('p3', 'b', t0)).toBe('ok');
    expect(guard.admit('p3', null, t0)).toBe('ok');
    // Six a minute: one wrong code is earned back every 10 s.
    expect(guard.admit('p2', 'a', t0 + 9_000)).toBe('limited');
    expect(guard.admit('p2', 'a', t0 + 10_500)).toBe('ok');
    guard.miss('p2', 'a', t0 + 10_500);
    expect(guard.admit('p1', 'a', t0 + 10_500)).toBe('limited');
  });

  it('closes a player who keeps trying while refused; an admitted join or a long pause ends the run', () => {
    const guard = new RoomCodeGuard({ missBurst: 1, missesPerMinute: 0.5, refusalsBeforeClose: 3 });
    guard.miss('p1', null, t0);
    expect([1, 2, 3, 4].map((dt) => guard.admit('p1', null, t0 + dt))).toEqual(['limited', 'limited', 'abuse', 'abuse']);
    // Still out of budget (one code per 2 min), but a minute of quiet starts a new run.
    expect(guard.admit('p1', null, t0 + 70_000)).toBe('limited');
    expect(guard.admit('p1', null, t0 + 120_000)).toBe('ok');
    guard.miss('p1', null, t0 + 120_000);
    expect(guard.admit('p1', null, t0 + 120_001)).toBe('limited');
  });
});

function fakeSocket() {
  const sent: string[] = [];
  const socket = { readyState: 1, bufferedAmount: 0, terminated: false, sent } as SocketLike & { bufferedAmount: number; terminated: boolean; sent: string[] };
  socket.send = (d: string) => void sent.push(d);
  socket.close = () => undefined;
  socket.terminate = () => {
    socket.terminated = true;
    (socket as { readyState: number }).readyState = 3;
  };
  return socket;
}

describe('outbound backpressure', () => {
  const snapshot: SnapshotMsg = { type: 'snapshot', tick: 2, players: [], balloons: [], splashes: [], items: [], tideLevel: 0, nextTideTick: 0, serverTime: 1, ack: 0, pings: [] };

  it('skips snapshots while the peer is behind but still delivers everything else', () => {
    const socket = fakeSocket();
    const sender = createSender(socket, 0);
    socket.bufferedAmount = SNAPSHOT_SKIP_BUFFERED_BYTES + 1;
    sender.send(snapshot);
    sender.send({ type: 'queue_left' });
    expect(socket.sent).toEqual(['{"type":"queue_left"}']);
    socket.bufferedAmount = 0;
    sender.send(snapshot);
    expect(socket.sent).toHaveLength(2);
    expect(socket.terminated).toBe(false);
  });

  it('drops a peer that stopped reading instead of buffering forever', () => {
    const socket = fakeSocket();
    const sender = createSender(socket, 0);
    socket.bufferedAmount = SLOW_PEER_BUFFERED_BYTES + 1;
    sender.send({ type: 'queue_left' });
    expect(socket.terminated).toBe(true);
    expect(socket.sent).toEqual([]);
  });
});

describe('heartbeat', () => {
  it('drops a silent socket after three missed pings and dates the disconnect back to the last message', () => {
    const socket = fakeSocket();
    const t0 = 50_000;
    const session = new Session(socket, t0, 0);
    session.identify('p1', t0);
    session.admit(t0 + 1000);
    let now = t0 + 1000;
    while (session.keepAlive(now) === 'ok') now += 100;
    expect(now - (t0 + 1000)).toBeGreaterThan(CONFIG.PING_INTERVAL_MS * 3);
    expect(now - (t0 + 1000)).toBeLessThanOrEqual(CONFIG.PING_INTERVAL_MS * 3 + 1100);
    expect(session.goneSince(now)).toBe(now);
    session.dropSilent();
    expect(socket.terminated).toBe(true);
    expect(session.goneSince(now)).toBe(t0 + 1000);
  });

  it('allows for DEV_LAG_MS delaying the pings', () => {
    const session = new Session(fakeSocket(), 0, 500);
    session.identify('p1', 0);
    expect(session.keepAlive(CONFIG.PING_INTERVAL_MS * 3 + 1400)).toBe('ok');
  });
});
