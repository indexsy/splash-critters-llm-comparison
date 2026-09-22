import type { App } from '../app.js';

export function mountLeaderboard(root: HTMLElement, app: App): () => void {
  let mode: 'duel' | 'ffa' = 'duel';
  root.innerHTML = `<div class="shell"><div class="topbar"><h1>Leaderboard</h1><button id="back">Back</button></div><div class="row"><button data-m="duel">Duel</button><button data-m="ffa">Free-for-All</button></div><div id="board" class="panel" style="margin-top:12px"></div></div>`;
  const board = root.querySelector('#board') as HTMLElement;
  const load = async () => {
    const res = await fetch(`/api/leaderboard?mode=${mode}`);
    const data = (await res.json()) as {
      rows: { rank: number; nickname: string; tag: string; rating: number; tier: string; games: number; winrate: number }[];
    };
    board.innerHTML = `<table><thead><tr><th>#</th><th>Name</th><th>Rating</th><th>Tier</th><th>Games</th><th>Winrate</th></tr></thead><tbody>${
      data.rows
        .map(
          (r) =>
            `<tr><td>${r.rank}</td><td>${r.nickname}#${r.tag}</td><td>${r.rating}</td><td>${r.tier}</td><td>${r.games}</td><td>${Math.round(r.winrate * 100)}%</td></tr>`,
        )
        .join('') || '<tr><td colspan="6">No ranked games yet.</td></tr>'
    }</tbody></table>`;
  };
  root.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.m as 'duel' | 'ffa';
      void load();
    };
  });
  root.querySelector('#back')!.addEventListener('click', () => app.goto('menu'));
  void load();
  return () => {};
}
