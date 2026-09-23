// Acceptance flow 4: netcode feel under ?lag=150 in BOTH tabs (150 ms each way on top of the
// real server). Two tabs of one browser (two players through the Web Locks identity slots) play
// a 2P room; the opt-in net-stats overlay (?netstats=1) and its frame trace measure:
//   (a) frames from a movement key-down to the local critter's first on-screen movement (<= 2),
//   (b) the remote critter's per-frame displacement while it walks steadily (no zero-then-jump),
//   (c) reconciliation corrections (typically < 2 px) and no local rubber-banding.
import { inputLatency, localRubberBand, localSmoothness, remoteSmoothness, summarize } from './feel.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Checks, OUT_DIR, errorsOf, loadChromium, log, newPage, shot, sleep, startServer, stats } from './lib.mjs';
import { createRoom, enterMenu, joinByCode, muteViaSettings, profileName, readyAndStart } from './menus.mjs';
import { myPos } from './pilot.mjs';

const LAG = Number(process.env.E2E_LAG ?? 150);
const checks = new Checks(`flow4-netcode (lag ${LAG})`);
const server = await startServer();
const browser = await loadChromium().launch();

/** Wait until this tab's critter can walk (round live), probing with short real presses. */
async function waitWalkable(page, dir = 'ArrowDown', back = 'ArrowUp') {
  for (let i = 0; i < 60; i++) {
    const a = await myPos(page);
    if (a) {
      await page.keyboard.down(dir);
      await sleep(120);
      await page.keyboard.up(dir);
      await sleep(250);
      const b = await myPos(page);
      if (b && (b.x !== a.x || b.y !== a.y)) {
        await page.keyboard.down(back);
        await sleep(120);
        await page.keyboard.up(back);
        await sleep(400);
        return true;
      }
    }
    await sleep(250);
  }
  return false;
}

/** (a) Short presses from rest, alternating so the critter stays inside its clear spawn area. */
async function latencyPresses(page, count) {
  const since = await page.evaluate(() => performance.now());
  for (let i = 0; i < count; i++) {
    const key = i % 2 === 0 ? 'ArrowDown' : 'ArrowUp';
    await page.keyboard.down(key);
    await sleep(110 + (i % 3) * 20);
    await page.keyboard.up(key);
    await sleep(320 + ((i * 37) % 90));
  }
  return since;
}

