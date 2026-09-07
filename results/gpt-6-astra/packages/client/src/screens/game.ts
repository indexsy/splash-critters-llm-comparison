import {
  button,
  escapeHtml,
  icon,
  portrait,
  themeName,
  type UIState,
} from "../ui.js";
import { tutorialPanel } from "./tutorial.js";
export function gameScreen(state: UIState): string {
  const match = state.match;
  return `<div class="game-heading"><div><span class="eyebrow">${state.training ? "SPLASH SCHOOL" : match?.ranked ? "RANKED MATCH" : "JUST GOOD CLEAN CHAOS"}</span><h2>${themeName(match?.theme ?? "backyard")} <span>${match?.mode === "duel" ? "Duel" : "Free-for-All"}</span></h2></div><div class="game-clock"><span class="pixel" id="round-label">ROUND 1</span><strong id="round-clock">2:00</strong><small id="ping-label">0ms</small></div>${button(icon("close"), "exit-match", "icon-button", 'aria-label="Leave match"')}</div>
  ${state.training ? tutorialPanel(state) : ""}
  <section class="game-layout"><aside class="player-hud">${match?.players.map((s) => `<article id="player-${s.slot}" class="player-card slot-${s.slot} ${s.playerId === state.profile?.id ? "local-player" : ""}"><div class="player-card-head">${portrait(s.animal, s.hat)}<span><strong>${escapeHtml(s.nickname.split("#")[0])}</strong><small>${s.playerId === state.profile?.id ? "YOU" : s.kind === "bot" ? `${s.difficulty.toUpperCase()} BOT` : match.ranked ? `${s.rating} ELO` : "FRIEND / FOE"}</small></span><b class="player-score">0</b></div><div class="player-live-stats"><span title="Balloon capacity">${icon("drop", 13)} <b class="stat-balloons">1</b></span><span title="Splash range">${icon("plus", 13)} <b class="stat-range">2</b></span><span title="Movement speed">${icon("bolt", 13)} <b class="stat-speed">4.0</b></span></div><div class="alive-label">STILL DRY</div></article>`).join("") ?? ""}<div class="match-rule"><strong>LAST CRITTER DRY WINS.</strong><p>First to ${match?.roundsToWin ?? 3} round wins.<br>Remember: water plays no favorites.</p></div></aside>
  <div class="arena-shell"><div class="arena-inner"><canvas id="arena" width="256" height="224" aria-label="Splash Critters game arena. Move with WASD or arrows and drop balloons with Space." tabindex="0"></canvas><div id="announcer" class="announcer"><strong>READY?</strong><small>GET YOUR FLIPPERS ON</small></div></div><div class="arena-caption"><span><i class="live-dot"></i> ${match?.ranked ? "RANKED / HUMANS ONLY" : "LIVE FROM THE POND"}</span><span id="tide-label">RISING TIDE AT 2:00</span></div></div>
  <aside class="game-side"><div class="side-title">THE SPLASH REPORT</div><div id="kill-feed" class="kill-feed"><p>All quiet. Suspiciously quiet.</p></div><div class="emote-box"><strong>SAY IT WITH A QUACK.</strong><div>${["Quack", "Ribbit", "Squeak", "Honk"].map((e, i) => `<button data-action="emote" data-id="${i}" title="${e}"><kbd>${i + 1}</kbd>${e}</button>`).join("")}</div></div><div class="game-tip">${icon("drop", 24)}<p>Balloon chains use each balloon's own splash range. Think two splashes ahead.</p></div></aside></section>
  <div class="control-strip"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>ARROWS</kbd> Move</span><span><kbd>SPACE</kbd> / <kbd>E</kbd> Balloon</span><span><kbd>1</kbd>-<kbd>4</kbd> Emote</span><span><kbd>M</kbd> Mute</span><span id="dev-stats"></span></div>`;
}
