import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@splash/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
