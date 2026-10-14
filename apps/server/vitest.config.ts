import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: { target: 'node', external: ['node:sqlite'] },
  test: {
    include: ['src/**/*.test.ts'],
    server: { deps: { external: [/sqlite/] } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});