// Screen-level regression probes used by the screens flow: things a layout audit cannot see
// (what a caption says, whether a toast sits on a title, how keycaps are grouped). Each probe
// reads the live page and returns plain data for the flow to check.

/** The Locker caption and what the preview shows (its aria-label names the animal and hat ids). */
async function lockerLook(page) {
  return page.evaluate(() => ({
    name: document.querySelector('.locker-name')?.textContent ?? '',
    blurb: document.querySelector('.locker-blurb')?.textContent ?? '',
    preview: document.querySelector('.locker-preview')?.getAttribute('aria-label') ?? '',
  }));
}

/**
 * Locker, reached by a mouse click (the cursor rests where the Locker button was, over the grid):
 * the look on arrival, while hovering a locked tile, and after the pointer leaves the grid.
 */
export async function lockerCaptions(page) {
  const arrival = await lockerLook(page);
  const locked = page.locator('.cos-tile.is-locked').first();
  const lockedId = (await locked.getAttribute('data-cos-id')) ?? '';
  await locked.hover();
  const hovered = await lockerLook(page);
  await page.mouse.move(1, 1);
  const away = await lockerLook(page);
  return { arrival, hovered, away, lockedId };
}

/** Whether the menu profile card shows the player's whole name (no ellipsis). */
export async function profileNameFits(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.profile-card .nt-name');
    return el ? { text: el.textContent ?? '', fits: el.scrollWidth <= el.clientWidth + 1 } : { text: '', fits: false };
  });
}

/** The How to Play "Move" keycaps, one string per binding set ("W A S D", "or Up Left Down Right"). */
export async function moveKeyRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.howto-move-set')].map((row) => [...row.children].map((c) => (c.textContent ?? '').trim()).join(' ')));
}

/** Area (px^2) where a visible toast covers the mounted screen's title, and the toast text. */
export async function toastOverTitle(page) {
  return page.evaluate(() => {
    const title = document.querySelector('.screen-root .shell-title')?.getBoundingClientRect();
    const toasts = [...document.querySelectorAll('.layer-toasts .toast:not(.toast-leaving)')];
    let area = 0;
    for (const t of toasts) {
      const r = t.getBoundingClientRect();
      if (!title) continue;
      area += Math.max(0, Math.min(r.right, title.right) - Math.max(r.left, title.left)) * Math.max(0, Math.min(r.bottom, title.bottom) - Math.max(r.top, title.top));
    }
    return { area, toasts: toasts.map((t) => t.textContent ?? ''), hasTitle: !!title };
  });
}
