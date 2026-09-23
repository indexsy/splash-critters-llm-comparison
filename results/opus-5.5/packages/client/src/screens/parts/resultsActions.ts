// Results action bar. Casual rooms in the 'results' phase get the rematch vote (live votes /
// needed and a countdown to rematchDeadline) plus Leave Room; once the vote closes the room is
// back in its lobby. Ranked and practice matches just Continue to the menu (practice leaves its
// room first). Escape always has a way out, like every other screen: Leave Room when there is
// one, else Continue.
import type { MatchEndMsg } from '@splash/shared';
import { navigate } from '../../app';
import { net } from '../../net';
import { store } from '../../store';
import { button, h, toast } from '../../ui';
import { formatClockMs, secondsLeft } from './format';
import { rematchTally } from './lobbyRules';
import { navKey, rerender } from './refocus';
import type { Scope } from './scope';
import { progressBar } from './shell';

const COUNTDOWN_MS = 250;

function leaveRoom(): void {
  if (store.get().lobby) net.send({ type: 'leave_room' });
  navigate('/menu');
}

/** The primary way on; `escape` binds Escape to it when nothing else on the bar backs out. */
function continueButton(label: string, onClick: () => void, escape: boolean): HTMLButtonElement {
  const btn = navKey(button(label, onClick, { variant: 'primary', hotkey: escape ? 'Escape' : undefined }), 'continue');
  btn.dataset.autofocus = '';
  return btn;
}

function leaveButton(): HTMLButtonElement {
  return navKey(button('Leave room', leaveRoom, { variant: 'ghost', hotkey: 'Escape' }), 'leave');
}

export function resultsActions(scope: Scope, matchEnd: MatchEndMsg): HTMLElement {
  const bar = h('div', { class: 'results-actions' });
  let countdown: HTMLElement | null = null;

  const voteView = (): Node[] => {
    const lobby = store.get().lobby;
    if (!lobby) return [h('span', { class: 'results-note' }, 'The room has closed.'), continueButton('Continue', () => navigate('/menu'), true)];
    if (lobby.phase === 'in_match') return [h('span', { class: 'results-note blink' }, 'Rematch starting...')];
    if (lobby.phase === 'lobby' || !matchEnd.canRematch) {
      return [
        h('span', { class: 'results-note' }, matchEnd.canRematch ? 'Vote closed' : 'Room is open'),
        leaveButton(),
        continueButton('Back to lobby', () => navigate('/lobby'), false),
      ];
    }
    const tally = rematchTally(lobby);
    // Yes-only: the server counts a 'no' as a decided ballot that can end the vote early, so the
    // way to decline is Leave room.
    const vote = navKey(
      button(tally.youVoted ? 'Voted!' : 'Rematch', () => {
        if (!net.send({ type: 'rematch_vote', yes: true })) toast('Not connected. Try again in a moment.', 'error');
      }, { variant: 'primary', disabled: tally.youVoted, title: 'Vote to play again with the same room' }),
      'vote',
    );
    if (!tally.youVoted) vote.dataset.autofocus = '';
    countdown = h('span', { class: 'vote-clock' });
    return [
      vote,
      h(
        'div',
        { class: 'vote-tally' },
        h('span', null, `${tally.votes}/${tally.needed} votes`),
        progressBar(tally.votes / tally.needed, 'vote', 'Rematch votes').el,
      ),
      countdown,
      leaveButton(),
    ];
  };

  const render = () => {
    countdown = null;
    if (matchEnd.ranked) rerender(bar, () => [continueButton('Continue', () => navigate('/menu'), true)]);
    else if (matchEnd.practice) rerender(bar, () => [continueButton('Continue', leaveRoom, true)]);
    else rerender(bar, voteView);
    tickClock();
  };

  const tickClock = () => {
    const lobby = store.get().lobby;
    if (!countdown || !lobby) return;
    countdown.textContent = formatClockMs(secondsLeft(lobby.rematchDeadline, net.serverNow()) * 1000);
  };

  render();
  scope.interval(tickClock, COUNTDOWN_MS);
  scope.add(
    store.subscribe((next, prev) => {
      if (next.lobby !== prev.lobby && !matchEnd.ranked && !matchEnd.practice) render();
    }),
  );
  return bar;
}
