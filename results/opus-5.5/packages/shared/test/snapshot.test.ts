import { describe, expect, it } from 'vitest';
import { idx } from '../src/grid';
import { movePlayer } from '../src/movement';
import { simulateTick } from '../src/sim';
import { applySnapshotToState, snapshotBody, toPlayerSnap, type SnapshotBody } from '../src/snapshot';
import { activeBalloonCount, cloneState, createRoundState } from '../src/state';
import { Dir, PowerUp, type RoundState } from '../src/types';
import { inp, mapFromAscii, putBalloon, stateFromAscii } from './fixtures';

const ARENA = ['###########', '#...B.....#', '#.#.#.#.#.#', '#0..r..1.2#', '###########'];

/** Server state one tick in: a live splash, a revealed item, a sliding and a resting balloon, a duck. */
function busyServer(): RoundState {
  const s = stateFromAscii(ARENA);
  s.players[0].canKick = true;
  putBalloon(s, 2, 1, 0, { fuse: 1 });
  putBalloon(s, 2, 3, 1);
  putBalloon(s, 6, 3, 1);
  const rider = s.players[2];
  Object.assign(rider, { alive: false, soakedTick: 0, soakedBy: 1, duckPos: 27000, duckCooldownUntil: 150 });
  simulateTick(s, [inp(Dir.Right)]);
  return s;
}

/** A client-side state: same arena, no hidden contents, tiles kept in sync by castle_washed events. */
function clientFor(server: RoundState): RoundState {
  const { map } = mapFromAscii(ARENA);
  const client = createRoundState({ ...map, hidden: new Uint8Array(map.hidden.length) }, [true, true, true], server.rules);
  client.tiles.set(server.tiles);
  return client;
}

function overWire(body: SnapshotBody): SnapshotBody {
  return JSON.parse(JSON.stringify(body)) as SnapshotBody;
}

describe('snapshotBody', () => {
  it('captures the dynamic state of present players, balloons, splashes, items and tide', () => {
    const s = busyServer();
    const body = snapshotBody(s);
    expect(body.tick).toBe(1);
    expect(body.players.map((p) => p.slot)).toEqual([0, 1, 2]);
    expect(body.players[1]).toEqual(toPlayerSnap(s, s.players[1]));
    expect(body.players[1].activeBalloons).toBe(2);
    expect(body.players[2]).toMatchObject({ alive: false, duckPos: 27000, duckCooldownUntil: 150 });
    expect(body.balloons).toEqual(s.balloons);
    expect(body.balloons.find((b) => b.slideDir === Dir.Right)).toBeDefined();
    expect(body.splashes).toEqual(s.splashes);
    expect(body.items).toEqual([
      { x: 4, y: 1, kind: PowerUp.Balloon },
      { x: 4, y: 3, kind: PowerUp.Range },
    ]);
    expect([body.tideLevel, body.nextTideTick]).toEqual([s.tideLevel, s.nextTideTick]);
  });

  it('omits absent slots and shares no references with the state', () => {
    const s = stateFromAscii(ARENA, { present: [true, false, true] });
    putBalloon(s, 5, 1, 0);
    const body = snapshotBody(s);
    expect(body.players.map((p) => p.slot)).toEqual([0, 2]);
    s.balloons[0].x += 100;
    expect(body.balloons[0].x).not.toBe(s.balloons[0].x);
  });
});

describe('applySnapshotToState', () => {
  it('round-trips the dynamic state onto a client RoundState', () => {
    const server = busyServer();
    const client = clientFor(server);
    applySnapshotToState(client, overWire(snapshotBody(server)));

    expect(client.tick).toBe(server.tick);
    for (const p of server.players) expect(toPlayerSnap(client, client.players[p.slot])).toEqual(toPlayerSnap(server, p));
    expect(client.balloons).toEqual(server.balloons);
    expect(client.splashes).toEqual(server.splashes);
    expect(Array.from(client.items)).toEqual(Array.from(server.items));
    expect([client.tideLevel, client.nextTideTick]).toEqual([server.tideLevel, server.nextTideTick]);
    expect(Array.from(client.hidden).every((v) => v === 0)).toBe(true);
    for (let i = 0; i < server.splashUntil.length; i++) {
      const live = server.splashUntil[i] > server.tick;
      expect(client.splashUntil[i] > client.tick).toBe(live);
      if (!live) continue;
      expect(client.splashUntil[i]).toBe(server.splashUntil[i]);
      expect(client.splashOwner[i]).toBe(server.splashOwner[i]);
      expect(client.splashDuck[i]).toBe(server.splashDuck[i]);
    }
    expect(activeBalloonCount(client, 1)).toBe(2);
  });

  it('lets client prediction reproduce server movement', () => {
    const server = busyServer();
    const client = clientFor(server);
    applySnapshotToState(client, overWire(snapshotBody(server)));
    const authority = cloneState(server);
    for (const dir of [Dir.Left, Dir.Left, Dir.Left, Dir.Up, Dir.Right, Dir.Down, Dir.Left, Dir.Left]) {
      movePlayer(authority, authority.players[1], dir, false);
      movePlayer(client, client.players[1], dir, false);
      expect([client.players[1].x, client.players[1].y]).toEqual([authority.players[1].x, authority.players[1].y]);
    }
  });

  it('replaces stale entities and clears stale splash water', () => {
    const server = busyServer();
    const client = clientFor(server);
    putBalloon(client, 8, 1, 0);
    client.splashUntil[idx(client.w, 9, 1)] = 500;
    client.splashOwner[idx(client.w, 9, 1)] = 2;
    client.items[idx(client.w, 1, 1)] = PowerUp.Boots;
    applySnapshotToState(client, overWire(snapshotBody(server)));
    expect(client.balloons.map((b) => b.id)).toEqual(server.balloons.map((b) => b.id));
    expect(client.splashUntil[idx(client.w, 9, 1)]).toBe(0);
    expect(client.splashOwner[idx(client.w, 9, 1)]).toBe(-1);
    expect(client.items[idx(client.w, 1, 1)]).toBe(PowerUp.None);
  });

  it('drops splash water once the snapshot tick passes the splash end', () => {
    const server = busyServer();
    const body = overWire(snapshotBody(server));
    const client = clientFor(server);
    applySnapshotToState(client, { ...body, tick: body.splashes[0].endTick });
    expect(Array.from(client.splashUntil).every((v) => v === 0)).toBe(true);
  });

  it('marks a player missing from the snapshot (left the round) as absent and dry of duck', () => {
    const server = busyServer();
    const client = clientFor(server);
    applySnapshotToState(client, overWire(snapshotBody(server)));
    expect(client.players[2].present).toBe(true);
    server.players[2].present = false; // e.g. a ranked FFA forfeit mid-round
    server.players[2].alive = false;
    applySnapshotToState(client, overWire(snapshotBody(server)));
    expect(client.players[2].present).toBe(false);
    expect(client.players[2].alive).toBe(false);
    expect(client.players[2].duckPos).toBe(-1);
    expect(client.players[0].present).toBe(true);
  });
});
