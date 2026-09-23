// Flow 7: hostile or broken clients. A bystander sits in a lobby while other sockets send
// messages before hello, a wrong protocol version, malformed JSON, unknown types, oversized
// frames, a 500-message flood, replayed (decreasing-seq) inputs and host-only commands from a
// guest. Each offender gets an error or is closed; the server stays healthy, the bystander never
// notices, and the same port still serves the built client next to /ws, /api and /health.
import { CONFIG, Dir } from '@splash/shared';
import type { HealthInfo } from '../../../src/net/gameServer';
import type { Msg, WsClient } from '../client';
import type { FlowContext, FlowSpec } from '../harness';

const FLOOD_SIZE = 500;
const WS_MESSAGE_TOO_BIG = 1009;
const CLOSE_POLICY = 1008;

async function expectError(ctx: FlowContext, client: WsClient, code: Msg<'error'>['code'], what: string): Promise<void> {
  const err = await client.take('error');
  ctx.equal(err.code, code, what);
}

/** Replayed / reordered inputs are ignored: the ack never goes back and the old input is not applied. */
async function replayedInput(ctx: FlowContext): Promise<void> {
  const player = await ctx.connect('replayer');
  player.send({ type: 'create_room', opts: { name: 'Practice', size: 2, isPublic: false, theme: 'pool', roundsToWin: 2, botFill: false, practice: true, practiceDifficulty: 'easy' } });
  await player.take('match_start');
  await player.take('snapshot', (m) => m.tick > 0, 10_000);
  player.send({ type: 'input', seq: 50, tick: 0, dir: Dir.None, balloonPressed: false });
  await player.take('snapshot', (m) => m.ack === 50);
  player.send({ type: 'input', seq: 40, tick: 0, dir: Dir.None, balloonPressed: true });
  player.send({ type: 'input', seq: 41, tick: 0, dir: Dir.None, balloonPressed: true });
  const later = await player.take('snapshot', (m) => m.tick >= CONFIG.TICK_RATE * 2);
  const me = later.players.find((p) => p.slot === 0);
  ctx.check(later.ack === 50 && me?.activeBalloons === 0, `inputs with seq 40, 41 after 50 ignored (ack still ${later.ack}, no balloon placed)`);
  player.send({ type: 'input', seq: 51, tick: 0, dir: Dir.None, balloonPressed: false });
  await player.take('snapshot', (m) => m.ack === 51);
  ctx.note('seq 51 accepted again (ack 51)');
  player.send({ type: 'leave_room' });
  await player.take('left_room');
}

async function run(ctx: FlowContext): Promise<void> {
  const bystander = await ctx.connect('bystander');
  bystander.send({ type: 'create_room', opts: { name: 'Quiet Pond', size: 4, isPublic: false, theme: 'beach', roundsToWin: 3, botFill: false } });
  const { code } = await bystander.take('room_created');
  await bystander.take('lobby_state');

  const early = await ctx.open('no-hello');
  early.send({ type: 'set_ready', ready: true });
  await expectError(ctx, early, 'not_ready', 'message before hello -> error');

  const oldClient = await ctx.open('old-version');
  oldClient.send({ type: 'hello', v: CONFIG.PROTOCOL_VERSION + 1 });
  await expectError(ctx, oldClient, 'bad_version', 'wrong protocol version -> error');
  ctx.equal((await oldClient.closed).code, CLOSE_POLICY, 'wrong protocol version -> socket closed');

  const garbage = await ctx.connect('garbage');
  garbage.sendRaw('{"type":"create_room","opts":');
  await expectError(ctx, garbage, 'bad_message', 'malformed JSON -> error');
  const unknown = await ctx.connect('unknown');
  unknown.sendRaw(JSON.stringify({ type: 'teleport', x: 3, y: 4 }));
  await expectError(ctx, unknown, 'bad_message', 'unknown message type -> error');
  const mistyped = await ctx.connect('mistyped');
  mistyped.sendRaw(JSON.stringify({ type: 'input', seq: -1, tick: 0, dir: 9, balloonPressed: 'yes' }));
  await expectError(ctx, mistyped, 'bad_message', 'out-of-range input fields -> error');
  ctx.check(garbage.isOpen && unknown.isOpen && mistyped.isOpen, 'a malformed message is answered, not punished with a disconnect');

  const huge = await ctx.connect('oversized');
  huge.sendRaw(JSON.stringify({ type: 'set_nickname', nickname: 'x'.repeat(CONFIG.MAX_MESSAGE_BYTES * 4) }));
  ctx.equal((await huge.closed).code, WS_MESSAGE_TOO_BIG, `frame over ${CONFIG.MAX_MESSAGE_BYTES} bytes -> socket closed`);

  const flooder = await ctx.connect('flooder');
  for (let i = 0; i < FLOOD_SIZE; i++) flooder.send({ type: 'pong', t: i });
  const closed = await flooder.closed;
  const limited = flooder.all('error').some((e) => e.code === 'rate_limited');
  ctx.check(limited && closed.code === CLOSE_POLICY, `${FLOOD_SIZE}-message flood -> rate_limited error, then closed ${closed.code} (${closed.reason})`);

  const guest = await ctx.connect('guest');
  guest.send({ type: 'join_room', code });
  await guest.take('lobby_state', (m) => m.lobby.yourSlot === 1);
  guest.send({ type: 'set_slot', slot: 2, kind: 'bot', difficulty: 'hard' });
  await expectError(ctx, guest, 'not_host', 'set_slot from a non-host -> error');
  guest.send({ type: 'start_match' });
  await expectError(ctx, guest, 'not_host', 'start_match from a non-host -> error');

  await replayedInput(ctx);

  bystander.send({ type: 'room_list_request' });
  await bystander.take('room_list');
  const view = await bystander.take('lobby_state', (m) => m.lobby.slots[1].kind === 'human');
  ctx.equal(
    view.lobby.slots.map((s) => s.kind),
    ['human', 'human', 'open', 'open'],
    'bystander still connected and served; its room untouched by the guest',
  );
  const health = await ctx.env.getJson<HealthInfo>('/health');
  ctx.check(health.status === 200 && health.body.ok, `server still healthy (/health ${health.status}, ${health.body.players} players online)`);
  if (!ctx.env.server.clientMounted) {
    ctx.note('client dist not built: GET / not checked (run npm run build first)');
    return;
  }
  const page = await fetch(`http://127.0.0.1:${ctx.env.port}/`);
  const html = await page.text();
  ctx.check(
    page.status === 200 && (page.headers.get('content-type') ?? '').includes('text/html') && /<title>[^<]+<\/title>/.test(html),
    `the same port also serves the built client (GET / ${page.status}, ${html.length} bytes of HTML) next to /ws, /api and /health`,
  );
}

export const robustnessFlow: FlowSpec = { name: 'robustness', timeoutMs: 90_000, run };
