/**
 * The acceptance criteria, proven end to end against the real server.
 *
 * One express + ws server boots in-process on an ephemeral port over a fresh
 * temp data directory, real 'ws' clients connect to it, and every claim is made
 * about what actually crossed the wire. The one exception is the ranked
 * progression test, which drives a match headlessly the way soak.ts does,
 * because a real ranked duel is first-to-3 with a two minute tide per round and
 * could never fit inside a test.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG,
  Dir,
  Tile,
  levelFromXp,
  tierForRating,
  type CreateRoomOpts,
  type LeaderboardResponse,
  type ProfileResponse,
} from '@splash/shared';
import { finaliseMatch } from '../src/elo.js';
import { Room } from '../src/room.js';
import { bootTestHarness, playMatchWithBots, type TestClient, type TestHarness } from './harness.js';

/** Matchmaking sweeps on CONFIG.MM_TICK_MS, so pairing needs more than a tick. */
const QUEUE_TIMEOUT_MS = 15000;

let harness: TestHarness;

/** Shared by the room browser, match start and input criteria, in that order. */
let host: TestClient;
let guest: TestClient;
let hostId: string;
let guestId: string;
let roomCode: string;

beforeAll(async () => {
  harness = await bootTestHarness();
}, 20000);

afterAll(async () => {
  await harness.stop();
});

// ---------------------------------------------------------------------- 1

it('a fresh client gets a guest account, and its token brings the same one back', async () => {
  const first = await harness.connect('guest-1');
  const welcome = await first.hello();

  expect(welcome.playerId).toBeTruthy();
  expect(welcome.token).toBeTruthy();
  expect(welcome.activeRoom).toBeNull();
  expect(welcome.profile.id).toBe(welcome.playerId);
  expect(welcome.profile.level).toBe(1);
  expect(welcome.profile.xp).toBe(0);
  expect(welcome.profile.nickname).toMatch(/^[A-Za-z]{3,16}$/);
  expect(welcome.profile.tag).toMatch(/^\d{4}$/);
  expect(welcome.profile.unlocks).toContain('animal:frog');
  first.close();

  const returning = await harness.connect('guest-1-again');
  const second = await returning.hello(welcome.token);
  expect(second.playerId).toBe(welcome.playerId);
  expect(second.token).toBe(welcome.token);
  expect(second.profile.nickname).toBe(welcome.profile.nickname);
  expect(second.profile.tag).toBe(welcome.profile.tag);
  returning.close();

  const stranger = await harness.connect('guest-2');
  const other = await stranger.hello('a-token-this-server-never-minted');
  expect(other.playerId).not.toBe(welcome.playerId);
  // An unknown token is not adopted: the server mints a real one instead.
  expect(other.token).not.toBe('a-token-this-server-never-minted');
  stranger.close();
});

// ---------------------------------------------------------------------- 2

it('refuses a too-short or profane nickname and accepts a real one with a tag', async () => {
  const client = await harness.connect('nicknames');
  await client.hello();

  client.send({ t: 'set_nickname', nickname: 'ab' });
  const tooShort = await client.nextMessage('error');
  expect(tooShort.code).toBe('nickname_invalid');
  expect(tooShort.msg).toContain(String(CONFIG.NICKNAME_MIN));

  client.send({ t: 'set_nickname', nickname: 'sh1tstain' });
  const profane = await client.nextMessage('error');
  expect(profane.code).toBe('nickname_invalid');

  client.send({ t: 'set_nickname', nickname: 'Bubble Boss' });
  const update = await client.nextMessage('profile_update');
  expect(update.profile.nickname).toBe('Bubble Boss');
  expect(update.profile.tag).toMatch(/^\d{4}$/);
  expect(Number(update.profile.tag)).toBeGreaterThan(0);
  client.close();
});

// -------------------------------------------------------------------- 2b

/**
 * The very first thing a new player does. This asks for exactly what
 * screens/tutorial.ts asks for, because both the wire validator and Room's own
 * clamp used to reject roundsToWin 1 and leave every fresh account stuck on
 * "loading match" forever.
 */
