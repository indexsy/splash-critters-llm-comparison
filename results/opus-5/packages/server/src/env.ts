/**
 * Typed environment, read once at import time.
 *
 * Paths resolve from this module's own URL rather than process.cwd(), so the
 * server finds the data directory and the client build no matter which
 * directory it was launched from (npm workspaces love to move the goalposts).
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Env {
  port: number;
  /** Where splash.db lives. Created on boot when missing. */
  dataDir: string;
  nodeEnv: string;
  /**
   * Dev flag: delay every outbound socket message by this many ms. Set it to
   * 120 and the client's prediction and interpolation have to earn their keep.
   */
  artificialLatencyMs: number;
  /** Built client assets. Missing is fine: the API still serves. */
  clientDir: string;
  repoRoot: string;
}

/** src/ during tsx dev, dist/ once compiled - both sit one level under the package. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readPath(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim();
  // A relative override is relative to where the operator ran the server, which
  // is the only place cwd is the honest answer.
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

export const ENV: Env = {
  port: readInt('PORT', 3000, 1, 65535),
  dataDir: readPath('DATA_DIR', resolve(repoRoot, 'data')),
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  artificialLatencyMs: readInt('ARTIFICIAL_LATENCY_MS', 0, 0, 5000),
  clientDir: readPath('CLIENT_DIR', resolve(repoRoot, 'packages', 'client', 'dist')),
  repoRoot,
};
