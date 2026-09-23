// Flow 2: casual 4p with bots. A creates a public 4-player room and seats two Hard bots; B, with
// the room browser open, sees it listed, joins and readies; A starts; both play (Medium
// autopilots) a full match. Results must agree with the round scores, XP goes to exactly A and B
// and is persisted, the room moves to the rematch vote and a double yes starts a new match.
import { CONFIG, type LobbyState } from '@splash/shared';
import { checkPersistedMatch, checkPlacements, checkXp } from '../checks';
import type { FlowContext, FlowSpec } from '../harness';

const ROUNDS_TO_WIN = 2;
/** Wall-clock budget for the whole match (rounds often run to the tide: see the report). */
const MATCH_WALL_MS = 11 * 60_000;

function slotKinds(lobby: LobbyState): string[] {
  return lobby.slots.map((s) => (s.kind === 'bot' ? `bot:${s.difficulty}` : s.kind));
}

async function run(ctx: FlowContext): Promise<void> {
  const a = await ctx.connect('A');
  const b = await ctx.connect('B');
  const aName = `${a.welcome!.profile.nickname}#${a.welcome!.profile.tag}`;
  b.send({ type: 'room_list_watch', on: true });
  await b.take('room_list');

  a.send({ type: 'create_room', opts: { name: 'E2E Splash Party', size: 4, isPublic: true, theme: 'random', roundsToWin: ROUNDS_TO_WIN, botFill: false } });
  const { code } = await a.take('room_created');
  await a.take('lobby_state', (m) => m.lobby.code === code);
  a.send({ type: 'set_slot', slot: 1, kind: 'bot', difficulty: 'hard' });
  a.send({ type: 'set_slot', slot: 2, kind: 'bot', difficulty: 'hard' });
  const seated = await a.take('lobby_state', (m) => m.lobby.slots[2].kind === 'bot');
  ctx.equal(slotKinds(seated.lobby), ['human', 'bot:hard', 'bot:hard', 'open'], 'A seated two Hard bots');

  const listed = await b.take('room_list', (m) => m.rooms.some((r) => r.code === code && r.players === 3));
  const summary = listed.rooms.find((r) => r.code === code)!;
  ctx.equal(
    { mode: summary.mode, players: `${summary.players}/${summary.maxPlayers}`, joinable: summary.joinable, host: summary.host },
    { mode: 'ffa', players: '3/4', joinable: true, host: aName },
    `B's live room_list shows A's room ${code}`,
  );

  b.send({ type: 'room_list_request', mode: 'duel' });
  const duels = await b.take('room_list', (m) => !m.rooms.some((r) => r.mode === 'ffa'));
  ctx.check(!duels.rooms.some((r) => r.code === code), 'the browser filtered to 2-player rooms hides it');

  b.send({ type: 'join_room', code });
  const joined = await b.take('lobby_state', (m) => m.lobby.code === code);
  ctx.equal(joined.lobby.yourSlot, 3, 'B seated in the open slot');
  for (const id of [0, 1, 2] as const) a.send({ type: 'emote', id });
  const emote = await b.take('emote');
  await ctx.env.sleep(CONFIG.EMOTE_COOLDOWN_MS / 2);
  ctx.check(emote.slot === 0 && emote.id === 0 && b.buffered('emote').length === 0, 'emote relayed to the room; the two spammed within the cooldown dropped');
  b.send({ type: 'set_ready', ready: true });
  await a.take('lobby_state', (m) => m.lobby.slots[3].kind === 'human' && m.lobby.slots[3].ready);
  await b.take('room_list', (m) => m.rooms.some((r) => r.code === code && r.players === 4 && !r.joinable));
  ctx.note('room_list pushed the full room (4/4, not joinable)');

  ctx.pilot(a, 'medium');
  ctx.pilot(b, 'medium');
  a.send({ type: 'start_match' });
  const [startA, startB] = await Promise.all([a.take('match_start'), b.take('match_start')]);
  const { config } = startA;
  ctx.check(
    config.mode === 'ffa' && !config.ranked && config.players.filter((p) => p.isBot && p.difficulty === 'hard').length === 2 && config.players.length === 4,
    'match_start: casual FFA, 2 humans + 2 Hard bots',
  );
  ctx.check(startB.config.matchId === config.matchId && startB.config.yourSlot === 3, 'B got the same match, slot 3');
  const late = await ctx.connect('latecomer');
  late.send({ type: 'join_room', code });
  ctx.equal((await late.take('error')).code, 'room_in_match', 'joining the room mid-match is refused');
  late.close();

  const matchStartedAt = ctx.env.now();
  const [endA, endB] = await Promise.all([a.take('match_end', undefined, MATCH_WALL_MS), b.take('match_end', undefined, MATCH_WALL_MS)]);
  const rounds = a.all('round_end');
  const final = rounds.at(-1)!;
  ctx.note(
    `match took ${rounds.length} rounds, ${((ctx.env.now() - matchStartedAt) / 1000).toFixed(0)} s game time; winners ${rounds.map((r) => (r.winner < 0 ? 'draw' : r.winner)).join(',')}; final scores ${final.scores.join('-')}`,
  );
  ctx.check(final.matchOver && endB.matchId === endA.matchId, 'both players got the same match_end after the deciding round');
  ctx.check(
    Math.max(...final.scores) === ROUNDS_TO_WIN || final.roundNo === CONFIG.MAX_ROUNDS,
    `match ended at ${ROUNDS_TO_WIN} round wins (or the ${CONFIG.MAX_ROUNDS}-round cap)`,
  );
  ctx.check(endA.placements.length === 4 && endA.canRematch && !endA.ranked && endA.ratingDeltas === null, '4 placements, casual (no rating), rematch offered');
  checkPlacements(ctx, endA, final.scores);

  const humans = [a.playerId, b.playerId].sort();
  checkXp(ctx, endA);
  checkPersistedMatch(ctx, endA, 4);
  const totals = ctx.env.query<{ id: string; xp: number }>('SELECT id, xp FROM players WHERE id IN (?, ?) ORDER BY id', ...humans);
  ctx.equal(
    totals.map((t) => t.xp),
    humans.map((id) => endA.xp.find((x) => x.playerId === id)!.xpAfter),
    'SQLite players.xp totals updated',
  );

  const results = await a.take('lobby_state', (m) => m.lobby.phase === 'results');
  ctx.check(results.lobby.rematchDeadline > 0, 'room in phase results with an open rematch vote');
  a.send({ type: 'rematch_vote', yes: true });
  b.send({ type: 'rematch_vote', yes: true });
  const [againA, againB] = await Promise.all([a.take('match_start'), b.take('match_start')]);
  ctx.check(
    againA.config.matchId !== config.matchId && againA.config.matchId === againB.config.matchId,
    `double yes vote started a rematch (${againA.config.matchId.slice(0, 8)})`,
  );
  a.send({ type: 'leave_room' });
  b.send({ type: 'leave_room' });
  await Promise.all([a.take('left_room'), b.take('left_room')]);
}

export const casualFlow: FlowSpec = { name: 'casual-4p-bots', timeoutMs: MATCH_WALL_MS + 60_000, run };
