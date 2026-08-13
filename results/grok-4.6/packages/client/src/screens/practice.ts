import { net } from "../net.js";
import type { Screen } from "./types.js";

export function practiceScreen(go: (name: string) => void): Screen {
  net.send({
    type: "create_room",
    opts: { name: "Practice", size: 2, public: false, theme: "backyard", roundsToWin: 3, botFill: true },
  });
  let sent = false;
  const unsub = net.on((msg) => {
    if (msg.type === "lobby_state" && !sent) {
      sent = true;
      net.send({ type: "set_slot", slot: 1, kind: "bot", difficulty: "hard" });
      net.send({ type: "set_ready", ready: true });
      setTimeout(() => net.send({ type: "start_match" }), 200);
    }
    if (msg.type === "match_start") go("game");
    if (msg.type === "error") go("menu");
  });
  return {
    name: "practice",
    update() {},
    draw(ctx) {
      ctx.fillStyle = "#1a1430";
      ctx.fillRect(0, 0, 256, 224);
      ctx.fillStyle = "#f4e8c1";
      ctx.font = "8px monospace";
      ctx.fillText("Starting practice…", 70, 110);
    },
    leave() {
      unsub();
    },
  };
}
