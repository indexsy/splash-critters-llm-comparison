import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  CONFIG,
  cloneState,
  simulateTick,
  type ClientMessage,
  type ServerMessage,
  type PlayerInput,
} from "../packages/shared/src/index.js";
import { startServer } from "../packages/server/src/index.js";
import { BotController } from "../packages/server/src/bots/bot.js";

const dir = mkdtempSync(path.join(tmpdir(), "splash-integration-"));
const server = await startServer({ port: 0, dataDir: dir, host: "127.0.0.1" });
const base = `http://127.0.0.1:${server.port}`;
const sockets: WebSocket[] = [];
class Client {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  token = randomUUID();
  id = "";
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    sockets.push(this.ws);
    this.ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(message);
      if (message.type === "ping") this.send({ type: "pong", t: message.t });
    });
  }
  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }
  async wait<T extends ServerMessage["type"]>(
    type: T,
    timeout = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const i = this.messages.findIndex((m) => m.type === type);
      if (i >= 0)
        return this.messages.splice(i, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(
      `Timed out waiting for ${type}; received ${this.messages.map((m) => m.type).join(",")}`,
    );
  }
  async hello(token = this.token): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN)
      await new Promise<void>((r) => this.ws.once("open", r));
    this.send({ type: "hello", token });
    const welcome = await this.wait("welcome");
    this.token = welcome.token;
    this.id = welcome.playerId;
    assert(!JSON.stringify(welcome).includes("token_hash"));
  }
  clear(): void {
    this.messages = [];
  }
}
try {
  assert.equal((await (await fetch(`${base}/health`)).json()).ok, true);
  assert.equal((await fetch(`${base}/`)).status, 200);
  const a = new Client();
  const b = new Client();
  await Promise.all([a.hello(), b.hello()]);
  assert.notEqual(a.id, b.id);
  a.send({ type: "queue_join", mode: "duel" });
  assert.match((await a.wait("error")).msg, /nickname/);
  a.send({ type: "set_nickname", nickname: "PuddleTester" });
  b.send({ type: "set_nickname", nickname: "SplashTester" });
  await Promise.all([a.wait("profile_updated"), b.wait("profile_updated")]);
  a.send({
    type: "create_room",
    opts: {
      name: "Integration Pond",
      mode: "ffa",
      isPublic: true,
      theme: "beach",
      roundsToWin: 2,
      botFill: false,
    },
  });
  const { code } = await a.wait("room_created");
  a.send({ type: "set_slot", slot: 2, kind: "bot", difficulty: "hard" });
  a.send({ type: "set_slot", slot: 3, kind: "bot", difficulty: "hard" });
  b.send({ type: "room_list_request" });
  const list = await b.wait("room_list");
  assert(list.rooms.some((r) => r.code === code));
  b.send({ type: "join_room", code });
  await b.wait("lobby_state");
  b.send({ type: "set_ready", ready: true });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ type: "start_match" });
  await Promise.all([a.wait("match_start"), b.wait("match_start")]);
  const roundStart = await a.wait("round_start");
  const snap = await a.wait("snapshot");
  assert.equal(roundStart.castleGrid.length, 195);
  assert.equal(snap.state.players.length, 4);
  for (const data of [roundStart, snap]) {
    assert(!JSON.stringify(data).includes("hiddenPowerups"));
    assert(!JSON.stringify(data).includes("lootSeed"));
  }
  const room = server.rooms.rooms.get(code)!;
  // Accelerate the actual authority with deterministic command streams; no production debug endpoint exists.
  let rounds = 0;
  while (room.status === "playing" && rounds < 30) {
    room.match!.nextRoundAt = 0;
    room.match!.countdown = 0;
    const s = room.match!.state;
    const replay = cloneState(s);
    const drivers = s.players.map(
      (p, i) =>
        new BotController(p.id, i === 1 ? "easy" : "hard", 53 + i + rounds),
    );
    while (!s.roundOver && s.tick < 4000) {
      const inputs: Record<string, PlayerInput> = Object.fromEntries(
        drivers.map((d) => [d.id, d.nextInput(s)]),
      );
      simulateTick(s, inputs);
      simulateTick(replay, inputs);
    }
    assert.deepEqual(s, replay);
    assert(s.roundOver);
    server.rooms.endRound(room);
    rounds++;
    if (room.status === "playing") server.rooms.newRound(room);
  }
  assert.equal(room.status, "results");
  const result = await a.wait("match_end");
  await b.wait("match_end");
  assert.equal(result.placements.length, 4);
  assert(result.xp[a.id] > 0 && result.xp[b.id] > 0);
  assert(server.store.profile(a.id)!.xp > 0);
  assert.equal(server.store.recentMatches(a.id).length, 1);
  a.send({ type: "rematch_vote" });
  b.send({ type: "rematch_vote" });
  await a.wait("match_start");
  assert.equal(room.status, "playing");
  a.send({ type: "leave_room" });
  b.send({ type: "leave_room" });
  await Promise.all([a.wait("room_left"), b.wait("room_left")]);
  await new Promise((r) => setTimeout(r, 80));
  a.clear();
  b.clear();
  a.send({ type: "queue_join", mode: "duel" });
  b.send({ type: "queue_join", mode: "duel" });
  await Promise.all([a.wait("queue_status"), b.wait("queue_status")]);
  server.matchmaker.tick();
  const found = await a.wait("match_found");
  await b.wait("match_found");
  await a.wait("match_start");
  const ranked = server.rooms.rooms.get(found.code)!;
  assert(ranked.ranked);
  assert(ranked.slots.every((s) => s.kind === "human"));
  a.ws.close();
  await new Promise((r) => setTimeout(r, 30));
  const reconnect = new Client();
  await reconnect.hello(a.token);
  assert.equal(reconnect.id, a.id);
  await reconnect.wait("match_start");
  await reconnect.wait("round_start");
  await reconnect.wait("snapshot");
  assert(!ranked.disconnected.has(a.id));
  b.ws.close();
  await new Promise((r) => setTimeout(r, 30));
  ranked.disconnected.set(b.id, Date.now() - CONFIG.RECONNECT_GRACE_MS - 1);
  const rankedResult = await reconnect.wait("match_end");
  assert.equal(rankedResult.ratingDeltas[a.id].after, 1032);
  assert.equal(rankedResult.ratingDeltas[b.id].after, 968);
  assert.equal(
    rankedResult.placements.find((p) => p.playerId === b.id)?.placement,
    2,
  );
  const leaderboard = await (
    await fetch(`${base}/api/leaderboard?mode=duel`)
  ).json();
  assert.equal(leaderboard.leaderboard[0].playerId, a.id);
  const profile = await (await fetch(`${base}/api/profile/${a.id}`)).json();
  assert.equal(
    profile.profile.ratings.find((r: { mode: string }) => r.mode === "duel")
      .rating,
    1032,
  );
  assert(!JSON.stringify(profile).includes("token_hash"));
  assert(!JSON.stringify(profile).includes(a.token));
  const priorXp = server.store.profile(a.id)!.xp;
  server.rooms.finish(ranked);
  assert.equal(server.store.profile(a.id)!.xp, priorXp);
  reconnect.send({ type: "equip", animal: "capybara", hat: "none" });
  assert.match((await reconnect.wait("error")).msg, /level/);
  reconnect.send({ type: "tutorial_complete" });
  assert.match((await reconnect.wait("error")).msg, /training/);
  reconnect.ws.send(
    JSON.stringify({
      type: "input",
      seq: 1,
      tick: 1,
      dir: "right",
      balloonPressed: false,
      x: 1000,
    }),
  );
  assert.equal((await reconnect.wait("error")).code, "BAD_MESSAGE");
  assert.equal(
    (await fetch(`${base}/api/leaderboard?mode=invalid`)).status,
    400,
  );
  console.log(
    `Integration passed: guest auth, public 4p + 2 Hard bots, ${rounds} rounds, deterministic replay, XP, rematch, ranked Duel, reconnect, forfeit, Elo, leaderboard, validation, secret masking.`,
  );
} finally {
  for (const ws of sockets) ws.terminate();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
