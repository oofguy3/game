import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/game/',
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 30000,
  },
});
