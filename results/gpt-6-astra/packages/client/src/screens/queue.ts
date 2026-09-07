import { rankTier } from "@splash/shared";
import { button, icon, portrait, type UIState } from "../ui.js";
export function queueScreen(state: UIState): string {
  const mode = state.queue?.mode ?? state.mode;
  const rating =
    state.profile?.ratings.find((r) => r.mode === mode)?.rating ?? 1000;
  return `<section class="queue-screen"><div class="eyebrow">RANKED ${mode === "duel" ? "DUEL" : "FREE-FOR-ALL"}</div><h1>Testing the Waters...</h1><p>Finding your next worthy splash rival.</p><div class="queue-orbit"><span></span><span></span><span></span>${portrait(state.profile?.selectedAnimal, state.profile?.selectedHat)}</div><div class="queue-tier">${icon("trophy")} ${rankTier(rating).name} <b>${rating}</b></div><div class="queue-stats"><div><small>TIME IN THE POND</small><strong id="queue-elapsed">${state.queue?.elapsed ?? 0}s</strong></div><div><small>SEARCH RANGE</small><strong id="queue-range">+/- ${state.queue?.searchRange ?? 100}</strong></div><div><small>CRITTERS QUEUED</small><strong id="queue-count">${state.queue?.queued ?? 1}</strong></div></div><p class="queue-note" id="queue-note">${state.queue?.eta ? `Estimated match in ${state.queue.eta}s` : "Waiting for real players. Ranked matches never use bots."}</p>${button("Back Out of the Water", "cancel-queue", "secondary")}<p class="small">Your search widens every 10 seconds, up to +/- 400 Elo.</p></section>`;
}
