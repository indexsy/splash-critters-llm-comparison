// Pure text for the results screen: the headline for the local player and fun stat values.
import type { FunStat, Mode } from '@splash/shared';
import { formatClockMs, ordinal } from './format';

export type ResultMood = 'victory' | 'defeat' | 'neutral';

export interface Headline {
  text: string;
  mood: ResultMood;
}

/** "VICTORY!" for 1st, "DEFEAT" for a lost duel, "2nd place" in FFA; neutral when not playing. */
export function resultHeadline(placement: number | null, mode: Mode): Headline {
  if (placement === null) return { text: 'Match over', mood: 'neutral' };
  if (placement === 1) return { text: 'Victory!', mood: 'victory' };
  if (mode === 'duel') return { text: 'Defeat', mood: 'defeat' };
  return { text: `${ordinal(placement)} place`, mood: 'defeat' };
}

/** Characters a fun stat card has room for on its value line. */
export const FUN_VALUE_MAX_CHARS = 11;

/** The value with its unit ("5 soaks"), or without it when that would not fit the card ("1234"). */
function fitCard(withUnit: string, bare: string): string {
  return withUnit.length <= FUN_VALUE_MAX_CHARS ? withUnit : bare;
}

function countWithUnit(count: number, unit: string): string {
  return fitCard(`${count} ${unit}${count === 1 ? '' : 's'}`, String(count));
}

/** Display value for a fun stat ("5 soaks", "01:42", "x4 chain"). longest_survivor is whole seconds. */
export function funStatValue(stat: FunStat): string {
  switch (stat.id) {
    case 'most_soaks':
      return countWithUnit(stat.value, 'soak');
    case 'castle_crusher':
      return countWithUnit(stat.value, 'castle');
    case 'longest_survivor':
      return formatClockMs(stat.value * 1000);
    case 'biggest_chain':
      return fitCard(`x${stat.value} chain`, `x${stat.value}`);
    default:
      return String(stat.value);
  }
}
