// Acceptance flow 2: two tabs of ONE browser become two players (Web Locks identity slots).
// Tab A: Casual > Create room (public, 4 players) and sets two slots to Hard bots. Tab B: finds
// the room in Browse rooms (reached with the keyboard), joins and readies; A starts. Both tabs
// get the VS card and 3-2-1-SPLASH!, play on (soaked early, they lob balloons from revenge ducks)
// until the match ends, and the results screen shows placements, fun stats and an animated XP bar
// whose XP matches SQLite. Then both vote for a rematch, which restarts the room.
import { Checks, errorsOf, loadChromium, log, newPage, openDb, shot, sleep, startServer, waitScreen } from './lib.mjs';
import { auditAtAllScales } from './layout.mjs';
import { lobFromDuck, readResults, sampleXpAnimation, shootIntro, waitResults } from './match.mjs';
import { createRoom, enterMenu, muteViaSettings, profileName, readyAndStart, setSlotBot } from './menus.mjs';

/** A match ends by MAX_ROUNDS (15) at the latest: about 2.4 min per round with tide and intros. */
const MATCH_TIMEOUT_MS = 40 * 60 * 1000;
const checks = new Checks('flow2-casual');
const server = await startServer();
const browser = await loadChromium().launch();

function splitTag(nameTag) {
  const i = nameTag.lastIndexOf('#');
  return { nickname: nameTag.slice(0, i), tag: nameTag.slice(i + 1) };
}

function playerRow(db, nameTag) {
  const { nickname, tag } = splitTag(nameTag);
  return db.prepare('SELECT id, xp, level FROM players WHERE nickname = ? AND tag = ?').get(nickname, tag);
}

