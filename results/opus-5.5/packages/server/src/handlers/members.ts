// MemberInfo straight from the database (rooms and the matchmaker always see current looks/level).
import { levelFromXp } from '@splash/shared';
import { getPlayer, type Db } from '../db';
import type { MemberInfo } from '../match/types';
import { ClientError } from '../net/errors';

export function memberInfo(db: Db, playerId: string): MemberInfo {
  const player = getPlayer(db, playerId);
  if (!player) throw new ClientError('not_found', 'Unknown player.');
  return {
    playerId,
    name: player.nickname,
    tag: player.tag,
    animal: player.animal,
    hat: player.hat,
    level: levelFromXp(player.xp).level,
    hasNickname: player.hasNickname,
  };
}
