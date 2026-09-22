import type { App } from '../app.js';

export function mountTutorial(root: HTMLElement, app: App): () => void {
  root.innerHTML = `
    <div class="shell">
      <div class="panel">
        <h1>Tutorial</h1>
        <p>A tiny backyard, one easy critter, under two minutes.</p>
        <ol>
          <li>Move with WASD or arrows.</li>
          <li>Drop a balloon behind a sandcastle and step away.</li>
          <li>Grab the power-up it reveals.</li>
          <li>Chain two balloons so one splash pops the other.</li>
          <li>Soak the bot. Last critter dry wins.</li>
        </ol>
        <div class="row"><button id="go">Start</button><button class="alt" id="skip">Skip</button></div>
      </div>
    </div>`;
  root.querySelector('#go')!.addEventListener('click', () => {
    app.audio.unlock();
    app.net.send({ t: 'tutorial_begin' });
  });
  root.querySelector('#skip')!.addEventListener('click', () => {
    app.net.send({ t: 'tutorial_skip' });
    app.goto('menu');
  });
  return () => {};
}
