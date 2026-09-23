// npm run e2e: boots the real server in-process (real bots, temp DATA_DIR, ephemeral port) and
// drives the acceptance flows over real WebSockets with headless clients, concurrently where they
// cannot interfere. Prints PASS/FAIL per flow with timings and exits 1 on any failure.
//
//   npm run e2e -- [--only a,b] [--fast-speed N] [--lag-ms N] [--data-root DIR] [--keep-data] [--verbose]
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '@splash/shared';
import { FLOW_PLAN, type PlannedFlow, type ServerName } from './e2e/plan';
import { bootServer, runFlow, type FlowResult, type ServerEnv } from './e2e/harness';

interface E2eOptions {
  only: Set<string> | null;
  fastSpeed: number;
  /** DEV_LAG_MS of the lagged server. */
  lagMs: number;
  /** Parent directory of the temporary DATA_DIRs (default: the OS temp dir). */
  dataRoot: string;
  keepData: boolean;
  verbose: boolean;
}

const USAGE = `Usage: npm run e2e -- [--only flow1,flow2] [--fast-speed N] [--lag-ms N] [--data-root DIR] [--keep-data] [--verbose]
  --only        run only these flows (${FLOW_PLAN.map((f) => f.spec.name).join(', ')})
  --fast-speed  clock speed of the second server that hosts the long casual 4p match (default 4, 1 = real time)
  --lag-ms      DEV_LAG_MS (per direction) of the third server that hosts the latency flow (default 150)
  --data-root   where the temporary DATA_DIRs are created (default: the OS temp dir)
  --keep-data   keep the temporary DATA_DIRs (SQLite files) for inspection
  --verbose     print every check of every flow`;

