import type { App } from "../main";
import { audio } from "../audio";

interface Entry {
  rank: number;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}

export function showLeaderboard(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>LEADERBOARD</h2>
    <div class="row">
      <button class="small" id="duelBtn">Duel</button>
      <button class="small" id="ffaBtn">Free-for-All</button>
      <button class="small" id="back">Back</button>
    </div>
    <div class="panel" style="width:640px">
      <table><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Tier</th><th>Games</th><th>Win%</th></tr></thead>
      <tbody id="rows"><tr><td colspan="6" class="muted">loading…</td></tr></tbody></table>
    </div>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  let currentMode: "duel" | "ffa" = "duel";
  const rows = el.querySelector("#rows")!;

  const load = async (): Promise<void> => {
    rows.innerHTML = `<tr><td colspan="6" class="muted">loading…</td></tr>`;
    try {
      const res = await fetch(`/api/leaderboard?mode=${currentMode}`);
      const data = (await res.json()) as { entries: Entry[] };
      if (data.entries.length === 0) {
        rows.innerHTML = `<tr><td colspan="6" class="muted">No ranked games yet — be the first!</td></tr>`;
        return;
      }
      rows.innerHTML = data.entries
        .map(
          (e) =>
            `<tr><td>${e.rank}</td><td>${e.nickname}<span class="tag">#${e.tag}</span></td><td>${e.rating}</td><td><span class="badge">${e.tier}</span></td><td>${e.games}</td><td>${e.winrate}</td></tr>`,
        )
        .join("");
    } catch {
      rows.innerHTML = `<tr><td colspan="6" class="muted">failed to load</td></tr>`;
    }
  };

  el.querySelector("#duelBtn")!.addEventListener("click", () => {
    currentMode = "duel";
    void load();
  });
  el.querySelector("#ffaBtn")!.addEventListener("click", () => {
    currentMode = "ffa";
    void load();
  });
  el.querySelector("#back")!.addEventListener("click", () => app.navigate("#/menu"));

  void load();
  return () => {
    audio.stopMusic();
  };
}
