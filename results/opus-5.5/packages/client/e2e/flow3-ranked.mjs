// Acceptance flow 3: two tabs of one browser set nicknames through the dialog, queue Ranked Duel,
// get matched (queue screen, MATCH FOUND!), play (tab B keeps dropping balloons on itself with
// Space so it loses rounds fast), see the rating change + tier on the results screen, and the
// Leaderboard (after Refresh and after a full reload) lists both with their new ratings, which
// also match SQLite. Then a second duel that A forfeits from the leave confirm: A lands on the
// menu with a toast saying what it cost, and B's results screen backs out with Escape.
import { Checks, clickButton, errorsOf, loadChromium, log, newPage, openDb, shot, sleep, startServer, waitScreen } from './lib.mjs';
import { auditAtAllScales } from './layout.mjs';
import { readResults, shootIntro, waitResults } from './match.mjs';
import { enterMenu, muteViaSettings, profileName, setNickname } from './menus.mjs';

const checks = new Checks('flow3-ranked');
const server = await startServer();
const browser = await loadChromium().launch();
const suffix = String(Date.now() % 100000).padStart(5, '0');

/** Tab B's losing strategy: press Space whenever it can (it stands on the balloon). */
async function selfSoakUntilResults(page, done) {
  while (!done.value) {
    await page.keyboard.down('Space');
    await sleep(60);
    await page.keyboard.up('Space');
    await sleep(700);
  }
}

/** A queues with B again, forfeits as soon as the match starts, and reads what it is told. */
async function forfeitDuel(a, b, ratingBefore) {
  await a.keyboard.press('Escape');
  await waitScreen(a, 'menu');
  await clickButton(a, 'Duel 1v1');
  await waitScreen(a, 'queue');
  await clickButton(b, 'Duel 1v1');
  await Promise.all([waitScreen(a, 'game', 20000), waitScreen(b, 'game', 20000)]);
  await sleep(1000);
  await a.keyboard.press('Escape');
  const confirm = a.locator('.layer-modals .modal');
  await confirm.waitFor({ timeout: 5000 });
  await confirm.getByRole('button', { name: 'Forfeit', exact: true }).click();
  await waitScreen(a, 'menu');
  const notice = a.locator('.layer-toasts .toast', { hasText: 'Match forfeited' });
  await notice.waitFor({ timeout: 8000 });
  const text = (await notice.textContent()) ?? '';
  await sleep(400); // past the toast's fade-in
  await shot(a, 'f3-08-forfeit-notice-A');
  const m = /^Match forfeited\. Duel rating (\d+) to (\d+) \((-\d+)\)$/.exec(text);
  checks.ok('forfeiting a ranked duel says what it cost on the menu', !!m && Number(m[1]) === ratingBefore && Number(m[2]) < ratingBefore, text);
  await waitScreen(b, 'results', 20000);
  await b.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 10000 });
  await b.keyboard.press('Escape');
  await waitScreen(b, 'menu');
  checks.ok('ranked results back out to the menu with Escape', true);
}

/** Leaderboard rows as [name#tag, rating] pairs. */
async function leaderboardRows(page) {
  await page.locator('.lb-table, .lb-state').first().waitFor({ timeout: 10000 });
  await page.locator('.lb-table').waitFor({ timeout: 10000 });
  return page.evaluate(() =>
    [...document.querySelectorAll('.lb-table tbody tr')].map((tr) => ({
      name: tr.querySelector('.lb-name')?.getAttribute('title') ?? '',
      rating: Number((tr.querySelector('.lb-rating')?.textContent ?? '').replace(/[^\d]/g, '')),
      me: tr.classList.contains('is-me'),
    })),
  );
}

