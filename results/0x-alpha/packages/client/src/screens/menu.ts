import type { App } from "../main";
import { audio } from "../audio";
import { net } from "../net";

export function showMenu(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  const p = app.profile;
  const tier = (mode: string): string => {
    const r = app.ratings[mode];
    if (!r) return "";
    return `${r.rating}`;
  };
  el.innerHTML = `
    <h2>MAIN MENU</h2>
    <div class="subtitle">${p ? `${p.nickname}<span class="tag">#${p.tag}</span> · Lv ${p.level} · Duel ${tier("duel")} / FFA ${tier("ffa")}` : "connecting…"}</div>
    <div class="col">
      <button id="rankedDuel">Play Ranked — Duel (1v1)</button>
      <button id="rankedFfa">Play Ranked — Free-for-All (4p)</button>
      <button id="casualBrowse">Casual — Browse Rooms</button>
      <button id="casualCreate">Casual — Create Room</button>
      <button id="joinCode">Join by Code</button>
      <button id="practice">Practice vs Bots</button>
      <div class="row">
        <button class="small" id="tutorialBtn">How to Play</button>
        <button class="small" id="leaderboardBtn">Leaderboard</button>
        <button class="small" id="lockerBtn">Locker</button>
        <button class="small" id="settingsBtn">Settings</button>
      </div>
    </div>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  const click = (id: string, fn: () => void): void =>
    el.querySelector(id)!.addEventListener("click", () => {
      audio.uiClick();
      fn();
    });

  click("#rankedDuel", () => app.navigate("#/queue/duel"));
  click("#rankedFfa", () => app.navigate("#/queue/ffa"));
  click("#casualBrowse", () => app.navigate("#/browser"));

  click("#casualCreate", () => {
    const name = prompt("Room name:", `${app.profile?.nickname ?? "Player"}'s room`) ?? "Room";
    const mode = confirm("OK = 4-player FFA room, Cancel = 1v1 Duel room") ? "ffa" : "duel";
    net.send({
      t: "create_room",
      name,
      mode: mode as "duel" | "ffa",
      isPublic: true,
      theme: "random",
      roundsToWin: 3,
      botFill: true,
    });
    // lobby_state message will route us
  });
  click("#joinCode", () => {
    const code = prompt("Room code:")?.toUpperCase().trim();
    if (code) net.send({ t: "join_room", code });
  });
  click("#practice", () => {
    net.send({ t: "create_room", name: "Practice", mode: "duel", isPublic: false, theme: "random", roundsToWin: 3, botFill: false });
    practicePending = true;
  });
  click("#tutorialBtn", () => app.navigate("#/tutorial"));
  click("#leaderboardBtn", () => app.navigate("#/leaderboard"));
  click("#lockerBtn", () => app.navigate("#/locker"));
  click("#settingsBtn", () => app.navigate("#/settings"));

  let practicePending = false;
  const off = net.on((msg) => {
    if (msg.t === "lobby_state") {
      if (practicePending && msg.name === "Practice") {
        practicePending = false;
        // fill remaining slot with a hard bot and start
        for (const s of msg.slots) {
          if (s.kind === "open") net.send({ t: "set_slot", slot: s.index, kind: "bot", difficulty: "hard" });
        }
        setTimeout(() => net.send({ t: "start_match" }), 150);
      }
      app.navigate(`#/room/${msg.code}`);
    }
  });

  return () => {
    off();
    audio.stopMusic();
  };
}
