import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own include and excludes dist.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
