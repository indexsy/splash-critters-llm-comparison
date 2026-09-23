// Per-tab identity slots. localStorage is shared by every tab of an origin, so without this two
// tabs would log in as the same player (and fight over one account). Each tab holds a Web Lock
// on the lowest free slot for its lifetime: slot 0 is the everyday account ('splash.token'),
// extra simultaneous tabs get slot 1, 2, ... with their own persisted token
// ('splash.token.1', ...). `?identity=N` forces a slot (handy for testing).

const BASE_KEY = 'splash.token';
const MAX_SLOTS = 8;

export interface IdentitySlot {
  slot: number;
  storageKey: string;
}

function keyFor(slot: number): string {
  return slot === 0 ? BASE_KEY : `${BASE_KEY}.${slot}`;
}

function forcedSlot(): number | null {
  const raw = new URLSearchParams(window.location.search).get('identity');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 100 ? n : null;
}

/** Try to take the lock for `name` and hold it until the tab closes. Resolves false if taken. */
function holdLock(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>(() => {
          // Never settles: the lock is released when the page unloads.
        });
      })
      .catch(() => resolve(false));
  });
}

/** Claim this tab's identity slot. Falls back to slot 0 where Web Locks are unavailable. */
export async function acquireIdentitySlot(): Promise<IdentitySlot> {
  const forced = forcedSlot();
  if (forced !== null) return { slot: forced, storageKey: keyFor(forced) };
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return { slot: 0, storageKey: BASE_KEY };
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    if (await holdLock(`splash-identity-${slot}`)) return { slot, storageKey: keyFor(slot) };
  }
  return { slot: 0, storageKey: BASE_KEY };
}
