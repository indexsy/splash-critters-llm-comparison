/**
 * Match results: placements, fun stats, an animated XP bar, the ranked rating
 * change and the rematch vote.
 *
 * Everything is derived from the single match_end message parked in the store,
 * so the screen can be rebuilt (or re-entered) without asking the server again.
 */

import {
  CONFIG,
  displayName,
  levelFromXp,
  tierForRating,
  xpForLevel,
  type AnimalId,
  type AwardEntry,
  type HatId,
  type MatchEndMsg,
  type MatchPlacement,
} from '@splash/shared';
import { playSfx, startMusic } from '../audio';
import { send } from '../net';
import { drawCritterIcon } from '../render/sprites';
import { navigate, type Screen } from '../router';
import { showStage } from '../stage';
import { getState, mySlot, setState, subscribe } from '../store';
import { button, el, panel, screenShell } from '../ui/dom';

/** How long the XP bar takes to travel from the pre-match value to the new one. */
const XP_ANIM_MS = 1400;
/** drawCritterIcon paints an 8x8 portrait centred on the point it is given. */
const ICON_PX = 8;

interface CritterSpec {
  slot: number;
  animal: AnimalId;
  hat: HatId;
}

function critterIcon(spec: CritterSpec): HTMLCanvasElement {
  const canvas = el('canvas', {
    attrs: { 'aria-hidden': 'true' },
    style: { width: '24px', height: '24px', display: 'block', imageRendering: 'pixelated' },
  });
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    drawCritterIcon(ctx, spec, ICON_PX / 2, ICON_PX / 2);
  }
  return canvas;
}

/** 'animal:otter' / 'hat:bucket' into the names players actually see. */
function cosmeticName(id: string): string {
  const [kind, key] = id.split(':');
  if (kind === 'animal') return CONFIG.ANIMALS.find((a) => a.id === key)?.name ?? key;
  if (kind === 'hat') return CONFIG.HATS.find((h) => h.id === key)?.name ?? key;
  return id;
}

/** Total lifetime XP a player has when they first reach `level`. */
function xpAtLevelStart(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForLevel(n);
  return total;
}

function findYou(placements: MatchPlacement[]): MatchPlacement | null {
  const playerId = getState().playerId;
  if (playerId) {
    const byId = placements.find((p) => p.playerId === playerId);
    if (byId) return byId;
  }
  const slot = mySlot();
  return placements.find((p) => p.slot === slot) ?? null;
}

function placementTable(placements: MatchPlacement[], you: MatchPlacement | null): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', { text: '#' }),
    el('th', { text: '' }),
    el('th', { text: 'Critter' }),
    el('th', { text: 'Rounds' }),
    el('th', { text: 'Soaks' }),
    el('th', { text: 'Castles' }),
  );
  const body = placements.map((p) => {
    const isYou = you !== null && p.slot === you.slot;
    return el(
      'tr',
      { class: isYou ? 'is-you' : '' },
      el('td', { text: String(p.placement) }),
      el('td', {}, critterIcon({ slot: p.slot, animal: p.animal, hat: p.hat })),
      el('td', { text: displayName(p.nickname, p.tag) }),
      el('td', { text: String(p.roundsWon) }),
      el('td', { text: String(p.soaks) }),
      el('td', { text: String(p.castles) }),
    );
  });
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...body));
}

function awardRow(label: string, entry: AwardEntry | null, unit: (value: number) => string): HTMLElement | null {
  if (!entry) return null;
  return el(
    'div',
    { class: 'spread' },
    el('span', { class: 'field-label', text: label }),
    el('span', {}, `${entry.nickname} `, el('span', { class: 'badge', text: unit(entry.value) })),
  );
}

