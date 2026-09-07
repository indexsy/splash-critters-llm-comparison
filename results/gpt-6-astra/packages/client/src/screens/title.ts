import { button, icon, portrait, type UIState } from "../ui.js";
export function titleScreen(state: UIState): string {
  return `<section class="hero">
    <div class="hero-copy"><div class="eyebrow"><span class="tiny-spark">+</span> A LITTLE CHAOS. A LOT OF WATER.</div>
      <h1>Small critters.<br><span>BIG SPLASHES.</span><i class="title-drops">' '</i></h1>
      <p>Water balloons. Questionable friendships.<br>Be the last critter dry in a delightfully chaotic<br class="wide-only"> 8-bit arena battler.</p>
      <div class="hero-actions">${button(`Let's Make Waves ${icon("arrow")}`, state.profile?.tutorialComplete || localStorage.getItem("splash-tutorial-seen") ? "quick-play" : "tutorial", "primary large")}${button(`${icon("help", 18)} How to Play`, "how-to", "text")}</div>
      <div class="hero-footnote"><div class="mini-portraits">${portrait("frog")}${portrait("duck")}${portrait("cat")}</div><span>2-4 players <b>\u00b7</b> Free to play <b>\u00b7</b> No downloads</span></div>
    </div>
    <div class="hero-art"><span class="art-tag pixel">100% FRIENDLY FIRE</span><canvas id="scene" width="256" height="224" aria-label="Animated pixel critters having a water balloon battle on a sunny island"></canvas><div class="art-sticker"><span>STAY</span><strong>DRY!</strong><span>or don't.</span></div></div>
  </section>
  <div class="section-line"><h2>CHOOSE YOUR SPLASH</h2><span>Good times. Zero dry towels.</span></div>
  <section class="play-options">
    <button class="mode-card ranked-card" data-action="ranked"><div class="mode-top"><span class="mode-symbol">${icon("trophy", 26)}</span><span class="chip">THE COMPETITIVE ONE</span></div><h2>Make a name.<br> Make a splash.</h2><p>Duel or free-for-all. Climb the ranks.<br> From tiny Puddle to total Tsunami.</p><div class="mode-bottom"><strong>Play Ranked</strong><span class="square-arrow">${icon("arrow")}</span></div></button>
    <button class="mode-card casual-card" data-action="browse"><div class="mode-top"><span class="mode-symbol">${icon("users", 26)}</span><span class="chip">BETTER WITH FRIENDS</span></div><h2>Bring the<br> whole pond.</h2><p>Find a room or start your own.<br> Friends, strangers, and very clever bots.</p><div class="mode-bottom"><strong>Play Casual</strong><span class="square-arrow">${icon("arrow")}</span></div></button>
    <button class="mode-card practice-card" data-action="practice"><div class="mode-top"><span class="mode-symbol">${icon("bolt", 26)}</span><span class="chip">NO PRESSURE</span></div><h2>Get your<br> paws wet.</h2><p>Just you and the bots.<br> A little practice goes a long splash.</p><div class="mode-bottom"><strong>Practice vs Bots</strong><span class="square-arrow">${icon("arrow")}</span></div></button>
  </section>
  <section class="tip-strip"><span class="tip-icon">${icon("drop", 22)}</span><p><strong>A LITTLE POND WISDOM</strong> Your own splash can soak you, too. Drop a balloon. Make an exit. Look adorable doing it.</p><span class="pixel">SPLASH RESPONSIBLY.</span></section>`;
}
