// Bundles the server (with shared source inlined) into a single ESM file.
// Node built-ins and node_modules deps (ws, express, better-sqlite3) stay external.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(root, 'packages/server/dist/index.js'),
  // Keep real node_modules deps external (native / heavy), but BUNDLE the
  // @splash/shared workspace source into the output.
  external: ['ws', 'express', 'better-sqlite3'],
  sourcemap: true,
  logLevel: 'info',
  banner: {
    // better-sqlite3 & friends are CJS; give the bundle a require() shim for ESM output.
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('server bundled -> packages/server/dist/index.js');
