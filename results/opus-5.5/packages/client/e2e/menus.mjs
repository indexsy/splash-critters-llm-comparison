// Menu journeys shared by the multi-tab flows, all through real clicks and key presses:
// title -> menu (skipping the tutorial offer for fresh guests), mute via Settings, create a
// casual room, set bot slots, join by code, ready/start, nickname dialog.
import { clickButton, log, sleep, waitScreen } from './lib.mjs';

/** Load the app, press Enter on the title and take the Skip path when the tutorial is offered. */
export async function enterMenu(page, url) {
  await page.goto(url);
  await page.locator('.title-prompt').waitFor({ timeout: 15000 });
  await page.keyboard.press('Enter');
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  const menu = page.locator('.screen-root[data-screen="menu"]');
  await Promise.race([skip.waitFor({ timeout: 15000 }), menu.waitFor({ state: 'attached', timeout: 15000 })]);
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await waitScreen(page, 'menu');
}

/** The player's "name#tag" from the menu profile card. */
export async function profileName(page) {
  const name = page.locator('.profile-card .pc-name');
  await name.waitFor({ timeout: 10000 });
  return name.getAttribute('title');
}

/** Settings > Mute all sound (the owner asked for silent test tabs); returns the muted flag. */
export async function muteViaSettings(page) {
  await clickButton(page, 'Settings');
  await waitScreen(page, 'settings');
  const toggle = page.getByRole('switch', { name: /Mute all sound/ });
  await toggle.waitFor({ timeout: 5000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  const muted = (await toggle.getAttribute('aria-checked')) === 'true';
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');
  return muted;
}

/** Menu > Create room: pick size/visibility/rounds, uncheck bot fill when asked, create. */
export async function createRoom(page, { size = 4, isPublic = true, rounds = null, botFill = true } = {}) {
  await clickButton(page, 'Create room');
  const dialog = page.locator('.layer-modals .modal');
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByRole('radio', { name: size === 4 ? '4P FFA' : '2P Duel' }).click();
  await dialog.getByRole('radio', { name: isPublic ? 'Public' : 'Private' }).click();
  if (rounds) await dialog.getByRole('radio', { name: `First to ${rounds}` }).click();
  const fill = dialog.getByRole('switch', { name: /Fill empty slots/ });
  if (((await fill.getAttribute('aria-checked')) === 'true') !== botFill) await fill.click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await waitScreen(page, 'lobby');
  await page.locator('.lobby-code').waitFor({ timeout: 10000 });
  const link = await page.locator('.lobby-code button').getAttribute('title');
  const code = /\/room\/([A-Z2-9]{6})/.exec(link ?? '')?.[1] ?? '';
  log(`  room created: ${code}`);
  return code;
}

/** Host: set lobby slot `slot` (0-based) to a bot of `difficulty` via its EDIT button. */
export async function setSlotBot(page, slot, difficulty) {
  await page.getByRole('button', { name: 'Edit' }).and(page.locator(`[title="Change slot P${slot + 1}"]`)).click();
  await page.getByRole('button', { name: `Bot: ${difficulty}` }).click();
  await page.locator(`.slot-card:nth-child(${slot + 1}) .slot-status.is-bot`).waitFor({ timeout: 5000 });
}

/** Menu > Join by code: type the 6-character code and join. */
export async function joinByCode(page, code) {
  await clickButton(page, 'Join by code');
  const dialog = page.locator('.layer-modals .modal');
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByRole('textbox').type(code, { delay: 30 });
  await page.keyboard.press('Enter');
  await waitScreen(page, 'lobby');
  await page.locator('.lobby-code').waitFor({ timeout: 10000 });
}

/** Joiner: READY. Host: wait until START is enabled, then START. */
export async function readyAndStart(host, guest) {
  await guest.getByRole('button', { name: 'Ready!' }).click();
  const start = host.getByRole('button', { name: 'Start match' });
  await start.waitFor({ timeout: 10000 });
  for (let i = 0; i < 50 && (await start.isDisabled()); i++) await sleep(100);
  await start.click();
}

/** Open the nickname dialog from the profile card EDIT and save `nick`. */
export async function setNickname(page, nick) {
  await page.locator('.profile-card').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.locator('.layer-modals .modal');
  await dialog.waitFor({ timeout: 5000 });
  const input = dialog.getByRole('textbox');
  await input.fill('');
  await input.type(nick, { delay: 20 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 10000 });
}
