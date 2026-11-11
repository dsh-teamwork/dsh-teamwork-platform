import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own `include` and excludes `dist` (Vitest 4
// no longer does the latter by default).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // The database suites share one Postgres and clear what they touch.
    fileParallelism: false,
  },
  resolve: {
    // `server-only` throws outside a React Server Component build, which a
    // test is; the guard it provides is the bundler's, not the test's.
    alias: { 'server-only': path.resolve(__dirname, './src/server/test-empty.ts') },
  },
});
