// Flow 8: artificial latency. On a server started with DEV_LAG_MS (150 ms each way by default) two
// Medium autopilots play a casual duel. The server must measure the round trip in snapshot.pings,
// keep applying one input per tick (no starved ticks once the pipeline is full), and the clients'
// prediction (shared sim, rewind-replay of unacknowledged inputs) must agree with the server's
// authoritative position: that is what makes local movement feel instant under latency.
import { CONFIG } from '@splash/shared';
import type { WsClient } from '../client';
import type { FlowContext, FlowSpec } from '../harness';
import { startCasualDuel } from '../lobby';

/** Seconds of live play observed. */
const OBSERVE_TICKS = 20 * CONFIG.TICK_RATE;
/** Share of ticks (pipeline full) a player may go without a fresh input: timer jitter only. */
const MAX_STARVED = 0.02;
/** Share of prediction checks allowed to disagree (another player's balloon can block a step). */
const MAX_MISPREDICTED = 0.02;

interface AckStats {
  ticks: number;
  starved: number;
}

/**
 * Counts, snapshot to snapshot, ticks whose input did not reach the server in time, once a
 * round's pipeline is full: the server takes inputs only while a round is live, so the first
 * round trip of every round necessarily has none (and after round_over it takes none again).
 */
function watchAcks(client: WsClient): AckStats {
  const stats: AckStats = { ticks: 0, starved: 0 };
  let playing = false;
  let roundAck = -1;
  let warm = false;
  let lastTick = -1;
  let lastAck = -1;
  client.onMessage((m) => {
    if (m.type === 'round_start') {
      playing = true;
      warm = false;
      roundAck = -1;
    } else if (m.type === 'event' && m.events.some((e) => e.type === 'round_over')) {
      playing = false;
    }
    if (m.type !== 'snapshot' || !playing) return;
    if (warm && m.tick > lastTick) {
      stats.ticks += m.tick - lastTick;
      stats.starved += Math.max(0, m.tick - lastTick - (m.ack - lastAck));
    } else if (roundAck < 0) {
      roundAck = m.ack;
    } else if (m.ack > roundAck) {
      warm = true;
    }
    lastTick = m.tick;
    lastAck = m.ack;
  });
  return stats;
}

async function run(ctx: FlowContext): Promise<void> {
  const lag = ctx.env.lagMs;
  ctx.check(lag > 0, `server runs with DEV_LAG_MS ${lag}`);
  const a = await ctx.connect('A');
  const b = await ctx.connect('B');
  const pilots = [ctx.pilot(a, 'medium'), ctx.pilot(b, 'medium')];
  const acks = [watchAcks(a), watchAcks(b)];
  await startCasualDuel(a, b, 'E2E Latency');
  const wallStart = performance.now();
  await a.take('snapshot', (m) => m.tick >= OBSERVE_TICKS, 60_000).catch(() => a.take('round_end', undefined, 1));
  const last = await a.take('snapshot', undefined, 10_000).catch(() => null);
  ctx.note(`observed ${((performance.now() - wallStart) / 1000).toFixed(1)} s of the match; last snapshot tick ${last?.tick ?? 'none (round over)'}`);

  const rtts = last ? last.pings.filter((p) => p >= 0) : [];
  ctx.check(
    rtts.length === 2 && rtts.every((rtt) => rtt >= 2 * lag - 20 && rtt <= 2 * lag + 150),
    `snapshot.pings show the round trip for both players: ${rtts.join(' / ')} ms (2 x ${lag} ms lag)`,
  );
  acks.forEach((s, i) => {
    const share = s.ticks > 0 ? s.starved / s.ticks : 1;
    ctx.check(share <= MAX_STARVED, `player ${i}: ${s.starved}/${s.ticks} ticks without a fresh input (${(share * 100).toFixed(1)}%)`);
  });
  pilots.forEach((p, i) => {
    const { predictionsChecked: checked, predictionsOff: off } = p.stats;
    ctx.check(checked > 100 && off / checked <= MAX_MISPREDICTED, `player ${i}: prediction matched the server ${checked - off}/${checked} times`);
  });
  a.send({ type: 'leave_room' });
  b.send({ type: 'leave_room' });
  await Promise.all([a.take('left_room'), b.take('left_room')]);
}

export const lagFlow: FlowSpec = { name: 'lag-150ms', timeoutMs: 2 * 60_000, run };
