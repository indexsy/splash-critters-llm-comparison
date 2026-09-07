import { levelProgress, rankTier } from "@splash/shared";
import { button, escapeHtml, icon, portrait, type UIState } from "../ui.js";
export function resultsScreen(state: UIState): string {
  const r = state.result;
  if (!r) return "";
  const winner = r.placements[0];
  const you = r.placements.find((p) => p.playerId === state.profile?.id);
  const won = you?.placement === 1;
  const xp = r.xp[state.profile?.id ?? ""] ?? 0;
  const rating = r.ratingDeltas[state.profile?.id ?? ""];
  const progress = levelProgress(state.profile?.xp ?? 0);
  const award = (
    key: "soaks" | "castlesWashed" | "survivalTicks" | "biggestChain",
  ) =>
    r.placements.reduce(
      (best, p) => (p[key] > best[key] ? p : best),
      r.placements[0],
    );
  return `<section class="results-screen"><div class="eyebrow">THAT'S A WRAP. GRAB A TOWEL.</div><div class="winner-portrait">${portrait(winner.animal, "crown")}</div><h1>${won ? "Dry. Dashing. Dangerous." : "A Glorious Soaking."}</h1><p>${escapeHtml(winner.nickname.split("#")[0])} made the biggest splash. ${won ? "That would be you." : "Next round could be yours."}</p>
    <div class="result-standings">${r.placements.map((p) => `<div class="standing ${p.playerId === state.profile?.id ? "you" : ""}"><b>#${p.placement}</b>${portrait(p.animal)}<span><strong>${escapeHtml(p.nickname)}</strong><small>${p.forfeited ? "Forfeit" : `${p.roundsWon} rounds won / ${p.soaks} soaks`}</small></span>${r.ratingDeltas[p.playerId] ? `<strong class="delta ${r.ratingDeltas[p.playerId].after >= r.ratingDeltas[p.playerId].before ? "positive" : ""}">${r.ratingDeltas[p.playerId].after - r.ratingDeltas[p.playerId].before >= 0 ? "+" : ""}${r.ratingDeltas[p.playerId].after - r.ratingDeltas[p.playerId].before} ELO</strong>` : ""}</div>`).join("")}</div>
    <div class="result-rewards"><div><span class="eyebrow">A LITTLE MORE LEGENDARY</span><h3>+${xp} XP <small>Level ${progress.level}</small></h3><div class="xp-track"><span style="width:${Math.round((progress.current / progress.required) * 100)}%"></span></div><small>${progress.current} / ${progress.required} to the next level</small></div>${rating ? `<div><span class="eyebrow">${rankTier(rating.after).name.toUpperCase()}</span><h3>${rating.after} <small>${rating.after >= rating.before ? "+" : ""}${rating.after - rating.before} Elo</small></h3><p>Peak potential. Keep making waves.</p></div>` : `<div>${icon("shirt", 25)}<h3>Style, Never Stats.</h3><p>New levels unlock animals and hats.</p></div>`}</div>
    <div class="fun-awards">${(
      [
        ["soaks", "MOST SOAKS"],
        ["castlesWashed", "CASTLE CRUSHER"],
        ["survivalTicks", "LONGEST SURVIVOR"],
        ["biggestChain", "BIGGEST CHAIN"],
      ] as const
    )
      .map(
        ([key, label]) =>
          `<div><span>${label}</span><strong>${escapeHtml(award(key).nickname.split("#")[0])}</strong><small>${key === "survivalTicks" ? `${Math.round(award(key)[key] / 30)}s dry` : award(key)[key]}</small></div>`,
      )
      .join("")}</div>
    <div class="result-actions">${state.training && state.tutorialGoals.size === 5 && !state.profile?.tutorialComplete ? button("Collect Your First 50 XP", "complete-tutorial") : ""}${!r.ranked ? button(`One More Splash ${icon("refresh")}`, "rematch") : button(`Back to Ranked ${icon("trophy")}`, "ranked-again")}${button("Back to the Pond", "leave", "secondary")}</div><p class="small" id="rematch-status">${!r.ranked ? "A majority of players must vote to start the rematch." : "Your new rating is saved. The leaderboard has been updated."}</p></section>`;
}
