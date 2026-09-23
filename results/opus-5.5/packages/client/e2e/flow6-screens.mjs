// Every menu screen and dialog at 1x, 2x, 3x and 4x integer scale (window sizes chosen so the
// 256x224 frame picks that scale), audited for UI sticking out of the stage, clipped text and
// overlapping controls, with screenshots at 800x700 (3x) and 1600x1000 (4x). Also checks that
// the arrow keys move the menu cursor and Escape backs out of every screen and dialog, and what
// an audit cannot see: the guest name fits the profile card, the Locker caption always matches
// its preview, How to Play groups the move keys by set, the Account tab has no identity-slot
// jargon and a toast never sits on the title of the screen it lands on.
import { Checks, clickButton, errorsOf, loadChromium, log, newPage, shot, sleep, startServer, waitScreen } from './lib.mjs';
import { auditLayout, frameScale } from './layout.mjs';
import { lockerCaptions, moveKeyRows, profileNameFits, toastOverTitle } from './screenChecks.mjs';

const SIZES = [
  { w: 300, h: 260, scale: 1 },
  { w: 560, h: 480, scale: 2 },
  { w: 800, h: 700, scale: 3, shots: true },
  { w: 1600, h: 1000, scale: 4, shots: true },
];
const checks = new Checks('flow6-screens');
const server = await startServer();
const browser = await loadChromium().launch();
const suffix = String(Date.now() % 10000).padStart(4, '0');

async function inspect(page, size, name) {
  await sleep(350);
  const issues = await auditLayout(page);
  checks.ok(`${size.scale}x ${name}: no overflow, clipping or overlap`, issues.length === 0, issues.slice(0, 6).join(' | '));
  if (size.shots) await shot(page, `f6-${size.scale}x-${name}`);
}

/** Open a menu dialog, audit it, close it with Escape. */
async function dialog(page, size, button, name) {
  await clickButton(page, button);
  await page.locator('.layer-modals .modal').waitFor({ timeout: 5000 });
  await inspect(page, size, name);
  await page.keyboard.press('Escape');
  await page.locator('.layer-modals .modal').waitFor({ state: 'detached', timeout: 5000 });
}

/** Open a menu screen, audit it, come back with Escape. */
async function screen(page, size, button, name, extra = null) {
  await clickButton(page, button);
  await waitScreen(page, name);
  await inspect(page, size, name);
  if (extra) await extra();
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');
}