it('lets the tutorial open its one-round room and reach a live round', async () => {
  const client = await harness.connect('tutorial');
  await client.hello();

  client.send({
    t: 'create_room',
    opts: {
      name: 'Tutorial',
      size: 2,
      isPublic: false,
      theme: 'backyard',
      roundsToWin: CONFIG.TUTORIAL_ROUNDS_TO_WIN,
      botFill: true,
      autoStart: true,
      tutorial: true,
    },
  });

  expect((await client.nextMessage('room_created')).code).toHaveLength(CONFIG.ROOM_CODE_LENGTH);

  const start = await client.nextMessage('match_start');
  expect(start.config.tutorial).toBe(true);
  // Kept, not clamped back to the three the create-room dialog offers.
  expect(start.config.roundsToWin).toBe(CONFIG.TUTORIAL_ROUNDS_TO_WIN);
  expect(start.config.yourSlot).toBeGreaterThanOrEqual(0);
  expect(start.config.players.filter((p) => p.isBot)).toHaveLength(1);

  expect((await client.nextMessage('round_start')).roundNo).toBe(1);
  client.send({ t: 'leave_room' });
  client.close();
}, 15000);

// ---------------------------------------------------------------------- 3

it('shows a public room in the browser with its bots, and joins it by code', async () => {
  host = await harness.connect('host');
  hostId = (await host.hello()).playerId;
  host.send({ t: 'set_nickname', nickname: 'RoomBoss' });
  await host.nextMessage('profile_update');

  const opts: CreateRoomOpts = {
    name: 'Splash Palace',
    size: 4,
    isPublic: true,
    theme: 'beach',
    roundsToWin: 2,
    botFill: false,
  };
  host.send({ t: 'create_room', opts });
  roomCode = (await host.nextMessage('room_created')).code;
  await host.nextMessage('lobby_state');

  for (const slot of [2, 3]) {
    host.send({ t: 'set_slot', slot, kind: 'bot', difficulty: 'hard' });
    await host.nextMessage('lobby_state', (msg) => msg.lobby.slots[slot].kind === 'bot');
  }

  guest = await harness.connect('guest');
  guestId = (await guest.hello()).playerId;
  guest.send({ t: 'set_nickname', nickname: 'TideRider' });
  await guest.nextMessage('profile_update');

  guest.send({ t: 'room_list_request' });
  const listed = (await guest.nextMessage('room_list')).rooms.find((r) => r.code === roomCode);
  expect(listed).toBeDefined();
  expect(listed?.name).toBe('Splash Palace');
  expect(listed?.mode).toBe('ffa');
  expect(listed?.players).toBe(3);
  expect(listed?.maxPlayers).toBe(4);
  expect(listed?.hostName).toBe('RoomBoss');
  expect(listed?.inProgress).toBe(false);

  guest.send({ t: 'join_room', code: roomCode });
  for (const client of [host, guest]) {
    const seated = await client.nextMessage(
      'lobby_state',
      (msg) => msg.lobby.slots.filter((s) => s.kind === 'human').length === 2,
    );
    const humans = seated.lobby.slots.filter((s) => s.kind === 'human');
    const bots = seated.lobby.slots.filter((s) => s.kind === 'bot');
    expect(humans.map((s) => s.playerId)).toEqual([hostId, guestId]);
    expect(humans.map((s) => s.nickname)).toEqual(['RoomBoss', 'TideRider']);
    expect(bots).toHaveLength(2);
    expect(bots.map((s) => s.difficulty)).toEqual(['hard', 'hard']);
    expect(seated.lobby.hostSlot).toBe(0);
    expect(seated.lobby.code).toBe(roomCode);
  }
});

// ---------------------------------------------------------------------- 4

