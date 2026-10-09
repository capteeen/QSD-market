import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Independent verification: no mocks of the packages under test.
    environment: 'node',
    pool: 'forks',
  },
});