/** Tab B reaches Browse rooms with the arrow keys + Enter (menu keyboard navigation). */
async function browseWithKeyboard(page) {
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const start = await focused();
  await page.keyboard.press('ArrowDown');
  const target = await focused();
  checks.ok('menu keyboard navigation: Down from the first item focuses Browse rooms', /browse rooms/i.test(target), `${start} -> ${target}`);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'browser');
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const a = await newPage(context, 'A');
  await enterMenu(a, `${server.base}/?netstats=1`);
  checks.ok('tab A muted via Settings', await muteViaSettings(a));
  const b = await newPage(context, 'B');
  await enterMenu(b, `${server.base}/?netstats=1`);
  const [nameA, nameB] = [await profileName(a), await profileName(b)];
  checks.ok('tab B is a different player than tab A', nameA !== nameB, `${nameA} vs ${nameB}`);
  const mutedB = await b.evaluate(() => JSON.parse(localStorage.getItem('splash.settings') ?? '{}').muted === true);
  checks.ok('tab B inherits the muted setting', mutedB);

  await createRoom(a, { size: 4, isPublic: true });
  await setSlotBot(a, 2, 'Hard');
  await setSlotBot(a, 3, 'Hard');
  await shot(a, 'f2-01-lobby-host-hard-bots');

  await browseWithKeyboard(b);
  const row = b.locator('.room-row', { hasText: nameA.split('#')[0] });
  await row.first().waitFor({ timeout: 10000 });
  const rowText = (await row.first().innerText()).replace(/\s+/g, ' ');
  checks.ok("Browse rooms lists A's public 4P room", /4P/.test(rowText) && /\d\/4/.test(rowText), rowText);
  await shot(b, 'f2-02-browser-lists-room');
  await row.first().getByRole('button', { name: 'Join' }).click();
  await waitScreen(b, 'lobby');
  await b.locator('.slot-card.is-you').waitFor({ timeout: 10000 });
  const slotsB = await b.locator('.slot-card').allInnerTexts();
  checks.ok('B joined A\'s room (2 humans + 2 Hard bots)', slotsB.filter((t) => /bot hard/i.test(t)).length === 2 && slotsB.some((t) => t.includes(nameA.split('#')[0].toUpperCase()) || t.includes(nameA.split('#')[0])), slotsB.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  await shot(b, 'f2-03-lobby-guest');

  let before = null;
  if (server.dataDir) {
    const db = openDb(server.dataDir);
    before = { a: playerRow(db, nameA), b: playerRow(db, nameB) };
    db.close();
  }
  await readyAndStart(a, b);
  await shootIntro([a, b], 'f2-04');
  // F3 hides the diagnostics overlay (the trace keeps running) for clean HUD shots.
  await a.keyboard.press('F3');
  await b.keyboard.press('F3');
  await sleep(6000);
  await shot(a, 'f2-05-hud-midmatch-A');
  await shot(b, 'f2-05-hud-midmatch-B');

  // Both humans play on: soaked early, they ride revenge ducks and lob balloons at the bots.
  const done = { value: false };
  const players = [lobFromDuck(a, done), lobFromDuck(b, done)];
  const took = await waitResults([a, b], MATCH_TIMEOUT_MS, 60000, async (secs) => {
    if (secs % 120 === 0) await shot(a, `f2-06-progress-${secs}s`);
  }).finally(() => (done.value = true));
  await Promise.all(players);
  log(`  match finished after ${Math.round(took / 1000)} s of play`);
  // The breakdown is read while the bar counts up: a level-up unlock replaces it afterwards.
  const [linesA, linesB] = [await readResults(a), await readResults(b)].map((r) => r.lines);
  const [animA, animB] = await Promise.all([sampleXpAnimation(a), sampleXpAnimation(b)]);
  log('  XP count-up A:', JSON.stringify(animA));
  log('  XP count-up B:', JSON.stringify(animB));
  await shot(a, 'f2-07-results-A');
  await shot(b, 'f2-07-results-B');
  const scales = await auditAtAllScales(a);
  const bad = scales.filter((r) => r.issues.length);
  checks.ok('casual results at 1x-4x: no overflow, clipping or overlap', bad.length === 0 && scales.map((r) => r.scale).join() === '1,2,3,4', bad.map((r) => `${r.scale}x: ${r.issues.slice(0, 3).join(' | ')}`).join(' ; '));
  const [resA, resB] = [await readResults(a), await readResults(b)];
  log('  results A:', JSON.stringify(resA));
  log('  results B:', JSON.stringify(resB));
  checks.ok('results list 4 placements', resA.rows.length === 4 && resB.rows.length === 4, resA.rows.map((r) => `${r.rank} ${r.name}`).join(', '));
  checks.ok('results show fun stats', resA.fun.length >= 3, resA.fun.join(' | '));
  for (const [label, anim] of [['A', animA], ['B', animB]]) {
    const counts = anim.map((s) => s.gain);
    checks.ok(`tab ${label}: XP bar animates (the +XP count rises)`, new Set(counts).size >= 2 && counts[0] !== counts[counts.length - 1], counts.join(' -> '));
  }
  for (const [label, res, lines] of [['A', resA, linesA], ['B', resB, linesB]]) {
    const total = Number(res.xpGain.replace(/[^\d]/g, ''));
    const sum = lines.reduce((acc, l) => acc + l.xp, 0);
    const mine = res.rows.find((r) => r.me);
    const place = Number(/\d+/.exec(mine?.rank ?? '')?.[0] ?? 0);
    const expectedPlacementXp = place >= 4 ? 20 : [100, 60, 35][place - 1];
    const placementLine = lines.find((l) => l.label === 'Placement')?.xp;
    const participation = lines.find((l) => l.label === 'Participation')?.xp;
    const unlocks = res.unlocked.length ? ` (level up, unlocked: ${res.unlocked.join(', ')})` : '';
    checks.ok(`tab ${label}: XP total = breakdown sum, participation 40, placement XP matches ${mine?.rank}`, total === sum && participation === 40 && placementLine === expectedPlacementXp, `+${total} = ${lines.map((l) => `${l.label} ${l.xp}`).join(' + ')}${unlocks}`);
  }
  if (server.dataDir && before) {
    const db = openDb(server.dataDir);
    const after = { a: playerRow(db, nameA), b: playerRow(db, nameB) };
    const match = db.prepare("SELECT m.id, m.mode, m.ranked, m.player_count FROM matches m JOIN match_players mp ON mp.match_id = m.id WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 1").get(after.a.id);
    const mps = db.prepare('SELECT player_id, placement, soaks, rounds_won, xp_earned FROM match_players WHERE match_id = ?').all(match.id);
    db.close();
    log('  SQLite match:', JSON.stringify(match), JSON.stringify(mps));
    checks.ok('SQLite: casual FFA match with 4 players recorded', match.mode === 'ffa' && match.ranked === 0 && match.player_count === 4);
    for (const [label, res, key] of [['A', resA, 'a'], ['B', resB, 'b']]) {
      const mp = mps.find((m) => m.player_id === after[key].id);
      const shown = Number(res.xpGain.replace(/[^\d]/g, ''));
      checks.ok(`SQLite: tab ${label} XP shown (+${shown}) = xp_earned = profile XP gained`, mp && mp.xp_earned === shown && after[key].xp - before[key].xp === shown, `xp_earned ${mp?.xp_earned}, profile ${before[key].xp} -> ${after[key].xp}`);
    }
  }
  await sleep(1500);
  await shot(a, 'f2-08-results-after-anim-A');

  // Rematch vote: both vote yes and the same room restarts; then both leave with Esc > Leave.
  await a.getByRole('button', { name: 'Rematch' }).click();
  await sleep(300);
  await shot(b, 'f2-09-rematch-vote-1of2-B');
  await b.getByRole('button', { name: 'Rematch' }).click();
  await Promise.all([a, b].map((p) => waitScreen(p, 'game', 20000)));
  checks.ok('rematch: both votes restart the room (both tabs back on the VS card)', true);
  await sleep(1000);
  await shot(a, 'f2-10-rematch-vs-card-A');
  for (const p of [a, b]) {
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Leave', exact: true }).click();
    await waitScreen(p, 'menu');
  }
  checks.ok('Esc > Leave takes both tabs from the rematch back to the menu', true);
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
