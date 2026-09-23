// Shared harness for the browser acceptance scripts (packages/client/e2e/*.mjs).
//
// Every flow drives the REAL built client in headless Chromium against the REAL built server,
// using only user input (keyboard / mouse). The harness:
//  - resolves Playwright (from this repo, or from PLAYWRIGHT_FROM=<dir or package.json> of a
//    project that has it installed). The repo does not declare Playwright: it is a large
//    optional download that `npm ci` (Docker, CI) should not pull. To install it here:
//    `npm install --no-save playwright && npx playwright install chromium`,
//  - either uses a running server (E2E_BASE=http://localhost:PORT [+ E2E_DATA_DIR for SQLite
//    checks]) or boots packages/server/dist/index.js on an ephemeral port with a temp DATA_DIR,
//  - records console errors / page errors per page and saves screenshots to E2E_OUT
//    (default <repo>/output/e2e-browser). E2E_PORT pins the spawned server's port.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../../..');
export const OUT_DIR = resolve(process.env.E2E_OUT ?? join(REPO, 'output/e2e-browser'));
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Playwright + server
// ---------------------------------------------------------------------------

function requireFrom(anchor) {
  const pkg = anchor.endsWith('.json') ? anchor : join(anchor, 'package.json');
  return createRequire(pkg);
}

/** Playwright's chromium, from this repo or from PLAYWRIGHT_FROM. */
export function loadChromium() {
  const anchors = [join(REPO, 'package.json')];
  if (process.env.PLAYWRIGHT_FROM) anchors.unshift(process.env.PLAYWRIGHT_FROM);
  for (const anchor of anchors) {
    try {
      return requireFrom(anchor)('playwright').chromium;
    } catch {
      // try the next anchor
    }
  }
  throw new Error(
    'Playwright not found. Install it without touching package.json (npm install --no-save playwright && npx playwright install chromium), ' +
      'or set PLAYWRIGHT_FROM to a project directory that has it.',
  );
}

/**
 * The server under test. E2E_BASE points at a running one (E2E_DATA_DIR = its DATA_DIR, for
 * SQLite assertions); otherwise the built server is started on a free port and stopped by close().
 */
export async function startServer() {
  if (process.env.E2E_BASE) {
    return { base: process.env.E2E_BASE.replace(/\/$/, ''), dataDir: process.env.E2E_DATA_DIR ?? null, close: async () => {} };
  }
  const entry = join(REPO, 'packages/server/dist/index.js');
  if (!existsSync(entry)) throw new Error('Build first: npm run build');
  const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'splash-e2e-'));
  const env = { ...process.env, PORT: process.env.E2E_PORT ?? '0', DATA_DIR: dataDir };
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('server did not start within 15 s')), 15000);
    child.stdout.on('data', (buf) => {
      const m = /on (http:\/\/localhost:\d+)/.exec(String(buf));
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    child.stderr.on('data', (buf) => process.stderr.write(`[server] ${buf}`));
    child.on('exit', (code) => fail(new Error(`server exited early (${code})`)));
  });
  const close = () =>
    new Promise((ok) => {
      if (child.exitCode !== null) return ok();
      child.once('exit', () => ok());
      child.kill('SIGTERM');
    });
  return { base, dataDir, close };
}

/** Read-only SQLite handle on the server's database (better-sqlite3 from the server package). */
export function openDb(dataDir) {
  const Database = createRequire(join(REPO, 'packages/server/package.json'))('better-sqlite3');
  return new Database(join(dataDir, 'splash.db'), { readonly: true, fileMustExist: true });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Wire console/page error capture onto a page; errors land in page.__errors. */
function watchErrors(page, label) {
  page.__errors = [];
  page.__label = label;
  page.on('console', (msg) => {
    if (msg.type() === 'error') page.__errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => page.__errors.push(`pageerror: ${err.message}`));
  return page;
}

/**
 * Runs in the page before any game script: the owner asked for no game music in test browsers,
 * so the shared settings blob always carries musicVolume 0 (sound effects are left alone).
 */
function keepMusicOff() {
  try {
    const raw = localStorage.getItem('splash.settings');
    const saved = raw ? JSON.parse(raw) : {};
    if (saved.musicVolume !== 0) localStorage.setItem('splash.settings', JSON.stringify({ ...saved, musicVolume: 0 }));
  } catch {
    // Storage unavailable: the game then runs on defaults (and the flow's own mute).
  }
}

/**
 * A page with game music forced off. The audio flow passes { music: true } because it measures
 * the music itself (Playwright's Chromium runs with --mute-audio, so nothing reaches speakers).
 */
export async function newPage(context, label, opts = {}) {
  const page = await context.newPage();
  if (!opts.music) await page.addInitScript(keepMusicOff);
  return watchErrors(page, label);
}

export function errorsOf(...pages) {
  return pages.flatMap((p) => (p.__errors ?? []).map((e) => `[${p.__label}] ${e}`));
}

export async function shot(page, name) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  log(`  screenshot ${path}`);
  return path;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...args) {
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}]`, ...args);
}

/** Click the visible button whose text matches `name` (string or RegExp). */
export async function clickButton(page, name, opts = {}) {
  const loc = page.getByRole('button', { name, exact: typeof name === 'string' ? opts.exact ?? true : undefined });
  await loc.first().click({ timeout: opts.timeout ?? 10000 });
}

/** Wait for the router to show `screen` (the data-screen attribute of the mounted root). */
export async function waitScreen(page, screen, timeout = 15000) {
  await page.locator(`.screen-root[data-screen="${screen}"]`).waitFor({ state: 'attached', timeout });
}

/** The opt-in diagnostics handle (?netstats=1) exposed by the client. */
export async function stats(page) {
  return page.evaluate(() => window.splashNetStats?.report() ?? null);
}

/** Result bookkeeping: each check prints PASS/FAIL and the process exit code follows. */
export class Checks {
  constructor(name) {
    this.name = name;
    this.items = [];
  }

  ok(label, cond, detail = '') {
    this.items.push({ label, pass: !!cond, detail });
    log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
    return !!cond;
  }

  finish() {
    const failed = this.items.filter((i) => !i.pass);
    log(`${this.name}: ${this.items.length - failed.length}/${this.items.length} checks passed`);
    if (failed.length) process.exitCode = 1;
    return failed.length === 0;
  }
}
