import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tools/**/*.test.ts', 'tests/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['./tools/test/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
