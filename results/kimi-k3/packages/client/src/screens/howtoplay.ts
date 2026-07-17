import { el, showApp } from './common.js';

export function renderHowTo(root: HTMLElement, go: (screen: string) => void): void {
  showApp();
  const panel = el('div', { class: 'panel col', style: 'max-width:520px;' });
  panel.append(el('h2', {}, ['HOW TO PLAY']));

  const rows: [string, string][] = [
    ['MOVE', 'WASD or Arrow keys'],
    ['DROP BALLOON', 'Space or E — fuse is 3 seconds'],
    ['GOAL', 'Soak every other critter. Last one dry wins the round. First to the round target wins the match.'],
    ['SPLASHES', 'Balloons burst in a cross shape. Boulders block splashes; sandcastles stop them but get washed away.'],
    ['CHAINS', 'A balloon caught in a splash bursts instantly — chain them for DOUBLE and TRIPLE splashes!'],
    ['POWER-UPS', 'Hidden inside sandcastles: Extra Balloon, Big Splash (range), Flippers (speed), and rare Rubber Boots.'],
    ['RUBBER BOOTS', 'Walk into a balloon to kick it — it slides until it hits something.'],
    ['RISING TIDE', 'At 2:00 the arena floods inward ring by ring. Keep moving to the center!'],
    ['REVENGE DUCKS', 'Soaked in casual? You come back as a duck circling the arena — lob balloons every 5s for revenge.'],
    ['EMOTES', 'Keys 1-4: quack, ribbit, squeak, honk.'],
    ['RANKED', 'Duel and FFA have separate Elo ratings. Tiers: Puddle → Pond → River → Lake → Ocean → Tsunami.'],
  ];
  for (const [k, v] of rows) {
    panel.append(
      el('div', { class: 'row', style: 'align-items:flex-start;' }, [
        el('span', { class: 'kbd', style: 'min-width:110px;' }, [k]),
        el('span', { class: 'small' }, [v]),
      ]),
    );
  }

  const back = el('button', { class: 'secondary' }, ['BACK']);
  back.onclick = () => go('menu');
  panel.append(back);
  root.append(panel);
}
