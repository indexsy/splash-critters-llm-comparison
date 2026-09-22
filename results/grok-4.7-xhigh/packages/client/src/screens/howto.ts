import { mount, qs } from '../app.js';

export function showHowto(nav: { back: () => void; tutorial: () => void }) {
  const root = mount(`
    <div class="shell"><div class="panel">
      <div class="row" style="justify-content:space-between"><h2>How to play</h2><button class="btn-ghost" id="back">Back</button></div>
      <div class="grid two" style="margin-top:12px">
        <div class="card"><h3>Move & drop</h3><p class="sub"><kbd>WASD</kbd> or arrows to waddle. <kbd>Space</kbd> or <kbd>E</kbd> drops a water balloon on your tile. Fuse is 3 seconds. Walk off your own balloon.</p></div>
        <div class="card"><h3>Splashes</h3><p class="sub">Balloons burst in a cross. Boulders block them. The first sandcastle in each direction washes away and stops the spray. A splash that touches another balloon chains — the whole cascade resolves in one tick.</p></div>
        <div class="card"><h3>Power-ups</h3><p class="sub">Hidden in sandcastles until they wash away: Extra Balloon, Big Splash, Flippers, and rare Rubber Boots (kick a balloon so it slides). Stats reset each round.</p></div>
        <div class="card"><h3>Tide & ducks</h3><p class="sub">At 2:00 the tide climbs inward. In casual matches, soaked critters ride rubber duckies and can lob a short balloon. Ranked has no ducks and no bots.</p></div>
        <div class="card"><h3>Win</h3><p class="sub">Last critter dry takes the round. First to the round target takes the match. Same-tick double soak is a draw. Emotes are <kbd>1</kbd>-<kbd>4</kbd>. Mute is <kbd>M</kbd>.</p></div>
        <div class="card"><h3>Ranks</h3><p class="sub">Puddle, Pond, River, Lake, Ocean, Tsunami. Duel and free-for-all keep separate ratings. Cosmetics never change power.</p></div>
      </div>
      <button class="btn" id="tut" style="margin-top:12px">Replay tutorial</button>
    </div></div>`);
  qs('#back').onclick = nav.back;
  qs('#tut').onclick = nav.tutorial;
  return () => {};
}
