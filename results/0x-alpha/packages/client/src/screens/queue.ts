import type { App } from "../main";
import type { QueueStatusMsg } from "@sc/shared";
import { net } from "../net";
import { audio } from "../audio";

export function showQueue(app: App, mode: "duel" | "ffa"): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>${mode === "duel" ? "RANKED DUEL" : "RANKED FREE-FOR-ALL"}</h2>
    <div class="subtitle">Humans only — never bots. Widening search range…</div>
    <div class="panel col">
      <div id="elapsed">0:00</div>
      <div id="range" class="muted">search range ±100</div>
      <div id="waiting" class="muted"></div>
    </div>
    <button class="danger" id="cancel">Cancel</button>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  net.send({ t: "queue_join", mode });

  const off = net.on((msg) => {
    if (msg.t === "queue_status" && msg.mode === mode) {
      const s = Math.floor(msg.elapsedMs / 1000);
      (el.querySelector("#elapsed")!).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      (el.querySelector("#range")!).textContent = `search range ±${msg.searchRange}`;
      (el.querySelector("#waiting")!).textContent =
        msg.waiting > 1 ? `${msg.waiting} critters waiting` : "";
    }
  });

  el.querySelector("#cancel")!.addEventListener("click", () => {
    net.send({ t: "queue_leave" });
    app.navigate("#/menu");
  });

  return () => {
    off();
    audio.stopMusic();
    net.send({ t: "queue_leave" });
  };
}
