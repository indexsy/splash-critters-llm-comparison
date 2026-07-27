import { defineConfig } from 'vite';

const SERVER = process.env.SPLASH_SERVER ?? 'http://localhost:3000';

const VERSION = process.env.npm_package_version ?? '1.0.0';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
