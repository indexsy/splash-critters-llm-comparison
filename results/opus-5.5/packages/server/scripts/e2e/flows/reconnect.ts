// Flow 5: casual disconnects. (a) B's socket dies mid-round and B comes back with the same token
// inside the grace period: welcome, lobby_state, match_start, round_start with resumeTick, then
// snapshots and B's inputs are applied again while the match goes on; a second tab with the same
// token then takes the live session over (old socket closed 4000). (b) A player who never
// returns is replaced by a Medium bot after the grace period (player_status replacedByBot) and the
// bot keeps playing the seat.
import { CONFIG, type S2CType } from '@splash/shared';
import type { Msg, WsClient } from '../client';
import type { FlowContext, FlowSpec } from '../harness';
import { startCasualDuel } from '../lobby';

/** Close code of a socket whose session was taken over by a newer one (ARCHITECTURE section 5). */
const CLOSE_REPLACED = 4000;

/** Waits until the round is live (a snapshot a second into the round). */
function liveSnapshot(client: WsClient): Promise<Msg<'snapshot'>> {
  return client.take('snapshot', (m) => m.tick >= CONFIG.TICK_RATE, 10_000);
}

async function reconnect(ctx: FlowContext): Promise<void> {
  const a = await ctx.connect('A');
  const b = await ctx.connect('B');
  // A stays idle so the round is certainly still running when B comes back.
  ctx.pilot(b, 'medium');
  const start = await startCasualDuel(a, b, 'E2E Reconnect');
  const live = await liveSnapshot(b);
  const { token, playerId } = b.welcome!;
  b.terminate();
  ctx.note(`B dropped at tick ${live.tick}`);
  await a.take('player_status', (m) => m.slot === 1 && !m.connected && !m.replacedByBot);
  await ctx.env.sleep(2000);

  const back = await ctx.open('B-again');
  ctx.pilot(back, 'medium');
  const welcome = await back.hello(token);
  ctx.equal(welcome.playerId, playerId, 'same token -> same player');
  const lobby = await back.take('lobby_state');
  const again = await back.take('match_start');
  const round = await back.take('round_start');
  const order: S2CType[] = back.log.map((m) => m.type).filter((t) => t !== 'profile');
  ctx.equal(order.slice(0, 4), ['welcome', 'lobby_state', 'match_start', 'round_start'], 're-attach sequence');
  ctx.check(lobby.lobby.phase === 'in_match' && lobby.lobby.yourSlot === 1, 'lobby_state: in_match, same seat');
  ctx.check(again.config.matchId === start.config.matchId && again.config.yourSlot === 1, 'match_start: same match, same slot');
  ctx.check(round.resumeTick !== undefined && round.resumeTick > live.tick, `round_start resumes at tick ${round.resumeTick} (dropped at ${live.tick})`);
  await a.take('player_status', (m) => m.slot === 1 && m.connected);
  ctx.note('A saw B reconnect (player_status connected)');

  const resumed = await back.take('snapshot', (m) => m.tick > round.resumeTick!);
  const acked = await back.take('snapshot', (m) => m.ack > 0, 5000);
  ctx.note(`snapshots resumed at tick ${resumed.tick}; B's new inputs applied again (ack ${acked.ack} at tick ${acked.tick})`);
  const later = await a.take('snapshot', (m) => m.tick >= acked.tick + CONFIG.TICK_RATE * 2, 5000);
  ctx.check(later.players.length === 2, `match goes on for both (tick ${later.tick})`);

  // A second tab with the same token while this socket is alive takes the session over.
  const third = await ctx.open('B-third-tab');
  ctx.pilot(third, 'medium');
  await third.hello(token);
  const replaced = await back.closed;
  ctx.equal(replaced.code, CLOSE_REPLACED, 'the older socket is closed as replaced');
  const takeover = await third.take('round_start');
  ctx.check(takeover.resumeTick !== undefined && takeover.resumeTick > later.tick - CONFIG.TICK_RATE, `the new tab is re-attached (resumeTick ${takeover.resumeTick})`);
  await third.take('snapshot', (m) => m.ack > 0, 5000);
  a.send({ type: 'leave_room' });
  third.send({ type: 'leave_room' });
  await Promise.all([a.take('left_room'), third.take('left_room')]);
}

async function takeover(ctx: FlowContext): Promise<void> {
  const a = await ctx.connect('A');
  const b = await ctx.connect('B');
  await startCasualDuel(a, b, 'E2E Takeover');
  const live = await liveSnapshot(a);
  const droppedAt = ctx.env.now();
  b.terminate();
  ctx.note(`B dropped at tick ${live.tick} and never returns`);
  const status = await a.take('player_status', (m) => m.slot === 1 && m.replacedByBot, CONFIG.RECONNECT_GRACE_MS + 5000);
  const waited = ctx.env.now() - droppedAt;
  ctx.check(
    waited >= CONFIG.RECONNECT_GRACE_MS - 50 && waited < CONFIG.RECONNECT_GRACE_MS + 2000 && !status.forfeited,
    `player_status replacedByBot ${(waited / 1000).toFixed(2)} s after the drop`,
  );
  const lobby = await a.take('lobby_state', (m) => m.lobby.slots[1].kind === 'bot');
  ctx.equal(
    { kind: lobby.lobby.slots[1].kind, difficulty: lobby.lobby.slots[1].difficulty, phase: lobby.lobby.phase },
    { kind: 'bot', difficulty: CONFIG.DISCONNECT_BOT_DIFFICULTY, phase: 'in_match' },
    'seat 1 is now a bot',
  );
  const at = await a.take('snapshot');
  const seat = (m: Msg<'snapshot'>) => m.players.find((p) => p.slot === 1);
  const moved = await a.take(
    'snapshot',
    (m) => {
      const now = seat(m);
      const then = seat(at);
      return now !== undefined && then !== undefined && (now.x !== then.x || now.y !== then.y || now.activeBalloons > 0);
    },
    10_000,
  );
  ctx.note(`the bot plays the seat (moving or dropping by tick ${moved.tick})`);
  a.send({ type: 'leave_room' });
  await a.take('left_room');
}

export const reconnectFlow: FlowSpec = { name: 'casual-reconnect', timeoutMs: 90_000, run: reconnect };
export const takeoverFlow: FlowSpec = { name: 'casual-bot-takeover', timeoutMs: 90_000, run: takeover };
