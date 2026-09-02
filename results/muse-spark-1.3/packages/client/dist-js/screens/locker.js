import { net } from '../net.js';
import { app } from '../state.js';
import { sfx } from '../audio.js';
const ANIMALS = [
    { id: 'frog', name: 'Frog', level: 1 },
    { id: 'duck', name: 'Duck', level: 1 },
    { id: 'otter', name: 'Otter', level: 3 },
    { id: 'penguin', name: 'Penguin', level: 5 },
    { id: 'cat', name: 'Cat (hates water!)', level: 8 },
    { id: 'raccoon', name: 'Raccoon', level: 12 },
    { id: 'turtle', name: 'Turtle', level: 15 },
    { id: 'capybara', name: 'Capybara (flex)', level: 20 },
];
const HATS = [
    { id: 'none', name: 'None', level: 1 },
    { id: 'bucket', name: 'Bucket hat', level: 2 },
    { id: 'snorkel', name: 'Snorkel', level: 4 },
    { id: 'bandana', name: 'Pirate bandana', level: 7 },
    { id: 'propeller', name: 'Propeller cap', level: 10 },
    { id: 'crown', name: 'Tiny crown', level: 16 },
];
export function renderLocker(root, nav) {
    root.innerHTML = '';
    const d = document.createElement('div');
    const p = app.profile;
    const lv = p?.level ?? 1;
    d.innerHTML = `
    <div class="card">
      <div class="row"><button id="back" class="secondary">← Menu</button><b>Locker</b><span class="small">Level ${lv} · all cosmetic, never pay/power</span></div>
      <div class="row">
        <div><b>Animal</b><div id="animals"></div></div>
        <div><b>Hat</b><div id="hats"></div></div>
      </div>
      <div class="card" style="text-align:center"><canvas id="prev" width="64" height="64" class="pixel" style="width:128px"></canvas><div class="small">live preview · walk cycle</div></div>
    </div>`;
    root.appendChild(d);
    d.querySelector('#back').onclick = () => nav('#/menu');
    let animal = p?.animal ?? 'frog';
    let hat = p?.hat ?? 'none';
    const aBox = d.querySelector('#animals');
    const hBox = d.querySelector('#hats');
    for (const a of ANIMALS) {
        const b = document.createElement('button');
        b.textContent = `${a.name}${lv >= a.level ? '' : ` (Lv${a.level})`}`;
        b.className = a.id === animal ? '' : 'secondary';
        b.disabled = lv < a.level;
        b.onclick = () => {
            animal = a.id;
            sfx.click();
            net.send({ kind: 'set_cosmetics', animal, hat });
            renderLocker(root, nav);
        };
        aBox.appendChild(b);
    }
    for (const h of HATS) {
        const b = document.createElement('button');
        b.textContent = `${h.name}${lv >= h.level ? '' : ` (Lv${h.level})`}`;
        b.className = h.id === hat ? '' : 'secondary';
        b.disabled = lv < h.level;
        b.onclick = () => {
            hat = h.id;
            sfx.click();
            net.send({ kind: 'set_cosmetics', animal, hat });
            renderLocker(root, nav);
        };
        hBox.appendChild(b);
    }
    // preview
    const cv = d.querySelector('#prev');
    const g = cv.getContext('2d');
    let f = 0;
    const iv = window.setInterval(() => {
        f++;
        g.fillStyle = '#0e1430';
        g.fillRect(0, 0, 64, 64);
        import('../render/sprites.js').then(({ drawAnimal }) => {
            g.save();
            g.scale(2, 2);
            drawAnimal(g, animal, hat, 16, 18, Math.floor(f / 10), 1, false);
            g.restore();
        });
    }, 120);
    return () => clearInterval(iv);
}
