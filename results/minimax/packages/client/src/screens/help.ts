import type { App } from '../app.js';
import { button, clear, el, panel } from '../ui.js';

/** How to play - the rules in short. */
export class HelpScreen {
  private app: App | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    const root = panel(
      'How to play',
      el('p', {}, [
        'Drop water balloons on the tile you stand on. After three seconds they burst into a cross shaped splash that washes away sandcastles and soaks anyone caught in it.',
      ]),
      el('ul', {}, [
        el('li', {}, ['Move with WASD or the arrow keys.']),
        el('li', {}, ['Drop a balloon with SPACE or E - then get out of the cross before it bursts.']),
        el('li', {}, ['Sandcastles hide power ups: more balloons, a bigger splash, faster flippers or rubber boots that let you kick a balloon.']),
        el('li', {}, ['Balloons caught in a splash burst too - chain them for a double or triple splash.']),
        el('li', {}, ['The last dry critter wins the round. First to three round wins takes the match.']),
        el('li', {}, ['After two minutes the tide rises and washes the arena away - move towards the middle.']),
        el('li', {}, ['In casual games soaked players ride a rubber duck and can lob one last balloon.']),
      ]),
      el('div', { class: 'row' }, [
        button('Back', () => app.go('menu')),
        button('Practice vs bots', () => {
          app.send({
            t: 'create_room',
            opts: {
              name: 'Practice',
              maxPlayers: 2,
              isPublic: false,
              theme: 'random',
              roundsToWin: 3,
              botFill: true,
              autoStart: true,
            },
          });
        }),
      ]),
    );
    app.overlay.appendChild(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }
}
