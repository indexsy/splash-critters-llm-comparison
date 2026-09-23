// MatchConfig / MatchPlayerInfo builders (the match_start payload and match_found roster).
import type { MatchConfig, MatchPlayerInfo, SimRules } from '@splash/shared';
import type { MatchParticipant, MatchSetup } from './types';

export function playerInfo(p: MatchParticipant): MatchPlayerInfo {
  const info: MatchPlayerInfo = {
    slot: p.slot,
    playerId: p.playerId,
    name: p.name,
    tag: p.tag,
    isBot: p.playerId === null,
    animal: p.animal,
    hat: p.hat,
    level: p.level,
  };
  if (p.difficulty && p.playerId === null) info.difficulty = p.difficulty;
  if (p.rating !== undefined) info.rating = p.rating;
  if (p.tier !== undefined) info.tier = p.tier;
  return info;
}

export function matchConfigFor(
  setup: MatchSetup,
  rules: SimRules,
  participants: readonly MatchParticipant[],
  yourSlot: number,
): MatchConfig {
  return {
    matchId: setup.matchId,
    mode: setup.mode,
    ranked: setup.kind === 'ranked',
    practice: setup.kind === 'practice',
    tutorial: setup.kind === 'tutorial',
    roomCode: setup.roomCode,
    roundsToWin: setup.roundsToWin,
    theme: setup.theme,
    w: setup.w,
    h: setup.h,
    rules: { ...rules },
    players: participants.map(playerInfo),
    yourSlot,
  };
}
