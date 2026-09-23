// Match results: headline + fanfare, placements, fun stat cards, the XP bar animation with
// level-ups and unlocks, the ranked rating change with tier progress, and the way on (rematch
// vote for casual rooms, Continue for ranked and practice). Built from store.matchEnd + match.
import type { MatchConfig, MatchEndMsg } from '@splash/shared';
import { navigate } from '../app';
import { audio } from '../audio';
import { net } from '../net';
import { PAL } from '../render/palette';
import { store } from '../store';
import { button, h } from '../ui';
import type { Screen } from './index';
import { focusInitial, installArrowNav } from './parts/arrowNav';
import { runMenuBackdrop } from './parts/backdrop';
import { ratingPanel } from './parts/ratingPanel';
import { resultsActions } from './parts/resultsActions';
import { funStatCards, placementList } from './parts/resultsPlacements';
import { resultHeadline, type ResultMood } from './parts/resultsText';
import { Scope } from './parts/scope';
import { chip, screenShell } from './parts/shell';
import { xpPanel } from './parts/xpPanel';
import './parts/styles/results.css';

const XP_DELAY_MS = 800;
const MUSIC_DELAY_MS = 2600;
const MOOD_COLOR: Record<ResultMood, string> = { victory: PAL.yellow, defeat: PAL.skyLight, neutral: PAL.sand };

let scope: Scope | null = null;

/** The local player's slot in this match (match config when it is the same match, else by id). */
function mySlotIn(matchEnd: MatchEndMsg, match: MatchConfig | null): number {
  if (match && match.matchId === matchEnd.matchId) return match.yourSlot;
  return matchEnd.placements.find((p) => p.playerId !== null && p.playerId === net.playerId)?.slot ?? -1;
}

function kindLabel(m: MatchEndMsg): string {
  return `${m.ranked ? 'Ranked' : m.practice ? 'Practice' : 'Casual'} ${m.mode === 'duel' ? 'Duel' : 'FFA'}`;
}

function noResults(): HTMLElement {
  const back = button('Main menu', () => navigate('/menu'), { variant: 'primary', hotkey: 'Escape' });
  back.dataset.autofocus = '';
  return screenShell({ title: 'Results' }, h('div', { class: 'results-empty' }, h('p', null, 'No match results to show.'), back));
}

function playFanfare(s: Scope, mood: ResultMood): void {
  if (mood !== 'neutral') audio.sfx(mood === 'victory' ? 'victory' : 'defeat');
  s.timeout(() => audio.music('results'), mood === 'neutral' ? 0 : MUSIC_DELAY_MS);
}

function buildResults(s: Scope, matchEnd: MatchEndMsg, match: MatchConfig | null): { el: HTMLElement; start: () => void } {
  const slot = mySlotIn(matchEnd, match);
  const mine = matchEnd.placements.find((p) => p.slot === slot) ?? null;
  const headline = resultHeadline(mine?.placement ?? null, matchEnd.mode);
  const award = matchEnd.xp.find((x) => x.slot === slot) ?? null;
  const delta = matchEnd.ratingDeltas?.find((d) => d.slot === slot) ?? null;
  const xp = xpPanel(s, award, mine?.animal ?? store.get().profile?.animal ?? 'frog', matchEnd.practice);
  const rating = delta ? ratingPanel(s, delta) : null;

  const el = screenShell(
    {
      title: headline.text,
      titleColor: MOOD_COLOR[headline.mood],
      className: `results mood-${headline.mood}`,
      lead: chip(kindLabel(matchEnd), matchEnd.ranked ? 'coral' : 'water'),
      tools: match ? chip(`First to ${match.roundsToWin}`, 'sand') : null,
    },
    h(
      'div',
      { class: 'results-grid' },
      h('div', { class: 'results-main' }, placementList(matchEnd.placements, slot), funStatCards(matchEnd.funStats, matchEnd.placements)),
      h('div', { class: 'results-side' }, xp.el, rating?.el ?? null),
    ),
    resultsActions(s, matchEnd),
  );
  const start = () => {
    playFanfare(s, headline.mood);
    s.timeout(() => xp.play(() => rating?.play()), XP_DELAY_MS);
  };
  return { el, start };
}

export const screen: Screen = {
  mount(root) {
    const s = new Scope();
    scope = s;
    runMenuBackdrop(s);
    s.add(installArrowNav(root));
    const { matchEnd, match } = store.get();
    if (!matchEnd) {
      audio.music('menu');
      root.append(noResults());
      focusInitial(root);
      return;
    }
    const view = buildResults(s, matchEnd, match);
    root.append(view.el);
    view.start();
    focusInitial(root);
  },

  unmount() {
    scope?.dispose();
    scope = null;
  },
};
