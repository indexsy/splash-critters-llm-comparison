import type { App } from "../main";
import type { RoomListMsg } from "@sc/shared";
import { net } from "../net";
import { audio } from "../audio";

export function showBrowser(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>ROOM BROWSER</h2>
    <div class="row">
      <button class="small" id="refresh">Refresh</button>
      <button class="small" id="create">Create Room</button>
      <button class="small" id="back">Back</button>
    </div>
    <div class="panel" style="width:640px">
      <table><thead><tr><th>Name</th><th>Mode</th><th>Players</th><th>Theme</th><th>Host</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="6" class="muted">loading…</td></tr></tbody></table>
    </div>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  const rows = el.querySelector("#rows")!;

  const render = (msg: RoomListMsg): void => {
    if (msg.rooms.length === 0) {
      rows.innerHTML = `<tr><td colspan="6" class="muted">No open rooms — create one!</td></tr>`;
      return;
    }
    rows.innerHTML = "";
    for (const r of msg.rooms) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${r.mode === "duel" ? "1v1" : "4p"}</td>
        <td>${r.players}/${r.maxPlayers}</td>
        <td>${r.theme}</td>
        <td>${r.hostNickname}</td>
        <td><button class="small primary" data-code="${r.code}">Join</button></td>`;
      tr.querySelector("button")!.addEventListener("click", () => {
        audio.uiClick();
        net.send({ t: "join_room", code: r.code });
      });
      rows.appendChild(tr);
    }
  };

  const request = (): void => net.send({ t: "room_list_request" });
  request();
  const interval = window.setInterval(request, 3000);
  const off = net.on((msg) => {
    if (msg.t === "room_list") render(msg);
  });

  el.querySelector("#refresh")!.addEventListener("click", request);
  el.querySelector("#create")!.addEventListener("click", () => {
    net.send({
      t: "create_room",
      name: `${app.profile?.nickname ?? "Player"}'s room`,
      mode: "ffa",
      isPublic: true,
      theme: "random",
      roundsToWin: 3,
      botFill: true,
    });
  });
  el.querySelector("#back")!.addEventListener("click", () => app.navigate("#/menu"));

  return () => {
    off();
    clearInterval(interval);
    audio.stopMusic();
  };
}
