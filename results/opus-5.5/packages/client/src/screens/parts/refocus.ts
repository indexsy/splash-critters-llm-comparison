// Re-render a live region (lobby slots, room list, keybind table, results actions) without
// dropping keyboard focus: controls carry data-nav-key, and after the rebuild the control with
// the same key gets focus back. When that key is gone the region's preferred control
// ([data-autofocus], the same one a fresh mount would focus) takes the cursor, and only then
// its first enabled control, so a vanished button never hands the cursor to a neighbour such
// as LEAVE by accident.

/** What the refocus rule needs to know about one rebuilt control. */
export interface RefocusCandidate {
  key?: string;
  disabled: boolean;
  preferred: boolean;
}

/** Leave focus where it is; the region remembers the key and reclaims focus on a later rebuild. */
export const PARK = -1;

/**
 * Index of the control to focus after a rebuild, or PARK. The same key wins; a same-key control
 * that is now disabled parks the cursor (never jump onto a neighbour where a repeated Enter
 * would do something else entirely); otherwise the preferred control, then the first enabled.
 */
export function refocusTarget(candidates: readonly RefocusCandidate[], key: string | undefined): number {
  const same = key === undefined ? -1 : candidates.findIndex((c) => c.key === key);
  if (same >= 0) return candidates[same].disabled ? PARK : same;
  const preferred = candidates.findIndex((c) => c.preferred && !c.disabled);
  if (preferred >= 0) return preferred;
  const first = candidates.findIndex((c) => !c.disabled);
  return first >= 0 ? first : PARK;
}

/** Tag a control so focus can follow it across re-renders. */
export function navKey<T extends HTMLElement>(el: T, key: string): T {
  el.dataset.navKey = key;
  return el;
}

const CANDIDATES = '[data-nav-key], button, [tabindex="0"]';

/**
 * Regions whose focused control was rebuilt disabled (or vanished with nothing to take over):
 * focus fell back to <body>, and the region takes it back on its next rebuild as long as the
 * player has not focused anything else meanwhile.
 */
const parked = new WeakMap<HTMLElement, string | undefined>();

function focusLost(active: Element | null): boolean {
  return active === null || active === document.body;
}

export function rerender(region: HTMLElement, build: () => Node[]): void {
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && region.contains(active);
  const reclaim = !inside && focusLost(active) && parked.has(region);
  const key = inside ? active.closest<HTMLElement>('[data-nav-key]')?.dataset.navKey : parked.get(region);
  parked.delete(region);
  region.replaceChildren(...build());
  if (!inside && !reclaim) return;
  const controls = [...region.querySelectorAll<HTMLElement>(CANDIDATES)];
  const target = refocusTarget(
    controls.map((el) => ({ key: el.dataset.navKey, disabled: (el as HTMLButtonElement).disabled === true, preferred: el.hasAttribute('data-autofocus') })),
    key,
  );
  if (target === PARK) parked.set(region, key);
  else controls[target].focus({ preventScroll: true });
}
