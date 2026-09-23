// Ranked queue while waiting: a guest without a nickname is refused; a lone nicknamed player gets
// a queue_status push every matchmaker pass (elapsed time growing) and sees the search range widen
// by MM_WIDEN_STEP after MM_WIDEN_EVERY_MS, then leaves the queue. Runs in the duel lane, before
// the duel flows, so nobody else is queued meanwhile.
import { CONFIG } from '@splash/shared';
import type { Msg } from '../client';
import type { FlowContext, FlowSpec } from '../harness';

async function run(ctx: FlowContext): Promise<void> {
  const guest = await ctx.connect('guest');
  guest.send({ type: 'queue_join', mode: 'duel' });
  ctx.equal((await guest.take('error')).code, 'nickname_required', 'ranked without a nickname is refused');

  const waiter = await ctx.connectNamed('waiter', 'E2eWaiter');
  const statuses: Msg<'queue_status'>[] = [];
  waiter.onMessage((m) => {
    if (m.type === 'queue_status') statuses.push(m);
  });
  waiter.send({ type: 'queue_join', mode: 'duel' });
  const widened = await waiter.take('queue_status', (m) => m.searchRange > CONFIG.MM_BASE_RANGE, CONFIG.MM_WIDEN_EVERY_MS + 3 * CONFIG.MM_TICK_MS);
  ctx.check(
    widened.searchRange === CONFIG.MM_BASE_RANGE + CONFIG.MM_WIDEN_STEP && widened.elapsedMs >= CONFIG.MM_WIDEN_EVERY_MS,
    `search range widened to ±${widened.searchRange} after ${(widened.elapsedMs / 1000).toFixed(1)} s in the queue`,
  );
  const elapsed = statuses.map((s) => s.elapsedMs);
  ctx.check(
    statuses.length >= Math.floor(CONFIG.MM_WIDEN_EVERY_MS / CONFIG.MM_TICK_MS) && elapsed.every((ms, i) => i === 0 || ms >= elapsed[i - 1]) && statuses.every((s) => s.inQueue === 1),
    `${statuses.length} queue_status pushes, elapsed ${elapsed.map((ms) => (ms / 1000).toFixed(0)).join(',')} s, alone in the queue`,
  );
  waiter.send({ type: 'queue_leave' });
  await waiter.take('queue_left');
  const before = statuses.length;
  await ctx.env.sleep(CONFIG.MM_TICK_MS * 1.5);
  ctx.check(statuses.length === before, 'no more queue_status after queue_leave');
}

export const queueWaitFlow: FlowSpec = { name: 'ranked-queue-wait', timeoutMs: 60_000, run };