/** (b) Steady back-and-forth walking (never reaching the ends, so it never clamps). */
async function walkLegs(page, legs, holdMs) {
  for (let i = 0; i < legs; i++) {
    const key = i % 2 === 0 ? 'ArrowUp' : 'ArrowDown';
    await page.keyboard.down(key);
    await sleep(holdMs);
    await page.keyboard.up(key);
    await sleep(40);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const query = `/?lag=${LAG}&netstats=1`;
  const a = await newPage(context, 'A');
  await enterMenu(a, server.base + query);
  checks.ok('tab A muted via Settings', await muteViaSettings(a));
  const b = await newPage(context, 'B');
  await enterMenu(b, server.base + query);
  const [nameA, nameB] = [await profileName(a), await profileName(b)];
  checks.ok('second tab is a different player (Web Locks identity slot)', nameA && nameB && nameA !== nameB, `${nameA} vs ${nameB}`);
  const code = await createRoom(a, { size: 2, isPublic: false, rounds: 5, botFill: false });
  await joinByCode(b, code);
  checks.ok('B joined the private room by typing its code', (await b.locator('.slot-card').allInnerTexts()).some((t) => t.toUpperCase().includes(nameA.split('#')[0].toUpperCase())), code);
  await readyAndStart(a, b);
  await Promise.all([a, b].map((p) => p.locator('.screen-root[data-screen="game"]').waitFor({ state: 'attached', timeout: 15000 })));
  const liveA = await waitWalkable(a);
  const liveB = await waitWalkable(b, 'ArrowUp', 'ArrowDown');
  checks.ok('both critters walk under lag', liveA && liveB);
  await shot(a, 'f4-01-tabA-netstats');

  // (a) local input latency in tab A (B stands still).
  await a.evaluate(() => window.splashNetStats.reset());
  const sinceA = await latencyPresses(a, 16);
  const traceA = await a.evaluate((t) => ({ frames: window.splashNetStats.frames(t), keys: window.splashNetStats.keys(t) }), sinceA);
  const lat = inputLatency(traceA.frames, traceA.keys);
  const latFrames = summarize(lat.map((l) => l.frames));
  const latMs = summarize(lat.map((l) => l.ms));
  const reportA = await stats(a);
  log(`  (a) presses measured: ${lat.length}; frames ${JSON.stringify(latFrames)}; ms ${JSON.stringify(latMs)}; fps ${reportA.fps}`);
  checks.ok('(a) local movement shows within 2 frames of the key press, despite the lag', lat.length >= 8 && latFrames.max <= 2, `max ${latFrames.max} frames / ${latMs.max} ms over ${lat.length} presses at ${reportA.fps} fps`);
  const rbA = localRubberBand(traceA.frames, traceA.keys);

  // (b) remote smoothness: B walks steadily, A watches.
  await a.evaluate(() => window.splashNetStats.reset());
  const sinceB = await a.evaluate(() => performance.now());
  await walkLegs(b, 14, 420);
  await sleep(600);
  const framesSeen = await a.evaluate((t) => window.splashNetStats.frames(t), sinceB);
  const slotB = framesSeen.find((f) => f.remote.length)?.remote[0]?.slot ?? 1;
  const smooth = remoteSmoothness(framesSeen, slotB);
  log(`  (b) remote legs ${smooth.legs}, frames ${smooth.frames}, per-frame px min ${smooth.minPx} max ${smooth.maxPx}, zero frames ${smooth.zeroFrames}, stutters ${smooth.stutters}, snaps>1 tile ${smooth.snaps}`);
  checks.ok('(b) remote critter walks without zero-then-jump stutter or snaps', smooth.legs >= 8 && smooth.stutters === 0 && smooth.snaps === 0, JSON.stringify(smooth));
  // A ~60 Hz display sees every other frame of this ~120 Hz trace: at 4 tiles/s = ~1.07 px per
  // frame there, a smoothly walking critter should move on (nearly) every frame.
  const fps = (await stats(a)).fps;
  const at60 = fps >= 100 ? remoteSmoothness(framesSeen.filter((_, i) => i % 2 === 0), slotB) : smooth;
  log(`  (b) at ~60 Hz: per-frame px min ${at60.minPx} max ${at60.maxPx}, zero frames ${at60.zeroFrames}/${at60.frames} (${at60.midZeroFrames} mid-leg), stutters ${at60.stutters}`);
  checks.ok('(b) at ~60 Hz the remote critter moves on (almost) every frame mid-walk (<2% still), max 2 px per frame', at60.midZeroFrames <= at60.frames * 0.02 && at60.maxPx <= 2 && at60.stutters === 0, JSON.stringify(at60));
  writeFileSync(join(OUT_DIR, 'f4-remote-trace.json'), JSON.stringify({ slot: slotB, frames: framesSeen }));
  await shot(a, 'f4-02-tabA-watching-B');
  await shot(b, 'f4-03-tabB-walking');

  // (c) reconciliation corrections on both sides, rubber-banding of B's own critter.
  const traceB = await b.evaluate((t) => ({ frames: window.splashNetStats.frames(t), keys: window.splashNetStats.keys(t) }), 0);
  const rbB = localRubberBand(traceB.frames, traceB.keys);
  const ownB = localSmoothness(traceB.frames.filter((f) => f.t >= traceB.keys.find((k) => k.t > 0)?.t));
  log(`  local walking in tab B: legs ${ownB.legs}, per-frame px min ${ownB.minPx} max ${ownB.maxPx}, zero frames ${ownB.zeroFrames}/${ownB.frames}, stutters ${ownB.stutters}`);
  const walkB = traceB.frames.filter((f) => f.t >= traceB.keys.find((k) => k.t > 0)?.t);
  const ownB60 = localSmoothness((await stats(b)).fps >= 100 ? walkB.filter((_, i) => i % 2 === 0) : walkB);
  log(`  local walking in tab B at ~60 Hz: per-frame px min ${ownB60.minPx} max ${ownB60.maxPx} (mid-walk ${ownB60.midMaxPx}), zero frames ${ownB60.zeroFrames}/${ownB60.frames} (${ownB60.midZeroFrames} mid-walk)`);
  checks.ok('own critter walks smoothly between 30 Hz ticks (at ~60 Hz mid-walk: <5% still frames, max 2 px)', ownB60.midZeroFrames <= ownB60.frames * 0.05 && ownB60.midMaxPx <= 2 && ownB60.stutters === 0, JSON.stringify(ownB60));
  const [repA, repB] = [await stats(a), await stats(b)];
  log('  report A', JSON.stringify(repA));
  log('  report B', JSON.stringify(repB));
  for (const [label, rep] of [['A', repA], ['B', repB]]) {
    checks.ok(`(c) tab ${label}: corrections tiny (p95 < 2 px, no snaps)`, rep.correctionPx.p95 < 2 && rep.correctionPx.snaps === 0, JSON.stringify(rep.correctionPx));
  }
  checks.ok('(c) no local rubber-banding while a key is held', rbA.backwards === 0 && rbB.backwards === 0 && rbA.jumps === 0 && rbB.jumps === 0, `A ${JSON.stringify(rbA)} B ${JSON.stringify(rbB)}`);
  checks.ok('overlay reflects the artificial latency (RTT >= 2x lag)', repA.rttMs >= 2 * LAG * 0.9 && repB.rttMs >= 2 * LAG * 0.9, `A ${repA.rttMs} ms, B ${repB.rttMs} ms`);
  checks.ok('input->ack delay is visible in the overlay', repB.ackDelayMs.avg >= 2 * LAG * 0.9, `B avg ${repB.ackDelayMs.avg} ms`);

  // Emote 1 (quack): the bubble shows over A's critter in both tabs.
  await a.keyboard.press('Digit1');
  await sleep(LAG * 2 + 150);
  await shot(a, 'f4-04-emote-tabA');
  await shot(b, 'f4-04-emote-seen-in-tabB');

  // F3 hides the overlay (collection keeps running) and shows it again.
  await a.keyboard.press('F3');
  const hidden = (await a.locator('.net-stats').count()) === 0;
  await a.keyboard.press('F3');
  const shown = (await a.locator('.net-stats').count()) === 1;
  checks.ok('F3 toggles the net-stats overlay', hidden && shown);
  // A reload mid-match (F5) re-attaches the tab to the running round and it plays on; the
  // first snapshot places the critter (no bogus correction from the spawn tile).
  await b.reload();
  await b.locator('.screen-root[data-screen="game"]').waitFor({ state: 'attached', timeout: 15000 });
  const reattached = await waitWalkable(b, 'ArrowUp', 'ArrowDown');
  const afterReload = (await stats(b)).correctionPx;
  checks.ok('after a reload mid-match the tab re-attaches, walks again, with no correction or snap', reattached && afterReload.max < 2 && afterReload.snaps === 0, JSON.stringify(afterReload));
  await shot(b, 'f4-05-tabB-after-reload');
  const errors = errorsOf(a, b);
  checks.ok('no console errors', errors.length === 0, errors.join(' | '));
  await context.close();
} catch (err) {
  checks.ok(`flow crashed: ${err.message}`, false);
} finally {
  await browser.close();
  await server.close();
  checks.finish();
}
