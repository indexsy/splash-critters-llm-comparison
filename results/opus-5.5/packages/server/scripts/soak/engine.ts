// The soak's match engine (match runner, sim and bots) is bundled with esbuild into one plain ES
// module before any match runs: worker threads load it directly and a single-worker run imports it
// in-process. Running the bots from the bundle instead of through tsx's on-the-fly module interop
// makes every match about two and a half times faster.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export interface Engine {
  /** Absolute path of the bundled worker module (it also exports playAndVerify). */
  path: string;
  /** Deletes the bundle. */
  dispose(): void;
}

export async function bundleEngine(): Promise<Engine> {
  const dir = mkdtempSync(join(tmpdir(), 'splash-soak-'));
  const path = join(dir, 'engine.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
    outfile: path,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    logLevel: 'warning',
  });
  return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
