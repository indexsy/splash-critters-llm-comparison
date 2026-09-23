// Flow 1: a fresh browser. hello without a token -> generated guest -> tutorial (a lesson-following
// autopilot plays all five lessons) -> match_end with the tutorial XP -> profile.tutorialDone ->
// back to the menu. Several fresh guests go through it at once, each timed: the tutorial must take
// under 2 min (SPEC) and fresh-connection-to-menu under 3 min, for every one of them. One more
// guest skips the tutorial instead (done, no XP).
import { CONFIG } from '@splash/shared';
import { checkUnlocks } from '../checks';
import type { FlowContext, FlowSpec } from '../harness';

const TUTORIAL_LIMIT_MS = 2 * 60_000;
const FRESH_TO_MENU_LIMIT_MS = 3 * 60_000;
const GUEST_NAME = /^[A-Z][a-z]+[A-Z][a-z]+$/;
/** Independent fresh guests playing the tutorial concurrently (reliability, not a single lucky run). */
const GUESTS = 3;

interface StepSeen {
  step: number;
  done: boolean;
  atMs: number;
}

async function playTutorial(ctx: FlowContext, label: string): Promise<number> {
  const { env } = ctx;
  const connectedAt = env.now();
  const client = await ctx.connect(label);
  const { profile, token, playerId } = client.welcome!;
  ctx.check(GUEST_NAME.test(profile.nickname), `${label}: generated guest name ${profile.nickname}#${profile.tag} matches ${GUEST_NAME}`);
  ctx.check(/^\d{4}$/.test(profile.tag), `${label}: guest tag "${profile.tag}" is 4 digits`);
  ctx.check(token.length >= 16 && !profile.hasNickname && !profile.tutorialDone && profile.xp === 0, `${label}: fresh guest: device token issued, no nickname, tutorial not done, 0 XP`);

  ctx.pilot(client, 'tutorial');
  const steps: StepSeen[] = [];
  const startedAt = env.now();
  client.onMessage((m) => {
    if (m.type === 'tutorial_step') steps.push({ step: m.step, done: m.done, atMs: env.now() - startedAt });
  });
  client.send({ type: 'tutorial_start' });
  const { config } = await client.take('match_start');
  ctx.check(config.tutorial && !config.ranked && config.players.length === 2, `${label}: tutorial match_start: sandbox vs one bot`);
  await client.take('round_start');

  const finished = await client.take('tutorial_step', (m) => m.done, TUTORIAL_LIMIT_MS + 30_000);
  const tutorialMs = env.now() - startedAt;
  ctx.note(`${label} lessons: ${steps.map((s) => (s.done ? 'done' : `${s.step}`) + `@${(s.atMs / 1000).toFixed(1)}s`).join(' ')}`);
  const lessonSteps = steps.filter((s) => !s.done).map((s) => s.step);
  ctx.check(
    lessonSteps.every((step, i) => i === 0 || step > lessonSteps[i - 1]) && lessonSteps[0] === 1 && lessonSteps.at(-1) === 5,
    `${label}: lessons advance 1 -> 5 in order (${lessonSteps.join(',')}), then "${finished.title}"`,
  );

  const end = await client.take('match_end');
  ctx.check(end.tutorial && !end.ranked && end.ratingDeltas === null, `${label}: match_end flagged tutorial, unranked`);
  ctx.equal(
    end.xp.map((x) => ({ playerId: x.playerId, earned: x.earned })),
    [{ playerId, earned: CONFIG.XP.TUTORIAL }],
    `${label}: tutorial XP award`,
  );
  checkUnlocks(ctx, end.xp[0]);
  const refreshed = await client.take('profile', (m) => m.profile.tutorialDone);
  ctx.equal(refreshed.profile.xp, CONFIG.XP.TUTORIAL, `${label}: profile XP after the tutorial`);
  const [row] = env.query<{ tutorial_done: number; xp: number }>('SELECT tutorial_done, xp FROM players WHERE id = ?', playerId);
  ctx.equal(row, { tutorial_done: 1, xp: CONFIG.XP.TUTORIAL }, `${label}: SQLite players row (tutorial_done, xp)`);

  client.send({ type: 'leave_room' });
  await client.take('left_room');
  const toMenuMs = env.now() - connectedAt;
  ctx.check(tutorialMs < TUTORIAL_LIMIT_MS, `${label}: tutorial under 2 min (${(tutorialMs / 1000).toFixed(1)} s)`);
  ctx.check(toMenuMs < FRESH_TO_MENU_LIMIT_MS, `${label}: fresh connection to menu under 3 min (${(toMenuMs / 1000).toFixed(1)} s)`);
  return tutorialMs;
}

/** Skipping is allowed: the tutorial counts as done (no more prompts) but earns no XP. */
async function skipTutorial(ctx: FlowContext): Promise<void> {
  const client = await ctx.connect('skipper');
  client.send({ type: 'tutorial_start' });
  await client.take('tutorial_step', (m) => m.step === 1);
  client.send({ type: 'tutorial_skip' });
  const left = await client.take('left_room');
  const { profile } = await client.take('profile', (m) => m.profile.tutorialDone);
  const [row] = ctx.env.query<{ tutorial_done: number; xp: number }>('SELECT tutorial_done, xp FROM players WHERE id = ?', client.playerId);
  ctx.equal(
    { left: left.reason, xp: profile.xp, row },
    { left: 'left', xp: 0, row: { tutorial_done: 1, xp: 0 } },
    'skipper: tutorial_skip closes the sandbox, marks the tutorial done, no XP (SQLite)',
  );
}

async function run(ctx: FlowContext): Promise<void> {
  const labels = Array.from({ length: GUESTS }, (_, i) => `guest${i + 1}`);
  const [durations] = await Promise.all([Promise.all(labels.map((label) => playTutorial(ctx, label))), skipTutorial(ctx)]);
  const secs = durations.map((ms) => (ms / 1000).toFixed(1));
  ctx.note(`tutorial durations for ${GUESTS} fresh guests: ${secs.join(' s, ')} s (limit 120 s)`);
}

export const tutorialFlow: FlowSpec = { name: 'guest-tutorial', timeoutMs: 4 * 60_000, run };
