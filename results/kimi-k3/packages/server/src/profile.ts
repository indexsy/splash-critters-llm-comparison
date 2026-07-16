import { AnimalId, HatId, ProfileDto } from '@splash/shared';
import * as db from './db/index.js';

export function profileDtoForSend(playerId: string): ProfileDto | null {
  const p = db.profileFor(playerId);
  if (!p) return null;
  return {
    playerId: p.playerId,
    nickname: p.nickname,
    tag: p.tag,
    xp: p.xp,
    level: p.level,
    selectedAnimal: p.selectedAnimal as AnimalId,
    selectedHat: p.selectedHat as HatId,
    tutorialDone: p.tutorialDone,
    ratings: p.ratings,
    unlocks: p.unlocks,
  };
}
