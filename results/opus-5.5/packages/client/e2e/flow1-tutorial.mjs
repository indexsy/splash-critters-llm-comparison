// Acceptance flow 1: a fresh browser gets a guest account, plays the tutorial with the keyboard
// (all five lessons), lands on the main menu in under 3 minutes; a second fresh browser takes
// the Skip path straight to the menu. Also checks that M toggles mute (tabs stay muted).
//   node packages/client/e2e/flow1-tutorial.mjs   (see lib.mjs for E2E_BASE / PLAYWRIGHT_FROM)
import { Checks, errorsOf, loadChromium, log, newPage, openDb, shot, sleep, startServer, waitScreen } from './lib.mjs';
import { TutorialPilot, panelDone, panelStep, waitLive, waitStep } from './tutorialPilot.mjs';

const ACCEPT_MS = 3 * 60 * 1000;
const checks = new Checks('flow1-tutorial');
const server = await startServer();
const browser = await loadChromium().launch();

/** Title -> PRESS START (Enter) -> the tutorial offer. Returns the greeting text. */
async function pressStart(page) {
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  await page.keyboard.press('Enter');
  const dialog = page.locator('.layer-modals .modal');
  await dialog.waitFor({ timeout: 15000 });
  return (await dialog.textContent()) ?? '';
}

/** The M key toggles mute everywhere; the toast says which way it went. */
async function muteWithKey(page) {
  await page.keyboard.press('KeyM');
  const toast = page.locator('.toast').last();
  await toast.waitFor({ timeout: 3000 });
  return (await toast.innerText()).trim();
}

async function tutorialRun() {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const page = await newPage(context, 'tutorial');
  const t0 = Date.now();
  await page.goto(`${server.base}/?netstats=1`);
  await sleep(1200);
  await shot(page, 'f1-01-title');
  const toastText = await muteWithKey(page);
  checks.ok('M mutes from the title screen', /sound off/i.test(toastText), toastText);
  const offer = await pressStart(page);
  const name = /Hi ([A-Za-z0-9]+)!/i.exec(offer)?.[1] ?? '';
  checks.ok('guest account greeted by generated name', name.length > 0, name);
  await shot(page, 'f1-02-tutorial-offer');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'tutorial');
  checks.ok('tutorial panel shows step 1', await waitStep(page, 1, 10000));
  await sleep(1500);
  await shot(page, 'f1-03-tutorial-countdown');

  const pilot = new TutorialPilot(page);
  const live = await waitLive(page);
  checks.ok('critter moves with the arrow keys once the round is live', !!live, live ? `tile ${live.tx},${live.ty}` : '');
  const seen = [await panelStep(page)];
  await pilot.lesson1();
  checks.ok('lesson 1 (walk) advances the panel to step 2', await waitStep(page, 2, 5000));
  seen.push(await panelStep(page));
  await shot(page, 'f1-04-lesson2');

  await pilot.lesson2();
  checks.ok('lesson 2 (splash a castle and dodge) advances to step 3', await waitStep(page, 3, 5000));
  seen.push(await panelStep(page));
  await shot(page, 'f1-05-lesson3');

  await pilot.lesson3();
  checks.ok('lesson 3 (grab the power-up) advances to step 4', await waitStep(page, 4, 5000));
  seen.push(await panelStep(page));
  await shot(page, 'f1-06-lesson4');

  await pilot.lesson4();
  checks.ok('lesson 4 (chain splash) advances to step 5', await waitStep(page, 5, 5000));
  seen.push(await panelStep(page));
  await shot(page, 'f1-07-lesson5');

  const attempts = await pilot.lesson5(100000);
  const done = await panelDone(page);
  checks.ok('lesson 5 (soak the bot) completes the tutorial', done, `${attempts} balloon attempts`);
  log(`  panel steps seen: ${seen.join(' -> ')}${done ? ' -> complete' : ''}`);
  if (done) {
    const card = page.locator('.layer-modals .modal');
    await card.waitFor({ timeout: 8000 });
    await sleep(1200);
    const text = await card.innerText();
    checks.ok('completion card shows the XP award', /\+\d+ XP/.test(text), text.replace(/\n+/g, ' / '));
    await shot(page, 'f1-08-tutorial-complete');
    await page.keyboard.press('Enter');
  } else {
    await shot(page, 'f1-08-tutorial-stuck');
    await page.getByRole('button', { name: 'Skip' }).click();
  }
  await waitScreen(page, 'menu');
  const elapsed = Date.now() - t0;
  checks.ok('fresh load -> tutorial -> main menu in under 3 minutes', elapsed < ACCEPT_MS, `${(elapsed / 1000).toFixed(1)} s`);
  await sleep(800);
  await shot(page, 'f1-09-menu-after-tutorial');
  const token = await page.evaluate(() => localStorage.getItem('splash.token') ?? '');
  checks.ok('device token persisted in localStorage', token.length > 0);
  await context.close();
  return { page, done, name };
}

async function skipRun() {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const page = await newPage(context, 'skip');
  const t0 = Date.now();
  await page.goto(server.base);
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  await muteWithKey(page);
  const offer = await pressStart(page);
  const name = /Hi ([A-Za-z0-9]+)!/i.exec(offer)?.[1] ?? '';
  const skip = page.getByRole('button', { name: 'Skip' });
  await skip.click();
  await waitScreen(page, 'menu');
  const elapsed = Date.now() - t0;
  checks.ok('Skip path lands on the main menu', true, `fresh load -> menu in ${(elapsed / 1000).toFixed(1)} s`);
  await sleep(600);
  await shot(page, 'f1-10-menu-after-skip');
  // A skipped tutorial is remembered: PRESS START goes straight to the menu next time.
  await page.goto(server.base);
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  await page.keyboard.press('Enter');
  await waitScreen(page, 'menu');
  checks.ok('returning player: PRESS START goes straight to the menu', true);
  await context.close();
  return { page, name };
}

try {
  const tutorial = await tutorialRun();
  const skip = await skipRun();
  if (server.dataDir) {
    const db = openDb(server.dataDir);
    const row = db.prepare('SELECT nickname, xp, level, tutorial_done FROM players WHERE lower(nickname) = lower(?)');
    const [a, b] = [row.get(tutorial.name), row.get(skip.name)];
    db.close();
    log('  players:', JSON.stringify([a, b]));
    if (tutorial.done) checks.ok('SQLite: tutorial completion saved with first XP', a?.tutorial_done === 1 && a.xp > 0, JSON.stringify(a));
    checks.ok('SQLite: skipped tutorial saved without XP', b?.tutorial_done === 1 && b.xp === 0, JSON.stringify(b));
  }
  const errors = errorsOf(tutorial.page, skip.page);
  checks.ok('no console errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  checks.ok(`flow crashed: ${err.message}`, false);
} finally {
  await browser.close();
  await server.close();
  checks.finish();
}
