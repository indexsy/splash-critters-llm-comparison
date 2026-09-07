import {
  button,
  escapeHtml,
  icon,
  pageHeading,
  portrait,
  type UIState,
} from "../ui.js";
export function leaderboardScreen(state: UIState): string {
  return `${pageHeading("BIG FISH. SMALL POND.", "The Splash Elite.", "No shortcuts. No power for sale. Just very, very good flippers.", button(`${icon("refresh")} Refresh`, "refresh-leaderboard", "secondary"))}<div class="toolbar"><div class="segmented"><button class="${state.mode === "duel" ? "active" : ""}" data-action="leaderboard-duel">Duel / 1v1</button><button class="${state.mode === "ffa" ? "active" : ""}" data-action="leaderboard-ffa">Free-for-All / 4P</button></div><span class="small">TOP 100 / LIVE RATINGS</span></div>
  <div class="leaderboard-table"><div class="leaderboard-head"><span>RANK</span><span>CRITTER</span><span>TIER</span><span>RATING</span><span>GAMES</span><span>WIN RATE</span></div>${state.leaderboardLoading ? '<div class="empty-state"><p>Checking the pond records...</p></div>' : state.leaderboard.length ? state.leaderboard.map((p) => `<button class="leaderboard-row" data-action="profile" data-id="${p.playerId}"><strong class="rank-number">${String(p.rank).padStart(2, "0")}</strong><span>${portrait(p.animal)}<strong>${escapeHtml(p.nickname)}</strong></span><span class="tier-label">${p.tier}</span><strong>${p.rating}</strong><span>${p.games}</span><span>${p.winrate}%</span></button>`).join("") : `<div class="empty-state">${icon("trophy", 46)}<h2>History Is Still Dry.</h2><p>Complete a ranked match to put your name on the board.</p>${button("Make Your Mark", "ranked")}</div>`}</div><div class="tier-guide"><span>Puddle <b>&lt;1000</b></span><span>Pond <b>1000+</b></span><span>River <b>1150+</b></span><span>Lake <b>1300+</b></span><span>Ocean <b>1500+</b></span><span>Tsunami <b>1750+</b></span></div>`;
}
