// Persists XP awards: lifetime XP, the derived level and any cosmetics unlocked by levelling up.
import { levelFromXp, unlocksBetween } from '@splash/shared';
import type { XpAward, XpLine } from '@splash/shared';
import { addUnlocks, getPlayer, setPlayerXp, type Db } from './db';

/**
 * Adds `earned` XP to a player, recomputes their level and grants cosmetics unlocked between the
 * old and new level. `slot` only labels the award in match results (default 0 for awards outside a
 * match). Runs in one transaction (nested inside a caller's transaction when there is one).
 * Throws for an unknown player.
 */
export function awardXp(db: Db, playerId: string, earned: number, breakdown: XpLine[], slot = 0): XpAward {
  return db.transaction((): XpAward => {
    const player = getPlayer(db, playerId);
    if (!player) throw new Error(`awardXp: unknown player ${playerId}`);
    const gained = Math.max(0, Math.floor(earned));
    const xpBefore = player.xp;
    const xpAfter = xpBefore + gained;
    const levelBefore = levelFromXp(xpBefore).level;
    const levelAfter = levelFromXp(xpAfter).level;
    setPlayerXp(db, playerId, xpAfter, levelAfter);
    const unlocked = addUnlocks(db, playerId, unlocksBetween(levelBefore, levelAfter), Date.now());
    return { slot, playerId, earned: gained, breakdown, xpBefore, xpAfter, levelBefore, levelAfter, unlocked };
  })();
}
