// Results XP panel: "+N XP" counting up while the bar fills level by level (xp_tick blips,
// level_up + LEVEL UP! at every level boundary), the XP breakdown (with a note that practice
// lines are already cut to the practice rate), then newly unlocked cosmetics drawn with their
// sprites (or the next unlock to chase).
import { CONFIG, Dir, animalName, hatName, isAnimalId, isHatId, type AnimalId, type XpAward } from '@splash/shared';
import { audio } from '../../audio';
import { PAL } from '../../render/palette';
import { getAnimalFrame, getCritter } from '../../render/sprites';
import { settings } from '../../settings';
import { h, pixelTitle } from '../../ui';
import { nextUnlock, xpSegments, type XpSegment } from './progress';
import type { Scope } from './scope';
import { chip, progressBar, sectionLabel } from './shell';
import { spriteEl } from './sprite';

const MS_PER_FULL_BAR = 1400;
const MIN_SEGMENT_MS = 250;
const LEVEL_UP_PAUSE_MS = 750;
const TICK_EVERY_MS = 85;

export interface XpPanel {
  readonly el: HTMLElement;
  /** Run the count-up; `onDone` fires once the bar settles (immediately without an award). */
  play(onDone: () => void): void;
}

function unlockTile(id: string, animal: AnimalId): HTMLElement | null {
  const cb = settings.get().colorblind;
  if (isAnimalId(id)) return h('div', { class: 'unlock-tile' }, spriteEl(getAnimalFrame(id, Dir.Down, 0, 0, cb), 1, 'unlock-animal'), h('span', null, animalName(id)));
  if (isHatId(id)) return h('div', { class: 'unlock-tile' }, spriteEl(getCritter(animal, id, Dir.Down, 0, 0, cb), 1), h('span', null, hatName(id)));
  return null;
}

/** Why a practice breakdown reads low: every line is already at the practice rate. */
export function practiceXpNote(): string {
  return `Practice match: every line is ${Math.round(CONFIG.XP.PRACTICE_MULT * 100)}% of the usual XP.`;
}

function breakdown(award: XpAward | null, practice: boolean): HTMLElement {
  if (!award) return h('p', { class: 'muted-note' }, 'No XP for this match.');
  const list = h('ul', { class: 'xp-lines' }, award.breakdown.map((l) => h('li', null, h('span', null, l.label), h('span', { class: 'xp-line-val' }, `+${l.xp}`))));
  if (!practice || award.earned <= 0) return list;
  return h('div', { class: 'xp-breakdown' }, list, h('p', { class: 'muted-note xp-practice' }, practiceXpNote()));
}

function segmentMs(seg: XpSegment): number {
  if (seg.to <= seg.from) return 1;
  return Math.max(MIN_SEGMENT_MS, (MS_PER_FULL_BAR * (seg.to - seg.from)) / Math.max(1, seg.max));
}

export function xpPanel(scope: Scope, award: XpAward | null, animal: AnimalId, practice: boolean): XpPanel {
  const levelChip = chip('Lv 1', 'sand');
  const gain = h('span', { class: 'xp-gain' }, '+0 XP');
  const bar = progressBar(0, 'xp', 'Experience');
  const count = h('span', { class: 'xp-count' });
  const extra = h('div', { class: 'xp-extra' });
  const pop = h('div', { class: 'xp-levelup', hidden: true }, pixelTitle('LEVEL UP!', 1, { color: PAL.yellow, shadow: PAL.orangeDark }));
  const lines = breakdown(award, practice);
  const el = h(
    'section',
    { class: 'results-panel results-xp' },
    sectionLabel('Experience'),
    h('div', { class: 'xp-head' }, levelChip, count, gain),
    bar.el,
    lines,
    extra,
    pop,
  );

  const show = (level: number, into: number, max: number, gained: number) => {
    levelChip.textContent = `Lv ${level}`;
    bar.set(into / Math.max(1, max));
    count.textContent = `${Math.round(into)}/${max}`;
    gain.textContent = `+${Math.round(gained)} XP`;
  };

  const levelUp = () => {
    audio.sfx('level_up');
    pop.hidden = false;
    pop.classList.remove('is-popping');
    void pop.offsetWidth;
    pop.classList.add('is-popping');
  };

  /** After the count-up: unlocked cosmetics take the breakdown's place (or the next goal shows). */
  const finish = () => {
    if (!award) return;
    const tiles = award.unlocked.map((id) => unlockTile(id, animal)).filter((t): t is HTMLElement => t !== null);
    if (tiles.length > 0) {
      lines.replaceWith(h('div', { class: 'xp-unlocks' }, h('span', { class: 'xp-new' }, 'Unlocked!'), h('div', { class: 'xp-unlock-grid' }, tiles)));
      return;
    }
    const next = nextUnlock(award.levelAfter);
    if (next) extra.replaceChildren(h('span', { class: 'muted-note' }, `Next: ${next.name} at Lv ${next.level}`));
  };

  const segs = award ? xpSegments(award.xpBefore, award.xpAfter) : [];

  const play = (onDone: () => void) => {
    if (!award) {
      onDone();
      return;
    }
    let index = 0;
    let segStart = performance.now();
    let banked = 0;
    let ticks = 0;
    let lastTick = 0;
    scope.loop((now) => {
      if (now < segStart) return;
      const seg = segs[index];
      const p = Math.min(1, (now - segStart) / segmentMs(seg));
      const into = seg.from + (seg.to - seg.from) * p;
      show(seg.level, into, seg.max, banked + into - seg.from);
      if (seg.to > seg.from && p < 1 && now - lastTick >= TICK_EVERY_MS) {
        audio.sfx('xp_tick', { level: ticks++ });
        lastTick = now;
      }
      if (p < 1) return;
      banked += seg.to - seg.from;
      index += 1;
      segStart = now + (seg.levelsUp ? LEVEL_UP_PAUSE_MS : 0);
      if (seg.levelsUp) levelUp();
      if (index < segs.length) return;
      finish();
      onDone();
      return false;
    });
  };

  if (segs.length > 0) show(segs[0].level, segs[0].from, segs[0].max, 0);
  else levelChip.hidden = true;
  return { el, play };
}