it('starts the match with the right roster and a castle grid free of hidden power-ups', async () => {
  host.send({ t: 'start_match' });
  const hostStart = await host.nextMessage('match_start');
  const guestStart = await guest.nextMessage('match_start');

  expect(hostStart.config.matchId).toBe(guestStart.config.matchId);
  expect(hostStart.config.yourSlot).toBe(0);
  expect(guestStart.config.yourSlot).toBe(1);
  expect(hostStart.config.mode).toBe('ffa');
  expect(hostStart.config.ranked).toBe(false);
  expect(hostStart.config.roundsToWin).toBe(2);
  expect(hostStart.config.players.map((p) => p.playerId)).toEqual([hostId, guestId, null, null]);
  expect(hostStart.config.players.map((p) => p.isBot)).toEqual([false, false, true, true]);
  expect(hostStart.config.players.map((p) => p.nickname).slice(0, 2)).toEqual([
    'RoomBoss',
    'TideRider',
  ]);

  const round = await host.nextMessage('round_start');
  expect(round.roundNo).toBe(1);
  expect(round.theme).toBe('beach');
  expect(round.scores).toEqual([0, 0, 0, 0]);
  expect(round.castleGrid).toHaveLength(hostStart.config.width * hostStart.config.height);

  // The anti-datamining guarantee: tiles only, and no field that could carry
  // what a castle is hiding.
  const tiles = new Set<number>([Tile.EMPTY, Tile.BOULDER, Tile.CASTLE, Tile.WATER]);
  expect(round.castleGrid.filter((value) => !tiles.has(value))).toEqual([]);
  expect(round.castleGrid).toContain(Tile.CASTLE);
  expect(Object.keys(round).sort()).toEqual(
    ['castleGrid', 'countdownTicks', 'roundNo', 'scores', 'startTick', 't', 'theme'].sort(),
  );
  // The generation seed rolls the hidden contents in a second pass, so shipping
  // it would be the same leak by another name.
  expect(Object.keys(round)).not.toContain('mapSeed');

  const snapshot = await host.nextMessage('snapshot');
  expect(snapshot.players).toHaveLength(4);
  expect(snapshot.phase).toBe('countdown');
});

// ---------------------------------------------------------------------- 5

it('accepts inputs and advances the acknowledgement to the highest sequence sent', async () => {
  const highest = 5;
  for (let seq = 1; seq <= highest; seq++) {
    guest.send({ t: 'input', seq, tick: seq, dir: Dir.RIGHT, balloonPressed: false });
  }

  const acked = await guest.nextMessage('snapshot', (msg) => msg.ack >= highest);
  // The server can never acknowledge a sequence nobody sent.
  expect(acked.ack).toBe(highest);
});

// ---------------------------------------------------------------------- 6