function awardsPanel(msg: MatchEndMsg): HTMLElement | null {
  const rows = [
    awardRow('Most Soaks', msg.awards.mostSoaks, (v) => `${v}`),
    awardRow('Castle Crusher', msg.awards.castleCrusher, (v) => `${v} castles`),
    awardRow('Longest Survivor', msg.awards.longestSurvivor, (v) => `${Math.round(v / CONFIG.TICK_RATE)}s`),
    awardRow('Biggest Chain', msg.awards.biggestChain, (v) => `${v}x`),
  ].filter((node): node is HTMLElement => node !== null);
  if (rows.length === 0) return null;
  return panel('Fun Stats', el('div', { class: 'stack' }, ...rows));
}

/** Ranked only: rating delta, tier badge and progress through the tier band. */
function ratingPanel(you: MatchPlacement): HTMLElement | null {
  if (you.ratingBefore === null || you.ratingAfter === null) return null;
  const delta = you.ratingDelta ?? you.ratingAfter - you.ratingBefore;
  const tier = tierForRating(you.ratingAfter);
  const deltaColor = delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--danger)' : 'var(--ink-dim)';
  const deltaText = `${delta > 0 ? '+' : ''}${delta}`;

  const topTier = !Number.isFinite(tier.max);
  const low = Number.isFinite(tier.min) ? tier.min : Math.min(you.ratingAfter, tier.max - 200);
  const span = topTier ? 1 : tier.max + 1 - low;
  const progress = topTier ? 1 : Math.max(0, Math.min(1, (you.ratingAfter - low) / span));
  const nextText = topTier
    ? 'Top tier reached. Nothing above a Tsunami.'
    : `${Math.max(0, tier.max + 1 - you.ratingAfter)} rating to the next tier`;

  return panel(
    'Ranked',
    el(
      'div',
      { class: 'spread' },
      el('span', { class: 'big-number', text: String(you.ratingAfter) }),
      el('span', { class: `tier tier-${tier.id}`, text: tier.name }),
    ),
    el(
      'div',
      { class: 'spread' },
      el('span', { class: 'muted', text: `Was ${you.ratingBefore}` }),
      el('span', { style: { color: deltaColor }, text: deltaText }),
    ),
    el('div', { class: 'xp-bar' }, el('span', { style: { width: `${progress * 100}%`, background: 'var(--water)' } })),
    el('span', { class: 'field-hint', text: nextText }),
  );
}

interface XpPanel {
  node: HTMLElement;
  /** Paints the bar for a given lifetime XP total. */
  update(totalXp: number): void;
  /** Lists the cosmetics this match unlocked. Idempotent. */
  revealUnlocks(): void;
}

function xpPanel(you: MatchPlacement): XpPanel {
  const fill = el('span', { style: { width: '0%', transition: 'none' } });
  const label = el('span', { class: 'field-hint', text: '' });
  const levelText = el('span', { class: 'big-number', text: `LV ${you.levelBefore}` });
  const unlockHost = el('div', { class: 'stack' });

  let shownLevel = you.levelBefore;
  const node = panel(
    'Experience',
    el(
      'div',
      { class: 'spread' },
      levelText,
      el('span', { style: { color: 'var(--good)' }, text: `+${you.xpEarned} XP` }),
    ),
    el('div', { class: 'xp-bar' }, fill),
    label,
    unlockHost,
  );

  const revealUnlocks = (): void => {
    if (unlockHost.childElementCount > 0) return;
    for (const id of you.unlocked) {
      unlockHost.appendChild(
        el('div', { class: 'badge', style: { color: 'var(--gold)' }, text: `Unlocked: ${cosmeticName(id)}` }),
      );
    }
  };

  const update = (totalXp: number): void => {
    const { level, into, needed } = levelFromXp(totalXp);
    if (level > shownLevel) {
      shownLevel = level;
      playSfx('level_up');
      revealUnlocks();
    }
    levelText.textContent = `LV ${level}`;
    fill.style.width = `${Math.max(0, Math.min(1, into / needed)) * 100}%`;
    label.textContent = `${into} / ${needed} XP to level ${Math.min(level + 1, CONFIG.MAX_LEVEL)}`;
  };

  return { node, update, revealUnlocks };
}

