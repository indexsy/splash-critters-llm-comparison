/**
 * Development launcher: builds the shared package, then runs the game server
 * (with hot reload) and the Vite dev server side by side.
 *
 *   npm run dev   ->  server on :3000, client on :5173
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(command, args, cwd, name, color) {
  const child = spawn(command, args, { cwd, shell: process.platform === 'win32' });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, target) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString().trimEnd();
      if (!text) return;
      for (const line of text.split('\n')) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${prefix}exited with ${code}`);
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] building the shared package…');
const build = spawn('npm', ['run', 'build', '--workspace=packages/shared'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
build.on('exit', (code) => {
  if (code !== 0) {
    console.error('[dev] the shared package failed to build');
    process.exit(code ?? 1);
  }
  run('npm', ['run', 'dev', '--workspace=packages/server'], root, 'server', '36');
  run('npm', ['run', 'dev', '--workspace=packages/client'], root, 'client', '35');
});
