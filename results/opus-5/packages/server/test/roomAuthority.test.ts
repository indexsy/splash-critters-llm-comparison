/**
 * Who is allowed to do what to a room, proven over real sockets.
 *
 * Each test here reproduces a defect that let somebody act on a room they had
 * no standing in, or mint accounts nobody was counting. The server under test
 * is the real one, booted in-process on an ephemeral port over a throwaway data
 * directory.
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CreateRoomOpts } from '@splash/shared';
import { GUEST_MINTS_PER_ADDRESS } from '../src/guestLimit.js';
import { bootTestHarness, type TestClient, type TestHarness } from './harness.js';

let harness: TestHarness;

const CASUAL_ROOM: CreateRoomOpts = {
  name: 'Splash House',
  size: 4,
  isPublic: true,
  theme: 'backyard',
  roundsToWin: 2,
  botFill: false,
};

interface Seated {
  client: TestClient;
  id: string;
  token: string;
}

beforeAll(async () => {
  harness = await bootTestHarness();
}, 20000);

afterAll(async () => {
  await harness.stop();
});

/** A connected client with an account and a nickname of its own. */
async function seat(label: string, nickname: string): Promise<Seated> {
  const client = await harness.connect(label);
  const welcome = await client.hello();
  client.send({ t: 'set_nickname', nickname });
  await client.nextMessage('profile_update');
  return { client, id: welcome.playerId, token: welcome.token };
}

it('refuses a rematch vote in a lobby, so non-hosts cannot start the match', async () => {
  const host = await seat('rv-host', 'RematchHost');
  host.client.send({ t: 'create_room', opts: CASUAL_ROOM });
  const code = (await host.client.nextMessage('room_created')).code;
  await host.client.nextMessage('lobby_state');

  const two = await seat('rv-two', 'RematchTwo');
  const three = await seat('rv-three', 'RematchThree');
  for (const guest of [two, three]) {
    guest.client.send({ t: 'join_room', code });
    await guest.client.nextMessage('lobby_state', (msg) => msg.lobby.code === code);
  }
  const seated = await host.client.nextMessage(
    'lobby_state',
    (msg) => msg.lobby.slots.filter((s) => s.kind === 'human').length === 3,
  );
  expect(seated.lobby.phase).toBe('lobby');

  // The bug: onRematchVote only rejected a running match, so a majority of the
  // room could reach the threshold in the lobby and hub.startMatch fired,
  // which is exactly what start_match reserves for the host.
  for (const guest of [two, three]) {
    guest.client.send({ t: 'rematch_vote', vote: true });
    const refused = await guest.client.nextMessage('error');
    expect(refused.code).toBe('invalid_option');
  }

  const room = harness.server.rooms.get(code);
  expect(room?.phase).toBe('lobby');
  expect(room?.rematchVotes.size).toBe(0);
  expect(host.client.buffered('match_start')).toEqual([]);

  for (const player of [host, two, three]) player.client.close();
});

it('drops the membership of a player whose seat the host gave away', async () => {
  const host = await seat('ev-host', 'EvictHost');
  host.client.send({ t: 'create_room', opts: CASUAL_ROOM });
  const code = (await host.client.nextMessage('room_created')).code;
  await host.client.nextMessage('lobby_state');

  const ghost = await seat('ev-ghost', 'EvictGhost');
  ghost.client.send({ t: 'join_room', code });
  const seated = await ghost.client.nextMessage('lobby_state', (msg) => msg.lobby.code === code);
  const ghostSlot = seated.lobby.slots.findIndex((s) => s.playerId === ghost.id);
  expect(ghostSlot).toBeGreaterThan(0);

  // Only a disconnected human can be evicted, so drop the tab first.
  ghost.client.dispose();
  await host.client.nextMessage(
    'lobby_state',
    (msg) => msg.lobby.slots[ghostSlot].connected === false,
  );

  host.client.send({ t: 'set_slot', slot: ghostSlot, kind: 'open' });
  await host.client.nextMessage('lobby_state', (msg) => msg.lobby.slots[ghostSlot].kind === 'open');

  // The bug: Room.setSlot only forgot the player room-locally, so the manager
  // still called them a member. They kept a rematch vote, kept the room's idle
  // sweep at bay, and came back to a room with no seat in it.
  expect(harness.server.rooms.roomOfPlayer(ghost.id)).toBeUndefined();

  const back = await harness.connect('ev-ghost-again');
  const welcome = await back.hello(ghost.token);
  expect(welcome.playerId).toBe(ghost.id);
  expect(welcome.activeRoom).toBeNull();

  // ...and nothing they say about that room is heard any more.
  back.send({ t: 'rematch_vote', vote: true });
  const refused = await back.nextMessage('error');
  expect(refused.code).toBe('not_in_room');

  back.close();
  host.client.close();
});

/**
 * Last in the file on purpose: it fills this address's mint budget, which is
 * shared by every socket in the harness.
 */
it('stops one address minting guest accounts without end', async () => {
  const returning = await seat('mint-returning', 'MintReturning');
  returning.client.close();

  // Whatever the loopback looks like to this kernel: the accounts already
  // minted by this file all came from it.
  const limiter = harness.server.hub.guestLimiter;
  const [address] = limiter.addresses();
  expect(address).toBeTypeOf('string');
  while (limiter.countFor(address) < GUEST_MINTS_PER_ADDRESS) limiter.allow(address);
  expect(limiter.countFor(address)).toBe(GUEST_MINTS_PER_ADDRESS);

  // The bug: hello with no token minted a permanent account row every time,
  // with nothing counting them, so one process could drain the finite guest
  // namespace and leave the server unable to greet anybody new at all.
  const fresh = await harness.connect('mint-refused');
  fresh.send({ t: 'hello' });
  const refused = await fresh.nextMessage('error');
  expect(refused.code).toBe('rate_limited');
  fresh.close();

  // A player who already has an account is never held up by the brake.
  const again = await harness.connect('mint-returning-again');
  const welcome = await again.hello(returning.token);
  expect(welcome.playerId).toBe(returning.id);
  again.close();
});
