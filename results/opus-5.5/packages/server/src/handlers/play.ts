// In-game messages (inputs, emotes) and the tutorial.
import { buildProfile, skipTutorial } from '../accounts';
import type { Handler } from './context';
import { prepareForActivity } from './lobby';
import { memberInfo } from './members';

export const handleInput: Handler<'input'> = (ctx, { playerId, msg, now }) => {
  ctx.rooms.pushInput(playerId, { seq: msg.seq, dir: msg.dir, balloon: msg.balloonPressed }, now);
};

/** Emotes are rate-limited per socket (EMOTE_COOLDOWN_MS); extra presses are dropped silently. */
export const handleEmote: Handler<'emote'> = (ctx, { session, playerId, msg, now }) => {
  if (!ctx.rooms.roomOf(playerId) || !session.tryEmote(now)) return;
  ctx.rooms.emote(playerId, msg.id, now);
};

export const handleTutorialStart: Handler<'tutorial_start'> = (ctx, { playerId, now }) => {
  prepareForActivity(ctx, playerId);
  ctx.rooms.startTutorial(memberInfo(ctx.db, playerId), now);
};

/** Skipping marks the tutorial done without XP, closes the sandbox (left_room) and refreshes the profile. */
export const handleTutorialSkip: Handler<'tutorial_skip'> = (ctx, { session, playerId }) => {
  skipTutorial(ctx.db, playerId);
  ctx.rooms.endTutorial(playerId, 'left');
  session.send({ type: 'profile', profile: buildProfile(ctx.db, playerId) });
};
