// Runs the browser acceptance flows against one server (the built one started here on a fresh
// DATA_DIR, or E2E_BASE/E2E_DATA_DIR when given) and prints a summary.
//   npm run build && npm run e2e:browser -w @splash/client [-- flow1 flow4 ...]
// Needs Playwright (not a declared dependency): `npm install --no-save playwright && npx
// playwright install chromium`, or PLAYWRIGHT_FROM=<a project dir that has it>.
// Screenshots go to output/e2e-browser (E2E_OUT to change). Flow 2 plays a full 4P match
// against two Hard bots, which takes 8-35 minutes (the bots decide how many rounds it needs).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, startServer } from './lib.mjs';

const FLOWS = {
  flow1: 'flow1-tutorial.mjs',
  flow2: 'flow2-casual.mjs',
  flow3: 'flow3-ranked.mjs',
  flow4: 'flow4-netcode.mjs',
  flow5: 'flow5-audio.mjs',
  flow6: 'flow6-screens.mjs',
};

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const unknown = wanted.filter((f) => !FLOWS[f]);
if (unknown.length) {
  console.error(`Unknown flow(s): ${unknown.join(', ')}. Choose from: ${Object.keys(FLOWS).join(', ')}`);
  process.exit(2);
}
const selected = wanted.length ? wanted : Object.keys(FLOWS);

function runFlow(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const server = await startServer();
const env = { ...process.env, E2E_BASE: server.base, E2E_DATA_DIR: server.dataDir ?? '' };
log(`server ${server.base} (data ${server.dataDir ?? 'unknown'})`);
const results = [];
try {
  for (const name of selected) {
    log(`=== ${name} (${FLOWS[name]})`);
    const started = Date.now();
    const code = await runFlow(FLOWS[name], env);
    results.push({ name, ok: code === 0, secs: Math.round((Date.now() - started) / 1000) });
  }
} finally {
  await server.close();
}
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.secs} s)`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
