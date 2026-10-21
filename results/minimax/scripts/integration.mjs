/**
 * End to end test against a running server.
 *
 *   node scripts/integration.mjs [port]
 *
 * It walks through the acceptance criteria:
 *   1. a fresh browser gets a guest account
 *   2. tab A creates a public 4p room with two hard bots
 *   3. tab B finds the room in the browser list, joins, and the match completes
 *   4. two tabs queue ranked duel, the match finishes and the ratings move
 */
import { WebSocket } from 'ws';

const PORT = Number(process.argv[2] ?? 3999);
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;

let failures = 0;

function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

class TestClient {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.profile = null;
    this.playerId = null;
    this.token = null;
    this.room = null;
    this.matchEnd = null;
    this.roundStart = null;
    this.snapshots = 0;
    this.queueStatus = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'hello' }));
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.messages.push(message);
        this.handle(message);
      });
    });
  }

  handle(message) {
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        this.profile = message.profile;
        this.token = message.token;
        break;
      case 'room_created':
      case 'lobby_state':
        this.room = message.room;
        break;
      case 'round_start':
        this.roundStart = message;
        break;
      case 'snapshot':
        this.snapshots += 1;
        break;
      case 'queue_status':
        this.queueStatus = message;
        break;
      case 'match_end':
        this.matchEnd = message;
        break;
      default:
        break;
    }
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, timeout = 30000, label = 'message') {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const found = this.messages.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
          return;
        }
        if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error(`${this.name}: timed out waiting for ${label}`));
        }
      }, 50);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testGuestAccount() {
  console.log('\n[1] fresh browser creates a guest account');
  const client = new TestClient('guest');
  await client.connect();
  const welcome = await client.waitFor((m) => m.t === 'welcome', 10000, 'welcome');
  check('welcome received', !!welcome);
  check('guest id issued', typeof welcome.playerId === 'string' && welcome.playerId.length > 10);
  check('generated nickname', /^[A-Za-z]+$/.test(welcome.profile.nickname), welcome.profile.nickname);
  check('numeric tag', /^\d{4}$/.test(welcome.profile.tag), welcome.profile.tag);
  check('token issued', typeof welcome.token === 'string' && welcome.token.length > 10);
  client.close();
  return client;
}

async function testCasualRoom() {
  console.log('\n[2] public 4p room with two hard bots, joined from the browser list');
  const a = new TestClient('A');
  await a.connect();
  await a.waitFor((m) => m.t === 'welcome', 10000, 'welcome');

  a.send({
    t: 'create_room',
    opts: {
      name: 'Integration Room',
      maxPlayers: 4,
      isPublic: true,
      theme: 'beach',
      roundsToWin: 2,
      botFill: false,
    },
  });
  const created = await a.waitFor((m) => m.t === 'room_created', 10000, 'room_created');
  check('room created', created.room.name === 'Integration Room');
  check('room is public', created.room.isPublic === true);
  check('room code is 6 chars', created.room.code.length === 6, created.room.code);

  a.send({ t: 'set_slot', slot: 1, kind: 'bot', difficulty: 'hard' });
  a.send({ t: 'set_slot', slot: 2, kind: 'bot', difficulty: 'hard' });
  await sleep(200);

  // the second tab finds the room through the public browser
  const b = new TestClient('B');
  await b.connect();
  await b.waitFor((m) => m.t === 'welcome', 10000, 'welcome');
  b.send({ t: 'room_list_request' });
  const list = await b.waitFor((m) => m.t === 'room_list', 10000, 'room_list');
  const found = list.rooms.find((r) => r.code === created.room.code);
  check('room visible in the browser list', !!found);
  check('browser list shows the player count', found && found.players >= 1, JSON.stringify(found));

  b.send({ t: 'join_room', code: created.room.code });
  await b.waitFor((m) => m.t === 'room_created', 10000, 'join room');
  check('second player joined', true);

  a.send({ t: 'start_match' });
  await a.waitFor((m) => m.t === 'round_start', 15000, 'round_start');
  check('match started', a.roundStart !== null);
  await sleep(1500);
  check('snapshots are streaming', a.snapshots > 5, `snapshots=${a.snapshots}`);

  const matchEnd = await a.waitFor((m) => m.t === 'match_end', 300000, 'match_end');
  check('match produced results', matchEnd.placements.length === 4, JSON.stringify(matchEnd.placements.length));
  const xp = matchEnd.xp.find((x) => x.playerId === a.playerId);
  check('xp awarded', !!xp && xp.xp > 0, JSON.stringify(xp));
  check('placement recorded', matchEnd.placements.every((p) => p.placement >= 1 && p.placement <= 4));

  const profile = await fetch(`${BASE}/api/profile/${a.playerId}`).then((r) => r.json());
  check('profile stored in sqlite', profile.id === a.playerId);
  check('profile has xp', profile.xp > 0, `xp=${profile.xp}`);

  a.close();
  b.close();
}

async function testRankedQueue() {
  console.log('\n[3] ranked duel queue, forfeit handling and the leaderboard');
  const a = new TestClient('R1');
  const b = new TestClient('R2');
  await a.connect();
  await b.connect();
  await a.waitFor((m) => m.t === 'welcome', 10000, 'welcome');
  await b.waitFor((m) => m.t === 'welcome', 10000, 'welcome');

  a.send({ t: 'queue_join', mode: 'duel' });
  b.send({ t: 'queue_join', mode: 'duel' });
  await a.waitFor((m) => m.t === 'queue_status', 10000, 'queue_status');
  check('queue status is reported', a.queueStatus && a.queueStatus.searchRange >= 100);

  await a.waitFor((m) => m.t === 'match_found', 30000, 'match_found');
  await a.waitFor((m) => m.t === 'round_start', 20000, 'round_start');
  check('ranked match started', true);

  // the second player drops out - the reconnect grace expires and the match
  // is awarded as a forfeit
  b.close();
  const matchEnd = await a.waitFor((m) => m.t === 'match_end', 40000, 'forfeit match_end');
  const deltas = matchEnd.ratingDeltas;
  check('rating deltas returned', deltas.length === 2, JSON.stringify(deltas));
  const winner = deltas.find((d) => d.playerId === a.playerId);
  const loser = deltas.find((d) => d.playerId !== a.playerId);
  check('winner gained rating', winner && winner.delta > 0, JSON.stringify(winner));
  check('leaver lost rating', loser && loser.delta < 0, JSON.stringify(loser));

  const leaderboard = await fetch(`${BASE}/api/leaderboard?mode=duel`).then((r) => r.json());
  check('leaderboard lists the winner', leaderboard.entries.some((e) => e.playerId === a.playerId));
  const entry = leaderboard.entries.find((e) => e.playerId === a.playerId);
  check('leaderboard shows the new rating', entry && entry.rating === winner.ratingAfter, JSON.stringify(entry));
  check('leaderboard shows the tier', entry && typeof entry.tier === 'string' && entry.tier.length > 0);

  a.close();
}

async function main() {
  console.log(`Splash Critters integration test against ${BASE}`);
  await testGuestAccount();
  await testCasualRoom();
  await testRankedQueue();
  console.log(failures === 0 ? '\nAll integration checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('integration test crashed', err);
  process.exit(1);
});
