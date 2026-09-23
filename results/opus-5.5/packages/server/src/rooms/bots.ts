// Bot seats: unique display names ("Bot Bubbles"), a random look, and the MatchParticipant view.
import { randomInt } from 'node:crypto';
import { ANIMAL_IDS, BOT_NAMES, HAT_IDS } from '@splash/shared';
import type { Difficulty } from '@splash/shared';
import type { MatchParticipant } from '../match/types';
import type { BotSeat } from './room';

/** Bots show a fixed level in rosters (they have no progression). */
export const BOT_LEVEL = 1;

function botName(taken: ReadonlySet<string>): string {
  const free = BOT_NAMES.map((n) => `Bot ${n}`).filter((n) => !taken.has(n));
  if (free.length > 0) return free[randomInt(free.length)];
  return `Bot ${BOT_NAMES[randomInt(BOT_NAMES.length)]} ${taken.size + 1}`;
}

/** `auto`: seated by the room (bot fill, take-over), not the host; the seat reopens in the lobby. */
export function makeBotSeat(
  difficulty: Difficulty,
  takenNames: ReadonlySet<string>,
  opts: { auto?: boolean; replacedHuman?: boolean } = {},
): BotSeat {
  return {
    kind: 'bot',
    difficulty,
    auto: opts.auto === true,
    replacedHuman: opts.replacedHuman === true,
    name: botName(takenNames),
    animal: ANIMAL_IDS[randomInt(ANIMAL_IDS.length)],
    hat: HAT_IDS[randomInt(HAT_IDS.length)],
  };
}

export function botParticipant(slot: number, seat: BotSeat): MatchParticipant {
  return {
    slot,
    playerId: null,
    difficulty: seat.difficulty,
    name: seat.name,
    tag: '',
    animal: seat.animal,
    hat: seat.hat,
    level: BOT_LEVEL,
  };
}
