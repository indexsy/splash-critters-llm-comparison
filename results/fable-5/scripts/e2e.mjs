// End-to-end acceptance test against a real server process.
// Usage: node scripts/e2e.mjs   (starts its own server on :3111, in-memory DB)
//
// Covers:
//  1. Guest auto-creation on hello
//  2. Tab A creates a public 4p room with bots; Tab B finds it in the browser
//     list, joins; a full match completes with results + XP persisted
//  3. Ranked duel queue: matched, forfeit on disconnect, Elo persisted,
//     leaderboard reflects it

import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;
let failures = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ok - ${label}`);
  } else {
    failures++;
    console.error(`  FAIL - ${label}`);
  }
}

class TestClient {
  constructor(label) {
    this.label = label;
    this.msgs = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        this.msgs.push(msg);
        for (const w of [...this.waiters]) {
          if (w.pred(msg)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            w.resolve(msg);
          }
        }
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first (buffered or future) message matching pred. */
  waitFor(type, pred = () => true, timeoutMs = 30000) {
    const full = (m) => m.t === type && pred(m);
    const hit = this.msgs.find(full);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.label}: timeout waiting for ${type}`)),
        timeoutMs
      );
      this.waiters.push({
        pred: full,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  drop() {
    this.ws.close();
  }
}

async function main() {
  console.log("[e2e] starting server...");
  const server = spawn("node", ["packages/server/dist/server/src/index.js"], {
    env: { ...process.env, PORT: String(PORT), SPLASH_DB: ":memory:" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
  await new Promise((r) => setTimeout(r, 1200));

  try {
    // --- 0. HTTP surface ---
    console.log("[e2e] http checks");
    const health = await fetch(`${BASE}/health`).then((r) => r.json());
    assert(health.ok === true, "/health responds ok");
    const index = await fetch(`${BASE}/`).then((r) => r.text());
    assert(index.includes("<canvas"), "built client index.html served on / (not the fallback page)");

    // --- 1. Guest accounts ---
    console.log("[e2e] guest accounts");
    const A = new TestClient("A");
    await A.connect();
    A.send({ t: "hello" });
    const welcomeA = await A.waitFor("welcome");
    assert(/#\d{4}/.test(welcomeA.profile.nickname + welcomeA.profile.tag), "guest name like SoggyOtter#1234");
    assert(welcomeA.token.length >= 8, "token issued");

    const B = new TestClient("B");
    await B.connect();
    B.send({ t: "hello" });
    const welcomeB = await B.waitFor("welcome");
    assert(welcomeB.profile.playerId !== welcomeA.profile.playerId, "two tabs = two distinct guests");

    // --- 2. Casual room flow: A creates 4p public room + 2 bots, B joins ---
    console.log("[e2e] casual room with bots (this plays a REAL match, takes a few minutes)");
    A.send({
      t: "create_room",
      opts: { name: "E2E Arena", mode: "ffa", isPublic: true, theme: "beach", roundsToWin: 2, botFill: false },
    });
    const created = await A.waitFor("room_created");
    A.send({ t: "set_slot", slot: 1, kind: "bot", difficulty: "hard" });
    A.send({ t: "set_slot", slot: 2, kind: "bot", difficulty: "easy" });
    await A.waitFor("lobby_state", (m) => m.slots.filter((s) => s.kind === "bot").length === 2);

    B.send({ t: "room_list_request" });
    const list = await B.waitFor("room_list", (m) => m.rooms.length > 0);
    const room = list.rooms.find((r) => r.code === created.code);
    assert(!!room, "B sees A's room in the public browser list");
    assert(room?.players === 3 && room?.maxPlayers === 4, "room shows 3/4 players");

    B.send({ t: "join_room", code: created.code });
    await B.waitFor("lobby_state", (m) => m.slots.filter((s) => s.kind === "human").length === 2);
    B.send({ t: "set_ready", ready: true });
    await A.waitFor("lobby_state", (m) => m.slots.some((s) => s.kind === "human" && s.ready && s.playerId === welcomeB.profile.playerId));
    A.send({ t: "start_match" });

    const startA = await A.waitFor("match_start");
    await B.waitFor("match_start");
    assert(startA.players.length === 4, "match has 4 seats");
    assert(startA.players.filter((p) => p.isBot).length === 2, "2 bot seats");
    await A.waitFor("round_start");
    await A.waitFor("snapshot");
    assert(true, "snapshots flowing");

    // humans wiggle a little, then idle; bots decide the match
    let seq = 0;
    const wiggle = setInterval(() => {
      const dir = [1, 2, 3, 4][seq % 4];
      A.send({ t: "input", seq: ++seq, tick: 0, dir, balloon: false });
      B.send({ t: "input", seq, tick: 0, dir: 0, balloon: false });
    }, 66);

    const end = await A.waitFor("match_end", () => true, 10 * 60_000);
    clearInterval(wiggle);
    await B.waitFor("match_end");
    assert(end.players.length === 4, "match_end covers all 4 players");
    const placements = end.players.map((p) => p.placement).sort();
    assert(placements[0] === 1, "someone placed 1st");
    const aRow = end.players.find((p) => p.playerId === welcomeA.profile.playerId);
    assert(aRow.xpEarned > 0, `human A earned XP (${aRow.xpEarned})`);
    assert(end.rematchAvailable === true, "casual match offers rematch");

    const profA = await fetch(`${BASE}/api/profile/${welcomeA.profile.playerId}`).then((r) => r.json());
    assert(profA.recentMatches.length === 1, "match persisted to A's profile");
    assert(profA.xp === aRow.xpEarned, `XP persisted (${profA.xp})`);

    A.send({ t: "leave_room" });
    B.send({ t: "leave_room" });

    // --- 3. Ranked duel: queue, match, forfeit, Elo ---
    console.log("[e2e] ranked duel queue + forfeit (waits out the 15s grace)");
    A.send({ t: "queue_join", mode: "duel" });
    const err = await A.waitFor("error", (m) => m.code === "nickname_required", 5000);
    assert(!!err, "ranked requires a nickname");

    A.send({ t: "set_nickname", nickname: "TestAce" });
    await A.waitFor("nickname_result", (m) => m.ok);
    B.send({ t: "set_nickname", nickname: "TestBrook" });
    await B.waitFor("nickname_result", (m) => m.ok);

    A.send({ t: "queue_join", mode: "duel" });
    const qs = await A.waitFor("queue_status");
    assert(qs.searchRange >= 100, "queue status reports search range");
    B.send({ t: "queue_join", mode: "duel" });

    await A.waitFor("match_found", () => true, 10000);
    const rankedStart = await A.waitFor("match_start", (m) => m.ranked);
    assert(rankedStart.players.every((p) => !p.isBot), "ranked match is humans only");
    assert(rankedStart.players.every((p) => p.rating === 1000), "fresh ratings are 1000");

    B.drop(); // rage quit → 15s grace → forfeit
    const rankedEnd = await A.waitFor("match_end", (m) => m.ranked, 40_000);
    const aRanked = rankedEnd.players.find((p) => p.playerId === welcomeA.profile.playerId);
    const bRanked = rankedEnd.players.find((p) => p.playerId === welcomeB.profile.playerId);
    assert(aRanked.placement === 1, "A credited the win on forfeit");
    assert(bRanked.placement === 2, "leaver takes the loss");
    assert(aRanked.ratingAfter === 1032, `A rating 1000 -> 1032 (K=64) [got ${aRanked.ratingAfter}]`);
    assert(bRanked.ratingAfter === 968, `B rating 1000 -> 968 [got ${bRanked.ratingAfter}]`);

    const lb = await fetch(`${BASE}/api/leaderboard?mode=duel`).then((r) => r.json());
    assert(lb.rows[0]?.nickname.startsWith("TestAce"), "leaderboard #1 is TestAce");
    assert(lb.rows[0]?.rating === 1032, "leaderboard shows updated rating");

    A.drop();
  } catch (err) {
    failures++;
    console.error(`[e2e] ERROR: ${err.message}`);
  } finally {
    server.kill();
  }

  console.log(failures === 0 ? "\n[e2e] ALL PASS" : `\n[e2e] ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
