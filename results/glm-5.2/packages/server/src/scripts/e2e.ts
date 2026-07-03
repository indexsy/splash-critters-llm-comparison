// e2e.ts — integration test: two real WebSocket clients drive the full flow
// (acceptance criterion #2: room browser join + full match completes).
// Run against a live server. Usage: node dist/scripts/e2e.js <port>
import { WebSocket } from "ws";

const PORT = process.argv[2] ?? "3000";
const URL = `ws://localhost:${PORT}/ws`;

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function send(ws: WebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

function once(ws: WebSocket, t: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeoutMs);
    const h = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.t === t) {
          clearTimeout(to);
          ws.off("message", h);
          resolve(m);
        }
      } catch {}
    };
    ws.on("message", h);
  });
}

async function run() {
  console.log("[e2e] connecting two clients…");
  const a = await connect();
  const b = await connect();

  // hello
  send(a, { t: "hello" });
  send(b, { t: "hello" });
  await once(a, "welcome");
  await once(b, "welcome");

  // set nicknames (so they could queue ranked later)
  send(a, { t: "set_nickname", nickname: "HostOtter" });
  send(b, { t: "set_nickname", nickname: "GuestCat" });
  await once(a, "welcome");

  // A creates a public 4p room with bot fill
  send(a, {
    t: "create_room",
    name: "E2E Arena",
    size: 4,
    visibility: "public",
    theme: "beach",
    roundsToWin: 2,
    botFill: true,
  });
  const created = await once(a, "room_created");
  const code = created.code;
  console.log(`[e2e] room ${code} created`);

  // B refreshes the room browser and sees it
  send(b, { t: "room_list_request" });
  const list = await once(b, "room_list");
  const seen = list.rooms.some((r: any) => r.code === code);
  if (!seen) throw new Error("B did not see the room in the browser");
  console.log(`[e2e] B saw room in browser (${list.rooms.length} rooms)`);

  // B joins
  send(b, { t: "join_room", code });
  const lbB = await once(b, "lobby_state");
  if (lbB.slots.filter((s: any) => s.kind === "human").length < 2)
    throw new Error("B did not appear in lobby");
  console.log(`[e2e] B joined; humans in lobby: ${lbB.slots.filter((s:any)=>s.kind==="human").length}`);

  // A starts the match (bot fill fills the other 2 slots)
  send(a, { t: "start_match" });
  const ms = await once(a, "match_start", 5000);
  console.log(`[e2e] match started: ${ms.players.length} players, yourSlot=${ms.yourSlot}`);

  // confirm snapshots begin flowing
  const snap = await once(a, "snapshot", 5000);
  if (!Array.isArray(snap.snap.players)) throw new Error("no players in snapshot");
  console.log(`[e2e] snapshots flowing: ${snap.snap.players.length} players at tick ${snap.snap.tick}`);

  a.close();
  b.close();
  console.log("[e2e] PASS");
  process.exit(0);
}

run().catch((e) => {
  console.error("[e2e] FAIL:", e.message);
  process.exit(1);
});
