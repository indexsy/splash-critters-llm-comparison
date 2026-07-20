import type { PlacementDTO } from '@splash/shared';
import { net } from '../net';
import { drawCritter } from '../render/sprites';
import { nav, type ScreenInstance } from '../router';
import { slotColor } from '../theme';
import { store } from '../store';
import { btn, clearNode, h, screenEl } from '../ui';

const MEDALS = ['🥇', '🥈', '🥉', '4th'];

export function mount(root: HTMLElement): ScreenInstance {
  const el = screenEl();

  function render(): void {
    clearNode(el);
    const result = store.result;
    if (!result) {
      el.append(h('div', { class: 'subtitle', text: 'No results.' }), btn('Menu', { onclick: () => nav.go('menu') }));
      return;
    }
    const inRoom = !!store.lobby && store.lobby.phase === 'results' && !store.lobby.ranked;

    el.append(
      h('div', { class: 'title', style: 'font-size:26px', text: result.ranked ? 'Ranked Results' : 'Match Results' }),
      h('div', { class: 'list' }, result.placements.map((p, i) => placementRow(p, i))),
      awards(result.awards),
      xpBar(),
      h('div', { class: 'row', style: 'margin-top:10px' }, [
        inRoom
          ? btn(`Rematch (${store.lobby?.rematchVotes ?? 0}/${store.lobby?.rematchNeeded ?? 1})`, { variant: 'accent grow', onclick: () => net.send({ type: 'rematch_vote', vote: true }) })
          : h('span', { class: 'spacer' }),
        btn(inRoom ? 'Back to Lobby' : 'Main Menu', {
          variant: 'primary grow',
          onclick: () => {
            if (inRoom) nav.go('lobby');
            else {
              net.send({ type: 'leave_room' });
              nav.go('menu');
            }
          },
        }),
      ]),
    );
  }

  function placementRow(p: PlacementDTO, i: number): HTMLElement {
    const cv = h('canvas', { width: '28', height: '28', style: 'image-rendering:pixelated;width:36px;height:36px' }) as HTMLCanvasElement;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    drawCritter(c, { animal: p.animal, hat: 'none', cx: 14, cy: 16, size: 26, facing: 'down', frame: 0, moving: false, ownerSlot: p.slot });
    const delta = p.ratingDelta;
    return h('div', { class: 'list-row', style: `grid-template-columns:auto auto 1fr auto;border-color:${slotColor(p.slot, store.settings.colorblind)}` }, [
      h('div', { style: 'font-size:20px;min-width:34px;text-align:center', text: MEDALS[Math.min(i, 3)] }),
      cv,
      h('div', {}, [
        h('div', { style: 'font-weight:700', text: p.name.split('#')[0] }),
        h('div', { class: 'small muted', text: `${p.roundWins} rounds · ${p.soaks} soaks · ${p.castlesWashed} castles` }),
      ]),
      h('div', { style: 'text-align:right' }, [
        delta !== null
          ? h('div', { style: `font-weight:800;color:${delta >= 0 ? 'var(--good)' : 'var(--bad)'}`, text: `${delta >= 0 ? '+' : ''}${delta}` })
          : h('div', { class: 'small muted', text: `+${p.xpEarned} xp` }),
        delta !== null ? h('div', { class: 'small muted', text: `${p.ratingAfter} · ${p.tierName ?? ''}` }) : h('span', {}),
      ]),
    ]);
  }

  function awards(list: import('@splash/shared').AwardDTO[]): HTMLElement {
    if (!list.length) return h('div', {});
    return h('div', { class: 'row', style: 'flex-wrap:wrap' }, list.map((a) => h('span', { class: 'chip', text: `${a.label}: ${a.name.split('#')[0]} (${a.value})` })));
  }

  function xpBar(): HTMLElement {
    const prof = store.profile;
    const xp = store.lastXp;
    if (!prof) return h('div', {});
    const pct = Math.min(100, Math.round((prof.xpInto / Math.max(1, prof.xpNeed)) * 100));
    const bar = h('div', { class: 'bar' }, [h('span', { style: 'width:0%' })]);
    setTimeout(() => ((bar.firstChild as HTMLElement).style.width = `${pct}%`), 60);
    return h('div', { class: 'panel col', style: 'padding:10px' }, [
      h('div', { class: 'row between' }, [
        h('div', { class: 'tier', text: `Level ${prof.level}` }),
        xp?.leveledUp ? h('span', { class: 'chip', style: 'border-color:var(--accent-2)', text: '⭐ Level up!' }) : h('span', { class: 'small muted', text: `+${xp?.xp ? '' : ''}` }),
      ]),
      bar,
      xp && xp.unlocked.length ? h('div', { class: 'small', style: 'color:var(--accent-2)', text: `Unlocked: ${xp.unlocked.join(', ')}` }) : h('div', { class: 'small muted', text: `${prof.xpInto}/${prof.xpNeed} xp` }),
    ]);
  }

  const unsub = store.subscribe(render);
  render();
  root.append(el);
  return {
    unmount() {
      unsub();
      el.remove();
    },
  };
}
