import type { App } from "../main";
import type { LobbyStateMsg } from "@sc/shared";
import { net } from "../net";
import { audio } from "../audio";

export function showLobby(app: App, _code?: string): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2 id="roomName">ROOM</h2>
    <div class="subtitle" id="roomInfo"></div>
    <div id="slots" class="col" style="min-width:420px"></div>
    <div class="row">
      <button class="small" id="readyBtn">Ready</button>
      <button class="small primary" id="startBtn">Start Match</button>
      <button class="small danger" id="leaveBtn">Leave</button>
    </div>
    <div class="muted" id="shareHint"></div>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  let last: LobbyStateMsg | null = null;
  let isHost = false;
  let ready = false;

  const render = (msg: LobbyStateMsg): void => {
    last = msg;
    const me = app.playerId;
    isHost = msg.slots[msg.hostSlot]?.playerId === me;
    (el.querySelector("#roomName")!).textContent = msg.name;
    (el.querySelector("#roomInfo")!).innerHTML =
      `Code: <b>${msg.code}</b> · ${msg.mode === "duel" ? "1v1" : "4-player"} · rounds to win: ${msg.roundsToWin} · theme: ${msg.theme}` +
      (msg.isPublic ? "" : " · <span class='badge'>PRIVATE</span>");
    (el.querySelector("#shareHint")!).textContent = `Share link: ${location.origin}/#/room/${msg.code}`;

    const slots = el.querySelector("#slots")!;
    slots.innerHTML = "";
    for (const s of msg.slots) {
      const div = document.createElement("div");
      div.className = "row panel";
      div.style.padding = "8px";
      div.style.width = "100%";
      div.style.justifyContent = "space-between";
      if (s.kind === "human") {
        div.innerHTML = `<span>${s.index + 1}. ${s.nickname} ${s.ready ? "✔" : "…"}</span>`;
        if (s.playerId === me) ready = !!s.ready;
      } else if (s.kind === "bot") {
        div.innerHTML = `<span>${s.index + 1}. 🤖 Bot (${s.difficulty})</span>`;
        if (isHost) {
          const sel = document.createElement("select");
          sel.style.width = "110px";
          for (const d of ["easy", "medium", "hard"]) {
            const opt = document.createElement("option");
            opt.value = d;
            opt.textContent = d;
            if (d === s.difficulty) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.addEventListener("change", () =>
            net.send({ t: "set_slot", slot: s.index, kind: "bot", difficulty: sel.value as "easy" | "medium" | "hard" }),
          );
          div.appendChild(sel);
          const kick = document.createElement("button");
          kick.className = "small danger";
          kick.textContent = "Open";
          kick.addEventListener("click", () => net.send({ t: "set_slot", slot: s.index, kind: "open" }));
          div.appendChild(kick);
        }
      } else {
        div.innerHTML = `<span class="muted">${s.index + 1}. — empty —</span>`;
        if (isHost) {
          const addBot = document.createElement("button");
          addBot.className = "small";
          addBot.textContent = "+ Bot (medium)";
          addBot.addEventListener("click", () => net.send({ t: "set_slot", slot: s.index, kind: "bot", difficulty: "medium" }));
          div.appendChild(addBot);
        }
      }
      slots.appendChild(div);
    }
    (el.querySelector("#startBtn") as HTMLButtonElement).disabled = !isHost;
    (el.querySelector("#readyBtn") as HTMLButtonElement).textContent = ready ? "Not ready" : "Ready";
  };

  const off = net.on((msg) => {
    if (msg.t === "lobby_state") render(msg);
  });

  el.querySelector("#readyBtn")!.addEventListener("click", () => {
    audio.uiClick();
    net.send({ t: "set_ready", ready: !ready });
  });
  el.querySelector("#startBtn")!.addEventListener("click", () => {
    audio.uiClick();
    net.send({ t: "start_match" });
  });
  el.querySelector("#leaveBtn")!.addEventListener("click", () => {
    net.send({ t: "leave_room" });
    app.navigate("#/browser");
  });

  return () => {
    off();
    audio.stopMusic();
  };
}