async function runSize(size) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h } });
  const page = await newPage(context, `${size.scale}x`);
  await page.goto(server.base);
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  checks.ok(`${size.w}x${size.h} window renders at ${size.scale}x`, (await frameScale(page)) === size.scale);
  await page.keyboard.press('KeyM');
  await inspect(page, size, 'title');
  await page.keyboard.press('Enter');
  await page.locator('.layer-modals .modal').waitFor({ timeout: 10000 });
  await inspect(page, size, 'tutorial-offer');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await waitScreen(page, 'menu');
  await inspect(page, size, 'menu');
  const card = await profileNameFits(page);
  checks.ok(`${size.scale}x menu: the guest name fits the profile card`, card.fits, card.text);

  const focus = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const first = await focus();
  await page.keyboard.press('ArrowRight');
  const right = await focus();
  await page.keyboard.press('ArrowDown');
  const down = await focus();
  checks.ok(`${size.scale}x menu: arrow keys move the cursor`, first !== right && right !== down && down.length > 0, `${first} -> ${right} -> ${down}`);

  await dialog(page, size, 'Create room', 'create-room-dialog');
  await dialog(page, size, 'Join by code', 'join-code-dialog');
  await dialog(page, size, 'Practice vs bots', 'practice-dialog');
  await page.locator('.profile-card').getByRole('button', { name: 'Edit' }).click();
  await page.locator('.layer-modals .modal').waitFor({ timeout: 5000 });
  await inspect(page, size, 'nickname-dialog');
  await page.keyboard.press('Escape');
  await screen(page, size, 'Browse rooms', 'browser');
  await screen(page, size, 'Leaderboard', 'leaderboard');
  await screen(page, size, 'Locker', 'locker', async () => {
    const look = await lockerCaptions(page);
    const detail = JSON.stringify(look);
    checks.ok(`${size.scale}x locker: arriving by mouse shows the saved look, not the tile under the cursor`, look.arrival.name === look.away.name && look.arrival.preview === look.away.preview, detail);
    checks.ok(`${size.scale}x locker: hovering a locked tile previews it with its unlock level`, look.hovered.blurb.startsWith('Unlocks at level') && look.hovered.preview.includes(look.lockedId), detail);
    checks.ok(`${size.scale}x locker: leaving the grid puts the saved look back`, !look.away.blurb.startsWith('Unlocks at level') && !look.away.preview.includes(look.lockedId), detail);
  });
  await screen(page, size, 'How to play', 'howto', async () => {
    const rows = await moveKeyRows(page);
    checks.ok(`${size.scale}x howto: move keys grouped as W A S D, then the arrows`, rows.length === 2 && rows[0] === 'W A S D' && rows[1].toUpperCase() === 'OR UP LEFT DOWN RIGHT', JSON.stringify(rows));
    for (let i = 2; i <= 4; i++) {
      await page.keyboard.press('ArrowRight');
      await inspect(page, size, `howto-page${i}`);
    }
  });
  await screen(page, size, 'Settings', 'settings', async () => {
    for (const tab of ['Controls', 'Account']) {
      await page.getByRole('radio', { name: tab }).click();
      await inspect(page, size, `settings-${tab.toLowerCase()}`);
    }
    const account = await page.locator('.settings-account').innerText();
    checks.ok(`${size.scale}x settings account: no identity-slot jargon on the main tab`, !/\bslot\b/i.test(account), account.slice(0, 120));
    await page.getByRole('radio', { name: 'Sound & Display' }).click();
  });

  // Lobby of a private 2P room, then leave.
  await clickButton(page, 'Create room');
  const create = page.locator('.layer-modals .modal');
  await create.getByRole('radio', { name: '2P Duel' }).click();
  await create.getByRole('radio', { name: 'Private' }).click();
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await waitScreen(page, 'lobby');
  await page.locator('.lobby-code').waitFor({ timeout: 10000 });
  await inspect(page, size, 'lobby');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');

  // In-match DOM overlays: the tutorial objectives panel, and the leave-match confirm (Esc).
  await clickButton(page, 'Replay tutorial');
  await waitScreen(page, 'tutorial');
  await page.locator('.tutorial-panel').waitFor({ timeout: 10000 });
  await sleep(1500);
  await inspect(page, size, 'tutorial-panel');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');
  await clickButton(page, 'Practice vs bots');
  await page.locator('.layer-modals .modal').getByRole('button', { name: 'Start', exact: true }).click();
  await waitScreen(page, 'game', 15000);
  await sleep(5000);
  await page.keyboard.press('Escape');
  await page.locator('.layer-modals .modal').waitFor({ timeout: 5000 });
  await inspect(page, size, 'leave-match-confirm');
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await waitScreen(page, 'menu');

  // Ranked queue: the nickname gate first, then the queue screen, then cancel.
  await clickButton(page, 'Duel 1v1');
  const nick = page.locator('.layer-modals .modal');
  await nick.waitFor({ timeout: 5000 });
  await inspect(page, size, 'ranked-nickname-gate');
  await nick.getByRole('textbox').fill(`Lay${size.scale}x${suffix}`);
  await nick.getByRole('button', { name: 'Save' }).click();
  await waitScreen(page, 'queue');
  await sleep(300);
  const cover = await toastOverTitle(page);
  checks.ok(`${size.scale}x queue: the "you are now" toast shows without covering the title`, cover.hasTitle && cover.toasts.some((t) => /you are now/i.test(t)) && cover.area === 0, JSON.stringify(cover));
  await sleep(1200);
  await inspect(page, size, 'queue');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');

  // Results with nothing to show (a stale link) still back out with Escape.
  await page.evaluate(() => {
    window.location.hash = '#/results';
  });
  await waitScreen(page, 'results');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');
  checks.ok(`${size.scale}x results: Escape backs out to the menu`, true);
  await context.close();
  return page;
}

try {
  const pages = [];
  for (const size of SIZES) {
    log(`-- ${size.w}x${size.h}`);
    pages.push(await runSize(size));
  }
  const errors = errorsOf(...pages);
  checks.ok('no console errors on any screen', errors.length === 0, errors.join(' | '));
} catch (err) {
  checks.ok(`flow crashed: ${err.message}`, false);
} finally {
  await browser.close();
  await server.close();
  checks.finish();
}