function parseArgs(argv: string[]): E2eOptions {
  const opts: E2eOptions = { only: null, fastSpeed: 4, lagMs: 150, dataRoot: tmpdir(), keepData: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only') opts.only = new Set((argv[++i] ?? '').split(',').filter(Boolean));
    else if (arg === '--fast-speed') opts.fastSpeed = Number(argv[++i]);
    else if (arg === '--lag-ms') opts.lagMs = Number(argv[++i]);
    else if (arg === '--data-root') opts.dataRoot = resolve(argv[++i] ?? '');
    else if (arg === '--keep-data') opts.keepData = true;
    else if (arg === '--verbose') opts.verbose = true;
    else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  if (!Number.isFinite(opts.fastSpeed) || opts.fastSpeed < 1 || opts.fastSpeed > 8) {
    console.error(`--fast-speed must be between 1 and 8\n${USAGE}`);
    process.exit(2);
  }
  if (!Number.isInteger(opts.lagMs) || opts.lagMs < 0 || opts.lagMs > 1000) {
    console.error(`--lag-ms must be an integer between 0 and 1000\n${USAGE}`);
    process.exit(2);
  }
  const unknown = [...(opts.only ?? [])].filter((name) => !FLOW_PLAN.some((f) => f.spec.name === name));
  if (unknown.length > 0) {
    console.error(`Unknown flow(s): ${unknown.join(', ')}\n${USAGE}`);
    process.exit(2);
  }
  return opts;
}

function clientDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../client/dist');
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function printResult(r: FlowResult, verbose: boolean): void {
  const game = Math.abs(r.gameMs - r.wallMs) > 1000 ? ` (game time ${seconds(r.gameMs)})` : '';
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(20)} [${r.server}] ${seconds(r.wallMs)}${game}`);
  for (const note of r.notes) if (verbose || !note.startsWith('ok: ')) console.log(`      ${note}`);
  if (r.error) console.log(`      ERROR: ${r.error}`);
}

/**
 * Longest the server may take to let go after the last client left: a player who leaves once the
 * deciding round is over is released and that match still plays out its settling and round-end
 * card before it finishes (by design), so allow that plus slack.
 */
function settleWallMs(env: ServerEnv): number {
  return (CONFIG.ROUND_OVER_DELAY_MS + CONFIG.ROUND_END_MS) / env.speed + 3000;
}

/**
 * After the flows every client socket is gone: the server must still answer /health and hold no
 * sessions and no running matches. Lobby rooms emptied by disconnects are not listed and are
 * collected after ROOM_EMPTY_TTL_MS (by design), so they are only reported.
 */
async function settle(env: ServerEnv): Promise<FlowResult> {
  const started = performance.now();
  let health = env.server.health();
  while ((health.players > 0 || health.matches > 0) && performance.now() - started < settleWallMs(env)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    health = env.server.health();
  }
  const http = await env.getJson<{ ok: boolean }>('/health');
  const clean = http.status === 200 && http.body.ok && health.players === 0 && health.matches === 0;
  const result: FlowResult = {
    name: 'server-settles',
    server: env.name,
    ok: clean,
    wallMs: performance.now() - started,
    gameMs: 0,
    notes: [
      `GET /health ${http.status} ok=${http.body.ok}; sessions ${health.players}, running matches ${health.matches}, rooms ${health.rooms} (empty lobbies expire after ${CONFIG.ROOM_EMPTY_TTL_MS / 1000} s), uptime ${health.uptime} s`,
    ],
    error: clean ? null : 'sessions or running matches left behind after every client disconnected',
  };
  printResult(result, false);
  return result;
}

/** Flows of one lane run one after another (they would steal each other's queue matches). */
async function runLane(lane: PlannedFlow[], envs: Partial<Record<ServerName, ServerEnv>>, verbose: boolean): Promise<FlowResult[]> {
  const results: FlowResult[] = [];
  for (const planned of lane) {
    const result = await runFlow(planned.spec, envs[planned.server]!, planned.seed);
    printResult(result, verbose);
    results.push(result);
  }
  return results;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const planned = FLOW_PLAN.filter((f) => !opts.only || opts.only.has(f.spec.name));
  mkdirSync(opts.dataRoot, { recursive: true });
  const root = mkdtempSync(join(opts.dataRoot, 'splash-e2e-'));
  const dist = clientDist();
  const started = performance.now();
  const envs: Partial<Record<ServerName, ServerEnv>> = {};
  let results: FlowResult[] = [];
  try {
    const needs = (name: ServerName) => planned.some((f) => f.server === name);
    if (needs('realtime')) envs.realtime = await bootServer({ name: 'realtime', root, clientDist: dist, speed: 1 });
    if (needs('fast')) envs.fast = await bootServer({ name: 'fast', root, clientDist: dist, speed: opts.fastSpeed });
    if (needs('lagged')) envs.lagged = await bootServer({ name: 'lagged', root, clientDist: dist, speed: 1, lagMs: opts.lagMs });
    const described = Object.values(envs)
      .map((e) => `${e.name} :${e.port} speed x${e.speed}${e.lagMs > 0 ? ` DEV_LAG_MS ${e.lagMs}` : ''}`)
      .join(', ');
    console.log(`Splash Critters e2e: ${planned.length} flow(s); servers ${described}; client dist ${existsSync(dist) ? dist : 'missing'}`);
    const lanes = new Map<string, PlannedFlow[]>();
    for (const f of planned) lanes.set(f.lane, [...(lanes.get(f.lane) ?? []), f]);
    results = (await Promise.all([...lanes.values()].map((lane) => runLane(lane, envs, opts.verbose)))).flat();
    for (const env of Object.values(envs)) results.push(await settle(env));
  } finally {
    for (const env of Object.values(envs)) await env.close();
    if (opts.keepData) console.log(`DATA_DIRs kept under ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flows passed in ${seconds(performance.now() - started)} (wall).`);
  if (failed.length > 0) console.log(`E2E FAILED: ${failed.map((r) => r.name).join(', ')}`);
  process.exitCode = failed.length > 0 || results.length === 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err);
  console.log('E2E FAILED');
  process.exitCode = 1;
});
