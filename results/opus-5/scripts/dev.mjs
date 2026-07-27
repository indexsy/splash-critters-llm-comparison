#!/usr/bin/env node
/**
 * Development runner: rebuilds `shared` on change, restarts the server, and
 * serves the client through Vite with a proxy onto the server. One Ctrl-C
 * takes all three down.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COLORS = {
  shared: '\u001b[36m',
  server: '\u001b[32m',
  client: '\u001b[35m',
};
const RESET = '\u001b[0m';

const TASKS = [
  { name: 'shared', args: ['run', 'dev', '-w', '@splash/shared'] },
  { name: 'server', args: ['run', 'dev', '-w', '@splash/server'] },
  { name: 'client', args: ['run', 'dev', '-w', '@splash/client'] },
];

const children = [];
let shuttingDown = false;

function prefix(name, chunk) {
  const color = COLORS[name] ?? '';
  return String(chunk)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `${color}[${name}]${RESET} ${line}`)
    .join('\n');
}

function launch({ name, args }) {
  const child = spawn('npm', args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => {
    const text = prefix(name, chunk);
    if (text) console.log(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = prefix(name, chunk);
    if (text) console.error(text);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${prefix(name, `exited (code ${code}, signal ${signal})`)}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Splash Critters dev: server on http://localhost:3000, client on http://localhost:5173');
for (const task of TASKS) launch(task);
