import { levelProgress, type ServerMessage } from '@splash-critters/shared';
import type { App } from '../app.js';
import { button, card, clear, el, panel, tierPill } from '../ui.js';

/** End of match summary: placements, fun stats, XP and rating changes. */
export class ResultsScreen {
  private app: App | null = null;

  show(app: App): void {
    this.app = app;
    clear(app.overlay);
    const message = app.lastMatchEnd;
    const profile = app.state.profile;

    const children: (Node | string)[] = [];
    if (!message) {
      children.push(el('p', {}, ['No match data.']));
    } else {
      const ranked = message.ranked;
      const table = el('table', {}, [
        el('tr', {}, [
          el('th', {}, ['#']),
          el('th', {}, ['Player']),
          el('th', {}, ['Rounds']),
          el('th', {}, ['Soaks']),
          el('th', {}, ['Castles']),
          el('th', {}, ['Chain']),
        ]),
      ]);
      for (const placement of [...message.placements].sort((a, b) => a.placement - b.placement)) {
        const delta = message.ratingDeltas.find((d) => d.playerId === placement.playerId);
        const isMe = placement.playerId === app.state.playerId;
        table.appendChild(
          el('tr', { style: isMe ? 'color:#f7d14b' : '' }, [
            el('td', {}, [String(placement.placement)]),
            el('td', {}, [
              placement.nickname ? `${placement.nickname}${placement.tag ? `#${placement.tag}` : ''}` : 'bot',
            ]),
            el('td', {}, [String(placement.roundWins)]),
            el('td', {}, [String(placement.soaks)]),
            el('td', {}, [String(placement.castlesWashed)]),
            el('td', {}, [String(placement.biggestChain)]),
          ]),
        );
        void delta;
      }
      children.push(table);

      if (ranked && message.ratingDeltas.length) {
        children.push(el('h2', {}, ['Rating']));
        const list = el('div', { class: 'list' });
        for (const delta of message.ratingDeltas) {
          const up = delta.delta >= 0;
          list.appendChild(
            el('div', { class: 'item' }, [
              el('div', { class: 'row' }, [
                el('strong', {}, [delta.playerId === app.state.playerId ? 'You' : 'Player']),
                tierPill(delta.tierBefore),
                el('span', { class: 'hint' }, ['->']),
                tierPill(delta.tier),
              ]),
              el('span', { style: `color:${up ? '#2a9d8f' : '#e76f51'}` }, [
                `${up ? '+' : ''}${delta.delta} (${delta.ratingBefore} -> ${delta.ratingAfter})`,
              ]),
            ]),
          );
        }
        children.push(list);
      }

      const xpEntry = message.xp.find((x) => x.playerId === app.state.playerId);
      if (xpEntry) {
        const progress = levelProgress(xpEntry.totalXp);
        children.push(el('h2', {}, ['Experience']));
        children.push(
          card(
            el('div', { class: 'spread' }, [
              el('span', {}, [`+${xpEntry.xp} XP`]),
              el('span', { class: 'hint' }, [`Level ${progress.level} - ${progress.current}/${progress.needed}`]),
            ]),
            el('div', { style: 'height:8px;background:#0b1120;margin-top:4px' }, [
              el('div', {
                style: `height:8px;width:${Math.round(progress.ratio * 100)}%;background:#f4a261`,
              }),
            ]),
            xpEntry.levelUp ? el('p', { style: 'color:#f7d14b' }, ['LEVEL UP!']) : el('span'),
          ),
        );
      }

      const stats = message.stats;
      const statList = el('div', { class: 'row' }, [
        statCard('Most soaks', stats.mostSoaks),
        statCard('Castle crusher', stats.castleCrusher),
        statCard('Longest survivor', stats.longestSurvivor),
        statCard('Biggest chain', stats.biggestChain),
      ]);
      children.push(el('h2', {}, ['Awards']), statList);
    }

    children.push(
      el('div', { class: 'row' }, [
        message && !message.ranked
          ? button('Vote for a rematch', () => {
              app.send({ t: 'rematch_vote' });
              app.toast('rematch vote sent');
            })
          : el('span'),
        button('Continue', () => app.go('menu'), 'primary'),
      ]),
    );
    if (profile) {
      children.push(el('p', { class: 'hint' }, [`Level ${profile.level} - ${profile.xp} XP total`]));
    }

    const root = panel('Match results', ...children);
    app.overlay.appendChild(root);
  }

  hide(): void {
    if (this.app) clear(this.app.overlay);
  }

  update(): void {
    /* static */
  }
}

function statCard(label: string, value?: string): HTMLElement {
  return card(
    el('div', { class: 'hint' }, [label.toUpperCase()]),
    el('strong', {}, [value || '-']),
  );
}
