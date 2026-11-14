import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own `include` and excludes `dist` (Vitest 4
// no longer does the latter by default).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
