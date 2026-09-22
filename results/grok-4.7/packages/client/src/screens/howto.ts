import type { App } from '../app.js';

export function mountHowto(root: HTMLElement, app: App): () => void {
  root.innerHTML = `
    <div class="shell">
      <div class="topbar"><h1>How to Play</h1><button id="back">Back</button></div>
      <div class="panel">
        <p>Drop water balloons. They burst in a cross and wash sandcastles. Last critter dry wins the round. First to the round goal wins the match.</p>
        <p>WASD or arrows move. Space or E drops a balloon. You can walk off your own balloon. Splashes soak anyone standing in them, including you.</p>
        <p>A splash that touches another balloon pops it immediately. Chains resolve in one tick. Double Splash and Triple Splash get their own jingle.</p>
        <p>Sandcastles hide power-ups: extra balloon, bigger splash, flippers, and rare rubber boots. Boots let you kick a balloon so it slides until it hits something.</p>
        <p>At 2:00 the tide rises from the edges. Flooded tiles soak you. In casual games, soaked players ride rubber duckies and can lob a revenge balloon. Those soaks count in stats, not the score.</p>
        <p>Keys 1–4 are emotes. Ranked is humans only, with separate ratings for duel and free-for-all. Puddle, Pond, River, Lake, Ocean, Tsunami.</p>
        <p>Desktop only. No touch controls in this version.</p>
      </div>
    </div>`;
  root.querySelector('#back')!.addEventListener('click', () => app.goto('menu'));
  return () => {};
}