it('never crashes or acts on malformed, unknown, out-of-range or unauthenticated messages', async () => {
  const attacker = await harness.connect('attacker');

  // Nothing at all is accepted before hello.
  attacker.send({ t: 'room_list_request' });
  expect((await attacker.nextMessage('error')).code).toBe('not_authenticated');

  await attacker.hello();

  attacker.sendRaw('{ this is not json at all');
  expect((await attacker.nextMessage('error')).code).toBe('bad_message');

  attacker.sendJson({ t: 'definitely_not_a_real_message' });
  const unknown = await attacker.nextMessage('error');
  expect(unknown.code).toBe('bad_message');
  expect(unknown.msg).toContain('definitely_not_a_real_message');

  // A dir outside DirValue and a non-numeric seq are clamped, never obeyed, and
  // an input from someone who is in no match at all simply does nothing.
  attacker.sendJson({ t: 'input', seq: 9, tick: 1, dir: 99, balloonPressed: true });
  attacker.sendJson({ t: 'input', seq: 'nine', tick: 'ten', dir: -3, balloonPressed: 'yes' });
  attacker.sendJson({ t: 'input', seq: Number.NaN, tick: 1, dir: 2, balloonPressed: false });

  // Same socket, ordinary request: the server is alive and answering.
  attacker.send({ t: 'room_list_request' });
  const list = await attacker.nextMessage('room_list');
  expect(Array.isArray(list.rooms)).toBe(true);
  expect(attacker.buffered('error')).toEqual([]);

  const health = await fetch(`${harness.server.url}/health`);
  expect(health.status).toBe(200);
  expect(harness.server.hub.connectionCount()).toBeGreaterThan(0);
  attacker.close();

  // The server never accepts a client-supplied position: the only movement
  // fields that exist on the wire are dir and balloonPressed.
  const guards = readFileSync(new URL('../src/protocolGuards.ts', import.meta.url), 'utf8');
  const validator = /input:\s*\(body\)\s*=>\s*\(\{([\s\S]*?)\}\),/.exec(guards);
  expect(validator).not.toBeNull();
  const parsedFields = [...(validator?.[1] ?? '').matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  expect(parsedFields.sort()).toEqual(['balloonPressed', 'dir', 'seq', 't', 'tick']);

  const handlers = readFileSync(new URL('../src/handlers.ts', import.meta.url), 'utf8');
  const onInput = /function onInput\([\s\S]*?\n\}/.exec(handlers);
  expect(onInput).not.toBeNull();
  const used = [...(onInput?.[0] ?? '').matchAll(/\bmsg\.(\w+)/g)].map((m) => m[1]);
  expect([...new Set(used)].sort()).toEqual(['balloonPressed', 'dir', 'seq', 'tick']);
});

// ---------------------------------------------------------------------- 7

it('rate limits a flood and then closes the socket on it', async () => {
  const flooder = await harness.connect('flooder');
  await flooder.hello();

  // Comfortably past both the per-second allowance and the violation budget.
  const burst = CONFIG.MAX_MSGS_PER_SEC + CONFIG.MAX_RATE_VIOLATIONS + 40;
  for (let i = 0; i < burst; i++) flooder.sendJson({ t: 'room_list_request' });

  const limited = await flooder.nextMessage('error', (msg) => msg.code === 'rate_limited');
  expect(limited.msg).toBe('Slow down.');

  const closed = await flooder.waitForClose();
  expect(closed.code).toBe(4029);
});

// ---------------------------------------------------------------------- 8

it('pairs two queued players into one ranked duel', async () => {
  const one = await harness.connect('ranked-one');
  const two = await harness.connect('ranked-two');
  await one.hello();
  await two.hello();

  one.send({ t: 'set_nickname', nickname: 'DuelistOne' });
  await one.nextMessage('profile_update');
  two.send({ t: 'set_nickname', nickname: 'DuelistTwo' });
  await two.nextMessage('profile_update');

  one.send({ t: 'queue_join', mode: 'duel' });
  two.send({ t: 'queue_join', mode: 'duel' });

  const foundOne = await one.nextMessage('match_found', undefined, QUEUE_TIMEOUT_MS);
  const foundTwo = await two.nextMessage('match_found', undefined, QUEUE_TIMEOUT_MS);
  expect(foundOne.code).toBe(foundTwo.code);
  expect(foundOne.mode).toBe('duel');
  expect(foundTwo.mode).toBe('duel');

  const startOne = await one.nextMessage('match_start');
  const startTwo = await two.nextMessage('match_start');
  expect(startOne.config.ranked).toBe(true);
  expect(startTwo.config.ranked).toBe(true);
  expect(startOne.config.matchId).toBe(startTwo.config.matchId);
  expect(startOne.config.mode).toBe('duel');
  expect(startOne.config.players).toHaveLength(2);
  expect(startOne.config.yourSlot).not.toBe(startTwo.config.yourSlot);

  // Walk out rather than play it out: leaving a ranked room forfeits, which
  // also stops this match ticking underneath the rest of the file.
  one.send({ t: 'leave_room' });
  two.send({ t: 'leave_room' });
  one.close();
  two.close();
}, QUEUE_TIMEOUT_MS + 10000);

// ---------------------------------------------------------------------- 9

it('persists ratings, XP and history from a finished ranked duel, and surfaces them', async () => {
  const players = harness.server.players;
  const alpha = players.authenticate().record;
  const beta = players.authenticate().record;
  expect(players.getRating(alpha.id, 'duel').rating).toBe(CONFIG.ELO_START);
  expect(players.getRating(beta.id, 'duel').rating).toBe(CONFIG.ELO_START);

  const room = new Room(
    'E2ERNK',
    {
      name: 'Ranked Duel',
      size: 2,
      isPublic: false,
      theme: 'random',
      roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
      botFill: false,
    },
    true,
    null,
  );
  expect(room.addHuman(alpha.id)).toBe(0);
  expect(room.addHuman(beta.id)).toBe(1);

  // A drawn duel would rate nobody, so replay until the bots decide one. Only
  // the decisive match is ever finalised, so the accounts stay pristine.
  let played = playMatchWithBots(room, players);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (played.results[0].placement !== played.results[1].placement) break;
    played = playMatchWithBots(room, players);
  }
  const results = played.results;
  expect(played.runner.finished).toBe(true);
  expect(results.map((r) => r.placement)).toEqual([1, 2]);

  const winnerId = results[0].playerId as string;
  const loserId = results[1].playerId as string;
  expect([alpha.id, beta.id].sort()).toEqual([winnerId, loserId].sort());

  const end = finaliseMatch(players, room, results, played.runner.startedAt);
  expect(end.ranked).toBe(true);
  expect(end.rematchEnabled).toBe(false);
  expect(end.placements).toHaveLength(2);

  // ---- ratings moved, symmetrically, off the provisional K
  const step = CONFIG.ELO_K_PROVISIONAL / 2;
  const winnerRating = players.getRating(winnerId, 'duel');
  const loserRating = players.getRating(loserId, 'duel');
  expect(winnerRating.rating).toBe(CONFIG.ELO_START + step);
  expect(loserRating.rating).toBe(CONFIG.ELO_START - step);
  expect(winnerRating.rating - CONFIG.ELO_START).toBe(CONFIG.ELO_START - loserRating.rating);
  expect(winnerRating.games).toBe(1);
  expect(winnerRating.wins).toBe(1);
  expect(winnerRating.peak).toBe(winnerRating.rating);
  expect(loserRating.games).toBe(1);
  expect(loserRating.wins).toBe(0);
  expect(loserRating.peak).toBe(loserRating.rating);

  // ---- XP landed on both accounts and the level agrees with it
  for (const placement of end.placements) {
    const id = placement.playerId as string;
    expect(placement.xpEarned).toBeGreaterThan(0);
    const profile = players.getProfile(id);
    expect(profile).not.toBeNull();
    expect(profile?.xp).toBe(placement.xpEarned);
    expect(profile?.level).toBe(levelFromXp(placement.xpEarned).level);
  }

  // ---- one match row, two match_players rows
  const matchRow = harness.server.db
    .prepare<[string], { id: string; mode: string; ranked: number }>(
      'SELECT id, mode, ranked FROM matches WHERE id = ?',
    )
    .get(end.matchId);
  expect(matchRow?.mode).toBe('duel');
  expect(matchRow?.ranked).toBe(1);

  const playerRows = harness.server.db
    .prepare<[string], { player_id: string; placement: number; rating_after: number | null }>(
      'SELECT player_id, placement, rating_after FROM match_players WHERE match_id = ? ORDER BY placement',
    )
    .all(end.matchId);
  expect(playerRows.map((row) => row.player_id)).toEqual([winnerId, loserId]);
  expect(playerRows.map((row) => row.rating_after)).toEqual([
    winnerRating.rating,
    loserRating.rating,
  ]);
  expect(players.getRecentMatches(winnerId, 10)).toHaveLength(1);

  // ---- and the leaderboard says the same thing over real HTTP
  const response = await fetch(`${harness.server.url}/api/leaderboard?mode=duel`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as LeaderboardResponse;
  expect(body.mode).toBe('duel');

  const winnerRow = body.rows.find((row) => row.playerId === winnerId);
  const loserRow = body.rows.find((row) => row.playerId === loserId);
  expect(winnerRow).toBeDefined();
  expect(loserRow).toBeDefined();
  expect(winnerRow?.rating).toBe(winnerRating.rating);
  expect(loserRow?.rating).toBe(loserRating.rating);
  expect(winnerRow?.tier).toBe(tierForRating(winnerRating.rating).id);
  expect(loserRow?.tier).toBe(tierForRating(loserRating.rating).id);
  expect(winnerRow?.winrate).toBe(1);
  expect(loserRow?.winrate).toBe(0);
  expect(body.rows.indexOf(winnerRow!)).toBeLessThan(body.rows.indexOf(loserRow!));
  expect(winnerRow!.rank).toBeLessThan(loserRow!.rank);

  const ratings = body.rows.map((row) => row.rating);
  expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
  expect(body.rows.map((row) => row.rank)).toEqual(body.rows.map((_row, index) => index + 1));
}, 60000);

// ---------------------------------------------------------------------- 10

describe('the REST surface', () => {
  it('answers /health and serves or refuses a profile by id', async () => {
    const health = await fetch(`${harness.server.url}/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok: boolean; rooms: number; clients: number };
    expect(healthBody.ok).toBe(true);
    expect(typeof healthBody.rooms).toBe('number');
    expect(typeof healthBody.clients).toBe('number');

    const known = await fetch(`${harness.server.url}/api/profile/${hostId}`);
    expect(known.status).toBe(200);
    const profileBody = (await known.json()) as ProfileResponse;
    expect(profileBody.profile.id).toBe(hostId);
    expect(profileBody.profile.nickname).toBe('RoomBoss');
    expect(Array.isArray(profileBody.recentMatches)).toBe(true);

    const missing = await fetch(`${harness.server.url}/api/profile/no-such-player`);
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { error: string }).toEqual({ error: 'no such player' });
  });
});
