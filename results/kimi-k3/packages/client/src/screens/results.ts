import { CONFIG, tierFor } from '@splash/shared';
import { net } from '../net.js';
import { audio } from '../audio.js';
import { ResultsData, drawMiniIcon } from '../render/hud.js';
import { el, showApp } from './common.js';

export function renderResults(
  root: HTMLElement,
  go: (screen: string, data?: unknown) => void,
  data: ResultsData & { rematchAllowed: boolean },
): void {
  showApp();
  audio.playMusic('menu');
  const my = data.placements.find((p) => p.playerId === data.myPlayerId);
  const winner = [...data.placements].sort((a, b) => a.placement - b.placement)[0];

  const panel = el('div', { class: 'panel col', style: 'min-width:420px;' });
  panel.append(el('h2', {}, [winner && winner.placement === 1 ? `${winner.nickname} WINS!` : 'MATCH OVER']));

  const sorted = [...data.placements].sort((a, b) => a.placement - b.placement);
  for (const p of sorted) {
    const icon = document.createElement('canvas');
    icon.width = 12;
    icon.height = 12;
    icon.style.cssText = 'width:26px;height:26px;image-rendering:pixelated;';
    drawMiniIcon(icon, p.animal, 'none');
    const medal = ['🥇', '🥈', '🥉', '4th'][p.placement - 1] ?? `${p.placement}th`;
    const row = el('div', { class: 'room-row' }, [
      el('span', { style: 'width:30px;' }, [medal]),
      icon,
      el('span', { style: 'min-width:130px;' }, [p.nickname]),
      el('span', { class: 'small' }, [`${p.roundWins} rounds`]),
      el('span', { class: 'small' }, [`${p.soaks} soaks`]),
      el('span', { class: 'small' }, [`${p.castlesWashed} castles`]),
    ]);
    if (!p.isBot && p.playerId === data.myPlayerId) {
      row.append(el('span', { class: 'good small' }, [`+${p.xpEarned} XP`]));
      if (data.ranked && p.ratingBefore !== null && p.ratingAfter !== null) {
        const d = p.ratingAfter - p.ratingBefore;
        row.append(
          el('span', { class: d >= 0 ? 'good small' : 'bad small' }, [
            `${p.ratingBefore}→${p.ratingAfter} (${d >= 0 ? '+' : ''}${d}) ${tierFor(p.ratingAfter)}`,
          ]),
        );
      }
    }
    panel.append(row);
  }

  const bestSoaks = [...sorted].sort((a, b) => b.soaks - a.soaks)[0];
  const bestCastles = [...sorted].sort((a, b) => b.castlesWashed - a.castlesWashed)[0];
  const fun = el('div', { class: 'col', style: 'margin-top:8px;' }, [
    el('div', { class: 'small' }, [`💦 Most Soaks: ${bestSoaks?.nickname ?? '—'} (${bestSoaks?.soaks ?? 0})`]),
    el('div', { class: 'small' }, [`🏰 Castle Crusher: ${bestCastles?.nickname ?? '—'} (${bestCastles?.castlesWashed ?? 0})`]),
  ]);
  panel.append(fun);

  if (my) {
    const prof = net.profile;
    if (prof) {
      const curLevelXp = xpIntoLevel(prof.xp, prof.level);
      const need = CONFIG.xpForLevel(prof.level);
      const bar = el('div', { class: 'xpbar' });
      const fill = el('div');
      fill.style.width = '0%';
      bar.append(fill);
      panel.append(el('div', { class: 'row' }, [el('span', { class: 'small' }, [`Level ${prof.level}`]), bar]));
      setTimeout(() => {
        fill.style.width = `${Math.min(100, (curLevelXp / need) * 100)}%`;
      }, 100);
    }
  }

  const buttons = el('div', { class: 'row' });
  if (data.rematchAllowed) {
    const rematch = el('button', { class: 'good' }, ['REMATCH (vote)']);
    const status = el('span', { class: 'small dim' }, ['']);
    rematch.onclick = () => {
      net.send({ t: 'rematch_vote' });
      rematch.setAttribute('disabled', 'true');
    };
    const off = net.on('rematch_status', (msg) => {
      status.textContent = `${msg.votes}/${msg.needed} votes`;
    });
    cleanup.push(off);
    buttons.append(rematch, status);
  }
  const cont = el('button', { class: 'secondary' }, ['CONTINUE']);
  cont.onclick = () => {
    net.send({ t: 'leave_room' });
    go('menu');
  };
  buttons.append(cont);
  panel.append(buttons);
  root.append(panel);
}

function xpIntoLevel(xp: number, level: number): number {
  let remaining = xp;
  for (let l = 1; l < level; l++) remaining -= CONFIG.xpForLevel(l);
  return Math.max(0, remaining);
}

export const cleanup: (() => void)[] = [];
