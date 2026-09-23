// REST reads for the leaderboard screen (same origin: Vite proxies /api in dev, the server
// serves it in production). Every call has a timeout and resolves to validated data or throws.
import type { LeaderboardEntry, Mode, PublicProfile } from '@splash/shared';
import { parseLeaderboard, parsePublicProfile } from './apiParse';

const TIMEOUT_MS = 8000;

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(path, { signal: timeout.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : `Server error (${res.status})`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchLeaderboard(mode: Mode, signal?: AbortSignal): Promise<LeaderboardEntry[]> {
  const rows = parseLeaderboard(await getJson(`/api/leaderboard?mode=${mode}`, signal));
  if (!rows) throw new Error('Unexpected leaderboard data');
  return rows;
}

export async function fetchPublicProfile(id: string, signal?: AbortSignal): Promise<PublicProfile> {
  const profile = parsePublicProfile(await getJson(`/api/profile/${encodeURIComponent(id)}`, signal));
  if (!profile) throw new Error('Unexpected profile data');
  return profile;
}

/** Human text for a failed request (an abort here means our own timeout fired). */
export function requestError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'The server took too long to answer.';
  if (err instanceof TypeError) return 'Could not reach the server.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}