export function createResultsScreen(): Screen {
  let unsubscribe: (() => void) | null = null;
  let animate: ((dtMs: number) => void) | null = null;

  return {
    mount(host: HTMLElement): void {
      const msg = getState().matchEnd;
      if (!msg) {
        navigate('/menu', true);
        return;
      }
      // The game screen owns the canvas; results is pure DOM.
      showStage(false);

      const placements = [...msg.placements].sort((a, b) => a.placement - b.placement);
      const you = findYou(placements);
      const winner = placements[0] ?? null;
      const youWon = you !== null && you.placement === 1;

      startMusic('results');
      playSfx(youWon ? 'victory' : 'defeat');

      const banner = winner
        ? el('div', {
            class: 'panel center',
            style: { borderColor: youWon ? 'var(--gold)' : 'var(--panel-edge)' },
          },
            el('div', { class: 'big-number', text: youWon ? 'You Win!' : 'Winner' }),
            el('div', { text: displayName(winner.nickname, winner.tag) }),
          )
        : null;

      // The profile has already absorbed this match's XP, so the pre-match total
      // is simply the new total minus what the match awarded.
      const afterXp = getState().profile?.xp ?? (you ? xpAtLevelStart(you.levelAfter) : 0);
      const beforeXp = you ? Math.max(0, afterXp - you.xpEarned) : afterXp;

      let xp: XpPanel | null = null;
      if (you) {
        xp = xpPanel(you);
        xp.update(beforeXp);
        let elapsed = 0;
        animate = (dtMs: number): void => {
          elapsed += dtMs;
          const t = Math.min(1, elapsed / XP_ANIM_MS);
          // Ease-out so the bar lands softly on the final value.
          const eased = 1 - (1 - t) * (1 - t);
          xp?.update(Math.round(beforeXp + (afterXp - beforeXp) * eased));
          if (t >= 1) {
            animate = null;
            // Belt and braces: if the profile total had not landed yet the bar may
            // not have crossed a boundary, but the server still granted these.
            if (you.levelAfter > you.levelBefore) xp?.revealUnlocks();
          }
        };
      }

      const rematchLabel = el('span', { class: 'muted', text: '' });
      const rematchButton = button(
        'Rematch',
        () => {
          send({ t: 'rematch_vote', vote: true });
        },
        { variant: 'primary' },
      );

      const syncRematch = (): void => {
        const state = getState().rematch;
        if (!state) {
          rematchLabel.textContent = 'Vote to run it back.';
          rematchButton.disabled = false;
          return;
        }
        rematchLabel.textContent = `${state.votes} / ${state.needed} voted`;
        rematchButton.disabled = state.youVoted;
      };
      syncRematch();
      unsubscribe = subscribe(syncRematch);

      const actions = el(
        'div',
        { class: 'row' },
        msg.rematchEnabled ? rematchButton : null,
        msg.rematchEnabled ? rematchLabel : null,
        button(
          'Continue',
          () => {
            send({ t: 'leave_room' });
            navigate('/menu');
            // The match is over and its room is gone: nothing may inherit its
            // roster, least of all a later screen that reads store.match.
            setState({ matchEnd: null, rematch: null, match: null });
          },
          { variant: msg.rematchEnabled ? 'secondary' : 'primary' },
        ),
      );

      host.appendChild(
        screenShell(
          'Results',
          null,
          banner,
          panel('Placements', placementTable(placements, you)),
          awardsPanel(msg),
          xp?.node ?? null,
          msg.ranked && you ? ratingPanel(you) : null,
          actions,
        ),
      );
    },

    unmount(): void {
      unsubscribe?.();
      unsubscribe = null;
      animate = null;
    },

    frame(dtMs: number): void {
      animate?.(dtMs);
    },
  };
}
