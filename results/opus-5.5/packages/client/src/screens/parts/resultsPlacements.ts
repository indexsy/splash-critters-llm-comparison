// Results: the placement list (podium colours, portraits, rounds won, soaks) and the fun stat
// cards (Most Soaks, Castle Crusher, Longest Survivor, Biggest Chain).
import type { FunStat, PlacementEntry } from '@splash/shared';
import { getGlyph } from '../../render/sprites';
import { h } from '../../ui';
import { nameTag, ordinal } from './format';
import { funStatValue } from './resultsText';
import { chip, sectionLabel } from './shell';
import { portraitEl, spriteEl } from './sprite';

/** Big duel rows step long names down a font size so more of them fits. */
const BIG_NAME_MAX_CHARS = 10;

function placeClass(place: number): string {
  return place === 1 ? 'is-gold' : place === 2 ? 'is-silver' : place === 3 ? 'is-bronze' : '';
}

function stats(p: PlacementEntry): HTMLElement[] {
  return [
    h('span', { class: 'place-stat', title: 'Rounds won' }, spriteEl(getGlyph('star')), String(p.roundsWon)),
    h('span', { class: 'place-stat', title: 'Soaks' }, spriteEl(getGlyph('soaked')), String(p.soaks)),
  ];
}

function leftChip(p: PlacementEntry): HTMLElement | null {
  return p.forfeited ? chip('Left', 'coral') : null;
}

function nameEl(p: PlacementEntry, withChip: boolean): HTMLElement {
  const long = p.name.length > BIG_NAME_MAX_CHARS;
  return h(
    'span',
    { class: `place-name${long ? ' is-long' : ''}`, title: p.isBot ? p.name : nameTag(p.name, p.tag) },
    h('span', { class: 'place-name-text' }, p.name),
    withChip ? leftChip(p) : null,
  );
}

/** Compact row (4 players): rank, portrait, name, stats on one line. */
function placementRow(p: PlacementEntry, mySlot: number): HTMLElement {
  return h(
    'li',
    { class: ['place-row', placeClass(p.placement), p.slot === mySlot ? 'is-me' : ''].filter(Boolean).join(' ') },
    h('span', { class: 'place-rank' }, ordinal(p.placement)),
    portraitEl(p.animal, p.hat, p.slot),
    nameEl(p, true),
    ...stats(p),
  );
}

/** 2x portrait; a player who left gets it dimmed with a LEFT stamp across its foot. */
function bigPortrait(p: PlacementEntry): HTMLElement {
  const portrait = portraitEl(p.animal, p.hat, p.slot, 2);
  if (!p.forfeited) return portrait;
  return h('span', { class: 'place-portrait is-left' }, portrait, leftChip(p));
}

/** Big duel row: rank, 2x portrait, then the name above the stats so long names still fit. */
function bigPlacementRow(p: PlacementEntry, mySlot: number): HTMLElement {
  return h(
    'li',
    { class: ['place-row', 'place-row-big', placeClass(p.placement), p.slot === mySlot ? 'is-me' : ''].filter(Boolean).join(' ') },
    h('span', { class: 'place-rank' }, ordinal(p.placement)),
    bigPortrait(p),
    h('div', { class: 'place-info' }, nameEl(p, false), h('div', { class: 'place-stats' }, ...stats(p))),
  );
}

export function placementList(placements: readonly PlacementEntry[], mySlot: number): HTMLElement {
  const sorted = [...placements].sort((a, b) => a.placement - b.placement || a.slot - b.slot);
  // Duels have room for big portraits; four-player lists stay compact.
  const row = sorted.length <= 2 ? bigPlacementRow : placementRow;
  return h(
    'section',
    { class: 'results-panel results-placements' },
    sectionLabel('Placements'),
    h('ol', { class: 'place-list' }, sorted.map((p) => row(p, mySlot))),
  );
}

function funCard(stat: FunStat, placements: readonly PlacementEntry[]): HTMLElement {
  const who = placements.find((p) => p.slot === stat.slot);
  return h(
    'div',
    { class: 'fun-card' },
    h('span', { class: 'fun-label' }, stat.label),
    h(
      'div',
      { class: 'fun-who' },
      who ? portraitEl(who.animal, who.hat, who.slot) : null,
      h('div', { class: 'fun-text' }, h('span', { class: 'fun-name' }, who ? who.name : 'Nobody'), h('span', { class: 'fun-value' }, who ? funStatValue(stat) : '--')),
    ),
  );
}

export function funStatCards(stats: readonly FunStat[], placements: readonly PlacementEntry[]): HTMLElement | null {
  if (stats.length === 0) return null;
  return h('div', { class: 'fun-stats' }, stats.map((s) => funCard(s, placements)));
}
