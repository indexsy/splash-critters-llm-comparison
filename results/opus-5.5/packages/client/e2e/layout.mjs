// In-page layout audit for the DOM overlay (#ui): controls or text that stick out of the
// letterboxed stage, text clipped by its own box, and visible controls/text that overlap each
// other. Scrolled-away rows inside a scroll container are not problems; ellipsis truncation is
// intentional and allowed.

/** Runs in the page; returns a list of human-readable problems for the current screen. */
function auditLayoutInPage() {
  const stage = document.getElementById('stage').getBoundingClientRect();
  const issues = [];
  const TOL = 1.5;
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  /** The rect an element can actually be seen in: its nearest clipping ancestor, else the stage. */
  const clipRect = (el) => {
    for (let p = el.parentElement; p && p.id !== 'stage'; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) return p.getBoundingClientRect();
    }
    return stage;
  };
  const inside = (r, c) => r.left >= c.left - TOL && r.top >= c.top - TOL && r.right <= c.right + TOL && r.bottom <= c.bottom + TOL;
  const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const root = document.getElementById('ui');
  const modal = [...root.querySelectorAll('.layer-modals .modal')].pop() ?? null;
  const scope = modal ?? root.querySelector('.screen-root');
  if (!scope) return ['no mounted screen'];
  const all = [...scope.querySelectorAll('*')].filter(shown);

  // 1. Outside the stage (or outside the clipping box it lives in, when not merely scrolled away).
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const clip = clipRect(el);
    const scrolledAway = clip !== stage && overlapArea(r, clip) === 0;
    if (scrolledAway) continue;
    if (!inside(r, stage)) issues.push(`outside the stage: ${describe(el)}`);
  }

  // 2. Text clipped by its own box (no ellipsis, not a scroll container).
  for (const el of all) {
    const cs = getComputedStyle(el);
    const clips = /(hidden|clip)/.test(cs.overflowX + cs.overflowY);
    if (!clips || cs.textOverflow === 'ellipsis' || el.tagName === 'CANVAS' || el.tagName === 'INPUT') continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) issues.push(`clipped text: ${describe(el)} (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`);
  }

  // 3. Overlapping controls and text leaves (not nested in each other).
  const leaves = all.filter((el) => el.matches('button, input, select, [role="radio"], [role="switch"], [role="slider"]') || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const area = overlapArea(ra, rb);
      if (area > 4 && Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 2 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 2) {
        const clipA = clipRect(a);
        if (overlapArea(ra, clipA) === 0) continue;
        issues.push(`overlap: ${describe(a)} x ${describe(b)}`);
      }
    }
  }
  return [...new Set(issues)];
}

/** Audit the page's current screen; returns problems (empty = clean). */
export async function auditLayout(page) {
  return page.evaluate(auditLayoutInPage);
}

/** Current integer scale the frame chose (--px on <html>). */
export async function frameScale(page) {
  return page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--px')));
}

/** Window sizes at which the 256x224 frame picks each integer scale. */
export const SCALE_SIZES = [
  { width: 300, height: 260, scale: 1 },
  { width: 560, height: 480, scale: 2 },
  { width: 800, height: 700, scale: 3 },
  { width: 1600, height: 1000, scale: 4 },
];

/** Audit the current screen at every scale (resizing the window), then restore its size. */
export async function auditAtAllScales(page) {
  const original = page.viewportSize();
  const out = [];
  for (const size of SCALE_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(250);
    const scale = await frameScale(page);
    const issues = await auditLayout(page);
    out.push({ scale, issues });
  }
  if (original) await page.setViewportSize(original);
  return out;
}
