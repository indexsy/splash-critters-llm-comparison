import type { App } from '../app.js';

export function mountQueue(root: HTMLElement, app: App): () => void {
  const paint = () => {
    const q = app.session.queue;
    root.innerHTML = `
      <div class="shell"><div class="panel">
        <h1>Searching ${q?.mode === 'ffa' ? 'Free-for-All' : 'Duel'}</h1>
        <p>Elapsed ${q?.elapsed ?? 0}s · range ±${q?.searchRange ?? 100} · eta ~${q?.eta ?? 30}s</p>
        <button id="cancel">Cancel</button>
      </div></div>`;
    root.querySelector('#cancel')!.addEventListener('click', () => {
      app.net.send({ t: 'queue_leave' });
      app.goto('menu');
    });
  };
  const off = app.net.on((msg) => {
    if (msg.t === 'queue_status') paint();
  });
  paint();
  return () => off();
}
