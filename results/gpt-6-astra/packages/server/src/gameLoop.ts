import { performance } from "node:perf_hooks";
import { CONFIG, simulateTick, type PlayerInput } from "@splash/shared";
import { BotController } from "./bots/bot.js";
import type { Rooms } from "./rooms.js";

export function startGameLoop(rooms: Rooms): () => void {
  let previous = performance.now();
  let accumulator = 0;
  let frame = 0;
  const tick = () => {
    frame++;
    const now = Date.now();
    for (const room of rooms.rooms.values()) {
      if (
        now - room.updatedAt > CONFIG.ROOM_TTL_MS &&
        !room.slots.some((s) => s.kind === "human" && s.connected)
      ) {
        rooms.rooms.delete(room.code);
        continue;
      }
      if (room.status !== "playing" || !room.match) continue;
      const m = room.match;
      for (const [id, since] of room.disconnected)
        if (now - since >= CONFIG.RECONNECT_GRACE_MS) {
          room.disconnected.delete(id);
          if (room.ranked) rooms.forfeit(room, id);
          else {
            const slot = room.slots.find((s) => s.playerId === id)!;
            slot.kind = "bot";
            slot.difficulty = "medium";
            slot.connected = true;
            m.bots.set(
              id,
              new BotController(id, "medium", m.state.mapSeed ^ slot.slot),
            );
            rooms.update(room);
          }
        }
      if (room.status !== "playing") continue;
      if (m.nextRoundAt) {
        if (now >= m.nextRoundAt) rooms.newRound(room);
        continue;
      }
      if (m.countdown > 0) {
        m.countdown--;
        if (frame % 2 === 0) rooms.snapshot(room);
        continue;
      }
      const inputs: Record<string, PlayerInput> = {};
      for (const [id, queued] of m.inputs) {
        const fresh = now - queued.received < CONFIG.INPUT_STALE_MS;
        inputs[id] = {
          ...queued.input,
          dir: fresh ? queued.input.dir : "none",
          balloonPressed: fresh && queued.input.balloonPressed,
        };
        queued.input.balloonPressed = false;
      }
      for (const [id, bot] of m.bots) {
        // Training starts gently; the learner gets time to try the first few verbs.
        if (room.opts.tutorial && !m.tutorialGoals.has("chain")) continue;
        inputs[id] = bot.nextInput(m.state);
      }
      simulateTick(m.state, inputs);
      if (room.opts.tutorial) {
        const p = m.state.players[0];
        if (Math.abs(p.x - 1.5) + Math.abs(p.y - 1.5) > 1)
          m.tutorialGoals.add("move");
      }
      for (const event of m.state.events) {
        rooms.broadcast(room, { type: "event", event });
        if (room.opts.tutorial) {
          if (event.type === "castle_washed" && event.playerId === room.hostId)
            m.tutorialGoals.add("castle");
          if (
            event.type === "powerup_collected" &&
            event.playerId === room.hostId
          )
            m.tutorialGoals.add("pickup");
          if (event.type === "chain_burst" && event.playerId === room.hostId)
            m.tutorialGoals.add("chain");
          if (
            event.type === "player_soaked" &&
            event.byId === room.hostId &&
            event.playerId !== room.hostId
          )
            m.tutorialGoals.add("soak");
        }
      }
      if (m.state.roundOver) rooms.endRound(room);
      else if (frame % (CONFIG.TICK_RATE / CONFIG.SNAPSHOT_RATE) === 0)
        rooms.snapshot(room);
    }
  };
  const timer = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(now - previous, 250);
    previous = now;
    while (accumulator >= 1000 / CONFIG.TICK_RATE) {
      accumulator -= 1000 / CONFIG.TICK_RATE;
      tick();
    }
  }, 8);
  return () => clearInterval(timer);
}
