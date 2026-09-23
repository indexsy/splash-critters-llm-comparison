// What a ranked forfeit cost. The leaver gets no results screen: the server only sends a fresh
// profile once the match is settled, at once when the forfeit ends it (a Duel) or when the
// others finish (FFA). One toast says what happened with the rating change when that profile
// arrives within a moment; otherwise "forfeited" shows now and the change once the match settles.
import type { MatchConfig, Mode, RatingInfo } from '@splash/shared';
import { matchLiveness } from '../../game/liveness';
import { store } from '../../store';
import { toast } from '../../ui';
import { modeLabel, signed } from './format';

/** How long a Duel forfeit gets to settle before "forfeited" is shown without the numbers. */
export const SETTLE_WAIT_MS = 1200;
/** Stop waiting for the settlement after this long (an FFA the player left plays on without them). */
export const WATCH_LIMIT_MS = 30 * 60 * 1000;
/** These toasts carry the rating change, so they stay up a little longer than the default. */
const NOTICE_MS = 5000;

let stopWatching: (() => void) | null = null;

/** "Duel rating 1000 to 968 (-32)". */
export function ratingChangeText(mode: Mode, before: number, after: number): string {
  return `${modeLabel(mode)} rating ${before} to ${after} (${signed(after - before)})`;
}

/** Shown when the forfeited match has not settled yet (the others are still playing). */
export function forfeitPendingText(mode: Mode): string {
  return `Match forfeited. Your ${modeLabel(mode)} rating changes when the match ends.`;
}

/**
 * The settled result. `announced`: the pending text was already shown. A win means everyone else
 * had already left when this player did (the match was over before the forfeit reached it).
 */
export function forfeitSettledText(mode: Mode, before: RatingInfo, after: RatingInfo, announced: boolean): string {
  const change = ratingChangeText(mode, before.rating, after.rating);
  if (after.wins > before.wins) return `Match won: everyone else left first. ${change}`;
  return announced ? `Your forfeited match is over. ${change}` : `Match forfeited. ${change}`;
}

/**
 * Call right after leaving a ranked match: watches the profile for that mode's next settled game
 * and reports it (a newer forfeit replaces an older watch). A result landing while the player is
 * already in another live match stays quiet; the profile card shows it.
 */
export function watchForfeit(match: Pick<MatchConfig, 'matchId' | 'mode'>): void {
  stopWatching?.();
  const { mode, matchId } = match;
  const before = store.get().profile?.ratings[mode] ?? null;
  if (!before) {
    toast('Match forfeited', 'warn', NOTICE_MS);
    return;
  }
  let announced = false;
  const inAnotherMatch = () => {
    const { match: now, matchEnd } = store.get();
    return now !== null && now.matchId !== matchId && matchLiveness(now, matchEnd) === 'live';
  };
  const stop = () => {
    clearTimeout(pending);
    clearTimeout(limit);
    unsubscribe();
    if (stopWatching === stop) stopWatching = null;
  };
  const pending = setTimeout(() => {
    announced = true;
    toast(forfeitPendingText(mode), 'warn', NOTICE_MS);
  }, SETTLE_WAIT_MS);
  const limit = setTimeout(stop, WATCH_LIMIT_MS);
  const unsubscribe = store.subscribe((next) => {
    const after = next.profile?.ratings[mode];
    if (!after || after.games <= before.games) return;
    stop();
    if (announced && inAnotherMatch()) return;
    toast(forfeitSettledText(mode, before, after, announced), announced ? 'info' : 'warn', NOTICE_MS);
  });
  stopWatching = stop;
}
