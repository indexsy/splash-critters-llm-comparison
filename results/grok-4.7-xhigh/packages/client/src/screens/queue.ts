import type { Mode } from '@splash/shared';
import { mount, qs } from '../app.js';
import { audio } from '../audio.js';
import { net } from '../net.js';

export function showQueue(mode: Mode, nav: { cancel: () => void }) {
  audio.setMusic('menu');
  const root = mount(`
    <div class="shell"><div class="panel" style="text-align:center;max-width:520px">
      <h2>Searching ${mode === 'duel' ? 'Duel' : 'Free-for-All'}</h2>
      <p class="sub" id="status">Looking for a dry rival…</p>
      <div class="bar" style="margin:16px auto;max-width:280px"><span id="fill" style="width:20%"></span></div>
      <button class="btn-ghost" id="cancel">Cancel</button>
    </div></div>`);
  qs('#cancel').onclick = () => { net.send({ t: 'queue_leave' }); nav.cancel(); };
  const off = net.on((msg) => {
    if (msg.t !== 'queue_status') return;
    qs('#status').textContent = `${msg.elapsed}s · search ±${msg.searchRange} · eta ~${msg.eta}s`;
    (qs('#fill') as HTMLElement).style.width = `${Math.min(100, 20 + msg.elapsed)}%`;
  });
  let raf = 0;
  const loop = () => { audio.tick(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); off(); };
}
