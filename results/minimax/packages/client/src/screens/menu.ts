import { audio } from '../audio.js';
import type { App } from '../app.js';
import { button, card, clear, el, panel, tierPill } from '../ui.js';

/** The main menu - every entry point of the game lives here. */
export class MenuScreen {
  private app: App | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    audio.playMusic('menu');
    const profile = app.state.profile;
    const root = panel(
      'Splash Critters',
      profile
        ? card(
            el('div', { class: 'spread' }, [
              el('span', {}, [
                el('strong', {}, [`${profile.nickname}`]),
                el('span', { class: 'tag' }, [`#${profile.tag}`]),
              ]),
              el('div', { class: 'row' }, [
                tierPill(profile.tier),
                el('span', { class: 'hint' }, [`LV ${profile.level}`]),
              ]),
            ]),
            el('div', { class: 'row' }, [
              el('span', { class: 'hint' }, ['DUEL']),
              el('span', {}, [`${profile.ratingDuel}`]),
              el('span', { class: 'hint' }, ['FFA']),
              el('span', {}, [`${profile.ratingFfa}`]),
            ]),
          )
        : card(el('span', { class: 'muted' }, ['Connecting to the server…'])),
      el('h2', {}, ['Ranked']),
      el('div', { class: 'row' }, [
        button('Ranked duel', () => app.queueRanked('duel'), 'primary'),
        button('Ranked free-for-all', () => app.queueRanked('ffa')),
      ]),
      el('h2', {}, ['Casual']),
      el('div', { class: 'row' }, [
        button('Browse rooms', () => app.go('browser')),
        button('Create room', () => this.createRoom(app)),
        button('Join by code', () => this.joinByCode(app)),
        button('Practice vs bots', () => this.practice(app)),
      ]),
      el('h2', {}, ['Extras']),
      el('div', { class: 'row' }, [
        button('Leaderboard', () => app.go('leaderboard')),
        button('Locker', () => app.go('locker')),
        button('How to play', () => app.go('help')),
        button('Settings', () => app.go('settings')),
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

  private createRoom(app: App): void {
    const nameInput = el('input', { type: 'text', value: 'Splash Room', maxlength: 24 });
    const sizeSelect = el('select', {}, [
      el('option', { value: '2' }, ['2 players (duel)']),
      el('option', { value: '4' }, ['4 players (free-for-all)']),
    ]);
    const themeSelect = el('select', {}, [
      el('option', { value: 'random' }, ['Random theme']),
      el('option', { value: 'backyard' }, ['Backyard']),
      el('option', { value: 'beach' }, ['Beach']),
      el('option', { value: 'pool' }, ['Pool party']),
    ]);
    const roundsSelect = el('select', {}, [
      el('option', { value: '2' }, ['2 rounds']),
      el('option', { value: '3' }, ['3 rounds']),
      el('option', { value: '5' }, ['5 rounds']),
    ]);
    const publicInput = el('input', { type: 'checkbox' });
    publicInput.checked = true;
    const botInput = el('input', { type: 'checkbox' });

    const root = panel(
      'Create a room',
      el('div', { class: 'col' }, [
        el('div', {}, [el('label', {}, ['Room name']), nameInput]),
        el('div', {}, [el('label', {}, ['Room size']), sizeSelect]),
        el('div', {}, [el('label', {}, ['Map theme']), themeSelect]),
        el('div', {}, [el('label', {}, ['Rounds to win']), roundsSelect]),
        el('label', {}, [publicInput, ' Public room (visible in the browser)']),
        el('label', {}, [botInput, ' Fill empty slots with bots']),
      ]),
      el('div', { class: 'row' }, [
        button('Create', () => {
          app.send({
            t: 'create_room',
            opts: {
              name: nameInput.value.trim() || 'Splash Room',
              maxPlayers: Number(sizeSelect.value) === 4 ? 4 : 2,
              isPublic: publicInput.checked,
              theme: themeSelect.value as 'backyard' | 'beach' | 'pool' | 'random',
              roundsToWin: Number(roundsSelect.value),
              botFill: botInput.checked,
            },
          });
          clear(app.overlay);
        }, 'primary'),
        button('Back', () => app.go('menu')),
      ]),
    );
    app.overlay.appendChild(root);
  }

  private joinByCode(app: App): void {
    const input = el('input', { type: 'text', maxlength: 6, placeholder: 'CODE' });
    const root = panel(
      'Join by code',
      el('div', { class: 'col' }, [el('label', {}, ['Room code']), input]),
      el('div', { class: 'row' }, [
        button('Join', () => {
          app.send({ t: 'join_room', code: input.value.trim().toUpperCase() });
          clear(app.overlay);
        }, 'primary'),
        button('Back', () => app.go('menu')),
      ]),
    );
    app.overlay.appendChild(root);
    input.focus();
  }

  private practice(app: App): void {
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
  }
}
