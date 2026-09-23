// Match helpers for the multi-tab flows: follow a match from the VS card through the
// 3-2-1-SPLASH! countdown to the results screen, taking screenshots on the way, and read the
// results screen (placements, fun stats, XP count-up and breakdown, rating change).
import { log, shot, sleep, waitScreen } from './lib.mjs';

/** Both tabs switched to the game screen: screenshot the VS card, the countdown and SPLASH!. */
export async function shootIntro(pages, prefix) {
  await Promise.all(pages.map((p) => waitScreen(p, 'game', 20000)));
  await sleep(900);
  for (const [i, p] of pages.entries()) await shot(p, `${prefix}-vs-card-${'AB'[i]}`);
  // The round world appears with round_start (the countdown); frames then carry the local critter.
  await pages[0].waitForFunction(() => (window.splashNetStats?.frames(performance.now() - 300) ?? []).some((f) => f.local), null, { timeout: 20000, polling: 100 });
  await sleep(700);
  for (const [i, p] of pages.entries()) await shot(p, `${prefix}-countdown-${'AB'[i]}`);
  await sleep(2350);
  for (const [i, p] of pages.entries()) await shot(p, `${prefix}-splash-${'AB'[i]}`);
}

/** Wait until every page shows the results screen, logging progress every `everyMs`. */
export async function waitResults(pages, timeoutMs, everyMs = 60000, onProgress = null) {
  const start = Date.now();
  let next = start + everyMs;
  for (;;) {
    const at = await Promise.all(pages.map((p) => p.locator('.screen-root[data-screen="results"]').count()));
    if (at.every((n) => n > 0)) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new Error(`no results screen after ${Math.round(timeoutMs / 1000)} s`);
    if (Date.now() > next) {
      next += everyMs;
      log(`  ...match still running (${Math.round((Date.now() - start) / 1000)} s)`);
      if (onProgress) await onProgress(Math.round((Date.now() - start) / 1000));
    }
    await sleep(500);
  }
}

/** Everything the results screen tells the player. */
export async function readResults(page) {
  return page.evaluate(() => {
    const text = (el) => (el?.textContent ?? '').trim();
    const rows = [...document.querySelectorAll('.place-row')].map((r) => ({
      rank: text(r.querySelector('.place-rank')),
      name: r.querySelector('.place-name')?.getAttribute('title') ?? '',
      me: r.classList.contains('is-me'),
      stats: [...r.querySelectorAll('.place-stat')].map((s) => `${s.getAttribute('title')}=${text(s)}`),
    }));
    const fun = [...document.querySelectorAll('.fun-card')].map((c) => `${text(c.querySelector('.fun-label'))}: ${text(c.querySelector('.fun-name'))} ${text(c.querySelector('.fun-value'))}`);
    const lines = [...document.querySelectorAll('.xp-lines li')].map((li) => ({ label: text(li.firstElementChild), xp: Number(text(li.querySelector('.xp-line-val')).replace('+', '')) }));
    const unlocked = [...document.querySelectorAll('.xp-unlocks .unlock-tile')].map((t) => text(t));
    const bar = document.querySelector('.results-xp .bar');
    return {
      rows,
      fun,
      xpGain: text(document.querySelector('.xp-gain')),
      xpCount: text(document.querySelector('.xp-count')),
      xpBar: bar?.getAttribute('aria-valuenow') ?? '',
      lines,
      unlocked,
      rating: text(document.querySelector('.rating-value')),
      ratingChange: text(document.querySelector('.rating-line .chip')),
      tier: text(document.querySelector('.rating-tier')),
    };
  });
}

/** Sample the XP count-up a few times to prove it animates; returns the samples. */
export async function sampleXpAnimation(page, times = [150, 700, 1300, 2200, 4000]) {
  const out = [];
  const t0 = Date.now();
  for (const t of times) {
    await sleep(Math.max(0, t - (Date.now() - t0)));
    const r = await page.evaluate(() => ({
      gain: document.querySelector('.xp-gain')?.textContent ?? '',
      count: document.querySelector('.xp-count')?.textContent ?? '',
      bar: document.querySelector('.results-xp .bar')?.getAttribute('aria-valuenow') ?? '',
      lines: document.querySelectorAll('.xp-lines li').length,
      unlocked: document.querySelector('.xp-unlocks') !== null,
    }));
    out.push({ t, ...r });
  }
  return out;
}

/**
 * Play like someone who got soaked early: keep walking (then riding the revenge duck around the
 * border) and pressing E, the alternate balloon key, to drop or lob balloons until `done.value`.
 * E never activates a focused button, so the results screen's Rematch is left alone.
 */
export async function lobFromDuck(page, done) {
  const dirs = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  for (let i = 0; !done.value; i++) {
    const key = dirs[i % dirs.length];
    await page.keyboard.down(key);
    for (let k = 0; k < 4 && !done.value; k++) {
      await sleep(450);
      await page.keyboard.press('KeyE');
    }
    await page.keyboard.up(key);
  }
}
