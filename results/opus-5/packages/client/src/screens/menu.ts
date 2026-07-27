/**
 * Main menu: the hub every other screen hangs off. It also owns the player card,
 * because levelling up and setting a nickname are things you want to see the
 * moment you land back here after a match.
 */

import {
  CONFIG,
  displayName,
  levelFromXp,
  tierForRating,
  validateNickname,
  type GameMode,
  type PlayerProfile,
  type RatingInfo,
} from '@splash/shared';
import { playSfx, startMusic } from '../audio';
import { on, send } from '../net';
import type { Screen } from '../router';
import { navigate } from '../router';
import { getState, subscribe } from '../store';
import { button, el, field, panel, row, screenShell } from '../ui/dom';

const NICKNAME_ERRORS = new Set(['nickname_invalid', 'nickname_taken', 'nickname_required']);

function ratingFor(profile: PlayerProfile, mode: GameMode): RatingInfo {
  return (
    profile.ratings.find((entry) => entry.mode === mode) ?? {
      mode,
      rating: CONFIG.ELO_START,
      games: 0,
      wins: 0,
      peak: CONFIG.ELO_START,
    }
  );
}

function ratingLine(label: string, info: RatingInfo): HTMLElement {
  const tier = tierForRating(info.rating);
  return el(
    'div',
    { class: 'spread' },
    el('span', { text: label }),
    el(
      'span',
      { class: 'row' },
      el('span', { class: 'badge', text: `${info.rating}` }),
      el('span', { class: `tier tier-${tier.id}`, text: tier.name }),
      el('span', { class: 'muted', text: `${info.games} played` }),
    ),
  );
}

export function createMenuScreen(): Screen {
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeError: (() => void) | null = null;
  let signature = '';

  const card = el('div', { class: 'stack' });
  const nicknameInput = el('input', {
    type: 'text',
    maxLength: CONFIG.NICKNAME_MAX,
    placeholder: 'New nickname',
  });
  const nicknameError = el('p', { class: 'field-hint', text: '' });
  const codeInput = el('input', {
    type: 'text',
    maxLength: CONFIG.ROOM_CODE_LENGTH,
    placeholder: 'ABC123',
    on: {
      input: () => {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      },
    },
  });
  const rankedHint = el('p', { class: 'field-hint', text: '' });
  const rankedButtons: HTMLButtonElement[] = [];

  function canPlayRanked(): boolean {
    const profile = getState().profile;
    return !!profile && validateNickname(profile.nickname).ok;
  }

  function queueFor(mode: GameMode): void {
    if (!canPlayRanked()) return;
    playSfx('ui');
    send({ t: 'queue_join', mode });
    navigate(`/queue/${mode}`);
  }

  function go(path: string): void {
    playSfx('ui');
    navigate(path);
  }

  function submitNickname(): void {
    const value = nicknameInput.value.trim();
    const check = validateNickname(value);
    if (!check.ok) {
      nicknameError.textContent = check.reason ?? 'That nickname will not work.';
      return;
    }
    nicknameError.textContent = '';
    playSfx('ui');
    send({ t: 'set_nickname', nickname: value });
  }

  function joinByCode(): void {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== CONFIG.ROOM_CODE_LENGTH) {
      codeInput.focus();
      return;
    }
    playSfx('ui');
    send({ t: 'join_room', code });
  }

  function startPractice(): void {
    const profile = getState().profile;
    if (!profile) return;
    playSfx('ui');
    send({
      t: 'create_room',
      opts: {
        name: `${profile.nickname} practice`.slice(0, CONFIG.ROOM_NAME_MAX),
        size: 4,
        isPublic: false,
        theme: 'random',
        roundsToWin: CONFIG.DEFAULT_ROUNDS_TO_WIN,
        botFill: true,
        autoStart: true,
      },
    });
  }

  function renderCard(): void {
    const profile = getState().profile;
    const next = profile
      ? `${profile.nickname}#${profile.tag}|${profile.xp}|${profile.ratings.map((r) => `${r.mode}:${r.rating}:${r.games}`).join(',')}`
      : 'none';
    if (next === signature) return;
    signature = next;

    const ranked = canPlayRanked();
    for (const control of rankedButtons) {
      control.disabled = !ranked;
      control.title = ranked ? '' : 'Set a nickname first.';
    }
    rankedHint.textContent = ranked
      ? ''
      : 'Ranked needs a nickname so opponents know who they are playing.';

    if (!profile) {
      card.replaceChildren(el('p', { class: 'muted', text: 'Loading your critter...' }));
      return;
    }

    const { level, into, needed } = levelFromXp(profile.xp);
    const percent = Math.max(0, Math.min(100, Math.round((into / Math.max(1, needed)) * 100)));

    card.replaceChildren(
      el(
        'div',
        { class: 'spread' },
        el('span', { class: 'big-number', text: displayName(profile.nickname, profile.tag) }),
        el('span', { class: 'badge', text: `Level ${level}` }),
      ),
      el('div', { class: 'xp-bar' }, el('span', { style: { width: `${percent}%` } })),
      el('p', { class: 'field-hint', text: `${into} / ${needed} XP to level ${Math.min(CONFIG.MAX_LEVEL, level + 1)}` }),
      ratingLine('Duel rating', ratingFor(profile, 'duel')),
      ratingLine('Free-for-All rating', ratingFor(profile, 'ffa')),
      field(
        'Change nickname',
        row(nicknameInput, button('Set nickname', submitNickname)),
        `${CONFIG.NICKNAME_MIN} to ${CONFIG.NICKNAME_MAX} characters. Your #tag stays the same.`,
      ),
      nicknameError,
    );
  }

  return {
    mount(host) {
      startMusic('menu');

      const duel = button('Ranked Duel', () => queueFor('duel'), { variant: 'primary', wide: true });
      const ffa = button('Ranked Free-for-All', () => queueFor('ffa'), { variant: 'primary', wide: true });
      rankedButtons.push(duel, ffa);

      host.appendChild(
        screenShell(
          'Main Menu',
          () => go('/'),
          panel('Your critter', card),
          panel(
            'Play ranked',
            el('div', { class: 'grid grid-2' }, duel, ffa),
            el('p', { class: 'field-hint', text: 'Humans only. Separate ratings per mode.' }),
            rankedHint,
          ),
          panel(
            'Casual',
            el(
              'div',
              { class: 'grid grid-2' },
              button('Browse rooms', () => go('/browse'), { wide: true }),
              button('Create room', () => go('/create'), { wide: true }),
            ),
            field('Join by code', row(codeInput, button('Join', joinByCode)), 'Six characters, from a shared link or a friend.'),
          ),
          panel(
            'Practice',
            button('Practice vs bots', startPractice, { wide: true }),
            el('p', { class: 'field-hint', text: 'A private four-player room that fills with bots and starts at once.' }),
          ),
          panel(
            'More',
            el(
              'div',
              { class: 'grid grid-2' },
              button('Leaderboard', () => go('/leaderboard'), { wide: true }),
              button('Locker', () => go('/locker'), { wide: true }),
              button('How to play', () => go('/howto'), { wide: true }),
              button('Settings', () => go('/settings'), { wide: true }),
            ),
          ),
        ),
      );

      renderCard();
      unsubscribeStore = subscribe(renderCard);
      unsubscribeError = on('error', (msg) => {
        if (NICKNAME_ERRORS.has(msg.code)) nicknameError.textContent = msg.msg;
      });
    },

    unmount() {
      unsubscribeStore?.();
      unsubscribeError?.();
      unsubscribeStore = null;
      unsubscribeError = null;
      rankedButtons.length = 0;
    },
  };
}
