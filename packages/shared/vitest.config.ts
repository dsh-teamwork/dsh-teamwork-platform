import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own `include` and excludes `dist` (Vitest 4
// no longer does the latter by default).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Without DATABASE_URL the database suites run on a PGlite of their own,
    // in memory, so they never touch the developer's data directory.
    env: { PGLITE_DIR: process.env.PGLITE_DIR || 'memory://' },
    // A run's first query initialises that PGlite and applies every migration:
    // two seconds alone, past Vitest's five-second default on a loaded machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The database suites share one database and clear what they touch.
    fileParallelism: false,
  },
  resolve: {
    // `server-only` throws outside a React Server Component build, which a
    // test is; the guard it provides is the bundler's, not the test's.
    alias: { 'server-only': path.resolve(__dirname, './src/server/test-empty.ts') },
  },
});
