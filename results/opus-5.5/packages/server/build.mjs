// Bundles the server (and @splash/shared, which ships as TS source) into dist/index.js.
// Native / runtime deps stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: ['ws', 'express', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
  banner: {
    // esbuild ESM output needs a require shim for any CJS interop inside bundled code.
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
