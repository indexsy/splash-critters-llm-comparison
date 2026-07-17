import WebSocket from 'ws';
import http from 'node:http';

const URL = process.env.WS_URL ?? 'ws://localhost:3000/ws';
const HTTP = process.env.HTTP_URL ?? 'http://localhost:3000';

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function api(path) {
  return new Promise((resolve, reject) => {
    http.get(HTTP + path, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.profile = null;
    this.token = null;
    this.playerId = null;
    this.matchConfig = null;
    this.latestSnapshot = null;
    this.ws = new WebSocket(URL);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.t === 'ping') {
        this.send({ t: 'pong', t0: msg.t0 });
        return;
      }
      if (msg.t === 'welcome') {
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.profile = msg.profile;
      }
      if (msg.t === 'profile') this.profile = msg.profile;
      if (msg.t === 'match_start') this.matchConfig = msg.config;
      if (msg.t === 'snapshot') this.latestSnapshot = msg.s;
      this.msgs.push(msg);
      this.waiters = this.waiters.filter((w) => !w(msg));
      (this.listeners[msg.t] ?? []).forEach((fn) => fn(msg));
    });
    this.ready = new Promise((res) => this.ws.on('open', res));
  }
  listeners = {};
  on(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  waitFor(type, timeoutMs = 15000, pred = () => true) {
    return new Promise((resolve, reject) => {
      const existing = this.msgs.find((m) => m.t === type && pred(m));
      if (existing) return resolve(existing);
      const to = setTimeout(() => reject(new Error(`${this.name}: timeout waiting for ${type}`)), timeoutMs);
      this.waiters.push((msg) => {
        if (msg.t === type && pred(msg)) {
          clearTimeout(to);
          resolve(msg);
          return true;
        }
        return false;
      });
    });
  }
  async hello(nick) {
    await this.ready;
    this.send({ t: 'hello' });
    await this.waitFor('welcome');
    if (nick) {
      this.send({ t: 'set_nickname', nickname: nick });
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function casualTest() {
  console.log('[e2e] CASUAL: public 4p room, 2 humans + 2 hard bots');
  const A = new Client('A');
  await A.hello('AlphaTester');
  const B = new Client('B');
  await B.hello('BetaTester');

  A.send({ t: 'create_room', opts: { name: 'E2E Test', size: 4, isPublic: true, theme: 'random', roundsToWin: 2, botFill: true } });
  const created = await A.waitFor('room_created');
  const code = created.code;
  assert(code && code.length === 6, `room created with code ${code}`);
  await A.waitFor('lobby_state');

  B.send({ t: 'room_list_request' });
  const list = await B.waitFor('room_list');
  assert(list.rooms.some((r) => r.code === code), 'room visible in public browser');

  B.send({ t: 'join_room', code });
  const lobby = await B.waitFor('lobby_state', 5000, (m) => m.lobby.slots.filter((s) => s.kind === 'human').length === 2);
  assert(lobby.lobby.slots[1].nickname === 'BetaTester', 'B joined slot 1');

  A.send({ t: 'set_slot', slot: 2, kind: 'bot', difficulty: 'hard' });
  A.send({ t: 'set_slot', slot: 3, kind: 'bot', difficulty: 'hard' });
  await A.waitFor('lobby_state', 5000, (m) => m.lobby.slots.filter((s) => s.kind === 'bot').length === 2);

  A.send({ t: 'start_match' });
  const ms = await B.waitFor('match_start');
  assert(ms.config.players.length === 4, 'match started with 4 players');
  await B.waitFor('round_start');
  assert(true, 'round_start received');

  const end = await B.waitFor('match_end', 600000);
  assert(end.placements.length === 4, 'match_end with 4 placements');
  assert(end.placements.some((p) => p.placement === 1), 'has a winner');
  assert((end.xp[B.playerId] ?? 0) > 0, `B earned XP (${end.xp[B.playerId]})`);
  assert(end.rematch === true, 'rematch allowed in casual');
  console.log('  placements:', end.placements.map((p) => `${p.placement}:${p.nickname}(${p.roundWins}r ${p.soaks}s)`).join(' '));

  const prof = await api(`/api/profile/${B.playerId}`);
  assert(prof.xp > 0, `profile XP persisted (${prof.xp})`);
  assert(prof.recentMatches.length >= 1, 'recent match recorded');

  A.close();
  B.close();
}

async function rankedTest() {
  console.log('[e2e] RANKED DUEL: two humans queue, match, ratings update');
  const C = new Client('C');
  await C.hello('CharlieRank');
  const D = new Client('D');
  await D.hello('DeltaRank');

  C.send({ t: 'queue_join', mode: 'duel' });
  D.send({ t: 'queue_join', mode: 'duel' });
  const mfC = await C.waitFor('match_found', 20000);
  assert(mfC.ranked === true, 'C matched');
  await D.waitFor('match_found', 20000);
  const ms = await C.waitFor('match_start');
  assert(ms.config.ranked === true && ms.config.players.length === 2, 'ranked duel match_start');
  assert(ms.config.players.every((p) => !p.isBot), 'no bots in ranked');

  const rs = await C.waitFor('round_start');
  const W = 13, H = 11;
  let grid = rs.castleGrid.length ? [...rs.castleGrid] : new Array(W * H).fill(0);
  C.on('round_start', (m) => {
    if (m.castleGrid.length) grid = [...m.castleGrid];
  });
  const mySlot = ms.config.players.find((p) => p.playerId === C.playerId).slot;
  let seq = 0;

  const passable = (x, y, balloons) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (grid[y * W + x] !== 0) return false;
    return !balloons.some((b) => b.tx === x && b.ty === y);
  };
  const bfsPath = (sx, sy, tx, ty, balloons) => {
    const prev = new Map();
    const q = [[sx, sy]];
    prev.set(sy * W + sx, null);
    while (q.length) {
      const [cx, cy] = q.shift();
      if (cx === tx && cy === ty) {
        const path = [];
        let cur = cy * W + cx;
        while (prev.get(cur) !== null && prev.get(cur) !== undefined) {
          path.unshift({ x: cur % W, y: Math.floor(cur / W) });
          cur = prev.get(cur);
        }
        return path;
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        const idx = ny * W + nx;
        if (prev.has(idx) || !passable(nx, ny, balloons)) continue;
        prev.set(idx, cy * W + cx);
        q.push([nx, ny]);
      }
    }
    return null;
  };

  const chaser = setInterval(() => {
    const s = C.latestSnapshot;
    if (!s) return;
    for (const d of s.destroyedCastles) grid[d] = 0;
    const me = s.players[mySlot];
    if (!me || !me.alive) return;
    const mtx = Math.floor(me.x), mty = Math.floor(me.y);
    const ringDepth = (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y);
    let target = null;
    let bestDepth = -1;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!passable(x, y, s.balloons)) continue;
        const d = ringDepth(x, y);
        if (d > s.tideRing && d > bestDepth && bfsPath(mtx, mty, x, y, s.balloons)) {
          bestDepth = d;
          target = { x, y };
        }
      }
    }
    let dir = 0;
    if (target && (mtx !== target.x || mty !== target.y)) {
      const path = bfsPath(mtx, mty, target.x, target.y, s.balloons);
      if (path && path.length > 0) {
        const n = path[0];
        if (n.x > mtx) dir = 2; else if (n.x < mtx) dir = 4; else if (n.y > mty) dir = 3; else dir = 1;
      }
    }
    C.send({ t: 'input', seq: ++seq, dir, balloon: false });
  }, 150);

  const end = await C.waitFor('match_end', 540000);
  clearInterval(chaser);
  assert(end.rematch === false, 'no rematch in ranked');
  const deltas = end.ratingDeltas;
  const winner = end.placements.find((p) => p.placement === 1);
  const loser = end.placements.find((p) => p.placement === 2);
  assert((deltas[winner.playerId] ?? 0) > 0, `winner gained rating (+${deltas[winner.playerId]})`);
  assert((deltas[loser.playerId] ?? 0) < 0, `loser lost rating (${deltas[loser.playerId]})`);
  console.log('  placements:', end.placements.map((p) => `${p.placement}:${p.nickname} ${p.ratingBefore}→${p.ratingAfter}`).join(' '));

  const lb = await api('/api/leaderboard?mode=duel');
  assert(lb.entries.length === 2, 'leaderboard has both players');
  assert(lb.entries[0].playerId === winner.playerId, 'leaderboard ordered correctly');

  C.close();
  D.close();
}

const which = process.argv[2] ?? 'all';
try {
  const health = await api('/health');
  assert(health.ok === true, 'health endpoint');
  if (which === 'all' || which === 'casual') await casualTest();
  if (which === 'all' || which === 'ranked') await rankedTest();
} catch (e) {
  failures++;
  console.error('[e2e] ERROR:', e?.stack ?? e?.message ?? String(e));
}
console.log(failures === 0 ? '[e2e] ALL PASS' : `[e2e] ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
