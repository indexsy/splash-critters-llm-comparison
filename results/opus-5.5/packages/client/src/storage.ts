// Crash-proof key/value persistence. localStorage can be missing, full, or throw (private
// mode, blocked cookies, sandboxed iframes); every access is wrapped and mirrored into an
// in-memory map so the session keeps working even when nothing can be persisted.

const memory = new Map<string, string>();

function readPersistent(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePersistent(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or full: the in-memory copy still serves this session.
  }
}

export const storage = {
  get(key: string): string | null {
    return readPersistent(key) ?? memory.get(key) ?? null;
  },

  set(key: string, value: string): void {
    memory.set(key, value);
    writePersistent(key, value);
  },

  /** Parsed JSON value, or null when missing or malformed. */
  getJson(key: string): unknown {
    const raw = storage.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  },

  setJson(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value));
  },
};