try {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const a = await newPage(context, 'A');
  await enterMenu(a, `${server.base}/?netstats=1`);
  checks.ok('tab A muted via Settings', await muteViaSettings(a));
  const b = await newPage(context, 'B');
  await enterMenu(b, `${server.base}/?netstats=1`);

  await setNickname(a, `Ann${suffix}`);
  await setNickname(b, `Bob${suffix}`);
  const [nameA, nameB] = [await profileName(a), await profileName(b)];
  checks.ok('both nicknames saved through the dialog', nameA.startsWith(`Ann${suffix}#`) && nameB.startsWith(`Bob${suffix}#`), `${nameA} / ${nameB}`);
  await shot(a, 'f3-01-menu-nickname-A');

  await clickButton(a, 'Duel 1v1');
  await waitScreen(a, 'queue');
  await sleep(1200);
  await shot(a, 'f3-02-queue-A');
  const queueText = (await a.locator('.screen-root[data-screen="queue"]').innerText()).replace(/\s+/g, ' ');
  checks.ok('queue screen shows mode, search range and a cancel', /duel/i.test(queueText) && /cancel/i.test(queueText), queueText.slice(0, 160));
  await clickButton(b, 'Duel 1v1');
  await waitScreen(b, 'queue');
  const found = b.locator('.screen-root[data-screen="queue"] .found');
  await found.waitFor({ timeout: 15000 });
  await shot(b, 'f3-03-match-found-B');
  const flash = await found.evaluate((el) => ({ title: el.querySelector('.found-flash canvas')?.getAttribute('aria-label') ?? '', names: [...el.querySelectorAll('.found-name')].map((n) => n.getAttribute('title')) }));
  checks.ok('MATCH FOUND! flash names both players', /match found/i.test(flash.title) && flash.names.includes(nameA) && flash.names.includes(nameB), JSON.stringify(flash));

  await shootIntro([a, b], 'f3-04');
  const done = { value: false };
  const loser = selfSoakUntilResults(b, done);
  await sleep(4000);
  await shot(b, 'f3-05-hud-self-soak-B');
  const took = await waitResults([a, b], 5 * 60 * 1000, 30000);
  done.value = true;
  await loser;
  log(`  ranked duel finished after ${Math.round(took / 1000)} s`);
  await sleep(4500);
  await shot(a, 'f3-06-results-winner-A');
  await shot(b, 'f3-06-results-loser-B');
  for (const [label, p] of [['winner', a], ['loser', b]]) {
    const scales = await auditAtAllScales(p);
    const bad = scales.filter((r) => r.issues.length);
    checks.ok(`ranked results (${label}) at 1x-4x: no overflow, clipping or overlap`, bad.length === 0 && scales.map((r) => r.scale).join() === '1,2,3,4', bad.map((r) => `${r.scale}x: ${r.issues.slice(0, 3).join(' | ')}`).join(' ; '));
  }
  const [resA, resB] = [await readResults(a), await readResults(b)];
  log('  results A:', JSON.stringify(resA));
  log('  results B:', JSON.stringify(resB));
  const deltaA = Number(resA.ratingChange.replace(/[^\d-]/g, ''));
  const deltaB = Number(resB.ratingChange.replace(/[^\d-]/g, ''));
  checks.ok('results show the rating change (+ for the winner, - for the loser) and tier', deltaA > 0 && deltaB < 0 && resA.tier.length > 0 && resB.tier.length > 0, `A ${resA.rating} ${resA.ratingChange} ${resA.tier}; B ${resB.rating} ${resB.ratingChange} ${resB.tier}`);

  for (const p of [a, b]) {
    const cont = p.getByRole('button', { name: 'Continue' });
    if (await cont.isVisible().catch(() => false)) await cont.click();
    else await p.goto(`${server.base}/?netstats=1#/menu`);
    await waitScreen(p, 'menu');
  }
  await clickButton(a, 'Leaderboard');
  await waitScreen(a, 'leaderboard');
  await clickButton(a, 'Refresh');
  await sleep(500);
  const rows = await leaderboardRows(a);
  const rowA = rows.find((r) => r.name === nameA);
  const rowB = rows.find((r) => r.name === nameB);
  log('  leaderboard (after Refresh):', JSON.stringify(rows.slice(0, 10)));
  checks.ok('leaderboard lists both with updated ratings', rowA && rowB && rowA.rating === 1000 + deltaA && rowB.rating === 1000 + deltaB && rowA.me, `A ${rowA?.rating} B ${rowB?.rating}`);
  await shot(a, 'f3-07-leaderboard');
  await a.reload();
  await waitScreen(a, 'leaderboard');
  const rowsReload = await leaderboardRows(a);
  checks.ok('leaderboard after a full page reload still shows both', rowsReload.some((r) => r.name === nameA && r.rating === rowA?.rating) && rowsReload.some((r) => r.name === nameB && r.rating === rowB?.rating));

  if (server.dataDir) {
    const db = openDb(server.dataDir);
    const q = db.prepare("SELECT p.nickname, p.tag, r.rating, r.games, r.wins, r.peak FROM ratings r JOIN players p ON p.id = r.player_id WHERE r.mode = 'duel' AND p.nickname = ?");
    const [ra, rb] = [q.get(`Ann${suffix}`), q.get(`Bob${suffix}`)];
    const mp = db.prepare("SELECT mp.rating_before, mp.rating_after, mp.placement FROM match_players mp JOIN players p ON p.id = mp.player_id JOIN matches m ON m.id = mp.match_id WHERE p.nickname = ? AND m.ranked = 1 ORDER BY m.ended_at DESC LIMIT 1");
    const [ma, mb] = [mp.get(`Ann${suffix}`), mp.get(`Bob${suffix}`)];
    db.close();
    log('  SQLite ratings:', JSON.stringify(ra), JSON.stringify(rb), JSON.stringify(ma), JSON.stringify(mb));
    checks.ok('SQLite: both duel ratings updated (1 game each) and match the UI', ra?.games === 1 && rb?.games === 1 && ra.rating === 1000 + deltaA && rb.rating === 1000 + deltaB, `${ra?.rating} / ${rb?.rating}`);
    checks.ok('SQLite: match_players rating_before/after persisted', ma?.rating_before === 1000 && ma.rating_after === ra.rating && mb?.rating_after === rb.rating);
  }
  await forfeitDuel(a, b, rowA?.rating ?? 0);

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
