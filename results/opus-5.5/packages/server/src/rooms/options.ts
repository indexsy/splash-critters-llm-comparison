// Create-room options after validation: defaults (room name, practice difficulty) and the rules
// practice rooms impose (private, bots in every other slot, auto-start).
import { CONFIG } from '@splash/shared';
import type { CreateRoomOpts, Difficulty, Mode, ThemeChoice } from '@splash/shared';
import type { MemberInfo } from '../match/types';
import { isAllowedDisplayText } from '../moderation';
import type { RoomSettings } from './room';

export interface RoomPlan {
  settings: Omit<RoomSettings, 'code'>;
  /** Practice rooms seat a bot of this difficulty in every other slot; null for casual rooms. */
  practiceDifficulty: Difficulty | null;
}

const DEFAULT_PRACTICE_DIFFICULTY: Difficulty = 'medium';

function defaultRoomName(member: MemberInfo): string {
  return `${member.name}'s room`.slice(0, CONFIG.ROOM_NAME_MAX);
}

/**
 * The name other players see in the room browser and lobby: the creator's choice, or the default
 * when it is empty or fails the same word filter as nicknames (profanity, slurs, posing as staff).
 */
function roomName(requested: string, member: MemberInfo): string {
  const name = requested.trim();
  return name && isAllowedDisplayText(name) ? name : defaultRoomName(member);
}

function modeForSize(size: 2 | 4): Mode {
  return size === 2 ? 'duel' : 'ffa';
}

/** Turns validated CreateRoomOpts into room settings for the creating member. */
export function planRoom(opts: CreateRoomOpts, member: MemberInfo): RoomPlan {
  const practice = opts.practice === true;
  const theme: ThemeChoice = opts.theme;
  return {
    settings: {
      kind: practice ? 'practice' : 'casual',
      name: roomName(opts.name, member),
      mode: modeForSize(opts.size),
      size: opts.size,
      isPublic: practice ? false : opts.isPublic,
      theme,
      roundsToWin: opts.roundsToWin,
      botFill: practice ? false : opts.botFill,
    },
    practiceDifficulty: practice ? (opts.practiceDifficulty ?? DEFAULT_PRACTICE_DIFFICULTY) : null,
  };
}
