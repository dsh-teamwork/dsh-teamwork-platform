import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own `include` and excludes `dist`: Vitest 4
// dropped `**/dist/**` from its default exclude, so a compiled copy of a suite
// would otherwise run a second time against the last build.
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
    // The database suites share one database and clear the tables they touch.
    fileParallelism: false,
  },
});
